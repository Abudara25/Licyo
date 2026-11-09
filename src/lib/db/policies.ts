// Règles d'accès aux lignes : remplacent la RLS Postgres (supabase/migrations 0001-0005).
//
// Chaque requête de la couche de données reçoit un contexte de sécurité :
//   - service       : accès complet (webhooks, formulaires publics déjà validés,
//                     actions déjà contrôlées côté serveur) ;
//   - anon          : visiteur non connecté ;
//   - authenticated : utilisateur connecté (userId vérifié par la session).
// Pour anon/authenticated, le constructeur de requêtes ajoute la condition SQL
// de la politique : lignes invisibles en lecture, refusées en écriture.
// Sans politique applicable, l'accès est refusé (refus par défaut).

import type { TableName } from './schema';

export type SecurityContext =
  | { role: 'service' }
  | { role: 'anon' }
  | { role: 'authenticated'; userId: string };

export type Command = 'select' | 'insert' | 'update' | 'delete';

/** Fabrique la référence SQL d'une colonne de la ligne évaluée. */
export type ColumnRef = (column: string) => string;

export type Helpers = {
  uid: string; // littéral SQL ('...') ou NULL
  isSuperAdmin: string;
  hasClubRole: (club: string, roles: readonly string[]) => string;
  isClubStaff: (club: string) => string;
  isClubManager: (club: string) => string;
  isPublicClub: (club: string) => string;
  hasFamilyAccess: (family: string) => string;
  canCoachCategory: (club: string, category: string) => string;
};

type Expr = (col: ColumnRef, h: Helpers) => string;

type Policy = {
  cmd: Command | 'all';
  /** 'authenticated' : ignorée pour un visiteur anonyme. */
  to: 'public' | 'authenticated';
  using?: Expr;
  check?: Expr;
};

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const STAFF = ['president', 'secretary', 'treasurer', 'coach'] as const;
const MANAGERS = ['president', 'secretary', 'treasurer'] as const;
const EDITORS = ['president', 'secretary'] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function list(values: readonly string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
}

export function buildHelpers(ctx: SecurityContext): Helpers {
  if (ctx.role === 'authenticated' && !UUID_RE.test(ctx.userId)) {
    throw new Error('Identifiant utilisateur invalide');
  }
  const signedIn = ctx.role === 'authenticated';
  // L'identifiant vient de la session serveur et est validé ci-dessus : inclusion littérale sûre.
  const uid = signedIn ? `'${ctx.userId}'` : 'NULL';
  const isSuperAdmin = signedIn
    ? `EXISTS (SELECT 1 FROM staff_members sa WHERE sa.user_id = ${uid} AND sa.role = 'super_admin')`
    : '0';
  const hasClubRole = (club: string, roles: readonly string[]) =>
    signedIn
      ? `(${isSuperAdmin} OR EXISTS (SELECT 1 FROM staff_members sr WHERE sr.user_id = ${uid} AND sr.club_id = ${club} AND sr.role IN (${list(roles)})))`
      : '0';
  const isClubManager = (club: string) => hasClubRole(club, MANAGERS);
  return {
    uid,
    isSuperAdmin,
    hasClubRole,
    isClubStaff: (club) => hasClubRole(club, STAFF),
    isClubManager,
    isPublicClub: (club) =>
      `EXISTS (SELECT 1 FROM clubs pc WHERE pc.id = ${club} AND (pc.status = 'active' OR (pc.status = 'demo' AND (pc.demo_expires_at IS NULL OR pc.demo_expires_at > ${NOW}))))`,
    hasFamilyAccess: (family) =>
      signedIn ? `EXISTS (SELECT 1 FROM family_access fa WHERE fa.family_id = ${family} AND fa.user_id = ${uid})` : '0',
    canCoachCategory: (club, category) =>
      signedIn
        ? `(${isClubManager(club)} OR EXISTS (SELECT 1 FROM staff_members sc, json_each(sc.assigned_category_ids) jc WHERE sc.user_id = ${uid} AND sc.club_id = ${club} AND sc.role = 'coach' AND jc.value = ${category}))`
        : '0',
  };
}

// --- Politiques par table (équivalent des CREATE POLICY) ----------------------------

