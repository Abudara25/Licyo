// Validation automatique des paiements HelloAsso (appelée par functions/api/helloasso-notification.js).
// HelloAsso ne signe pas ses notifications (vérifié dans la documentation développeur le 2026-09-15) :
// l'URL enregistrée chez HelloAsso contient le secret de notification du club, et si ses identifiants
// API (identifiant et secret, enregistrés chiffrés dans /admin/parametres, voir integrations.js) sont configurés, la commande est relue auprès de l'API
// HelloAsso (GET /v5/orders/{id}) plutôt que de faire confiance au contenu reçu.
// Rattachement : formulaire HelloAsso d'une catégorie (liens de /admin/categories), puis fiche non payée
// de la saison dont le nom de l'enfant correspond au participant — l'e-mail du payeur départage ou,
// pour une commande d'un seul participant, suffit s'il ne désigne qu'une fiche. Sinon, alerte au club.
import { ensureInscriptionsTable, normalize } from './inscriptions-db.js';
import { getCategoriesConfig } from './settings-kv.js';
import { helloAssoCredentials } from './integrations.js';
import { sendHelloAssoAlert } from './confirmation-email.js';
import { afterInscriptionChange } from './automations.js';

// Une ligne par commande traitée : évite de traiter deux fois une notification renvoyée par HelloAsso,
// et garde une trace de ce qui n'a pas pu être rattaché.

