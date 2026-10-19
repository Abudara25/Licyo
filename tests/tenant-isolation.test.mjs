// Isolation entre organisations. L'organisation B (« Test Association ») n'existe QUE dans ces tests :
// la production ne contient que Club Démo (A). Depuis A, toute lecture, modification, suppression,
// accès fichier ou export d'une donnée de B doit échouer, côté admin comme côté pages publiques.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, handleLogin, isAuthed } from '../functions/_shared/admin-auth.js';
import { setInscriptionStatus, setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import * as inscriptionStatusAdmin from '../functions/admin/inscription-status.js';
import * as inscriptionStatusApi from '../functions/api/inscription-status.js';
import * as categoriesApi from '../functions/api/categories.js';
import * as helloassoWebhook from '../functions/api/helloasso-notification.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import * as list from '../functions/admin/inscriptions.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as dossier from '../functions/admin/inscriptions/[id]/dossier.js';
import * as photo from '../functions/admin/inscriptions/[id]/photo.js';
import * as verification from '../functions/admin/inscriptions/[id]/verification.js';
import * as apercu from '../functions/admin/inscriptions/[id]/apercu.js';
import * as dashboard from '../functions/admin/dashboard.js';
import * as events from '../functions/admin/events.js';
import * as depot from '../functions/depot/[token].js';
import * as depotPhoto from '../functions/depot/[token]/photo.js';
import * as depotPaiement from '../functions/depot/[token]/paiement.js';
import * as reinscription from '../functions/reinscription/[token].js';
import * as api from '../functions/api/inscriptions.js';
import { processHelloAssoOrder } from '../functions/_shared/helloasso.js';
import { logEmail } from '../functions/_shared/email-log.js';
import { ensureSiteEventsTable } from '../functions/_shared/site-events.js';
import { DEFAULT_CATEGORIES_CONFIG } from '../functions/_shared/settings-kv.js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';
import { createR2 } from './helpers/d1.mjs';
import { testUser, TEST_PASSWORD } from './helpers/accounts.mjs';

const ORG_B = 'org_test_association';
const SITE_A = 'https://clubdemo.licyo.fr';
const SITE_B = 'https://association-test.example';

let shared;
const setup = () => (shared ??= createSetup());
async function createSetup() {
  clearOrganizationCache();
  const env = {
    ...(await fixture()),
    ADMIN_PASSWORD: 'x',
    BREVO_API_KEY: 'test',
    DOSSIERS: createR2(),
    DOSSIERS_BACKUP: createR2(),
    ASSETS: { fetch: async () => new Response('Page introuvable', { status: 404 }) },
  };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'test-association', 'Test Association', 'cultural_association')").bind(ORG_B).run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('association-test.example', ?)").bind(ORG_B).run();

  const a = await seedInscription(env.DB, { enfant_prenom: 'Adam', enfant_nom: 'Martin', email: 'a@example.fr' });
  const b = await seedInscription(env.DB, {
    organization_id: ORG_B,
    enfant_prenom: 'Bérénice',
    enfant_nom: 'Secret',
    email: 'b@example.fr',
    archived_at: '2026-09-20 10:00:00',
    reinscription_token: 'reinscription-b',
    dossier_key: 'dossiers/b',
    dossier_content_type: 'application/pdf',
    dossier_uploaded_at: '2026-09-10 10:00:00',
    photo_key: 'photos/b',
    photo_content_type: 'image/jpeg',
    photo_uploaded_at: '2026-09-10 10:00:00',
  });
  for (const bucket of [env.DOSSIERS, env.DOSSIERS_BACKUP]) {
    await bucket.put('dossiers/b', 'pdf-b');
    await bucket.put('photos/b', 'jpg-b');
  }
  await logEmail(env, { to: [{ email: 'b@example.fr' }], subject: 'Relance Bérénice' }, { kind: 'relance', inscriptionId: b.id, organizationId: ORG_B }, { ok: true, status: 201 });
  // Mesure d'audience de B (R0a) : ni ses compteurs ni ses routes ne doivent apparaître chez A.
  await ensureSiteEventsTable(env.DB);
  await env.DB.prepare("INSERT INTO site_events (organization_id, event, page) VALUES (?, 'contact_form_submit', '/route-secrete-b')").bind(ORG_B).run();

  const cookieA = (await createSession(env, DEMO_ORG_ID, await testUser(env, DEMO_ORG_ID))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const cookieB = (await createSession(env, ORG_B, await testUser(env, ORG_B))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, a, b, cookieA, cookieB };
}

const req = (url, { cookie, method = 'GET', body } = {}) =>
  new Request(url, { method, body, headers: cookie ? { Cookie: cookie } : {} });
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) [].concat(v).forEach((x) => f.append(k, String(x)));
  return f;
};
const rowB = async (env, id) => env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(id).first();

