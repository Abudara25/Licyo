// Abonnements des clubs à Licyo (2026-10-20), première version SANS prestataire de paiement : l'éditeur suit dans la
// console plateforme la formule, le prix mensuel, la période d'essai et les paiements reçus (virement, prélèvement,
// carte… enregistrés à la main). Le club voit son abonnement dans Paramètres. Aucune coupure automatique : un retard
// est signalé (console, tableau de bord du club), la suspension reste une décision de l'éditeur.
//
// Tables (migration 18, additive) : platform_subscriptions (une ligne par club) et platform_payments (paiements reçus).
// Lues par la console (toutes organisations) et par le club (la sienne seulement).

export const BILLING_MIGRATION_VERSION = 18;
export const TRIAL_DAYS = 30;

// Formules et prix mensuels de référence (centimes, TTC). Le prix de chaque club reste modifiable dans la console.
export const PLANS = Object.freeze({
  essentiel: { label: 'Essentiel', price: 2900, description: 'Site, inscriptions en ligne, espace famille.' },
  club: { label: 'Club', price: 4900, description: 'Essentiel + CRM adhérents, présences, relances automatiques.' },
  premium: { label: 'Premium', price: 7900, description: 'Club + domaine personnalisé, accompagnement prioritaire.' },
});
export const SUBSCRIPTION_STATUSES = Object.freeze({ trial: 'Essai', active: 'Actif', past_due: 'En retard', cancelled: 'Résilié' });
export const PAYMENT_METHODS = Object.freeze({ virement: 'Virement', prelevement: 'Prélèvement', carte: 'Carte bancaire', cheque: 'Chèque', autre: 'Autre' });

const DEFINITIONS = [
  [
    'platform_subscriptions',
    `CREATE TABLE IF NOT EXISTS platform_subscriptions (
      organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
      plan TEXT NOT NULL DEFAULT 'club',
      status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial', 'active', 'past_due', 'cancelled')),
      monthly_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (monthly_price_cents >= 0),
      trial_ends_at TEXT,
      current_period_end TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ],
  [
    'platform_payments',
    `CREATE TABLE IF NOT EXISTS platform_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      months INTEGER NOT NULL DEFAULT 1 CHECK (months BETWEEN 1 AND 24),
      method TEXT NOT NULL DEFAULT 'virement',
      reference TEXT NOT NULL DEFAULT '',
      paid_at TEXT NOT NULL,
      recorded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ],
];
const INDEXES = [['idx_platform_payments_org', 'CREATE INDEX IF NOT EXISTS idx_platform_payments_org ON platform_payments (organization_id, paid_at)']];

export function billingMigrationStatements(db) {
  return [...DEFINITIONS.map(([, sql]) => db.prepare(sql)), ...INDEXES.map(([, sql]) => db.prepare(sql))];
}

export async function repairBillingInvariants(db, { tableExists }) {
  const statements = [];
  for (const [table, sql] of DEFINITIONS) if (!(await tableExists(db, table))) statements.push(db.prepare(sql));
  for (const [name, sql] of INDEXES) {
    if (!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first())) statements.push(db.prepare(sql));
  }
  return statements;
}

export class BillingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BillingError';
  }
}

