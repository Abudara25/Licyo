// Données RÉELLES de l'interface de la console fondateur (maquette « Licyo Platform », assets/platform-app).
// L'interface lit un seul module de données (src/data/fixtures.js, qui renvoie vers /platform/donnees) ; ce fichier
// en produit les mêmes exports, avec la même forme, à partir de D1. Règle : aucune donnée fictive présentée comme réelle.
// Ce qui n'est pas encore branché sort VIDE ou « non activé » (incidents, support, onboardings, surveillance des
// services, stockage, factures) : l'interface affiche alors ses états vides, jamais des chiffres inventés.
import { ensureSchema } from './inscriptions-db.js';
import { listOrganizations, sportColor } from './platform-data.js';
import { auditEntries } from './platform-auth.js';
import { initialsOf } from './platform-ui/avatar.js';
import { ROLE_LABELS } from './admin-users.js';

// Registre des capacités (décidé par le code) : modules réellement livrés dans le CRM Licyo.
export const MODULES = [
  { key: 'site', label: 'Site web', capability: 'shipped', flag: null, desc: 'Site public configurable, domaine du club' },
  { key: 'crm', label: 'CRM', capability: 'shipped', flag: null, desc: 'Personnes, familles, adhésions sur plusieurs saisons' },
  { key: 'registrations', label: 'Inscriptions', capability: 'shipped', flag: null, desc: 'Formulaire, pièces, suivi, pré-inscriptions' },
  { key: 'payments', label: 'Paiements', capability: 'shipped', flag: null, desc: 'Échéanciers, chèques, HelloAsso' },
  { key: 'documents', label: 'Documents', capability: 'shipped', flag: null, desc: 'Dossier signé, photo, validation' },
  { key: 'messaging', label: 'Communication', capability: 'shipped', flag: null, desc: 'E-mails, relances, newsletter' },
  { key: 'news', label: 'Actualités', capability: 'shipped', flag: null, desc: 'Articles publiés sur le site' },
  { key: 'schedule', label: 'Planning & événements', capability: 'beta', flag: null, desc: 'Événements du club' },
  { key: 'portal', label: 'Espace famille', capability: 'shipped', flag: null, desc: 'Lien personnel de suivi et de réinscription' },
  { key: 'data_io', label: 'Imports / exports', capability: 'beta', flag: null, desc: 'Export CSV, import Footclubs' },
];

const iso = (sqlite) => (sqlite ? `${String(sqlite).replace(' ', 'T')}${/Z$|[+-]\d\d:\d\d$/.test(sqlite) ? '' : 'Z'}` : null);
const parse = (json, fallback) => {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
};

export async function listPlans(db) {
  await ensureSchema(db);
  const { results } = await db.prepare('SELECT * FROM platform_plans ORDER BY sort_order, key').all();
  return results.map((p) => ({ key: p.key, name: p.name, tagline: p.tagline, priceCents: p.price_cents, quotas: parse(p.quotas, {}), modules: parse(p.modules, []) }));
}

// Saison sportive en cours (1er septembre → 31 août).
const season = (now = new Date()) => {
  const y = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return `Saison ${y}-${y + 1}`;
};