test('A ne lit aucune donnée de B (fiche, aperçu, dossier, photo, liste, tableau de bord, journal)', async () => {
  const { env, a, b, cookieA } = await setup();
  const params = { id: String(b.id) };
  for (const [name, call] of [
    ['fiche', () => fiche.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions/${b.id}`, { cookie: cookieA }), env, params })],
    ['édition', () => fiche.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions/${b.id}?edit=1`, { cookie: cookieA }), env, params })],
    ['aperçu', () => apercu.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions/${b.id}/apercu`, { cookie: cookieA }), env, params })],
    ['dossier', () => dossier.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions/${b.id}/dossier`, { cookie: cookieA }), env, params })],
    ['photo', () => photo.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions/${b.id}/photo`, { cookie: cookieA }), env, params })],
  ]) {
    const res = await call();
    assert.equal(res.status, 404, name);
    assert.doesNotMatch(await res.text(), /Bérénice|pdf-b|jpg-b/, name);
  }

  const pages = [
    await list.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions`, { cookie: cookieA }), env }),
    await list.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions?view=archive`, { cookie: cookieA }), env }),
    await dashboard.onRequestGet({ request: req(`${SITE_A}/admin/dashboard`, { cookie: cookieA }), env }),
    await events.onRequestGet({ request: req(`${SITE_A}/admin/events?inscription=${b.id}`, { cookie: cookieA }), env }),
  ];
  for (const res of pages) {
    const html = await res.text();
    assert.doesNotMatch(html, /Bérénice|b@example\.fr|route-secrete-b|Soumission du formulaire de contact/);
  }
  const own = await (await list.onRequestGet({ request: req(`${SITE_A}/admin/inscriptions`, { cookie: cookieA }), env })).text();
  assert.match(own, /Adam/, 'contrôle : A voit bien ses propres fiches');
  assert.ok(a.id);
});

test('A ne modifie ni ne supprime aucune donnée de B', async () => {
  const { env, b, cookieA } = await setup();
  const before = await rowB(env, b.id);
  const params = { id: String(b.id) };
  const post = (fields) => list.onRequestPost({ request: req(`${SITE_A}/admin/inscriptions`, { cookie: cookieA, method: 'POST', body: form(fields) }), env, waitUntil: () => {} });

  await post({ action: 'toggle-paye', id: b.id });
  await post({ action: 'restore', id: b.id });
  await post({ action: 'archive', id: b.id, archiveMotif: 'doublon' });
  await post({ action: 'delete', id: b.id, view: 'archive' });
  await post({ action: 'bulk-archive', ids: [b.id], archiveMotif: 'doublon' });

  const edit = await fiche.onRequestPost({
    request: req(`${SITE_A}/admin/inscriptions/${b.id}`, { cookie: cookieA, method: 'POST', body: form({ ...validData, enfantPrenom: 'Pirate' }) }),
    env, params, waitUntil: () => {},
  });
  assert.equal(edit.status, 404);
  const verif = await verification.onRequestPost({
    request: req(`${SITE_A}/admin/inscriptions/${b.id}/verification`, { cookie: cookieA, method: 'POST', body: form({ action: 'valider' }) }),
    env, params, waitUntil: () => {},
  });
  assert.equal(verif.status, 404);
  const upload = new FormData();
  upload.set('dossier', new File(['%PDF-1.4 pirate'], 'x.pdf', { type: 'application/pdf' }));
  const up = await dossier.onRequestPost({ request: req(`${SITE_A}/admin/inscriptions/${b.id}/dossier`, { cookie: cookieA, method: 'POST', body: upload }), env, params, waitUntil: () => {} });
  assert.equal(up.status, 404);

  assert.deepEqual({ ...(await rowB(env, b.id)) }, { ...before }, 'la fiche de B est intacte');
  assert.equal(env.DOSSIERS.store.get('dossiers/b'), 'pdf-b', 'le dossier de B est intact');
  assert.ok(env.DOSSIERS_BACKUP.store.has('photos/b'), 'la photo de B est intacte');
});

test('A n’exporte ni ne relance aucune fiche de B', async (t) => {
  const { env, a, b, cookieA } = await setup();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    sent.push(String(opts?.body || ''));
    return new Response('{}', { status: 201 });
  });
  const post = (fields) => list.onRequestPost({ request: req(`${SITE_A}/admin/inscriptions`, { cookie: cookieA, method: 'POST', body: form(fields) }), env, waitUntil: () => {} });

  const csv = await (await post({ action: 'bulk-export', ids: [a.id, b.id] })).text();
  assert.match(csv, /Adam/);
  assert.doesNotMatch(csv, /Bérénice/);

  await post({ action: 'bulk-reminder', ids: [b.id] });
  await post({ action: 'bulk-reinscription', ids: [b.id] });
  assert.ok(!sent.some((body) => body.includes('b@example.fr')), 'aucun e-mail vers la famille de B');
});

test('pages publiques : un jeton de B ne fonctionne pas sur le domaine de A', async () => {
  const { env, b } = await setup();
  const params = { token: b.upload_token };
  assert.equal((await depot.onRequestGet({ request: req(`${SITE_A}/depot/${b.upload_token}`), env, params })).status, 404);
  assert.equal((await depotPhoto.onRequestGet({ request: req(`${SITE_A}/depot/${b.upload_token}/photo`), env, params })).status, 404);
  const pay = await depotPaiement.onRequestPost({ request: req(`${SITE_A}/depot/${b.upload_token}/paiement`, { method: 'POST', body: form({ mode: 'Espèces' }) }), env, params, waitUntil: () => {} });
  assert.equal(pay.status, 404);
  assert.equal((await reinscription.onRequestGet({ request: req(`${SITE_A}/reinscription/reinscription-b`), env, params: { token: 'reinscription-b' } })).status, 404);

  // Contrôle : sur son propre domaine, le jeton de B fonctionne.
  assert.equal((await depot.onRequestGet({ request: req(`${SITE_B}/depot/${b.upload_token}`), env, params })).status, 200);
});

test('formulaire public : l’organisation vient du domaine, jamais du navigateur', async () => {
  const { env } = await setup();
  const submit = (site, data) =>
    api.onRequestPost({
      request: new Request(`${site}/api/inscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
        body: JSON.stringify(data),
      }),
      env, waitUntil: () => {},
    });

  const res = await submit(SITE_A, { ...validData, enfantPrenom: 'Chloé', email: 'c@example.fr', organization_id: ORG_B, organizationId: ORG_B });
  assert.equal(res.status, 200);
  const created = await env.DB.prepare("SELECT organization_id FROM inscriptions WHERE enfant_prenom = 'Chloé'").first();
  assert.equal(created.organization_id, DEMO_ORG_ID, 'organization_id envoyé par le navigateur ignoré');

  // Une fiche identique dans B ne bloque pas l'inscription chez A (anti-doublon propre à chaque organisation).
  const same = await submit(SITE_A, { ...validData, enfantPrenom: 'Bérénice', enfantNom: 'Secret', email: 'b@example.fr' });
  assert.equal(same.status, 200);

  const unknown = await submit('https://domaine-inconnu.example', { ...validData, enfantPrenom: 'Zoé' });
  assert.equal(unknown.status, 404);
  assert.equal(await env.DB.prepare("SELECT id FROM inscriptions WHERE enfant_prenom = 'Zoé'").first(), null);
});

