// DONNÉES FICTIVES — seule source de données du prototype.
// Aucune donnée de production, aucune donnée personnelle réelle, aucun secret ni jeton.
// Les noms d'organisations servent d'exemples ; tous leurs chiffres, utilisateurs, domaines (.example) et identifiants
// sont inventés. Les adresses IP appartiennent aux plages réservées à la documentation (RFC 5737) et sont masquées.

// ---------------------------------------------------------------------------------------------------------------------
// Opérateur affiché dans l'interface. PUREMENT DÉCORATIF : il n'accorde aucun droit.
// UI visibility is not authorization — l'autorisation de la future console sera décidée côté serveur (ADR-018).
export const OPERATOR_DISPLAY = Object.freeze({
  name: 'Camille Durand',
  initials: 'CD',
  email: 'camille.durand@platform.example',
  roleLabel: 'Support plateforme (profil de démonstration)',
});

export const ENVIRONMENT = Object.freeze({ label: 'Preview', region: 'UE', version: 'v0.1.0-prototype' });

// ---------------------------------------------------------------------------------------------------------------------
// Offres : EXEMPLES D'INTERFACE, non normatifs (la baseline ne fige aucun plan).
export const PLANS = [
  {
    key: 'starter', name: 'Starter', priceCents: 2900, tagline: 'Petites associations, un sport',
    quotas: { members: 300, admins: 3, storageGb: 5, emailsPerMonth: 2000, customDomains: 0 },
    modules: ['site', 'crm', 'registrations', 'news'],
  },
  {
    key: 'club', name: 'Club', priceCents: 7900, tagline: 'Clubs structurés, paiements en ligne',
    quotas: { members: 1500, admins: 10, storageGb: 25, emailsPerMonth: 10000, customDomains: 1 },
    modules: ['site', 'crm', 'registrations', 'payments', 'documents', 'messaging', 'news', 'data_io'],
  },
  {
    key: 'pro', name: 'Pro', priceCents: 14900, tagline: 'Omnisports et académies',
    quotas: { members: null, admins: null, storageGb: 100, emailsPerMonth: 50000, customDomains: 3 },
    modules: ['site', 'crm', 'registrations', 'payments', 'documents', 'messaging', 'news', 'schedule', 'portal', 'data_io'],
  },
];

// Registre des capacités (décidé par le code). Quatre notions distinctes (ADR-013) :
// capacité (code) · droit (plan) · drapeau (déploiement technique) · configuration (le club).
export const MODULES = [
  { key: 'site', label: 'Site web', capability: 'shipped', flag: null, desc: 'Site public configurable, domaine du club' },
  { key: 'crm', label: 'CRM', capability: 'shipped', flag: null, desc: 'Personnes, foyers, adhésions' },
  { key: 'registrations', label: 'Inscriptions', capability: 'shipped', flag: null, desc: 'Formulaires, pièces, suivi' },
  { key: 'payments', label: 'Paiements', capability: 'shipped', flag: 'payments.connector_v2', desc: 'Connecteur du club, grand livre' },
  { key: 'documents', label: 'Documents', capability: 'shipped', flag: null, desc: 'Pièces justificatives, validation' },
  { key: 'messaging', label: 'Communication', capability: 'beta', flag: 'messaging.campaigns', desc: 'E-mails, campagnes, préférences' },
  { key: 'news', label: 'Actualités', capability: 'shipped', flag: 'news.crm_source', desc: 'Articles publiés sur le site' },
  { key: 'schedule', label: 'Planning & événements', capability: 'in_development', flag: null, desc: 'Séances, présences, convocations' },
  { key: 'portal', label: 'Portail membres', capability: 'in_development', flag: null, desc: 'Espace famille et staff' },
  { key: 'data_io', label: 'Imports / exports', capability: 'beta', flag: 'imports.async', desc: 'CSV, Excel, export complet' },
];

// Drapeaux techniques : déploiement progressif, jamais un argument commercial.
export const FLAGS = {
  'payments.connector_v2': { state: 'on', desc: 'Nouveau connecteur de paiement' },
  'messaging.campaigns': { state: 'pilot', pilots: ['org_4c1e0b7d93a2f6581e0c7da94b3f2e61', 'org_a91f3c5e07d24b8f96e1c0d7b25a4f38'], desc: 'Campagnes e-mail' },
  'news.crm_source': { state: 'pilot', pilots: ['org_3f9a1c07e2b84d6f9a0c55e1d2b7c4a8'], desc: 'Actualités servies depuis le CRM' },
  'imports.async': { state: 'off', desc: 'Imports asynchrones (file de traitement)' },
};

// ---------------------------------------------------------------------------------------------------------------------
const users = (...list) => list.map(([name, role, mfa, lastLogin]) => ({ name, role, mfa, lastLogin }));
const allOn = (except = []) => Object.fromEntries(MODULES.map((m) => [m.key, !except.includes(m.key)]));

