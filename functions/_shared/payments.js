// Paiement en plusieurs fois (demande de l'utilisateur, 2026-11-09 : « un adhérent a payé 60 € des 180 € en carte
// bleue directement avec nous ; on met le montant payé et il aura un rappel pour le montant restant »).
//
// Le club enregistre chaque versement sur la fiche (functions/admin/inscriptions/[id].js, action « versement ») :
// montant reçu cumulé (montant_recu_cents) et montant dû (montant_du_cents, prérempli avec le tarif de la saison,
// moins 50 € avec un code Pass'Sport, modifiable). La colonne paye reste la seule qui dit « payé » : elle passe à 1
// quand le total reçu atteint le dû, et toute la logique existante (complet, relances, récapitulatif) en dépend
// sans changement. Montants en centimes (entiers), jamais en flottants. Une fiche sans versement enregistré a
// montant_recu_cents NULL ou 0 : rien ne change pour elle.

import { PASS_SPORT_CENTS } from './pass-sport.js';
import { oncePerBinding } from './once-per-binding.js';

export const MAX_AMOUNT_CENTS = 100_000; // 1 000 € : bien au-delà d'une adhésion, borne contre les fautes de frappe

// « 60 », « 60,50 », « 60.5 », « 60 € » → 6000, 6050, 6050, 6000 ; null si invalide, nul ou hors bornes.
export function parseEuros(value) {
  const text = String(value ?? '').replace(/\s|€/g, '').replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

// Correction d'un versement saisi par erreur : comme parseEuros, mais 0 est accepté (« rien reçu en fait »).
export function parseEurosOrZero(value) {
  return /^\s*0+([.,]0{1,2})?\s*€?\s*$/.test(String(value ?? '')) ? 0 : parseEuros(value);
}

// Date du paiement saisie par le club (2026-11-09 : un paiement fait au club un jour d'entraînement est souvent
// enregistré plus tard). AAAA-MM-JJ, ni dans le futur ni plus d'un an en arrière ; vide = aujourd'hui (heure de
// Paris). null si invalide.
export function todayParis(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function parsePaymentDate(value, now = new Date()) {
  const text = String(value ?? '').trim();
  const today = todayParis(now);
  if (!text) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  const yearAgo = todayParis(new Date(now.getTime() - 366 * 86400000));
  return text <= today && text >= yearAgo ? text : null;
}
// Valeur de dernier_versement_at : null = maintenant (paiement du jour), sinon midi le jour du paiement.
export const paymentDateTime = (date, now = new Date()) => (!date || date === todayParis(now) ? null : `${date} 12:00:00`);

// 6000 → « 60 € », 6050 → « 60,50 € ».
export function formatEuros(cents) {
  const value = Number(cents) || 0;
  const euros = value % 100 === 0 ? String(value / 100) : (value / 100).toFixed(2).replace('.', ',');
  return `${euros} €`;
}

// Montant dû proposé par défaut : tarif de la saison, moins 50 € avec un code Pass'Sport déclaré (à vérifier par le
// club, d'où un champ modifiable).
export function defaultDueCents(row, prix) {
  const base = Math.round((Number(prix) || 0) * 100);
  if (!base) return null;
  return Math.max(0, base - (row.pass_sport_code ? PASS_SPORT_CENTS : 0)) || null;
}

// Montant à régler par la famille (affiché dans l'espace famille et les relances) : le montant dû enregistré par le
// club s'il existe, sinon le tarif moins le Pass'Sport déclaré. null si le tarif est inconnu.
export const amountDueCents = (row, prix) => Number(row.montant_du_cents) || defaultDueCents(row, prix);

// Code Pass'Sport déclaré mais montant dû enregistré au tarif plein (2026-11-12, cas réel : versement de 130 € saisi
// avec un total dû de 180 €, la famille a reçu « reste 50 € »). Montant dû corrigé proposé, ou null.
export function passSportNotDeducted(row, prix) {
  const du = Number(row.montant_du_cents) || 0;
  const base = Math.round((Number(prix) || 0) * 100);
  if (!row.pass_sport_code || !du || !base || du !== base) return null;
  return Math.max(0, du - PASS_SPORT_CENTS);
}

// Code Pass'Sport ajouté ou retiré APRÈS l'enregistrement d'un montant dû (2026-11-12 : le montant dû restait au
// tarif plein et la famille devait encore 50 € de trop) : le montant dû suit, et le statut payé est recalculé si des
// versements existent. null si rien ne change.
export function passSportDueChange(existing, newCode) {
  const had = Boolean(existing.pass_sport_code);
  const has = Boolean(newCode);
  const du = Number(existing.montant_du_cents) || 0;
  if (had === has || !du) return null;
  const newDu = had ? du + PASS_SPORT_CENTS : Math.max(0, du - PASS_SPORT_CENTS);
  const recu = Number(existing.montant_recu_cents) || 0;
  const paye = recu > 0 ? (recu >= newDu ? 1 : 0) : existing.paye ? 1 : 0;
  return { du: newDu, paye };
}

// État du paiement en plusieurs fois, ou null s'il n'y a ni versement enregistré ni paiement partiel en cours.
// { du, recu, reste } en centimes ; reste = 0 si tout est payé.
export function paymentBalance(row) {
  const recu = Number(row.montant_recu_cents) || 0;
  const du = Number(row.montant_du_cents) || 0;
  if (!recu || !du) return null;
  return { du, recu, reste: row.paye ? 0 : Math.max(0, du - recu) };
}

// Paiement commencé mais pas terminé : quelque chose a été versé, il reste un solde.
export const isPartiallyPaid = (row) => {
  const balance = paymentBalance(row);
  return Boolean(balance && !row.paye && balance.reste > 0);
};

// Historique des versements (2026-11-09, demande de l'utilisateur) : une ligne par versement ou correction saisi sur
// la fiche, avec les totaux après l'opération. Table hors séquence de migrations (comme family_links), additive :
// rien d'existant n'est modifié ; les versements saisis avant sa création n'y figurent pas (la fiche affiche alors
// leur total comme « avant l'historique »). Effacée avec la fiche lors d'une suppression définitive.
const PAYMENT_ENTRIES_TABLE = `CREATE TABLE IF NOT EXISTS payment_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        inscription_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('versement', 'correction')),
        amount_cents INTEGER,
        mode TEXT,
        total_recu_cents INTEGER NOT NULL,
        total_du_cents INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`;
// Date du paiement (AAAA-MM-JJ) quand elle diffère du jour de saisie : colonne ajoutée le 2026-11-09, après la
// création de la table, NULL pour les lignes déjà enregistrées.
// État de la fiche juste avant une correction (2026-11-09), pour pouvoir l'annuler exactement ; NULL pour les
// corrections enregistrées avant (on reprend alors les totaux de la ligne précédente).
const PAYMENT_ENTRIES_ADDED = ['paid_on TEXT', 'prev_recu_cents INTEGER', 'prev_du_cents INTEGER', 'prev_paye INTEGER', 'prev_dernier_versement_at TEXT'];
const PAYMENT_ENTRIES_INDEX = 'CREATE INDEX IF NOT EXISTS idx_payment_entries_org_inscription ON payment_entries (organization_id, inscription_id, id)';

const ready = oncePerBinding();
export function ensurePaymentEntriesTable(db) {
  return ready(db, async () => {
        await db.batch([db.prepare(PAYMENT_ENTRIES_TABLE), db.prepare(PAYMENT_ENTRIES_INDEX)]);
        const present = new Set((await db.prepare('PRAGMA table_info(payment_entries)').all()).results.map((c) => c.name));
        for (const column of PAYMENT_ENTRIES_ADDED.filter((c) => !present.has(c.split(' ')[0]))) {
          await db.prepare(`ALTER TABLE payment_entries ADD COLUMN ${column}`).run().catch((error) => {
            if (!/duplicate column/i.test(String(error?.message))) throw error;
          });
        }
  });
}

// Ligne d'historique, écrite seulement si l'instruction qui la précède dans le même db.batch a modifié la fiche
// (changes() = 1) : un versement refusé (fiche déjà payée entre-temps) ne laisse aucune trace.
export const paymentEntryStatement = (db, organizationId, inscriptionId, { kind, amount = null, mode = null, totalRecu, totalDu, paidOn = null, previous = null }) =>
  db
    .prepare(
      `INSERT INTO payment_entries (organization_id, inscription_id, kind, amount_cents, mode, total_recu_cents, total_du_cents, paid_on,
         prev_recu_cents, prev_du_cents, prev_paye, prev_dernier_versement_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1`
    )
    .bind(
      organizationId, inscriptionId, kind, amount, mode, totalRecu, totalDu, paidOn,
      previous ? previous.montant_recu_cents ?? null : null,
      previous ? previous.montant_du_cents ?? null : null,
      previous ? (Number(previous.paye) ? 1 : 0) : null,
      previous ? previous.dernier_versement_at ?? null : null
    );

// Annulation de la correction la plus récente : état à rétablir. entries du plus récent au plus ancien ; null si la
// ligne la plus récente n'est pas une correction. Sans état enregistré (correction antérieure), totaux de la ligne
// précédente, sinon « aucun montant enregistré, non payé ».
export function stateBeforeCorrection(entries) {
  const [correction, older] = entries;
  if (!correction || correction.kind !== 'correction') return null;
  if (correction.prev_paye !== null && correction.prev_paye !== undefined) {
    return { recu: correction.prev_recu_cents || 0, du: correction.prev_du_cents || 0, paye: Number(correction.prev_paye) ? 1 : 0, dernier: correction.prev_dernier_versement_at || null };
  }
  if (older) {
    const recu = older.total_recu_cents || 0;
    const du = older.total_du_cents || 0;
    return { recu, du, paye: recu > 0 && recu >= du ? 1 : 0, dernier: older.paid_on ? `${older.paid_on} 12:00:00` : older.created_at };
  }
  return { recu: 0, du: 0, paye: 0, dernier: null };
}

// Du plus récent au plus ancien.
export async function listPaymentEntries(db, organizationId, inscriptionId) {
  await ensurePaymentEntriesTable(db);
  const { results } = await db
    .prepare('SELECT * FROM payment_entries WHERE organization_id = ? AND inscription_id = ? ORDER BY id DESC')
    .bind(organizationId, inscriptionId)
    .all();
  return results;
}

// Versements supprimables (saisie erronée) : ceux enregistrés APRÈS la dernière correction. Une correction a remplacé
// les totaux : retirer un versement plus ancien ne voudrait plus rien dire (il faut alors « Corriger montants ou date »).
// entries : du plus récent au plus ancien (listPaymentEntries).
export function deletableEntryIds(entries) {
  const ids = new Set();
  for (const entry of entries) {
    if (entry.kind === 'correction') break;
    ids.add(entry.id);
  }
  return ids;
}

export const paymentEntriesDeletionStatement = (db, organizationId, inscriptionId) =>
  db.prepare('DELETE FROM payment_entries WHERE organization_id = ? AND inscription_id = ?').bind(organizationId, inscriptionId);

// Montant reçu avant le début de l'historique (versements saisis avant le 2026-11-09) : 0 s'il n'y en a pas.
export function amountBeforeHistory(entries, balance) {
  const oldest = entries[entries.length - 1];
  if (!oldest) return balance?.recu || 0;
  return oldest.kind === 'versement' ? Math.max(0, oldest.total_recu_cents - (oldest.amount_cents || 0)) : 0;
}

// Paiement par chèques en plusieurs fois (2026-11-09, demande de l'utilisateur) : la famille remet ses chèques au
// club, qui les encaisse un par mois. Jusqu'à septembre inclus, 3 chèques au plus ; à partir d'octobre, 2 au plus
// (« 2 fois sans frais max jusqu'à fermeture des inscriptions »). Les chèques remis couvrent le reste à payer : la
// fiche passe à « payé » (la famille a réglé). L'encaissement est un suivi INTERNE du club : aucun e-mail.
// Table hors séquence (comme payment_entries), additive, effacée avec la fiche.
const CHEQUES_TABLE = `CREATE TABLE IF NOT EXISTS cheques (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        inscription_id INTEGER NOT NULL,
        rang INTEGER NOT NULL CHECK (rang BETWEEN 1 AND 3),
        montant_cents INTEGER NOT NULL CHECK (montant_cents > 0),
        numero TEXT,
        encaissement_prevu TEXT NOT NULL CHECK (encaissement_prevu GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
        encaisse_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`;
const CHEQUES_INDEX = 'CREATE INDEX IF NOT EXISTS idx_cheques_org_inscription ON cheques (organization_id, inscription_id, rang)';

const chequesReady = oncePerBinding();
export function ensureChequesTable(db) {
  return chequesReady(db, () => db.batch([db.prepare(CHEQUES_TABLE), db.prepare(CHEQUES_INDEX)]));
}

const parisMonth = (date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month) };
};