test('HelloAsso : un paiement reçu par A ne valide jamais une fiche de B', async () => {
  const { env } = await setup();
  const c = await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: 'Camille', enfant_nom: 'Autre', email: 'camille@example.fr' });
  const slug = DEFAULT_CATEGORIES_CONFIG.categories[0].helloAssoUrl.split('/').pop();
  const result = await processHelloAssoOrder(env, {
    id: 'commande-b',
    formSlug: slug,
    payer: { email: 'camille@example.fr', firstName: 'X', lastName: 'Autre' },
    items: [{ user: { firstName: 'Camille', lastName: 'Autre' }, state: 'Processed' }],
    payments: [{ state: 'Authorized' }],
  }, SITE_A, undefined, DEMO_ORG_ID);
  assert.equal(result.status, 'unmatched');
  assert.equal((await rowB(env, c.id)).paye, 0);
});

test('la session de B ne voit pas les données de A (symétrie)', async () => {
  const { env, a, cookieB } = await setup();
  const res = await fiche.onRequestGet({ request: req(`${SITE_B}/admin/inscriptions/${a.id}`, { cookie: cookieB }), env, params: { id: String(a.id) } });
  assert.equal(res.status, 404);
  const html = await (await list.onRequestGet({ request: req(`${SITE_B}/admin/inscriptions`, { cookie: cookieB }), env })).text();
  assert.doesNotMatch(html, /Adam/);
});

test('comptes : un responsable de A n’ouvre jamais B, et inversement', async () => {
  const { env } = await setup();
  await testUser(env, DEMO_ORG_ID, 'owner', { email: 'resp-a@club.example' });
  await testUser(env, ORG_B, 'owner', { email: 'resp-b@club.example' });
  const login = (site, email) => {
    const f = new FormData();
    f.set('email', email);
    f.set('password', TEST_PASSWORD);
    return handleLogin(new Request(`${site}/admin/inscriptions`, { method: 'POST', headers: { 'CF-Connecting-IP': crypto.randomUUID() } }), env, f);
  };
  assert.equal((await login(SITE_A, 'resp-a@club.example')).status, 302, 'compte A sur le domaine A');
  assert.equal((await login(SITE_B, 'resp-a@club.example')).status, 401, 'compte A sur le domaine B');
  assert.equal((await login(SITE_A, env.ADMIN_PASSWORD)).status, 401, 'ancien secret partagé : sans effet');
  const okB = await login(SITE_B, 'resp-b@club.example');
  assert.equal(okB.status, 302);
  const cookieB = okB.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  assert.equal((await isAuthed(req(`${SITE_B}/admin/inscriptions`, { cookie: cookieB }), env)).organizationId, ORG_B);
  assert.equal((await login(SITE_A, 'resp-b@club.example')).status, 401, 'compte B sur le domaine A');
});