const isoDate = (date) => date.toISOString().slice(0, 10);
export const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
};
export const addMonths = (iso, months) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return isoDate(d);
};
export const today = (now = new Date()) => isoDate(now);
export const formatEuros = (cents) => `${(Number(cents || 0) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

// Échéance effective : fin d'essai pendant l'essai, sinon fin de la période payée.
export const dueDate = (sub) => (sub ? (sub.status === 'trial' ? sub.trial_ends_at : sub.current_period_end) : null);

// Abonnement d'essai créé avec le club (console). Sans effet s'il existe déjà.
export async function startTrial(db, organizationId, { plan = 'club', now = new Date() } = {}) {
  const chosen = PLANS[plan] ? plan : 'club';
  await db
    .prepare('INSERT OR IGNORE INTO platform_subscriptions (organization_id, plan, status, monthly_price_cents, trial_ends_at) VALUES (?, ?, ?, ?, ?)')
    .bind(organizationId, chosen, 'trial', PLANS[chosen].price, addDays(today(now), TRIAL_DAYS))
    .run();
}

export async function getSubscription(db, organizationId) {
  return db.prepare('SELECT * FROM platform_subscriptions WHERE organization_id = ?').bind(organizationId).first().catch(() => null);
}

// Console : tous les clubs avec leur abonnement (ligne absente = pas d'abonnement suivi, ex. club de démo).
export async function listSubscriptions(db) {
  const { results } = await db
    .prepare(
      `SELECT o.id AS organization_id, o.name, o.status AS organization_status, s.plan, s.status, s.monthly_price_cents, s.trial_ends_at, s.current_period_end, s.notes,
              (SELECT MAX(p.paid_at) FROM platform_payments p WHERE p.organization_id = o.id) AS last_paid_at,
              (SELECT COALESCE(SUM(p.amount_cents), 0) FROM platform_payments p WHERE p.organization_id = o.id) AS total_paid_cents
       FROM organizations o /* toutes-organisations */
       LEFT JOIN platform_subscriptions s ON s.organization_id = o.id
       ORDER BY o.created_at, o.id`
    )
    .all();
  return results;
}

// Indicateurs de la console : revenu mensuel récurrent (clubs actifs), essais, retards.
export function billingStats(rows) {
  return {
    mrrCents: rows.filter((r) => r.status === 'active').reduce((sum, r) => sum + Number(r.monthly_price_cents || 0), 0),
    trials: rows.filter((r) => r.status === 'trial').length,
    pastDue: rows.filter((r) => r.status === 'past_due').length,
    active: rows.filter((r) => r.status === 'active').length,
  };
}

export async function updateSubscription(db, organizationId, { plan, status, priceEuros, notes }) {
  const current = await getSubscription(db, organizationId);
  if (!current) await startTrial(db, organizationId, { plan });
  const sub = await getSubscription(db, organizationId);
  const nextPlan = PLANS[plan] ? plan : sub.plan;
  const nextStatus = SUBSCRIPTION_STATUSES[status] ? status : sub.status;
  let price = sub.monthly_price_cents;
  if (priceEuros !== undefined && priceEuros !== null && String(priceEuros).trim() !== '') {
    const value = Number(String(priceEuros).replace(',', '.'));
    if (!Number.isFinite(value) || value < 0 || value > 10000) throw new BillingError('Prix mensuel invalide.');
    price = Math.round(value * 100);
  }
  const cleanNotes = String(notes ?? sub.notes).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, 1000);
  await db
    .prepare("UPDATE platform_subscriptions SET plan = ?, status = ?, monthly_price_cents = ?, notes = ?, updated_at = datetime('now') WHERE organization_id = ?")
    .bind(nextPlan, nextStatus, price, cleanNotes, organizationId)
    .run();
  return getSubscription(db, organizationId);
}

// Paiement reçu : enregistré, période prolongée d'autant de mois (à partir de l'échéance si elle n'est pas dépassée,
// sinon d'aujourd'hui), abonnement actif.
export async function recordPayment(db, organizationId, { amountEuros, months = 1, method = 'virement', reference = '', userId = null, now = new Date() }) {
  const amount = Math.round(Number(String(amountEuros ?? '').replace(',', '.')) * 100);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new BillingError('Montant invalide.');
  const count = Number.parseInt(months, 10);
  if (!Number.isInteger(count) || count < 1 || count > 24) throw new BillingError('Nombre de mois invalide (1 à 24).');
  if (!PAYMENT_METHODS[method]) throw new BillingError('Moyen de paiement inconnu.');
  if (!(await getSubscription(db, organizationId))) await startTrial(db, organizationId, { now });
  const sub = await getSubscription(db, organizationId);
  const base = [sub.current_period_end, sub.status === 'trial' ? sub.trial_ends_at : null].filter(Boolean).sort().pop();
  const start = base && base > today(now) ? base : today(now);
  const end = addMonths(start, count);
  await db.batch([
    db
      .prepare('INSERT INTO platform_payments (organization_id, amount_cents, months, method, reference, paid_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(organizationId, amount, count, method, String(reference || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 80), today(now), userId),
    db
      .prepare("UPDATE platform_subscriptions SET status = 'active', current_period_end = ?, updated_at = datetime('now') WHERE organization_id = ?")
      .bind(end, organizationId),
  ]);
  return getSubscription(db, organizationId);
}

export async function listPayments(db, organizationId, limit = 12) {
  const { results } = await db.prepare('SELECT * FROM platform_payments WHERE organization_id = ? ORDER BY paid_at DESC, id DESC LIMIT ?').bind(organizationId, limit).all();
  return results;
}

// Passage quotidien (cron) : essai terminé ou période échue non payée = « En retard ». Jamais de suspension.
export async function markOverdue(db, now = new Date()) {
  const day = today(now);
  const result = await db
    .prepare(
      `UPDATE platform_subscriptions /* toutes-organisations */ SET status = 'past_due', updated_at = datetime('now')
       WHERE (status = 'trial' AND trial_ends_at IS NOT NULL AND trial_ends_at < ?)
          OR (status = 'active' AND current_period_end IS NOT NULL AND current_period_end < ?)`
    )
    .bind(day, day)
    .run();
  return result.meta?.changes || 0;
}

// Message pour le tableau de bord du club (responsables) : essai qui se termine, retard. null sinon.
export function subscriptionNotice(sub, now = new Date()) {
  if (!sub) return null;
  const day = today(now);
  if (sub.status === 'past_due') return { tone: 'error', text: 'Abonnement Licyo en retard de paiement : contactez Licyo pour régulariser.' };
  if (sub.status === 'trial' && sub.trial_ends_at && sub.trial_ends_at <= addDays(day, 7)) {
    return { tone: 'info', text: `Votre période d’essai Licyo se termine le ${sub.trial_ends_at.split('-').reverse().join('/')}.` };
  }
  return null;
}