export const ORGANIZATIONS = [
  {
    id: 'org_3f9a1c07e2b84d6f9a0c55e1d2b7c4a8', slug: 'club-demo', name: 'Club Démo', initials: 'SG', color: '#8a1c2b',
    sports: ['football'], sections: ['École de foot U6-U9'], plan: 'club',
    lifecycle: 'LIVE', billing: { mode: 'manual', status: 'MANUAL' }, access: { mode: 'FULL', validUntil: null, reason: 'CONTRACT_LIVE' },
    domain: 'club-demo.example', users: users(['Admin principal', 'Propriétaire', true, '2026-09-28T07:12:00Z'], ['Secrétariat', 'Administrateur', false, '2026-09-26T18:40:00Z']),
    members: 184, storageMb: 2150, mrrCents: 7900, health: 'healthy', createdAt: '2026-08-31T10:00:00Z', lastActivityAt: '2026-09-28T08:55:00Z',
    lastDeployAt: '2026-09-28T08:41:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#8a1c2b', '#e0b43c'], period: 'Saison 2026-2027',
    modules: allOn(['schedule', 'portal', 'data_io']),
  },
  {
    id: 'org_4c1e0b7d93a2f6581e0c7da94b3f2e61', slug: 'tc-montmorency', name: 'Tennis Club Montmorency', initials: 'TM', color: '#b45309',
    sports: ['tennis', 'padel'], sections: ['Tennis', 'Padel', 'École de tennis'], plan: 'pro',
    lifecycle: 'LIVE', billing: { mode: 'provider', status: 'ACTIVE' }, access: { mode: 'FULL', validUntil: null, reason: 'CONTRACT_LIVE' },
    domain: 'tcmontmorency.example', users: users(['Présidence', 'Propriétaire', true, '2026-09-27T20:05:00Z'], ['Direction sportive', 'Administrateur', true, '2026-09-28T06:48:00Z'], ['Comptabilité', 'Lecteur', true, '2026-09-22T09:10:00Z']),
    members: 612, storageMb: 8420, mrrCents: 14900, health: 'healthy', createdAt: '2026-03-14T09:00:00Z', lastActivityAt: '2026-09-28T09:02:00Z',
    lastDeployAt: '2026-09-24T16:20:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#b45309', '#0f766e'], period: 'Saison 2026-2027',
    modules: allOn(),
  },
  {
    id: 'org_7d20c9e41a6b3f58c2e09a1d4f6b7e35', slug: 'judo-argenteuil', name: 'Judo Argenteuil', initials: 'JA', color: '#6d28d9',
    sports: ['judo'], sections: ['Éveil judo', 'Compétition'], plan: 'starter',
    lifecycle: 'TRIAL', billing: { mode: 'provider', status: 'TRIALING' }, access: { mode: 'FULL', validUntil: '2026-10-07T20:00:00Z', reason: 'TRIAL' },
    domain: 'judo-argenteuil.clubs.example', users: users(['Bureau', 'Propriétaire', false, '2026-09-27T12:30:00Z']),
    members: 96, storageMb: 310, mrrCents: 0, health: 'healthy', createdAt: '2026-09-23T14:00:00Z', lastActivityAt: '2026-09-27T12:44:00Z',
    lastDeployAt: '2026-09-25T10:02:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#6d28d9', '#f5f3ff'], period: 'Saison 2026-2027',
    modules: allOn(['payments', 'documents', 'messaging', 'schedule', 'portal', 'data_io']),
  },
  {
    id: 'org_91b3e6d027f84ac5b1d93e0f62a7c4d8', slug: 'padel-95', name: 'Padel 95', initials: 'P9', color: '#0e7490',
    sports: ['padel'], sections: ['Loisir', 'Tournois'], plan: 'club',
    lifecycle: 'LIVE', billing: { mode: 'provider', status: 'PAST_DUE', graceUntil: '2026-10-05T20:00:00Z' },
    access: { mode: 'FULL', validUntil: '2026-10-05T20:00:00Z', modeAfter: 'READ_ONLY', reason: 'BILLING_PAST_DUE' },
    domain: 'padel95.example', users: users(['Gérance', 'Propriétaire', true, '2026-09-25T17:00:00Z'], ['Accueil', 'Administrateur', false, '2026-09-28T08:15:00Z']),
    members: 341, storageMb: 1240, mrrCents: 7900, health: 'warning', createdAt: '2026-05-02T08:00:00Z', lastActivityAt: '2026-09-28T08:16:00Z',
    lastDeployAt: '2026-09-12T11:30:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#0e7490', '#fde047'], period: 'Année 2026',
    modules: allOn(['schedule', 'portal']),
  },
  {
    id: 'org_a91f3c5e07d24b8f96e1c0d7b25a4f38', slug: 'omnisports-enghien', name: 'Omnisports Enghien', initials: 'OE', color: '#1d4ed8',
    sports: ['football', 'basket', 'natation', 'danse'], sections: ['Football', 'Basket', 'Natation', 'Danse', 'Gym douce', 'Section jeunes'], plan: 'pro',
    lifecycle: 'LIVE', billing: { mode: 'provider', status: 'ACTIVE' }, access: { mode: 'FULL', validUntil: null, reason: 'CONTRACT_LIVE' },
    domain: 'omnisports-enghien.example', users: users(['Direction', 'Propriétaire', true, '2026-09-28T07:58:00Z'], ['Resp. Natation', 'Administrateur', true, '2026-09-27T19:20:00Z'], ['Resp. Basket', 'Administrateur', true, '2026-09-26T21:02:00Z'], ['Trésorerie', 'Lecteur', true, '2026-09-24T10:00:00Z']),
    members: 1438, storageMb: 21480, mrrCents: 14900, health: 'healthy', createdAt: '2026-01-19T09:00:00Z', lastActivityAt: '2026-09-28T09:21:00Z',
    lastDeployAt: '2026-09-27T09:05:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#1d4ed8', '#f59e0b'], period: 'Saison 2026-2027',
    modules: allOn(),
  },
  {
    id: 'org_c07e4a2d9b1f38e65a0d7c3b9e4f1a26', slug: 'natation-val-doise', name: "Natation Club de démonstration", initials: 'NV', color: '#0369a1',
    sports: ['natation'], sections: ['Apprentissage', 'Perfectionnement'], plan: 'club',
    lifecycle: 'PROVISIONING', billing: { mode: 'provider', status: 'NONE' }, access: { mode: 'SETUP', validUntil: null, reason: 'PROVISIONING' },
    domain: 'natation-vo.example', users: users(['Invitation envoyée', 'Propriétaire', false, null]),
    members: 0, storageMb: 12, mrrCents: 0, health: 'healthy', createdAt: '2026-09-26T15:10:00Z', lastActivityAt: '2026-09-27T16:30:00Z',
    lastDeployAt: null, timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#0369a1', '#bae6fd'], period: 'Saison 2026-2027',
    modules: allOn(['schedule', 'portal', 'messaging']), onboardingStep: 4,
  },
  {
    id: 'org_d52b8f1e0c7a49d36b2e8f0a1c9d7e43', slug: 'athle-pontoise', name: 'Athlé Pontoise', initials: 'AP', color: '#c2410c',
    sports: ['athletisme'], sections: ['Sprint', 'Demi-fond', 'Running'], plan: 'club',
    lifecycle: 'LIVE', billing: { mode: 'provider', status: 'ACTIVE' }, access: { mode: 'MAINTENANCE', validUntil: '2026-09-28T11:00:00Z', modeAfter: 'FULL', reason: 'OPERATOR_MAINTENANCE' },
    domain: 'athle-pontoise.example', users: users(['Présidence', 'Propriétaire', true, '2026-09-27T08:00:00Z'], ['Secrétariat', 'Administrateur', false, '2026-09-26T19:45:00Z']),
    members: 402, storageMb: 3900, mrrCents: 7900, health: 'warning', createdAt: '2026-04-08T10:00:00Z', lastActivityAt: '2026-09-28T08:59:00Z',
    lastDeployAt: '2026-09-20T13:12:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#c2410c', '#1e293b'], period: 'Saison 2026-2027',
    modules: allOn(['schedule', 'portal']),
  },
  {
    id: 'org_e1f6a3c8b20d47f9a5c1e7b0d38f2a64', slug: 'basket-sannois', name: 'Basket Sannois', initials: 'BS', color: '#b91c1c',
    sports: ['basket'], sections: ['Mini-basket', 'Seniors'], plan: 'starter',
    lifecycle: 'TERMINATION_SCHEDULED', billing: { mode: 'provider', status: 'ACTIVE' }, access: { mode: 'FULL', validUntil: '2026-10-31T21:00:00Z', modeAfter: 'READ_ONLY', reason: 'TERMINATION_SCHEDULED' },
    domain: 'basket-sannois.clubs.example', users: users(['Bureau', 'Propriétaire', false, '2026-09-19T20:10:00Z']),
    members: 138, storageMb: 640, mrrCents: 2900, health: 'healthy', createdAt: '2026-02-11T09:00:00Z', lastActivityAt: '2026-09-21T20:30:00Z',
    lastDeployAt: '2026-06-02T09:00:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#b91c1c', '#fef2f2'], period: 'Saison 2026-2027',
    modules: allOn(['payments', 'documents', 'messaging', 'schedule', 'portal', 'data_io']),
  },
  {
    id: 'org_f38a0d6c1e9b42a7d5f0c8e3b16a9d72', slug: 'rugby-franconville', name: 'Rugby Club Franconville', initials: 'RF', color: '#4d7c0f',
    sports: ['rugby'], sections: ['École de rugby', 'Seniors'], plan: 'club',
    lifecycle: 'LIVE', billing: { mode: 'provider', status: 'UNPAID', graceUntil: '2026-09-20T20:00:00Z' },
    access: { mode: 'READ_ONLY', validUntil: null, reason: 'BILLING_UNPAID' },
    domain: 'rugby-franconville.example', users: users(['Présidence', 'Propriétaire', true, '2026-09-24T18:00:00Z'], ['Secrétariat', 'Administrateur', false, '2026-09-27T17:25:00Z']),
    members: 267, storageMb: 1830, mrrCents: 7900, health: 'incident', createdAt: '2026-04-26T10:00:00Z', lastActivityAt: '2026-09-27T17:25:00Z',
    lastDeployAt: '2026-08-30T15:00:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#4d7c0f', '#fbbf24'], period: 'Saison 2026-2027',
    modules: allOn(['schedule', 'portal']),
  },
  {
    id: 'org_0b7d4e2a9c6f31e8b5a0d9c7e2f4b163', slug: 'danse-studio-taverny', name: 'Danse Studio Taverny', initials: 'DT', color: '#be185d',
    sports: ['danse'], sections: ['Classique', 'Contemporain', 'Hip-hop'], plan: 'starter',
    lifecycle: 'TRIAL', billing: { mode: 'provider', status: 'TRIALING' }, access: { mode: 'FULL', validUntil: '2026-10-12T20:00:00Z', reason: 'TRIAL' },
    domain: 'danse-taverny.clubs.example', users: users(['Direction', 'Propriétaire', false, '2026-09-26T11:00:00Z']),
    members: 58, storageMb: 190, mrrCents: 0, health: 'healthy', createdAt: '2026-09-18T09:30:00Z', lastActivityAt: '2026-09-26T11:20:00Z',
    lastDeployAt: '2026-09-22T09:00:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#be185d', '#fce7f3'], period: 'Saison 2026-2027',
    modules: allOn(['payments', 'documents', 'messaging', 'schedule', 'portal', 'data_io']),
  },
  {
    id: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', slug: 'badminton-herblay', name: 'Badminton Herblay', initials: 'BH', color: '#0f766e',
    sports: ['badminton'], sections: ['Loisir', 'Compétition'], plan: 'club',
    lifecycle: 'LIVE', billing: { mode: 'provider', status: 'ACTIVE' }, access: { mode: 'BLOCKED', validUntil: null, reason: 'SECURITY_HOLD' },
    domain: 'badminton-herblay.example', users: users(['Présidence', 'Propriétaire', true, '2026-09-27T21:40:00Z'], ['Bureau', 'Administrateur', false, '2026-09-27T21:52:00Z']),
    members: 173, storageMb: 880, mrrCents: 7900, health: 'incident', createdAt: '2026-06-17T09:00:00Z', lastActivityAt: '2026-09-27T21:52:00Z',
    lastDeployAt: '2026-09-10T10:00:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#0f766e', '#ccfbf1'], period: 'Saison 2026-2027',
    modules: allOn(['schedule', 'portal']),
  },
  {
    id: 'org_5a8e1c3f7d0b29e64c1a8f3d5b7e0c92', slug: 'karate-ermont', name: 'Karaté Ermont', initials: 'KE', color: '#7e22ce',
    sports: ['karate'], sections: ['Enfants', 'Adultes'], plan: 'starter',
    lifecycle: 'TERMINATED', billing: { mode: 'provider', status: 'CANCELED' }, access: { mode: 'READ_ONLY', validUntil: '2026-10-21T20:00:00Z', modeAfter: 'BLOCKED', reason: 'TERMINATED_GRACE' },
    domain: 'karate-ermont.clubs.example', users: users(['Bureau', 'Propriétaire', false, '2026-09-15T10:00:00Z']),
    members: 81, storageMb: 420, mrrCents: 0, health: 'healthy', createdAt: '2026-02-02T09:00:00Z', lastActivityAt: '2026-09-15T10:04:00Z',
    lastDeployAt: '2026-05-18T09:00:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#7e22ce', '#faf5ff'], period: 'Saison 2025-2026',
    modules: allOn(['payments', 'documents', 'messaging', 'schedule', 'portal', 'data_io']),
  },
  {
    id: 'org_6c0f9b2e8a4d17f53b9c0e6a2d8f4b71', slug: 'volley-beauchamp', name: 'Volley Beauchamp', initials: 'VB', color: '#b45309',
    sports: ['volley'], sections: ['Loisir mixte'], plan: 'club',
    lifecycle: 'PROVISIONING', billing: { mode: 'provider', status: 'NONE' }, access: { mode: 'SETUP', validUntil: null, reason: 'PROVISIONING' },
    domain: 'volley-beauchamp.clubs.example', users: users(['Invitation envoyée', 'Propriétaire', false, null]),
    members: 0, storageMb: 4, mrrCents: 0, health: 'healthy', createdAt: '2026-09-27T10:40:00Z', lastActivityAt: '2026-09-27T10:52:00Z',
    lastDeployAt: null, timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#b45309', '#fef3c7'], period: 'Saison 2026-2027',
    modules: allOn(['schedule', 'portal', 'messaging', 'payments']), onboardingStep: 2,
  },
  {
    id: 'org_8d3a6e0c2f9b45a17e0d3c8b6f1a9e24', slug: 'escrime-eaubonne', name: 'Escrime Eaubonne', initials: 'EE', color: '#334155',
    sports: ['escrime'], sections: ['Fleuret'], plan: 'starter',
    lifecycle: 'ARCHIVED', billing: { mode: 'provider', status: 'CANCELED' }, access: { mode: 'BLOCKED', validUntil: null, reason: 'ARCHIVED' },
    domain: 'escrime-eaubonne.clubs.example', users: users(['Compte désactivé', 'Propriétaire', false, '2026-06-30T09:00:00Z']),
    members: 0, storageMb: 260, mrrCents: 0, health: 'healthy', createdAt: '2025-11-05T09:00:00Z', lastActivityAt: '2026-06-30T09:00:00Z',
    lastDeployAt: '2026-03-01T09:00:00Z', timezone: 'Europe/Paris', locale: 'fr-FR', colors: ['#334155', '#e2e8f0'], period: 'Saison 2025-2026',
    modules: allOn(['payments', 'documents', 'messaging', 'schedule', 'portal', 'data_io']),
  },
];