const superAdminAll: Policy = { cmd: 'all', to: 'authenticated', using: (_c, h) => h.isSuperAdmin };
const managerAll: Policy = { cmd: 'all', to: 'authenticated', using: (c, h) => h.isClubManager(c('club_id')) };
const publicOrStaffRead: Policy = {
  cmd: 'select',
  to: 'public',
  using: (c, h) => `(${h.isPublicClub(c('club_id'))} OR ${h.isClubStaff(c('club_id'))})`,
};
/** Contenus de vitrine : lecture publique, écriture par le bureau, tout pour le super_admin. */
const vitrineContent: Policy[] = [publicOrStaffRead, managerAll, superAdminAll];

const POLICIES: Partial<Record<TableName, Policy[]>> = {
  // Comptes, sessions, limites : service uniquement (aucune politique).
  membership_tiers: [
    { cmd: 'select', to: 'public', using: (c, h) => `(${c('is_active')} = 1 OR ${h.isSuperAdmin})` },
    superAdminAll,
  ],
  clubs: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.isClubStaff(c('id')) },
    { cmd: 'update', to: 'authenticated', using: (c, h) => h.isClubManager(c('id')) },
    superAdminAll,
  ],
  public_clubs: [{ cmd: 'select', to: 'public', using: () => '1' }],
  // club_mail_credentials : service uniquement.
  staff_members: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => `(${c('user_id')} = ${h.uid} OR ${h.isClubStaff(c('club_id'))})` },
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) => `(${c('club_id')} IS NOT NULL AND ${h.hasClubRole(c('club_id'), ['president'])})`,
      check: (c, h) =>
        `(${c('club_id')} IS NOT NULL AND ${c('role')} <> 'super_admin' AND ${h.hasClubRole(c('club_id'), ['president'])})`,
    },
    superAdminAll,
  ],
  facilities: vitrineContent,
  categories: vitrineContent,
  schedules: vitrineContent,
  club_products: vitrineContent,
  sponsors: vitrineContent,
  posts: [
    {
      cmd: 'select',
      to: 'public',
      using: (c, h) =>
        `((${c('is_published')} = 1 AND ${c('published_at')} <= ${NOW} AND ${h.isPublicClub(c('club_id'))}) OR ${h.isClubStaff(c('club_id'))})`,
    },
    managerAll,
    superAdminAll,
  ],
  events: [
    publicOrStaffRead,
    { cmd: 'all', to: 'authenticated', using: (c, h) => h.canCoachCategory(c('club_id'), c('category_id')) },
    superAdminAll,
  ],
  members: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.isClubManager(c('club_id')) },
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.hasFamilyAccess(c('family_id')) },
    managerAll,
    superAdminAll,
  ],
  coach_roster: [{ cmd: 'select', to: 'authenticated', using: (c, h) => h.canCoachCategory(c('club_id'), c('category_id')) }],
  coach_contacts: [
    {
      cmd: 'select',
      to: 'authenticated',
      using: (c, h) =>
        `(${h.isClubManager(c('club_id'))} OR EXISTS (SELECT 1 FROM members mr WHERE mr.family_id = ${c('id')} AND ${h.canCoachCategory('mr.club_id', 'mr.category_id')}))`,
    },
  ],
  family_registrations: [
    managerAll,
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.hasFamilyAccess(c('id')) },
    superAdminAll,
  ],
  payment_installments: [
    managerAll,
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.hasFamilyAccess(c('family_id')) },
    superAdminAll,
  ],
  member_product_orders: [managerAll, superAdminAll],
  attendances: [
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) =>
        `EXISTS (SELECT 1 FROM schedules sa2 WHERE sa2.id = ${c('schedule_id')} AND sa2.club_id = ${c('club_id')} AND ${h.canCoachCategory('sa2.club_id', 'sa2.category_id')})`,
      check: (c, h) =>
        `EXISTS (SELECT 1 FROM schedules sa3 JOIN members ma3 ON ma3.category_id = sa3.category_id AND ma3.club_id = sa3.club_id WHERE sa3.id = ${c('schedule_id')} AND ma3.id = ${c('member_id')} AND sa3.club_id = ${c('club_id')} AND ${h.canCoachCategory('sa3.club_id', 'sa3.category_id')})`,
    },
    superAdminAll,
  ],
  event_convocations: [
    {
      cmd: 'select',
      to: 'authenticated',
      using: (c, h) => `EXISTS (SELECT 1 FROM members mo WHERE mo.id = ${c('member_id')} AND ${h.hasFamilyAccess('mo.family_id')})`,
    },
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) =>
        `EXISTS (SELECT 1 FROM events ec WHERE ec.id = ${c('event_id')} AND ${h.canCoachCategory('ec.club_id', 'ec.category_id')})`,
      check: (c, h) =>
        `EXISTS (SELECT 1 FROM events ek JOIN members mk ON mk.club_id = ek.club_id WHERE ek.id = ${c('event_id')} AND mk.id = ${c('member_id')} AND ek.club_id = ${c('club_id')} AND (ek.category_id IS NULL OR mk.category_id = ek.category_id) AND ${h.canCoachCategory('ek.club_id', 'ek.category_id')})`,
    },
    superAdminAll,
  ],
  sponsor_leads: [managerAll, superAdminAll],
  anonymous_page_views: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.isClubStaff(c('club_id')) },
    superAdminAll,
  ],
  club_requests: [managerAll],
  club_gallery: [
    { cmd: 'select', to: 'public', using: (c, h) => h.isPublicClub(c('club_id')) },
    managerAll,
  ],
  club_site_settings: [
    { cmd: 'select', to: 'public', using: (c, h) => h.isPublicClub(c('club_id')) },
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.isClubManager(c('club_id')) },
    {
      cmd: 'insert',
      to: 'authenticated',
      check: (c, h) => `(${h.hasClubRole(c('club_id'), EDITORS)} OR ${h.isSuperAdmin})`,
    },
    {
      cmd: 'update',
      to: 'authenticated',
      using: (c, h) => `(${h.hasClubRole(c('club_id'), EDITORS)} OR ${h.isSuperAdmin})`,
    },
  ],
  club_site_media: [
    { cmd: 'select', to: 'public', using: (c, h) => h.isPublicClub(c('club_id')) },
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) => `(${h.hasClubRole(c('club_id'), EDITORS)} OR ${h.isSuperAdmin})`,
    },
  ],
  family_access: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => `(${c('user_id')} = ${h.uid} OR ${h.isSuperAdmin})` },
  ],
  saas_prospects: [superAdminAll],
  platform_announcements: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => `(${c('is_active')} = 1 OR ${h.isSuperAdmin})` },
    superAdminAll,
  ],
  audit_events: [{ cmd: 'select', to: 'authenticated', using: (_c, h) => h.isSuperAdmin }],
};

