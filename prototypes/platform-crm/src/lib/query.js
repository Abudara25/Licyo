// Logique pure (sans DOM) : recherche, filtres, tri, pagination, indicateurs, disponibilité des modules, signaux.
// Testée par tests/platform-prototype.test.mjs.
import { fold, formatDate } from './format.js';
import { SPORTS } from '../data/status.js';

export function searchText(org) {
  return fold([org.name, org.slug, org.domain, org.id, ...org.sports.map((s) => SPORTS[s]?.label ?? s)].join(' '));
}

// Signal « à surveiller » d'une organisation, du plus grave au moins grave. null : rien à signaler.
// Les états attendus (essai, onboarding, résilié en période d'export, archivé) ne sont pas des problèmes.
export function organizationIssue(org) {
  if (org.access.mode === 'BLOCKED' && org.access.reason === 'SECURITY_HOLD') return { rank: 0, tone: 'danger', label: 'Blocage de sécurité' };
  if (org.billing.status === 'UNPAID') return { rank: 0, tone: 'danger', label: 'Impayé · accès en lecture seule' };
  if (org.billing.status === 'PAST_DUE') return { rank: 1, tone: 'warning', label: `Impayé · grâce jusqu’au ${formatDate(org.billing.graceUntil)}` };
  if (org.access.mode === 'MAINTENANCE') return { rank: 2, tone: 'violet', label: 'Maintenance en cours' };
  if (org.lifecycle === 'TERMINATION_SCHEDULED') return { rank: 2, tone: 'warning', label: `Résiliation le ${formatDate(org.access.validUntil)}` };
  return null;
}

// Vues rapides de la liste des organisations.
export const ORG_VIEWS = {
  all: { label: 'Toutes', test: () => true },
  attention: { label: 'À surveiller', test: (o) => organizationIssue(o) !== null },
  active: { label: 'Actives', test: (o) => ['LIVE', 'TERMINATION_SCHEDULED'].includes(o.lifecycle) },
  trial: { label: 'Essais', test: (o) => o.lifecycle === 'TRIAL' },
  onboarding: { label: 'Onboarding', test: (o) => o.lifecycle === 'PROVISIONING' },
  inactive: { label: 'Résiliées et archivées', test: (o) => ['TERMINATED', 'ARCHIVED', 'PURGE_SCHEDULED'].includes(o.lifecycle) },
};

export function filterOrganizations(orgs, { q = '', view = 'all', lifecycle = '', plan = '', health = '', access = '' } = {}) {
  const needle = fold(q.trim());
  const inView = (ORG_VIEWS[view] ?? ORG_VIEWS.all).test;
  return orgs.filter(
    (o) =>
      inView(o) &&
      (!needle || searchText(o).includes(needle)) &&
      (!lifecycle || o.lifecycle === lifecycle) &&
      (!plan || o.plan === plan) &&
      (!health || o.health === health) &&
      (!access || o.access.mode === access)
  );
}

// Répartition des organisations par groupe de cycle de vie (barre empilée du tableau de bord).
export const LIFECYCLE_GROUPS = [
  { key: 'active', label: 'Actives', lifecycles: ['LIVE'], color: '#12b76a' },
  { key: 'ending', label: 'Résiliation planifiée', lifecycles: ['TERMINATION_SCHEDULED'], color: '#f79009' },
  { key: 'trial', label: 'Essais', lifecycles: ['TRIAL'], color: '#7a5af8' },
  { key: 'onboarding', label: 'Onboarding', lifecycles: ['PROVISIONING'], color: '#2e90fa' },
  { key: 'inactive', label: 'Résiliées et archivées', lifecycles: ['TERMINATED', 'ARCHIVED', 'PURGE_SCHEDULED'], color: '#98a2b3' },
];
export const lifecycleBreakdown = (orgs) => LIFECYCLE_GROUPS.map((g) => ({ ...g, count: orgs.filter((o) => g.lifecycles.includes(o.lifecycle)).length }));