export const orgById = (id) => ORGANIZATIONS.find((o) => o.id === id) || null;

// ---------------------------------------------------------------------------------------------------------------------
// Domaines (revendications). Sous-domaines de la plateforme sur un domaine fictif neutre (RFC 2606), sans nom de produit.
export const PLATFORM_SITE_DOMAIN = 'clubs.example';
const dom = (id, hostname, orgId, type, status, claimEpoch, ssl, lastCheckAt, extra = {}) =>
  ({ id, hostname, orgId, type, status, claimEpoch, ssl, lastCheckAt, primary: false, ...extra });
export const DOMAINS = [
  dom('dcl_1a7f0e3c9b2d4f68a0c1e5d7b3f9a2c4', 'club-demo.example', 'org_3f9a1c07e2b84d6f9a0c55e1d2b7c4a8', 'custom', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { primary: true, verifiedBy: 'Attestation opérateur (import legacy)' }),
  dom('dcl_2b8e1f4d0c3a5e79b1d2f6e8c4a0b3d5', 'club-demo.clubs.example', 'org_3f9a1c07e2b84d6f9a0c55e1d2b7c4a8', 'platform', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z'),
  dom('dcl_3c9f2a5e1d4b6f80c2e3a7f9d5b1c4e6', 'tcmontmorency.example', 'org_4c1e0b7d93a2f6581e0c7da94b3f2e61', 'custom', 'ACTIVE', 2, 'active', '2026-09-28T06:00:00Z', { primary: true }),
  dom('dcl_4d0a3b6f2e5c7a91d3f4b8a0e6c2d5f7', 'www.tcmontmorency.example', 'org_4c1e0b7d93a2f6581e0c7da94b3f2e61', 'custom', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { redirect: true }),
  dom('dcl_5e1b4c7a3f6d8b02e4a5c9b1f7d3e6a8', 'judo-argenteuil.clubs.example', 'org_7d20c9e41a6b3f58c2e09a1d4f6b7e35', 'platform', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { primary: true }),
  dom('dcl_6f2c5d8b4a7e9c13f5b6d0c2a8e4f7b9', 'padel95.example', 'org_91b3e6d027f84ac5b1d93e0f62a7c4d8', 'custom', 'CHALLENGE_ISSUED', null, 'none', '2026-09-28T09:00:00Z', { challengeExpiresAt: '2026-10-02T09:00:00Z' }),
  dom('dcl_7a3d6e9c5b8f0d24a6c7e1d3b9f5a8c0', 'padel-95.clubs.example', 'org_91b3e6d027f84ac5b1d93e0f62a7c4d8', 'platform', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { primary: true }),
  dom('dcl_8b4e7f0d6c9a1e35b7d8f2e4c0a6b9d1', 'omnisports-enghien.example', 'org_a91f3c5e07d24b8f96e1c0d7b25a4f38', 'custom', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { primary: true }),
  dom('dcl_9c5f8a1e7d0b2f46c8e9a3f5d1b7c0e2', 'natation-vo.example', 'org_c07e4a2d9b1f38e65a0d7c3b9e4f1a26', 'custom', 'PROVISIONING', 1, 'pending', '2026-09-28T09:10:00Z', { primary: true }),
  dom('dcl_0d6a9b2f8e1c3a57d9f0b4a6e2c8d1f3', 'athle-pontoise.example', 'org_d52b8f1e0c7a49d36b2e8f0a1c9d7e43', 'custom', 'CHALLENGE_ISSUED', null, 'none', '2026-09-28T08:30:00Z', { challengeExpiresAt: '2026-09-30T08:30:00Z' }),
  dom('dcl_1e7b0c3a9f2d4b68e0a1c5b7f3d9e2a4', 'athle-pontoise.clubs.example', 'org_d52b8f1e0c7a49d36b2e8f0a1c9d7e43', 'platform', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { primary: true }),
  dom('dcl_2f8c1d4b0a3e5c79f1b2d6c8a4e0f3b5', 'rugby-franconville.example', 'org_f38a0d6c1e9b42a7d5f0c8e3b16a9d72', 'custom', 'ACTIVE', 1, 'active', '2026-09-28T06:00:00Z', { primary: true }),
  dom('dcl_3a9d2e5c1b4f6d80a2c3e7d9b5f1a4c6', 'badminton-herblay.example', 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', 'custom', 'PROVISIONING_FAILED', 1, 'failed', '2026-09-28T07:45:00Z', { primary: true, error: 'Renouvellement du certificat en échec : enregistrement CNAME introuvable' }),
  dom('dcl_4b0e3f6d2c5a7e91b3d4f8e0c6a2b5d7', 'karate-ermont.example', 'org_5a8e1c3f7d0b29e64c1a8f3d5b7e0c92', 'custom', 'QUARANTINED', 1, 'none', '2026-09-21T10:00:00Z', { quarantineUntil: '2026-10-21T10:00:00Z' }),
  dom('dcl_5c1f4a7e3d6b8f02c4e5a9f1d7b3c6e8', 'escrime-eaubonne.example', 'org_8d3a6e0c2f9b45a17e0d3c8b6f1a9e24', 'custom', 'QUARANTINED', 1, 'none', '2026-07-01T10:00:00Z', { quarantineUntil: '2026-07-31T10:00:00Z' }),
  dom('dcl_6d2a5b8f4e7c9a13d5f6b0a2e8c4d7f9', 'volley-beauchamp.clubs.example', 'org_6c0f9b2e8a4d17f53b9c0e6a2d8f4b71', 'platform', 'PROVISIONING', 1, 'pending', '2026-09-28T09:20:00Z', { primary: true }),
];

// ---------------------------------------------------------------------------------------------------------------------
export const SERVICES = [
  { key: 'd1', name: 'Base de données (D1)', status: 'operational', detail: 'Latence p95 38 ms · réplique UE', uptime: 99.99 },
  { key: 'pages', name: 'Pages & Functions', status: 'operational', detail: 'Dernier déploiement il y a 48 min', uptime: 99.98 },
  { key: 'domains', name: 'Domaines & SSL', status: 'degraded', detail: '1 certificat en échec', uptime: 99.62 },
  { key: 'queues', name: "Files d'attente", status: 'planned', detail: 'Prévu avec la première file (IC-JOBS)', uptime: null },
  { key: 'email', name: 'E-mail transactionnel', status: 'degraded', detail: 'Taux de rebond anormal sur 1 organisation', uptime: 99.9 },
  { key: 'storage', name: 'Stockage (R2)', status: 'operational', detail: '42,1 Go utilisés', uptime: 100 },
];

// 90 jours de disponibilité par service (jour le plus ancien d'abord) : 'ok' | 'warn' | 'down' | 'off'
const days = (spec) => Array.from({ length: 90 }, (_, i) => spec[i] || 'ok');
export const UPTIME = {
  d1: days({ 41: 'warn' }),
  pages: days({ 12: 'warn', 63: 'warn' }),
  domains: days({ 88: 'warn', 89: 'down', 55: 'warn' }),
  queues: Array(90).fill('off'),
  email: days({ 87: 'warn', 88: 'warn', 89: 'warn' }),
  storage: days({}),
};

export const INCIDENTS = [
  { id: 'INC-2046', title: 'Certificat SSL en échec — badminton-herblay.example', severity: 'SEV2', status: 'identified', service: 'domains', orgId: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', startedAt: '2026-09-28T07:45:00Z', resolvedAt: null },
  { id: 'INC-2045', title: 'Taux de rebond e-mail anormal', severity: 'SEV3', status: 'monitoring', service: 'email', orgId: 'org_f38a0d6c1e9b42a7d5f0c8e3b16a9d72', startedAt: '2026-09-26T14:10:00Z', resolvedAt: null },
  { id: 'INC-2044', title: 'Blocage de sécurité — connexions suspectes sur un compte administrateur', severity: 'SEV2', status: 'investigating', service: 'pages', orgId: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', startedAt: '2026-09-27T21:58:00Z', resolvedAt: null },
  { id: 'INC-2039', title: 'Déploiement Pages dégradé (build ralenti)', severity: 'SEV3', status: 'resolved', service: 'pages', orgId: null, startedAt: '2026-09-15T08:02:00Z', resolvedAt: '2026-09-15T08:47:00Z' },
  { id: 'INC-2031', title: 'Latence élevée des requêtes D1', severity: 'SEV3', status: 'resolved', service: 'd1', orgId: null, startedAt: '2026-08-18T16:20:00Z', resolvedAt: '2026-08-18T17:05:00Z' },
];

export const TICKETS = [
  { id: 'SUP-331', subject: 'Impossible de valider un dossier signé (PDF refusé)', orgId: 'org_4c1e0b7d93a2f6581e0c7da94b3f2e61', priority: 'high', status: 'open', openedAt: '2026-09-28T07:40:00Z', assignee: 'Camille D.' },
  { id: 'SUP-330', subject: 'Accès administrateur bloqué après le blocage de sécurité', orgId: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', priority: 'urgent', status: 'open', openedAt: '2026-09-27T22:05:00Z', assignee: 'Nadia R.' },
  { id: 'SUP-329', subject: 'Question sur le passage au plan Club', orgId: 'org_7d20c9e41a6b3f58c2e09a1d4f6b7e35', priority: 'normal', status: 'new', openedAt: '2026-09-27T12:50:00Z', assignee: null },
  { id: 'SUP-328', subject: 'Paiement de l’abonnement refusé par la banque', orgId: 'org_91b3e6d027f84ac5b1d93e0f62a7c4d8', priority: 'high', status: 'waiting', openedAt: '2026-09-26T09:15:00Z', assignee: 'Thomas G.' },
  { id: 'SUP-327', subject: 'Ajout d’une section Natation', orgId: 'org_a91f3c5e07d24b8f96e1c0d7b25a4f38', priority: 'normal', status: 'open', openedAt: '2026-09-25T16:30:00Z', assignee: 'Camille D.' },
  { id: 'SUP-326', subject: 'Enregistrement DNS du domaine personnalisé', orgId: 'org_d52b8f1e0c7a49d36b2e8f0a1c9d7e43', priority: 'normal', status: 'waiting', openedAt: '2026-09-24T10:00:00Z', assignee: 'Thomas G.' },
  { id: 'SUP-325', subject: 'Export complet avant résiliation', orgId: 'org_e1f6a3c8b20d47f9a5c1e7b0d38f2a64', priority: 'low', status: 'new', openedAt: '2026-09-22T18:20:00Z', assignee: null },
  { id: 'SUP-324', subject: 'Logo flou sur le site public', orgId: 'org_0b7d4e2a9c6f31e8b5a0d9c7e2f4b163', priority: 'low', status: 'resolved', openedAt: '2026-09-20T11:00:00Z', assignee: 'Nadia R.' },
  { id: 'SUP-323', subject: 'E-mails de relance classés en indésirables', orgId: 'org_f38a0d6c1e9b42a7d5f0c8e3b16a9d72', priority: 'high', status: 'open', openedAt: '2026-09-19T08:45:00Z', assignee: 'Camille D.' },
];

// Journal plateforme. Adresses : plages de documentation RFC 5737, masquées.
export const AUDIT = [
  { at: '2026-09-28T09:21:00Z', actor: 'Camille D.', actorType: 'operator', orgId: 'org_a91f3c5e07d24b8f96e1c0d7b25a4f38', action: 'support_session.started', resource: 'support_session:sps_7f2c', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J8Z4K7' },
  { at: '2026-09-28T09:10:00Z', actor: 'system:domain_verifier', actorType: 'system', orgId: 'org_c07e4a2d9b1f38e65a0d7c3b9e4f1a26', action: 'domain.provisioning_started', resource: 'domain:natation-vo.example', result: 'success', ip: '—', requestId: 'req_01J8Z4F2' },
  { at: '2026-09-28T09:00:00Z', actor: 'system:contract_schedule', actorType: 'system', orgId: 'org_91b3e6d027f84ac5b1d93e0f62a7c4d8', action: 'access.recalculated', resource: 'access_projection:epoch 14', result: 'success', ip: '—', requestId: 'req_01J8Z3X9' },
  { at: '2026-09-28T08:30:00Z', actor: 'Thomas G.', actorType: 'operator', orgId: 'org_d52b8f1e0c7a49d36b2e8f0a1c9d7e43', action: 'domain.challenge_issued', resource: 'domain:athle-pontoise.example', result: 'success', ip: '198.51.100.•••', requestId: 'req_01J8Z2QB' },
  { at: '2026-09-28T08:12:00Z', actor: 'Thomas G.', actorType: 'operator', orgId: 'org_d52b8f1e0c7a49d36b2e8f0a1c9d7e43', action: 'operator_hold.scheduled', resource: 'hold:maintenance 10:00–13:00', result: 'success', ip: '198.51.100.•••', requestId: 'req_01J8Z2A4' },
  { at: '2026-09-28T07:45:00Z', actor: 'system:domain_verifier', actorType: 'system', orgId: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', action: 'domain.ssl_failed', resource: 'domain:badminton-herblay.example', result: 'failed', ip: '—', requestId: 'req_01J8Z1M7' },
  { at: '2026-09-27T22:01:00Z', actor: 'Nadia R.', actorType: 'operator', orgId: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', action: 'security_hold.set', resource: 'tenant_hold:security', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J8XZ7C' },
  { at: '2026-09-27T21:59:00Z', actor: 'Visiteur inconnu', actorType: 'anonymous', orgId: 'org_2e9c7a0f4b1d56c38e7a2f9b0d4c6e15', action: 'admin.login', resource: 'session', result: 'denied', ip: '192.0.2.•••', requestId: 'req_01J8XZ5R' },
  { at: '2026-09-27T10:40:00Z', actor: 'Camille D.', actorType: 'operator', orgId: 'org_6c0f9b2e8a4d17f53b9c0e6a2d8f4b71', action: 'organization.created', resource: 'organization:volley-beauchamp', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J8WQ0D' },
  { at: '2026-09-26T15:10:00Z', actor: 'Camille D.', actorType: 'operator', orgId: 'org_c07e4a2d9b1f38e65a0d7c3b9e4f1a26', action: 'organization.created', resource: 'organization:natation-val-doise', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J8TZ1A' },
  { at: '2026-09-26T09:05:00Z', actor: 'system:billing_sync', actorType: 'system', orgId: 'org_91b3e6d027f84ac5b1d93e0f62a7c4d8', action: 'billing.state_synced', resource: 'tenant_billing:PAST_DUE', result: 'success', ip: '—', requestId: 'req_01J8TB3K' },
  { at: '2026-09-25T14:22:00Z', actor: 'Thomas G.', actorType: 'operator', orgId: 'org_4c1e0b7d93a2f6581e0c7da94b3f2e61', action: 'entitlement.changed', resource: 'entitlement:customDomains 2 → 3', result: 'success', ip: '198.51.100.•••', requestId: 'req_01J8QX8F' },
  { at: '2026-09-24T11:03:00Z', actor: 'Camille D.', actorType: 'operator', orgId: 'org_3f9a1c07e2b84d6f9a0c55e1d2b7c4a8', action: 'flag.pilot_added', resource: 'flag:news.crm_source', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J8N4R2' },
  { at: '2026-09-23T14:00:00Z', actor: 'Camille D.', actorType: 'operator', orgId: 'org_7d20c9e41a6b3f58c2e09a1d4f6b7e35', action: 'lifecycle.transitioned', resource: 'PROVISIONING → TRIAL', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J8KD6T' },
  { at: '2026-09-21T10:00:00Z', actor: 'system:contract_schedule', actorType: 'system', orgId: 'org_5a8e1c3f7d0b29e64c1a8f3d5b7e0c92', action: 'domain.quarantined', resource: 'domain:karate-ermont.example', result: 'success', ip: '—', requestId: 'req_01J8E0P1' },
  { at: '2026-09-20T20:00:00Z', actor: 'system:contract_schedule', actorType: 'system', orgId: 'org_f38a0d6c1e9b42a7d5f0c8e3b16a9d72', action: 'access.recalculated', resource: 'FULL → READ_ONLY (grâce expirée)', result: 'success', ip: '—', requestId: 'req_01J8DAX4' },
  { at: '2026-09-18T09:30:00Z', actor: 'Nadia R.', actorType: 'operator', orgId: 'org_0b7d4e2a9c6f31e8b5a0d9c7e2f4b163', action: 'organization.created', resource: 'organization:danse-studio-taverny', result: 'success', ip: '203.0.113.•••', requestId: 'req_01J87V2M' },
  { at: '2026-09-16T16:45:00Z', actor: 'Thomas G.', actorType: 'operator', orgId: 'org_e1f6a3c8b20d47f9a5c1e7b0d38f2a64', action: 'lifecycle.transitioned', resource: 'LIVE → TERMINATION_SCHEDULED', result: 'success', ip: '198.51.100.•••', requestId: 'req_01J83P7Q' },
];

export const ONBOARDINGS = [
  { orgId: 'org_c07e4a2d9b1f38e65a0d7c3b9e4f1a26', step: 4, owner: 'Camille D.', startedAt: '2026-09-26T15:10:00Z', blocker: 'Enregistrement DNS du domaine en cours de propagation' },
  { orgId: 'org_6c0f9b2e8a4d17f53b9c0e6a2d8f4b71', step: 2, owner: 'Camille D.', startedAt: '2026-09-27T10:40:00Z', blocker: null },
  { orgId: null, draftName: "Tir à l'arc Cormeilles", sport: 'Tir à l’arc', step: 1, owner: 'Nadia R.', startedAt: '2026-09-28T08:05:00Z', blocker: 'Brouillon' },
];

// Évolution mensuelle (octobre 2025 → septembre 2026)
export const GROWTH = {
  months: ['oct.', 'nov.', 'déc.', 'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.'],
  organizations: [1, 2, 2, 3, 6, 7, 9, 10, 11, 11, 12, 14],
  mrrCents: [2900, 5800, 5800, 20700, 23600, 38500, 54300, 62200, 70100, 70100, 70100, 72200],
  summary: [
    { label: 'Nouvelles organisations (30 j)', value: '5' },
    { label: 'Essais convertis (12 mois)', value: '4 sur 6' },
    { label: 'Résiliations (12 mois)', value: '3' },
  ],
};

export const WIZARD_STEPS = ['Organisation', 'Sport / activité', 'Identité visuelle', 'Domaine', 'Plan', 'Modules', 'Administrateur', 'Vérification', 'Création'];