// Nombre maximal de chèques selon le mois d'enregistrement : 3 de juin à septembre, 2 d'octobre à mai.
export function maxChequesFor(date = new Date()) {
  const { month } = parisMonth(date);
  return month >= 6 && month <= 9 ? 3 : 2;
}

// Mois d'encaissement prévus : le mois en cours, puis un par mois. ['2026-11', '2026-12', '2027-01'].
export function chequeMonths(count, date = new Date()) {
  const { year, month } = parisMonth(date);
  return Array.from({ length: count }, (_, i) => {
    const m = month - 1 + i;
    return `${year + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`;
  });
}

// Parts égales en centimes, le reste sur le premier chèque : 12000 en 2 → [6000, 6000] ; 10000 en 3 → [3334, 3333, 3333].
export function splitCents(total, count) {
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_, i) => base + (i === 0 ? total - base * count : 0));
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const monthLabel = (ym) => {
  const [y, m] = String(ym).split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${y}` : String(ym);
};

export async function listCheques(db, organizationId, inscriptionId) {
  await ensureChequesTable(db);
  const { results } = await db.prepare('SELECT * FROM cheques WHERE organization_id = ? AND inscription_id = ? ORDER BY rang').bind(organizationId, inscriptionId).all();
  return results;
}

// Chèques non encaissés dont le mois prévu est arrivé (liste « À traiter »), avec l'enfant concerné.
export async function chequesToCash(db, organizationId, date = new Date()) {
  await ensureChequesTable(db);
  const [current] = chequeMonths(1, date);
  const { results } = await db
    .prepare(
      `SELECT c.*, i.enfant_prenom, i.enfant_nom FROM cheques c
       JOIN inscriptions i ON i.organization_id = c.organization_id AND i.id = c.inscription_id
       WHERE c.organization_id = ? AND c.encaisse_at IS NULL AND c.encaissement_prevu <= ? AND i.archived_at IS NULL
       ORDER BY c.encaissement_prevu, c.inscription_id, c.rang`
    )
    .bind(organizationId, current)
    .all();
  return results;
}

export const chequesDeletionStatement = (db, organizationId, inscriptionId) =>
  db.prepare('DELETE FROM cheques WHERE organization_id = ? AND inscription_id = ?').bind(organizationId, inscriptionId);

// Exemption de paiement (2026-11-13, demande de l'utilisateur : « les enfants des dirigeants ne paient pas les frais de
// licence au club »). Décidée par le club sur la fiche, motif INTERNE (jamais montré à la famille, ni dans un e-mail ou
// un PDF). Clés stockées en base : ne jamais les renommer. Une fiche exemptée a paye = 1 et aucun montant.
export const EXEMPTION_MOTIFS = Object.freeze({
  dirigeant: 'Enfant de dirigeant',
  educateur: 'Enfant d’éducateur',
  autre: 'Autre',
});
export const EXEMPTION_COMMENT_MAX = 200;
export const isPaymentExempt = (row) => Boolean(row && row.paiement_exempte);
export function exemptionLabel(row) {
  if (!isPaymentExempt(row)) return '';
  const motif = EXEMPTION_MOTIFS[row.paiement_exempte] || 'Exempté';
  return row.paiement_exempte_commentaire ? `${motif} (${row.paiement_exempte_commentaire})` : motif;
}
// Motif et précision envoyés par le formulaire : { motif, commentaire } ou null si invalide (« Autre » exige une précision).
export function readExemption(data) {
  const motif = String(data?.motif || '');
  if (!Object.hasOwn(EXEMPTION_MOTIFS, motif)) return null;
  const commentaire = String(data?.commentaire || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (commentaire.length > EXEMPTION_COMMENT_MAX) return null;
  if (motif === 'autre' && !commentaire) return null;
  return { motif, commentaire: commentaire || null };
}