// Calcul lisible du mode d'accès (A2 LBA-5) : contribution du contrat, de la facturation et des blocages ;
// le plus restrictif l'emporte. Affichage seulement : la vraie projection est calculée côté serveur.
const RESTRICTION = ['FULL', 'SETUP', 'READ_ONLY', 'MAINTENANCE', 'BLOCKED'];
const LIFECYCLE_CONTRIBUTION = { PROVISIONING: 'SETUP', TRIAL: 'FULL', LIVE: 'FULL', TERMINATION_SCHEDULED: 'FULL', TERMINATED: 'READ_ONLY', ARCHIVED: 'BLOCKED', PURGE_SCHEDULED: 'BLOCKED' };
const HOLDS = { SECURITY_HOLD: { label: 'Blocage de sécurité', mode: 'BLOCKED' }, OPERATOR_MAINTENANCE: { label: 'Maintenance opérateur', mode: 'MAINTENANCE' } };

export function accessDerivation(org, now = new Date('2026-09-28T09:30:00Z')) {
  const lifecycle = LIFECYCLE_CONTRIBUTION[org.lifecycle] ?? 'BLOCKED';
  let billing = null;
  if (['LIVE', 'TERMINATION_SCHEDULED'].includes(org.lifecycle) && org.billing.mode === 'provider') {
    const s = org.billing.status;
    billing = s === 'ACTIVE' || s === 'TRIALING' ? 'FULL' : s === 'PAST_DUE' ? (org.billing.graceUntil && now < new Date(org.billing.graceUntil) ? 'FULL' : 'READ_ONLY') : 'READ_ONLY';
  }
  const hold = HOLDS[org.access.reason] ?? null;
  const modes = [lifecycle, billing, hold?.mode].filter(Boolean);
  const result = modes.reduce((a, b) => (RESTRICTION.indexOf(b) > RESTRICTION.indexOf(a) ? b : a), 'FULL');
  return { lifecycle, billing, hold, result };
}

const SORT_KEYS = {
  name: (o) => fold(o.name),
  members: (o) => o.members,
  createdAt: (o) => o.createdAt,
  lastActivityAt: (o) => o.lastActivityAt,
  mrr: (o) => o.mrrCents,
};

export function sortOrganizations(orgs, key = 'name', dir = 'asc') {
  const get = SORT_KEYS[key] ?? SORT_KEYS.name;
  const factor = dir === 'desc' ? -1 : 1;
  return [...orgs].sort((a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0) * factor);
}

export function paginate(rows, page = 1, size = 8) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * size;
  return { items: rows.slice(start, start + size), page: current, pages, total: rows.length, from: rows.length ? start + 1 : 0, to: Math.min(start + size, rows.length) };
}

export function computeKpis({ organizations, domains, incidents }) {
  const active = organizations.filter((o) => ['LIVE', 'TERMINATION_SCHEDULED'].includes(o.lifecycle));
  return {
    active: active.length,
    trials: organizations.filter((o) => o.lifecycle === 'TRIAL').length,
    onboarding: organizations.filter((o) => o.lifecycle === 'PROVISIONING').length,
    pendingDomains: domains.filter((d) => ['CHALLENGE_ISSUED', 'PROVISIONING'].includes(d.status)).length,
    openIncidents: incidents.filter((i) => i.status !== 'resolved').length,
    mrrCents: active.reduce((sum, o) => sum + o.mrrCents, 0),
  };
}

export function sportDistribution(organizations) {
  const counts = new Map();
  for (const o of organizations) for (const s of o.sports) counts.set(s, (counts.get(s) || 0) + 1);
  return [...counts.entries()].map(([sport, count]) => ({ sport, count })).sort((a, b) => b.count - a.count || a.sport.localeCompare(b.sport));
}

// Disponibilité d'un module pour une organisation = capacité ∧ droit ∧ drapeau ∧ configuration (ADR-013).
// Chaque notion garde sa propre valeur ; le premier facteur manquant donne la raison.
export function moduleAvailability(module, org, { plans, flags }) {
  const plan = plans.find((p) => p.key === org.plan);
  const capability = module.capability !== 'in_development';
  const entitlement = Boolean(plan?.modules.includes(module.key));
  const flag = module.flag ? flags[module.flag] : null;
  const flagOn = !flag || flag.state === 'on' || (flag.state === 'pilot' && flag.pilots.includes(org.id));
  const configured = Boolean(org.modules?.[module.key]);
  const reason = !capability ? 'Capacité non livrée' : !entitlement ? 'Non inclus dans le plan' : !flagOn ? 'Drapeau désactivé' : !configured ? 'Désactivé par le club' : null;
  return { capability, entitlement, flag, flagOn, configured, available: !reason, reason };
}