export async function buildSnapshot(env, operator) {
  const db = env.DB;
  await ensureSchema(db);
  const [orgs, plans, journal, extra, users, domains] = await Promise.all([
    listOrganizations(db),
    listPlans(db),
    auditEntries(db, { limit: 200 }),
    db
      .prepare(
        `SELECT o.id, o.lifecycle, o.plan, o.billing_mode, o.billing_status, o.timezone,
           (SELECT MAX(i.created_at) FROM inscriptions i WHERE i.organization_id = o.id) AS last_inscription,
           (SELECT MAX(u.last_login_at) FROM admin_users u WHERE u.organization_id = o.id) AS last_login,
           (SELECT s.published_at FROM site_configs s WHERE s.organization_id = o.id) AS last_publish
         FROM organizations o /* toutes-organisations */`
      )
      .all()
      .then((r) => new Map(r.results.map((row) => [row.id, row]))),
    db
      .prepare("SELECT organization_id, name, role, last_login_at FROM admin_users /* toutes-organisations */ WHERE status = 'active' ORDER BY name")
      .all()
      .then((r) => r.results),
    db.prepare('SELECT domain, organization_id, created_at FROM organization_domains ORDER BY length(domain), domain').all().then((r) => r.results),
  ]);
  const planByKey = new Map(plans.map((p) => [p.key, p]));

  const ORGANIZATIONS = orgs.map((o) => {
    const x = extra.get(o.id) || {};
    const plan = planByKey.get(x.plan) || null;
    const blocked = o.status === 'suspended';
    const color = sportColor(o.sport);
    const last = [x.last_inscription, x.last_login, o.created_at].filter(Boolean).sort().pop();
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      initials: initialsOf(o.name),
      color,
      sports: o.sport ? [o.sport] : [],
      sections: [],
      plan: plan ? plan.key : null,
      lifecycle: x.lifecycle || 'LIVE',
      billing: { mode: x.billing_mode || 'manual', status: x.billing_status || 'MANUAL' },
      access: blocked ? { mode: 'BLOCKED', validUntil: null, reason: 'OPERATOR_BLOCK' } : { mode: 'FULL', validUntil: null, reason: 'CONTRACT_LIVE' },
      domain: o.domain,
      users: users.filter((u) => u.organization_id === o.id).map((u) => ({ name: u.name, role: ROLE_LABELS[u.role] ?? u.role, mfa: false, lastLogin: iso(u.last_login_at) })),
      members: Number(o.members) || 0,
      storageMb: null, // non mesuré
      mrrCents: plan && plan.priceCents != null && x.billing_status === 'ACTIVE' ? plan.priceCents : 0,
      health: blocked ? 'incident' : o.issue ? 'warning' : 'healthy',
      createdAt: iso(o.created_at),
      lastActivityAt: iso(last),
      lastDeployAt: iso(x.last_publish),
      timezone: x.timezone || 'Europe/Paris',
      locale: 'fr-FR',
      colors: [color],
      period: season(),
      modules: Object.fromEntries(MODULES.map((m) => [m.key, plan ? plan.modules.includes(m.key) : m.capability === 'shipped'])),
    };
  });

  const DOMAINS = domains.map((d, i) => ({
    id: `dom_${i + 1}`,
    hostname: d.domain,
    orgId: d.organization_id,
    type: 'custom',
    status: 'UNVERIFIED', // le contrôle DNS / certificat n'est pas encore branché
    claimEpoch: 1,
    ssl: 'none',
    lastCheckAt: null,
    primary: ORGANIZATIONS.find((o) => o.id === d.organization_id)?.domain === d.domain,
  }));

  const AUDIT = journal.map((a) => ({
    at: iso(a.at),
    actor: a.operator_name,
    actorType: a.operator_id ? 'operator' : 'system',
    orgId: a.target_organization_id,
    action: a.action,
    resource: a.detail ? Object.entries(parse(a.detail, {})).map(([k, v]) => `${k}:${v}`).join(' · ') : '—',
    result: 'success',
    ip: '—',
    requestId: `pa_${a.id}`,
  }));

  // Croissance réelle : organisations existantes à la fin de chacun des 12 derniers mois.
  const now = new Date();
  const monthEnds = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 10 + i, 1)));
  const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
  const created = ORGANIZATIONS.map((o) => new Date(o.createdAt || 0));
  const last30 = created.filter((d) => now - d < 30 * 86_400_000).length;
  const GROWTH = {
    months: monthEnds.map((d) => monthFmt.format(new Date(d - 1))),
    organizations: monthEnds.map((end) => created.filter((d) => d < end).length),
    mrrCents: monthEnds.map(() => 0),
    summary: [
      { label: 'Nouvelles organisations (30 j)', value: String(last30) },
      { label: 'Organisations suspendues', value: String(ORGANIZATIONS.filter((o) => o.access.mode === 'BLOCKED').length) },
      { label: 'Comptes des bureaux actifs', value: String(users.length) },
    ],
  };

  const SERVICES = [
    ['d1', 'Base de données (D1)'],
    ['pages', 'Pages & Functions'],
    ['domains', 'Domaines & SSL'],
    ['queues', 'Files d’attente'],
    ['email', 'E-mail transactionnel'],
    ['storage', 'Stockage (R2)'],
  ].map(([key, name]) => ({ key, name, status: 'planned', detail: 'Surveillance pas encore branchée', uptime: null }));

  return {
    OPERATOR_DISPLAY: { name: operator.name, initials: initialsOf(operator.name), email: operator.email, roleLabel: operator.roleLabel },
    ENVIRONMENT: { label: env.APP_ENV === 'production' ? 'Production' : env.APP_ENV === 'preview' ? 'Prévisualisation' : 'Local', region: 'UE', version: 'licyo-crm' },
    PLANS: plans,
    MODULES,
    FLAGS: {},
    ORGANIZATIONS,
    PLATFORM_SITE_DOMAIN: env.PLATFORM_SITE_DOMAIN || 'licyo-demo.pages.dev',
    DOMAINS,
    SERVICES,
    UPTIME: Object.fromEntries(SERVICES.map((s) => [s.key, Array(90).fill('off')])),
    INCIDENTS: [],
    TICKETS: [],
    AUDIT,
    ONBOARDINGS: [],
    GROWTH,
    WIZARD_STEPS: ['Organisation', 'Sport / activité', 'Identité visuelle', 'Domaine', 'Plan', 'Modules', 'Administrateur', 'Vérification', 'Création'],
  };
}

// Module ES servi à l'interface : chaque export en JSON (jamais de code issu des données), plus orgById.
export function snapshotModule(snapshot) {
  const lines = Object.entries(snapshot).map(([name, value]) => `export const ${name} = ${JSON.stringify(value).replace(/</g, '\\u003c')};`);
  lines.push('export const orgById = (id) => ORGANIZATIONS.find((o) => o.id === id) || null;');
  return `// Données réelles générées pour l'opérateur connecté (functions/_shared/platform-snapshot.js).\n${lines.join('\n')}\n`;
}