async function fetchVerifiedOrder(credentials, orderId) {
  const tokenRes = await fetch('https://api.helloasso.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.clientId, client_secret: credentials.clientSecret }),
  });
  if (!tokenRes.ok) throw new Error(`HelloAsso token ${tokenRes.status}`);
  const { access_token: accessToken } = await tokenRes.json();
  const orderRes = await fetch(`https://api.helloasso.com/v5/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!orderRes.ok) throw new Error(`HelloAsso order ${orderRes.status}`);
  return orderRes.json();
}

// ".../adhesions/adhesion-u6-u7-club-demo" (ou ".../widget") → "adhesion-u6-u7-club-demo"
const formSlugs = (categories) =>
  new Set(
    categories
      .flatMap((c) => [c.helloAssoUrl, c.helloAssoWidgetUrl])
      .filter(Boolean)
      .map((url) => url.replace(/\/widget\/?$/, '').replace(/\/+$/, '').split('/').pop())
  );

const isPaid = (order) =>
  (order.payments || []).some((p) => p.state === 'Authorized' || p.state === 'Registered') || (order.items || []).some((i) => i.state === 'Processed');

const cleanName = (value) => normalize(value).replace(/[^a-z0-9]+/g, ' ').trim();
const sameName = (row, user) => Boolean(user) && cleanName(row.enfant_prenom) === cleanName(user.firstName) && cleanName(row.enfant_nom) === cleanName(user.lastName);
const sameEmail = (row, email) => Boolean(email) && [row.email, row.parent2_email].some((e) => e && normalize(e) === normalize(email));

// organizationId : organisation du domaine qui reçoit la notification (functions/api/helloasso-notification.js).
// Seules ses fiches peuvent être rattachées à la commande.
export async function processHelloAssoOrder(env, data, siteUrl, waitUntil, organizationId) {
  if (!organizationId) throw new Error('processHelloAssoOrder : organisation requise');
  const orderId = String(data?.id || '');
  if (!orderId) return { status: 'ignored', reason: 'commande sans identifiant' };

  await ensureInscriptionsTable(env.DB);
  if (await env.DB.prepare('SELECT order_id FROM helloasso_orders WHERE organization_id = ? AND order_id = ?').bind(organizationId, orderId).first()) {
    return { status: 'duplicate' };
  }

  // Identifiants API de l'organisation (jamais ceux d'une autre) : voir _shared/integrations.js.
  const credentials = await helloAssoCredentials(env, organizationId);
  const verified = Boolean(credentials.clientId && credentials.clientSecret);
  const order = verified ? await fetchVerifiedOrder(credentials, orderId) : data;
  const record = (status, ids, detail) =>
    env.DB.prepare(
      'INSERT INTO helloasso_orders (organization_id, order_id, status, inscription_ids, payer_email, detail) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, order_id) DO NOTHING'
    )
      .bind(organizationId, orderId, status, ids.join(','), order.payer?.email || null, detail)
      .run();

  const { saison, categories } = await getCategoriesConfig(env, organizationId);
  if (!formSlugs(categories).has(order.formSlug)) {
    await record('ignored', [], `formulaire ${order.formSlug || 'inconnu'}`);
    return { status: 'ignored', reason: 'formulaire hors adhésions' };
  }
  // Pas encore payée : rien n'est enregistré, pour qu'une notification ultérieure puisse la traiter.
  if (!isPaid(order)) return { status: 'unpaid' };

  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL AND paye = 0').bind(organizationId).all();
  const candidates = results.filter((r) => !r.saison || r.saison === saison);
  const participants = (order.items || []).filter((i) => i.user && !i.isCanceled).map((i) => i.user);
  const people = participants.length ? participants : [order.payer];
  const payerEmail = order.payer?.email;

  const matched = [];
  for (const user of people) {
    const pool = candidates.filter((r) => !matched.includes(r));
    const byName = pool.filter((r) => sameName(r, user));
    const byNameAndEmail = byName.filter((r) => sameEmail(r, payerEmail));
    const byEmail = pool.filter((r) => sameEmail(r, payerEmail));
    const pick =
      byNameAndEmail.length === 1 ? byNameAndEmail[0] : byName.length === 1 ? byName[0] : people.length === 1 && byEmail.length === 1 ? byEmail[0] : null;
    if (pick) matched.push(pick);
  }

  // Réserver la commande et appliquer ses paiements dans une seule transaction.
  // La clé primaire protège aussi contre deux notifications simultanées.
  const statements = [
    env.DB.prepare('INSERT INTO helloasso_orders (organization_id, order_id, status, payer_email, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(organizationId, orderId, 'processing', payerEmail || null, verified ? "vérifiée via l'API HelloAsso" : 'non vérifiée (identifiants API absents)'),
    ...matched.map((row) => env.DB.prepare(
      'UPDATE inscriptions SET paye = 1, helloasso_order_id = ? WHERE organization_id = ? AND id = ? AND paye = 0 AND archived_at IS NULL'
    ).bind(orderId, organizationId, row.id)),
    // Une autre commande ou un responsable peut avoir payé/archivé une fiche depuis sa lecture.
    // Le compte rendu reflète uniquement les fiches effectivement rattachées à cette commande.
    env.DB.prepare(`UPDATE helloasso_orders SET
      inscription_ids = (SELECT COALESCE(group_concat(id), '') FROM inscriptions WHERE organization_id = ?3 AND helloasso_order_id = ?1),
      status = CASE
        WHEN (SELECT COUNT(*) FROM inscriptions WHERE organization_id = ?3 AND helloasso_order_id = ?1) = 0 THEN 'unmatched'
        WHEN (SELECT COUNT(*) FROM inscriptions WHERE organization_id = ?3 AND helloasso_order_id = ?1) < ?2 THEN 'partial'
        ELSE 'matched' END
      WHERE organization_id = ?3 AND order_id = ?1`).bind(orderId, people.length, organizationId),
    env.DB.prepare('SELECT status, inscription_ids FROM helloasso_orders WHERE organization_id = ? AND order_id = ?').bind(organizationId, orderId),
  ];
  let committed;
  try {
    committed = await env.DB.batch(statements);
  } catch (error) {
    // Seul un conflit sur la commande signifie "déjà traité" ; une panne reste retentable.
    if (/UNIQUE constraint failed: helloasso_orders\./i.test(String(error?.message)) &&
        await env.DB.prepare('SELECT order_id FROM helloasso_orders WHERE organization_id = ? AND order_id = ?').bind(organizationId, orderId).first()) {
      return { status: 'duplicate' };
    }
    throw error;
  }
  const { status, inscription_ids: ids } = committed.at(-1).results[0];
  const paidIds = ids ? ids.split(',').map(Number) : [];
  for (const [index, row] of matched.entries()) {
    if (!committed[index + 1].meta.changes) continue;
    const task = afterInscriptionChange(env, { organizationId, id: row.id, before: row, step: 'paiement', source: 'helloasso', siteUrl });
    if (waitUntil) waitUntil(task);
    else await task;
  }

  if (status !== 'matched') {
    const alert = sendHelloAssoAlert(env, siteUrl, {
      orderId,
      payer: order.payer,
      participants: people.map((u) => `${u?.firstName || ''} ${u?.lastName || ''}`.trim()),
      amount: order.amount?.total,
      organizationId,
      reason: status === 'partial' ? 'une partie des participants seulement a été reconnue' : 'aucune inscription correspondante trouvée',
    });
    if (waitUntil) waitUntil(alert);
    else await alert;
  }

  return { status, matched: paidIds };
}