test('réglages KV : fermer les inscriptions de A ne ferme pas celles de B', async () => {
  const { env, cookieA } = await setup();
  const f = new FormData();
  f.set('status', 'closed');
  await inscriptionStatusAdmin.onRequestPost({ request: req(`${SITE_A}/admin/inscription-status`, { cookie: cookieA, method: 'POST', body: f }), env });
  const statusOf = async (site) => (await (await inscriptionStatusApi.onRequestGet({ request: req(`${site}/api/inscription-status`), env })).json()).status;
  assert.equal(await statusOf(SITE_A), 'closed');
  assert.equal(await statusOf(SITE_B), 'open', 'B garde sa valeur par défaut (ouverte), la fermeture de A ne la touche pas');
  await setInscriptionStatus(env, ORG_B, 'closed');
  await setInscriptionStatus(env, ORG_B, 'open');
  assert.equal(await statusOf(SITE_B), 'open');
  assert.equal(await statusOf(SITE_A), 'closed', 'A inchangée');
  const categoriesB = await (await categoriesApi.onRequestGet({ request: req(`${SITE_B}/api/categories`), env })).json();
  assert.deepEqual(categoriesB.categories, [], 'aucune catégorie ni lien HelloAsso de A exposé sur B');
});

test('HelloAsso : le même numéro de commande chez A et chez B ne se bloque pas', async () => {
  const { env } = await setup();
  const slug = DEFAULT_CATEGORIES_CONFIG.categories[0].helloAssoUrl.split('/').pop();
  await setCategoriesConfig(env, ORG_B, { saison: '2026-2027', categories: [{ ...DEFAULT_CATEGORIES_CONFIG.categories[0] }] });
  const childA = await seedInscription(env.DB, { enfant_prenom: 'Hugo', enfant_nom: 'Commande', email: 'hugo@example.fr' });
  const childB = await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: 'Hugo', enfant_nom: 'Commande', email: 'hugo@example.fr' });
  const order = {
    id: 'commande-partagee',
    formSlug: slug,
    payer: { email: 'hugo@example.fr', firstName: 'P', lastName: 'Commande' },
    items: [{ user: { firstName: 'Hugo', lastName: 'Commande' }, state: 'Processed' }],
    payments: [{ state: 'Authorized' }],
  };
  assert.equal((await processHelloAssoOrder(env, order, SITE_A, undefined, DEMO_ORG_ID)).status, 'matched');
  assert.equal((await processHelloAssoOrder(env, order, SITE_B, undefined, ORG_B)).status, 'matched', 'B traite sa propre commande');
  assert.equal((await processHelloAssoOrder(env, order, SITE_B, undefined, ORG_B)).status, 'duplicate', 'anti-rejeu propre à B');
  assert.equal((await rowB(env, childA.id)).paye, 1);
  assert.equal((await rowB(env, childB.id)).paye, 1);
  const { results } = await env.DB.prepare("SELECT organization_id, inscription_ids FROM helloasso_orders WHERE order_id = 'commande-partagee' ORDER BY organization_id").all();
  assert.deepEqual(results.map((r) => [r.organization_id, r.inscription_ids]), [
    [DEMO_ORG_ID, String(childA.id)],
    [ORG_B, String(childB.id)],
  ]);
});

test('HelloAsso : le secret de notification de A ne vaut pas sur le domaine de B', async (t) => {
  const { env } = await setup();
  const envWithSecret = { ...env, HELLOASSO_WEBHOOK_SECRET: 'secret-de-A' };
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 201 }));
  const notify = (site) =>
    helloassoWebhook.onRequestPost({
      request: new Request(`${site}/api/helloasso-notification?key=secret-de-A`, {
        method: 'POST',
        body: JSON.stringify({ eventType: 'Order', data: { id: 'x', formSlug: 'inconnu', items: [], payments: [] } }),
      }),
      env: envWithSecret,
      waitUntil: () => {},
    });
  assert.equal((await notify(SITE_B)).status, 403, 'secret de A refusé pour B');
  assert.equal((await notify(SITE_A)).status, 200, 'contrôle : accepté pour A');
});
