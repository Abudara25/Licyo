// Newsletter du club (2026-11-13) : un texte écrit dans l'admin (/admin/newsletter) envoyé à toutes les familles
// (inscriptions non archivées et pré-inscriptions encore en attente), un e-mail par adresse, avec un lien de
// désinscription en bas de chaque e-mail et l'en-tête List-Unsubscribe (désinscription en un clic de Gmail, Outlook…).
//
// - La désinscription ne vaut que pour la newsletter : les e-mails liés à l'inscription (dossier, paiement, relances)
//   continuent de partir, ils sont nécessaires au service.
// - Aucune adresse n'est stockée pour la désinscription : seulement une empreinte HMAC de l'adresse (clé secrète tirée
//   au hasard par organisation, table newsletter_keys). Le lien porte cette empreinte et une signature : il ne peut
//   pas être fabriqué pour une autre adresse sans la clé.
// - Tables hors séquence (comme payment_entries) : newsletter_keys, newsletter_unsubscribes, newsletters (historique
//   des envois : objet, texte, nombres ; aucune adresse).
import { oncePerBinding } from './once-per-binding.js';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS newsletter_keys (
    organization_id TEXT PRIMARY KEY NOT NULL,
    secret TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS newsletter_unsubscribes (
    organization_id TEXT NOT NULL,
    email_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (organization_id, email_hash)
  )`,
  `CREATE TABLE IF NOT EXISTS newsletters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    message TEXT NOT NULL,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'envoyee' CHECK (status IN ('programmee', 'en_cours', 'envoyee', 'annulee', 'echec')),
    scheduled_for TEXT,
    greet INTEGER NOT NULL DEFAULT 1,
    sent_at TEXT,
    error TEXT
  )`,
  'CREATE INDEX IF NOT EXISTS idx_newsletters_org ON newsletters (organization_id, id)',
  'CREATE INDEX IF NOT EXISTS idx_newsletters_due ON newsletters (status, scheduled_for)',
];

const ready = oncePerBinding();
export function ensureNewsletterTables(db) {
  return ready(db, () => db.batch(TABLES.map((sql) => db.prepare(sql))));
}

export const MAX_RECIPIENTS = 150; // plafond Infomaniak : 200 e-mails par 24 h, envois automatiques compris
export const SUBJECT_MAX = 150;
export const MESSAGE_MAX = 20000; // une newsletter peut être longue (plusieurs rubriques)

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

async function organizationSecret(db, organizationId) {
  await ensureNewsletterTables(db);
  const secret = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare('INSERT OR IGNORE INTO newsletter_keys (organization_id, secret) VALUES (?, ?)').bind(organizationId, secret).run();
  const row = await db.prepare('SELECT secret FROM newsletter_keys WHERE organization_id = ?').bind(organizationId).first();
  return row.secret;
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

// Signataire lié à une organisation : empreinte d'une adresse, jeton de désinscription, vérification.
export async function newsletterSigner(db, organizationId) {
  const secret = await organizationSecret(db, organizationId);
  const emailHash = async (email) => (await hmac(secret, `email:${normalizeEmail(email)}`)).slice(0, 40);
  const signature = async (hash) => (await hmac(secret, `desinscription:${hash}`)).slice(0, 24);
  return {
    emailHash,
    async token(email) {
      const hash = await emailHash(email);
      return `${hash}${await signature(hash)}`;
    },
    // Renvoie l'empreinte de l'adresse si le jeton est authentique, sinon null.
    async verify(token) {
      if (!/^[0-9a-f]{64}$/.test(String(token || ''))) return null;
      const hash = token.slice(0, 40);
      const expected = await signature(hash);
      let diff = 0;
      for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ token.charCodeAt(40 + i);
      return diff === 0 ? hash : null;
    },
  };
}

export async function isUnsubscribed(db, organizationId, hash) {
  await ensureNewsletterTables(db);
  return Boolean(await db.prepare('SELECT 1 FROM newsletter_unsubscribes WHERE organization_id = ? AND email_hash = ?').bind(organizationId, hash).first());
}
export async function unsubscribe(db, organizationId, hash) {
  await ensureNewsletterTables(db);
  await db.prepare('INSERT OR IGNORE INTO newsletter_unsubscribes (organization_id, email_hash) VALUES (?, ?)').bind(organizationId, hash).run();
}
export async function resubscribe(db, organizationId, hash) {
  await ensureNewsletterTables(db);
  await db.prepare('DELETE FROM newsletter_unsubscribes WHERE organization_id = ? AND email_hash = ?').bind(organizationId, hash).run();
}

// Adresses des familles : responsables 1 et 2 des inscriptions non archivées et des pré-inscriptions encore en attente
// (ni transférées en inscription, ni expirées). Une entrée par adresse, avec les enfants concernés.
export async function familyAddresses(db, organizationId) {
  const { results: inscriptions } = await db
    .prepare('SELECT id, enfant_prenom, enfant_nom, parent_prenom, parent_nom, email, parent2_prenom, parent2_nom, parent2_email FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL ORDER BY id')
    .bind(organizationId)
    .all();
  let preinscriptions = [];
  try {
    ({ results: preinscriptions } = await db
      .prepare('SELECT enfant_prenom, enfant_nom, parent_prenom, parent_nom, email, parent2_prenom, parent2_nom, parent2_email FROM preinscriptions WHERE organization_id = ? AND inscription_id IS NULL AND expired_at IS NULL ORDER BY id')
      .bind(organizationId)
      .all());
  } catch {
    // Table créée au premier usage des pré-inscriptions : absente = aucune pré-inscription.
  }
  const byEmail = new Map();
  const add = (email, prenom, nom, child, inscriptionId) => {
    const key = normalizeEmail(email);
    if (!key || !key.includes('@')) return;
    const entry = byEmail.get(key) || { email: String(email).trim(), prenom: prenom || '', nom: nom || '', children: [], inscriptionId: null };
    if (!entry.children.includes(child)) entry.children.push(child);
    if (!entry.inscriptionId && inscriptionId) entry.inscriptionId = inscriptionId;
    byEmail.set(key, entry);
  };
  for (const r of [...inscriptions, ...preinscriptions]) {
    const child = `${r.enfant_prenom} ${r.enfant_nom}`;
    add(r.email, r.parent_prenom, r.parent_nom, child, r.id || null);
    add(r.parent2_email, r.parent2_prenom, r.parent2_nom, child, r.id || null);
  }
  return [...byEmail.values()];
}

// Destinataires de la newsletter : adresses des familles moins les désinscrites, chacune avec son jeton.
export async function newsletterAudience(db, organizationId) {
  await ensureNewsletterTables(db);
  const signer = await newsletterSigner(db, organizationId);
  const { results } = await db.prepare('SELECT email_hash FROM newsletter_unsubscribes WHERE organization_id = ?').bind(organizationId).all();
  const off = new Set(results.map((r) => r.email_hash));
  const recipients = [];
  const unsubscribed = [];
  for (const entry of await familyAddresses(db, organizationId)) {
    const token = await signer.token(entry.email);
    if (off.has(token.slice(0, 40))) unsubscribed.push(entry);
    else recipients.push({ ...entry, token });
  }
  return { recipients, unsubscribed };
}

export async function recordNewsletter(db, organizationId, { subject, message, greet = true, sent, failed }) {
  await ensureNewsletterTables(db);
  await db
    .prepare("INSERT INTO newsletters (organization_id, subject, message, greet, sent_count, failed_count, status, sent_at) VALUES (?, ?, ?, ?, ?, ?, 'envoyee', datetime('now'))")
    .bind(organizationId, subject, message, greet ? 1 : 0, sent, failed)
    .run();
}

// Historique : tout sauf les newsletters encore programmées (affichées à part).
export async function listNewsletters(db, organizationId, { limit = 20 } = {}) {
  await ensureNewsletterTables(db);
  const { results } = await db
    .prepare("SELECT id, subject, message, sent_count, failed_count, created_at, status, scheduled_for, sent_at, error FROM newsletters WHERE organization_id = ? AND status <> 'programmee' ORDER BY COALESCE(sent_at, created_at) DESC, id DESC LIMIT ?")
    .bind(organizationId, limit)
    .all();
  return results;
}

export const unsubscribeUrl = (siteUrl, token) => `${siteUrl}/newsletter/desinscription/${token}`;

// ---------------------------------------------------------------------------------------------
// Envoi programmé (2026-11-13). La date et l'heure sont saisies à l'heure de Paris et stockées en UTC
// ('AAAA-MM-JJ HH:MM:SS', comme datetime('now')). Le Worker programmé (workers/cron) appelle /api/cron?taches=newsletters
// toutes les 15 minutes ; le passage quotidien les envoie aussi (filet de sécurité). Chaque newsletter est réservée
// (programmee → en_cours) par une seule instruction avant l'envoi : jamais deux envois, même si deux passages se
// croisent. Une newsletter restée « en_cours » (envoi interrompu) n'est jamais relancée automatiquement (doublons).
export const SCHEDULE_MIN_MINUTES = 15;
export const SCHEDULE_MAX_DAYS = 60;
const TZ = 'Europe/Paris';

// Décalage de Paris par rapport à UTC (en minutes) à un instant donné.
function parisOffsetMinutes(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// « 2026-12-20 » + « 18:30 » (heure de Paris) → Date, ou null si invalide.
export function parisToDate(day, time) {
  const d = String(day || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = String(time || '').match(/^(\d{2}):(\d{2})$/);
  if (!d || !t || +t[1] > 23 || +t[2] > 59) return null;
  const naive = Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]);
  if (new Date(naive).getUTCDate() !== +d[3]) return null; // 31 février…
  let guess = naive - parisOffsetMinutes(new Date(naive)) * 60000;
  guess = naive - parisOffsetMinutes(new Date(guess)) * 60000;
  return new Date(guess);
}

export const toSqlUtc = (date) => date.toISOString().slice(0, 19).replace('T', ' ');
const fromSqlUtc = (value) => new Date(`${String(value).replace(' ', 'T')}Z`);

// « samedi 20 décembre à 18:30 » (heure de Paris).
export function formatParis(sqlUtc) {
  const date = fromSqlUtc(sqlUtc);
  const day = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(date);
  return `${day} à ${time}`;
}

// Date de Paris du jour (AAAA-MM-JJ), pour le champ date du formulaire.
export const parisToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);

export function checkSchedule(date, now = new Date()) {
  if (!date) return 'Indiquez une date et une heure valides.';
  const minutes = (date.getTime() - now.getTime()) / 60000;
  if (minutes < SCHEDULE_MIN_MINUTES) return `Choisissez une heure au moins ${SCHEDULE_MIN_MINUTES} minutes plus tard.`;
  if (minutes > SCHEDULE_MAX_DAYS * 1440) return `Programmez au plus ${SCHEDULE_MAX_DAYS} jours à l’avance.`;
  return null;
}

export async function scheduleNewsletter(db, organizationId, { subject, message, greet, date }) {
  await ensureNewsletterTables(db);
  await db
    .prepare("INSERT INTO newsletters (organization_id, subject, message, greet, status, scheduled_for) VALUES (?, ?, ?, ?, 'programmee', ?)")
    .bind(organizationId, subject, message, greet ? 1 : 0, toSqlUtc(date))
    .run();
}

export async function listScheduled(db, organizationId) {
  await ensureNewsletterTables(db);
  const { results } = await db
    .prepare("SELECT id, subject, message, scheduled_for, created_at FROM newsletters WHERE organization_id = ? AND status = 'programmee' ORDER BY scheduled_for, id")
    .bind(organizationId)
    .all();
  return results;
}

// Annule une newsletter encore programmée (pas déjà partie). Renvoie true si elle l'était.
export async function cancelScheduled(db, organizationId, id) {
  await ensureNewsletterTables(db);
  const res = await db
    .prepare("UPDATE newsletters SET status = 'annulee' WHERE organization_id = ? AND id = ? AND status = 'programmee'")
    .bind(organizationId, id)
    .run();
  return res.meta.changes === 1;
}

// Envoie les newsletters programmées arrivées à échéance. send(recipient, newsletter) → booléen (sendNewsletter).
export async function runScheduledNewsletters(db, organizationId, send, { now = new Date() } = {}) {
  await ensureNewsletterTables(db);
  const { results: due } = await db
    .prepare("SELECT * FROM newsletters WHERE organization_id = ? AND status = 'programmee' AND scheduled_for <= ? ORDER BY scheduled_for, id")
    .bind(organizationId, toSqlUtc(now))
    .all();
  const report = { newsletters: 0, sent: 0, failed: 0 };
  for (const newsletter of due) {
    const claim = await db
      .prepare("UPDATE newsletters SET status = 'en_cours' WHERE organization_id = ? AND id = ? AND status = 'programmee'")
      .bind(organizationId, newsletter.id)
      .run();
    if (claim.meta.changes !== 1) continue; // déjà prise par un autre passage, ou annulée entre-temps
    const { recipients } = await newsletterAudience(db, organizationId);
    if (!recipients.length || recipients.length > MAX_RECIPIENTS) {
      const error = recipients.length ? `Trop d’adresses (${recipients.length}, ${MAX_RECIPIENTS} au plus)` : 'Aucune famille destinataire';
      await db.prepare("UPDATE newsletters SET status = 'echec', error = ?, sent_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(error, organizationId, newsletter.id).run();
      report.failed += 1;
      continue;
    }
    let sent = 0;
    let failed = 0;
    for (const recipient of recipients) {
      if (await send(recipient, newsletter)) sent += 1;
      else failed += 1;
    }
    await db
      .prepare("UPDATE newsletters SET status = 'envoyee', sent_count = ?, failed_count = ?, sent_at = datetime('now') WHERE organization_id = ? AND id = ?")
      .bind(sent, failed, organizationId, newsletter.id)
      .run();
    report.newsletters += 1;
    report.sent += sent;
    report.failed += failed;
  }
  return report;
}
