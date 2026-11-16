// Import de l'export « paiements » de HelloAsso (2026-11-13, demande de l'utilisateur) : /admin/helloasso.
// Une ligne de l'export = un paiement encaissé par HelloAsso (échéance d'un paiement en plusieurs fois, paiement
// unique, ou carte bancaire au club par « Tap to pay », sans nom de payeur). Chaque paiement est rattaché à une fiche
// d'inscription : proposé automatiquement (commande déjà rattachée, e-mail ou nom du payeur, versement de même
// montant saisi à la main), confirmé ou choisi par le club. Le fichier n'est jamais stocké ; seule la référence de
// chaque paiement traité est gardée (table helloasso_payments) pour ne jamais l'appliquer deux fois.
//
// Choix par ligne : ajouter le versement à une fiche (historique des versements + totaux), « déjà saisi à la main »
// (lien seul, aucun montant ajouté), « pas une adhésion » (don, vente, test : ne plus le proposer), ou plus tard.
// Paiement en plusieurs fois : la famille s'est engagée et HelloAsso prélève les échéances suivantes lui-même ; la
// fiche passe donc à « payé » dès la première échéance (comme la notification HelloAsso), les montants suivent au fil
// des imports. Une fiche déjà « payé » le reste.
import { normalizeText, FootclubsFileError as XlsxFileError } from './footclubs-import.js';
import { oncePerBinding } from './once-per-binding.js';
import { MAX_AMOUNT_CENTS, amountDueCents, isPaymentExempt, paymentEntryStatement, ensurePaymentEntriesTable } from './payments.js';
import { normalize } from './inscriptions-db.js';

export { XlsxFileError };
export const MAX_IMPORT_ROWS = 2000;

// Table hors séquence de migrations (comme payment_entries), additive. Aucune donnée personnelle : références,
// montant, date, fiche liée. payment_entry_id : ligne d'historique créée, pour reproposer le paiement si le club
// supprime ce versement de la fiche.
const TABLE = `CREATE TABLE IF NOT EXISTS helloasso_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  payment_ref TEXT NOT NULL,
  order_ref TEXT,
  amount_cents INTEGER NOT NULL,
  paid_on TEXT,
  status TEXT NOT NULL CHECK (status IN ('applied', 'linked', 'ignored')),
  inscription_id INTEGER,
  payment_entry_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (organization_id, payment_ref)
)`;
const INDEX = 'CREATE INDEX IF NOT EXISTS idx_helloasso_payments_org_inscription ON helloasso_payments (organization_id, inscription_id)';

const ready = oncePerBinding();
export function ensureHelloAssoPaymentsTable(db) {
  return ready(db, () => db.batch([db.prepare(TABLE), db.prepare(INDEX)]));
}

// ---------------------------------------------------------------------------------------------
// Lecture du fichier

const HEADERS = {
  paiement: ['reference paiement'],
  commande: ['reference commande'],
  montant: ['montant total'],
  date: ['date du paiement'],
  statut: ['statut du paiement'],
  nom: ['nom payeur'],
  prenom: ['prenom payeur'],
  email: ['email payeur'],
  campagne: ['campagne'],
  typeCampagne: ['type de campagne'],
  type: ['type'],
  moyen: ['moyen de paiement'],
};
const REQUIRED = ['paiement', 'montant', 'date', 'statut'];
const NA = (v) => !v || /^n\/?a$/i.test(String(v).trim());