/** Colonnes de clubs modifiables par un utilisateur (ancien GRANT UPDATE(...) de 0002). */
export const CLUB_USER_UPDATABLE = new Set([
  'name', 'sport_type', 'theme_preset', 'primary_color', 'secondary_color', 'logo_url', 'hero_image_url',
  'club_history_text', 'president_word_text', 'president_name', 'president_signature_url', 'rna_number',
  'siret_number', 'federation_name', 'affiliation_number', 'city', 'postal_code', 'nearby_cities',
  'contact_email', 'contact_phone', 'social_links', 'sibling_discount_rules', 'accepts_pass_sport',
  'pass_sport_amount', 'accepts_caf_aids', 'accepts_installments', 'pass_stripe_fees_to_parents',
  'enabled_modules', 'current_season',
]);

export type PolicySql = {
  /** Condition sur la ligne existante (SELECT, UPDATE, DELETE). null = aucune restriction. */
  using: ((col: ColumnRef) => string) | null;
  /** Condition sur la nouvelle ligne (INSERT, UPDATE). null = aucune restriction. */
  check: ((col: ColumnRef) => string) | null;
};

const DENY = () => '0';

/**
 * Conditions SQL effectives pour une commande, selon la sémantique Postgres :
 * politiques permissives combinées par OU ; WITH CHECK par défaut = USING.
 */
export function policyFor(table: TableName, cmd: Command, ctx: SecurityContext): PolicySql {
  if (ctx.role === 'service') return { using: null, check: null };
  const h = buildHelpers(ctx);
  const applicable = (POLICIES[table] ?? []).filter(
    (p) => (p.cmd === cmd || p.cmd === 'all') && (p.to === 'public' || ctx.role === 'authenticated'),
  );
  if (applicable.length === 0) return { using: DENY, check: DENY };

  const usingExprs = applicable.map((p) => p.using).filter((e): e is Expr => Boolean(e));
  const checkExprs = applicable.map((p) => p.check ?? p.using).filter((e): e is Expr => Boolean(e));
  const combine = (exprs: Expr[]) =>
    exprs.length === 0 ? DENY : (col: ColumnRef) => `(${exprs.map((e) => `(${e(col, h)})`).join(' OR ')})`;

  return {
    using: cmd === 'insert' ? null : combine(usingExprs),
    check: cmd === 'select' || cmd === 'delete' ? null : combine(checkExprs),
  };
}