// « 46338.7608 » (jours depuis le 30/12/1899, heure de Paris dans l'export) ou « 12/11/2026 14:15 ».
function toIsoDate(cell) {
  const v = String(cell?.value || '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(v);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{4,6}(\.\d+)?$/.test(v)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86400000).toISOString().slice(0, 10);
  return null;
}

function toCents(value) {
  const v = String(value ?? '').replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const cents = Math.round(Number(v) * 100);
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

const REF_RE = /^[A-Za-z0-9-]{1,40}$/;

export function helloAssoRecords(rows) {
  const headerIndex = rows.findIndex((r) => r && r.filter((c) => c?.value).length >= 3);
  if (headerIndex < 0) throw new XlsxFileError('Fichier vide.');
  const names = rows[headerIndex].map((c) => normalizeText(c?.value));
  const col = {};
  for (const [key, labels] of Object.entries(HEADERS)) col[key] = names.findIndex((n) => labels.includes(n));
  if (REQUIRED.some((k) => col[k] < 0)) {
    throw new XlsxFileError('Colonnes introuvables : « Référence paiement », « Montant total », « Date du paiement » et « Statut du paiement » sont nécessaires. Vérifiez qu’il s’agit bien de l’export des paiements HelloAsso.');
  }
  const data = rows.slice(headerIndex + 1).filter((r) => r && r.some((c) => c?.value));
  if (data.length > MAX_IMPORT_ROWS) throw new XlsxFileError(`Trop de lignes (${MAX_IMPORT_ROWS} au plus).`);
  const get = (r, key) => (col[key] >= 0 ? String(r[col[key]]?.value || '').trim().slice(0, 200) : '');
  const records = [];
  let invalid = 0;
  for (const r of data) {
    const ref = get(r, 'paiement');
    const cents = toCents(get(r, 'montant'));
    const date = toIsoDate(r[col.date]);
    if (!REF_RE.test(ref) || !cents || !date) {
      invalid += 1;
      continue;
    }
    const order = get(r, 'commande');
    const campagne = get(r, 'campagne');
    const tap = /tap to pay/i.test(campagne);
    const payer = NA(get(r, 'nom')) && NA(get(r, 'prenom')) ? null : { nom: NA(get(r, 'nom')) ? '' : get(r, 'nom'), prenom: NA(get(r, 'prenom')) ? '' : get(r, 'prenom') };
    records.push({
      ref,
      order: REF_RE.test(order) ? order : '',
      cents,
      date,
      paid: normalizeText(get(r, 'statut')) === 'paye',
      statut: get(r, 'statut'),
      payer,
      email: NA(get(r, 'email')) ? '' : get(r, 'email'),
      campagne,
      typeCampagne: get(r, 'typeCampagne'),
      plan: normalizeText(get(r, 'type')) === 'paiement en plusieurs fois',
      tap,
      adhesion: normalizeText(get(r, 'typeCampagne')) === 'adhesion',
    });
  }
  return { records, invalid };
}

// ---------------------------------------------------------------------------------------------
// Rapprochement

const cleanName = (v) => normalize(v).replace(/[^a-z0-9]+/g, ' ').trim();
const fullName = (prenom, nom) => cleanName(`${prenom || ''} ${nom || ''}`);
const nameKeys = (p) => new Set([fullName(p.prenom, p.nom), fullName(p.nom, p.prenom)]);
const sameEmail = (row, email) => Boolean(email) && [row.email, row.parent2_email].some((e) => e && normalize(e) === normalize(email));
const samePerson = (row, payer) => {
  if (!payer) return false;
  const keys = nameKeys(payer);
  return [fullName(row.enfant_prenom, row.enfant_nom), fullName(row.parent_prenom, row.parent_nom), fullName(row.parent2_prenom, row.parent2_nom)].some((k) => k && keys.has(k));
};
const DAY = 86400000;
const daysBetween = (a, b) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY;
export const fichLabel = (row) => `${row.enfant_prenom || ''} ${row.enfant_nom || ''}`.trim();

/**
 * Plan d'import. records : helloAssoRecords().records ; inscriptions : fiches non archivées de l'organisation ;
 * known : lignes helloasso_payments déjà enregistrées ; entries : versements manuels (payment_entries, kind
 * 'versement') { inscription_id, amount_cents, paid_on, created_at }.
 * Renvoie { lines, skipped, total } ; chaque ligne porte une suggestion « add:<id> » / « link:<id> » / « ignore » / ''.
 */
export function planHelloAssoImport(records, inscriptions, known = [], entries = []) {
  const knownByRef = new Map(known.map((k) => [String(k.payment_ref), k]));
  const byOrder = new Map();
  for (const k of known) if (k.order_ref && k.inscription_id && k.status === 'applied') byOrder.set(String(k.order_ref), k.inscription_id);
  for (const row of inscriptions) if (row.helloasso_order_id && !byOrder.has(String(row.helloasso_order_id))) byOrder.set(String(row.helloasso_order_id), row.id);
  const fiches = new Map(inscriptions.map((r) => [r.id, r]));
  const linkedIds = new Set(known.filter((k) => k.status === 'linked').map((k) => k.inscription_id));

  // Échéance n d'une commande en plusieurs fois, d'après les dates du fichier.
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
  const rank = new Map();
  const counter = new Map();
  for (const r of sorted) {
    if (!r.plan || !r.order) continue;
    counter.set(r.order, (counter.get(r.order) || 0) + 1);
    rank.set(r.ref, counter.get(r.order));
  }

  const suggest = (r) => {
    const fromOrder = r.order && byOrder.get(r.order);
    if (fromOrder && fiches.has(fromOrder)) return { choice: `add:${fromOrder}`, why: 'même commande HelloAsso' };
    if (r.payer || r.email) {
      const byEmail = inscriptions.filter((row) => sameEmail(row, r.email));
      const byName = inscriptions.filter((row) => samePerson(row, r.payer));
      const both = byEmail.filter((row) => byName.includes(row));
      const pick = both.length === 1 ? both[0] : byEmail.length === 1 ? byEmail[0] : byName.length === 1 ? byName[0] : null;
      if (pick) return { choice: `add:${pick.id}`, why: both.length === 1 ? 'nom et e-mail du payeur' : byEmail.length === 1 ? 'e-mail du payeur' : 'nom du payeur' };
      if (byEmail.length > 1 || byName.length > 1) return { choice: '', why: 'plusieurs fiches possibles (frères et sœurs ?)' };
    }
    if (!r.payer && !r.email) {
      // Carte bancaire au club : un versement de même montant déjà saisi à la main, à 7 jours près.
      const near = new Set(
        entries
          .filter((e) => e.amount_cents === r.cents && daysBetween(e.paid_on || String(e.created_at).slice(0, 10), r.date) <= 7)
          .map((e) => e.inscription_id)
      );
      for (const row of inscriptions) {
        const noEntry = !entries.some((e) => e.inscription_id === row.id);
        if (noEntry && Number(row.montant_recu_cents) === r.cents && row.dernier_versement_at && daysBetween(String(row.dernier_versement_at).slice(0, 10), r.date) <= 7) near.add(row.id);
      }
      const candidates = [...near].filter((id) => fiches.has(id) && !linkedIds.has(id));
      if (candidates.length === 1) return { choice: `link:${candidates[0]}`, why: `versement de même montant déjà saisi sur la fiche` };
      if (!r.adhesion && /^(don|vente)$/.test(normalizeText(r.typeCampagne))) return { choice: 'ignore', why: `${r.typeCampagne.toLowerCase()}, pas une adhésion` };
      return { choice: '', why: 'paiement sans nom : choisissez l’adhérent' };
    }
    return { choice: '', why: 'payeur inconnu dans les inscriptions' };
  };

  const lines = [];
  const skipped = [];
  for (const r of sorted.reverse()) {
    if (!r.paid) {
      skipped.push(r);
      continue;
    }
    const done = knownByRef.get(r.ref);
    const base = { ...r, rank: rank.get(r.ref) || null };
    if (done) lines.push({ ...base, done: { status: done.status, inscriptionId: done.inscription_id || null } });
    else lines.push({ ...base, ...suggest(r) });
  }
  return { lines, skipped, total: lines.reduce((n, l) => n + l.cents, 0) };
}

// ---------------------------------------------------------------------------------------------
// Confirmation : lignes renvoyées par le formulaire (le fichier n'est pas conservé), revérifiées.

export const IMPORT_MODES = Object.freeze({ online: 'HelloAsso', plan: 'HelloAsso (en plusieurs fois)', tap: 'Carte bancaire (Tap to pay)' });

export function sanitizeLines(json, now = new Date()) {
  let list;
  try {
    list = JSON.parse(String(json || ''));
  } catch {
    return null;
  }
  if (!Array.isArray(list) || list.length > MAX_IMPORT_ROWS) return null;
  const today = now.toISOString().slice(0, 10);
  const out = [];
  for (const l of list) {
    if (!l || typeof l !== 'object') return null;
    const { ref, order = '', cents, date, kind } = l;
    if (!REF_RE.test(String(ref)) || (order && !REF_RE.test(String(order)))) return null;
    if (!Number.isInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || date > today) return null;
    if (!Object.hasOwn(IMPORT_MODES, kind)) return null;
    out.push({ ref: String(ref), order: String(order), cents, date, kind });
  }
  return out;
}

export const lineKind = (r) => (r.tap ? 'tap' : r.plan ? 'plan' : 'online');

// « add:12 » → { action: 'add', id: 12 } ; « ignore », « reset », '' (plus tard).
export function parseChoice(value) {
  const v = String(value || '');
  if (v === 'ignore' || v === 'reset') return { action: v };
  const m = /^(add|link):(\d{1,9})$/.exec(v);
  return m ? { action: m[1], id: Number(m[2]) } : { action: 'later' };
}

/**
 * Applique une ligne « add » à une fiche (lue juste avant). Renvoie { ok, reason, before }.
 * Une transaction : fiche (si elle n'a pas changé depuis la lecture), historique, référence HelloAsso ; la référence
 * est unique par organisation, un paiement déjà importé fait échouer tout le lot (rien d'écrit).
 */
export async function applyPayment(env, organizationId, line, row, prix) {
  if (!row || row.archived_at) return { ok: false, reason: 'fiche introuvable ou à la corbeille' };
  if (isPaymentExempt(row)) return { ok: false, reason: 'fiche exemptée de paiement' };
  const du = Number(row.montant_du_cents) || amountDueCents(row, prix) || 0;
  if (!du) return { ok: false, reason: 'tarif de la saison inconnu (Catégories)' };
  const before = Number(row.montant_recu_cents) || 0;
  const recu = before + line.cents;
  const paye = row.paye || recu >= du || line.kind === 'plan' ? 1 : 0;
  const paidAt = `${line.date} 12:00:00`;
  const mode = IMPORT_MODES[line.kind];
  const ficheMode = line.kind === 'tap' ? 'Carte bancaire' : 'HelloAsso';
  await ensurePaymentEntriesTable(env.DB);
  await ensureHelloAssoPaymentsTable(env.DB);
  try {
    const [update] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET montant_recu_cents = ?, montant_du_cents = ?, paye = ?, mode_paiement = COALESCE(mode_paiement, ?),
           dernier_versement_at = CASE WHEN dernier_versement_at IS NULL OR dernier_versement_at < ? THEN ? ELSE dernier_versement_at END,
           auto_reminders_sent = CASE WHEN ? = 0 THEN 0 ELSE auto_reminders_sent END
         WHERE organization_id = ? AND id = ? AND archived_at IS NULL AND montant_recu_cents IS ? AND paye = ?`
      ).bind(recu, du, paye, ficheMode, paidAt, paidAt, paye, organizationId, row.id, row.montant_recu_cents ?? null, row.paye ? 1 : 0),
      paymentEntryStatement(env.DB, organizationId, row.id, { kind: 'versement', amount: line.cents, mode, totalRecu: recu, totalDu: du, paidOn: line.date }),
      env.DB.prepare(
        `INSERT INTO helloasso_payments (organization_id, payment_ref, order_ref, amount_cents, paid_on, status, inscription_id, payment_entry_id)
         SELECT ?, ?, ?, ?, ?, 'applied', ?, last_insert_rowid() WHERE changes() = 1`
      ).bind(organizationId, line.ref, line.order || null, line.cents, line.date, row.id),
    ]);
    if (!update.meta.changes) return { ok: false, reason: 'fiche modifiée entre-temps, réimportez le fichier' };
  } catch (error) {
    if (/UNIQUE constraint failed: helloasso_payments\./i.test(String(error?.message))) return { ok: false, reason: 'déjà importé' };
    throw error;
  }
  return { ok: true };
}

// Lien sans montant (« déjà saisi à la main ») ou paiement écarté (« pas une adhésion ») : référence seule.
export const markStatement = (db, organizationId, line, status, inscriptionId = null) =>
  db
    .prepare(
      `INSERT INTO helloasso_payments (organization_id, payment_ref, order_ref, amount_cents, paid_on, status, inscription_id)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, payment_ref) DO NOTHING`
    )
    .bind(organizationId, line.ref, line.order || null, line.cents, line.date, status, inscriptionId);

// Remettre à décider un paiement lié ou écarté (jamais un paiement appliqué : supprimer le versement de la fiche).
export const resetStatement = (db, organizationId, ref) =>
  db.prepare("DELETE FROM helloasso_payments WHERE organization_id = ? AND payment_ref = ? AND status IN ('linked', 'ignored')").bind(organizationId, ref);

// Versement supprimé de la fiche : le paiement HelloAsso correspondant sera reproposé au prochain import. À placer en
// fin du db.batch de suppression : n'agit que si la ligne d'historique a bien disparu (fiche modifiée entre-temps =
// suppression refusée, le paiement reste importé).
export const forgetEntryStatement = (db, organizationId, inscriptionId, entryId) =>
  db
    .prepare(
      `DELETE FROM helloasso_payments WHERE organization_id = ? AND inscription_id = ? AND payment_entry_id = ?
         AND NOT EXISTS (SELECT 1 FROM payment_entries WHERE organization_id = ? AND id = ?)`
    )
    .bind(organizationId, inscriptionId, entryId, organizationId, entryId);

// Suppression définitive d'une fiche : la référence reste (anti-doublon, aucune donnée personnelle), le lien disparaît.
export const detachInscriptionStatement = (db, organizationId, inscriptionId) =>
  db
    .prepare('UPDATE helloasso_payments SET inscription_id = NULL, payment_entry_id = NULL WHERE organization_id = ? AND inscription_id = ?')
    .bind(organizationId, inscriptionId);
