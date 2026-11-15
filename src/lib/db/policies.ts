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
import { CLUB_ROLES, rolesWith, scopedRolesWith, type Permission, type ScopedPermission } from '../permissions.ts';

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
  /** Permission sur tout le club (src/lib/permissions.ts). */
  can: (club: string, permission: Permission) => string;
  isPublicClub: (club: string) => string;
  hasFamilyAccess: (family: string) => string;
  /** Permission sportive : sur tout le club (sport.manage) ou sur une catégorie rattachée (encadrement). */
  canInCategory: (club: string, category: string, permission: ScopedPermission) => string;
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
  // Droit d'une ligne staff_members : sa liste personnalisée, ou à défaut (NULL) les droits par défaut de son rôle.
  const holds = (alias: string, grant: Permission | ScopedPermission, defaultRoles: readonly string[]) =>
    `((${alias}.permissions IS NULL AND ${alias}.role IN (${list(defaultRoles)})) OR EXISTS (SELECT 1 FROM json_each(${alias}.permissions) jp WHERE jp.value = ${list([grant])}))`;
  const can = (club: string, permission: Permission) =>
    signedIn
      ? `(${isSuperAdmin} OR EXISTS (SELECT 1 FROM staff_members sp WHERE sp.user_id = ${uid} AND sp.club_id = ${club} AND ${holds('sp', permission, rolesWith(permission))}))`
      : '0';
  return {
    uid,
    isSuperAdmin,
    hasClubRole,
    isClubStaff: (club) => hasClubRole(club, CLUB_ROLES),
    can,
    isPublicClub: (club) =>
      `EXISTS (SELECT 1 FROM clubs pc WHERE pc.id = ${club} AND (pc.status = 'active' OR (pc.status = 'demo' AND (pc.demo_expires_at IS NULL OR pc.demo_expires_at > ${NOW}))))`,
    hasFamilyAccess: (family) =>
      signedIn ? `EXISTS (SELECT 1 FROM family_access fa WHERE fa.family_id = ${family} AND fa.user_id = ${uid})` : '0',
    canInCategory: (club, category, permission) =>
      signedIn
        ? `(${can(club, 'sport.manage')} OR EXISTS (SELECT 1 FROM staff_members sc, json_each(sc.assigned_category_ids) jc WHERE sc.user_id = ${uid} AND sc.club_id = ${club} AND jc.value = ${category} AND ${holds('sc', permission, scopedRolesWith(permission))}))`
        : '0',
  };
}

// --- Politiques par table (équivalent des CREATE POLICY) ----------------------------

const superAdminAll: Policy = { cmd: 'all', to: 'authenticated', using: (_c, h) => h.isSuperAdmin };
/** Lecture et écriture réservées aux rôles qui ont la permission. */
const permAll = (permission: Permission): Policy => ({ cmd: 'all', to: 'authenticated', using: (c, h) => h.can(c('club_id'), permission) });
/** Lecture réservée aux rôles qui ont au moins une des permissions. */
const permRead = (...permissions: Permission[]): Policy => ({
  cmd: 'select',
  to: 'authenticated',
  using: (c, h) => `(${permissions.map((p) => h.can(c('club_id'), p)).join(' OR ')})`,
});
const publicOrStaffRead: Policy = {
  cmd: 'select',
  to: 'public',
  using: (c, h) => `(${h.isPublicClub(c('club_id'))} OR ${h.isClubStaff(c('club_id'))})`,
};
/** Organisation publique du club (lieux, catégories, créneaux, produits) : lecture publique, écriture organization.manage. */
const organizationContent: Policy[] = [publicOrStaffRead, permAll('organization.manage'), superAdminAll];

const POLICIES: Partial<Record<TableName, Policy[]>> = {
  // Comptes, sessions, limites : service uniquement (aucune politique).
  membership_tiers: [
    { cmd: 'select', to: 'public', using: (c, h) => `(${c('is_active')} = 1 OR ${h.isSuperAdmin})` },
    superAdminAll,
  ],
  clubs: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.isClubStaff(c('id')) },
    {
      cmd: 'update',
      to: 'authenticated',
      using: (c, h) => `(${h.can(c('id'), 'settings.manage')} OR ${h.can(c('id'), 'content.write')} OR ${h.can(c('id'), 'finance.write')})`,
    },
    superAdminAll,
  ],
  public_clubs: [{ cmd: 'select', to: 'public', using: () => '1' }],
  // club_mail_credentials : service uniquement.
  staff_members: [
    { cmd: 'select', to: 'authenticated', using: (c, h) => `(${c('user_id')} = ${h.uid} OR ${h.isClubStaff(c('club_id'))})` },
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) => `(${c('club_id')} IS NOT NULL AND ${h.can(c('club_id'), 'club.admin')})`,
      check: (c, h) =>
        `(${c('club_id')} IS NOT NULL AND ${c('role')} <> 'super_admin' AND ${h.can(c('club_id'), 'club.admin')})`,
    },
    superAdminAll,
  ],
  facilities: organizationContent,
  categories: organizationContent,
  schedules: organizationContent,
  club_products: organizationContent,
  sponsors: [publicOrStaffRead, permAll('partners.manage'), superAdminAll],
  posts: [
    {
      cmd: 'select',
      to: 'public',
      using: (c, h) =>
        `((${c('is_published')} = 1 AND ${c('published_at')} <= ${NOW} AND ${h.isPublicClub(c('club_id'))}) OR ${h.isClubStaff(c('club_id'))})`,
    },
    permAll('content.write'),
    superAdminAll,
  ],
  events: [
    publicOrStaffRead,
    { cmd: 'all', to: 'authenticated', using: (c, h) => h.canInCategory(c('club_id'), c('category_id'), 'events.manage') },
    superAdminAll,
  ],
  members: [
    permRead('members.read'),
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.hasFamilyAccess(c('family_id')) },
    permAll('members.write'),
    superAdminAll,
  ],
  coach_roster: [
    {
      cmd: 'select',
      to: 'authenticated',
      using: (c, h) =>
        `(${h.canInCategory(c('club_id'), c('category_id'), 'attendance.take')} OR ${h.canInCategory(c('club_id'), c('category_id'), 'events.manage')})`,
    },
  ],
  coach_contacts: [
    {
      cmd: 'select',
      to: 'authenticated',
      using: (c, h) =>
        `(${h.can(c('club_id'), 'members.read')} OR EXISTS (SELECT 1 FROM members mr WHERE mr.family_id = ${c('id')} AND (${h.canInCategory('mr.club_id', 'mr.category_id', 'attendance.take')} OR ${h.canInCategory('mr.club_id', 'mr.category_id', 'events.manage')})))`,
    },
  ],
  family_registrations: [
    permRead('members.read', 'finance.read'),
    permAll('members.write'),
    permAll('finance.write'),
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.hasFamilyAccess(c('id')) },
    superAdminAll,
  ],
  payment_installments: [
    permRead('finance.read'),
    permAll('finance.write'),
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.hasFamilyAccess(c('family_id')) },
    superAdminAll,
  ],
  member_product_orders: [permRead('finance.read'), permAll('finance.write'), superAdminAll],
  attendances: [
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) =>
        `EXISTS (SELECT 1 FROM schedules sa2 WHERE sa2.id = ${c('schedule_id')} AND sa2.club_id = ${c('club_id')} AND ${h.canInCategory('sa2.club_id', 'sa2.category_id', 'attendance.take')})`,
      check: (c, h) =>
        `EXISTS (SELECT 1 FROM schedules sa3 JOIN members ma3 ON ma3.category_id = sa3.category_id AND ma3.club_id = sa3.club_id WHERE sa3.id = ${c('schedule_id')} AND ma3.id = ${c('member_id')} AND sa3.club_id = ${c('club_id')} AND ${h.canInCategory('sa3.club_id', 'sa3.category_id', 'attendance.take')})`,
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
        `EXISTS (SELECT 1 FROM events ec WHERE ec.id = ${c('event_id')} AND ${h.canInCategory('ec.club_id', 'ec.category_id', 'events.manage')})`,
      check: (c, h) =>
        `EXISTS (SELECT 1 FROM events ek JOIN members mk ON mk.club_id = ek.club_id WHERE ek.id = ${c('event_id')} AND mk.id = ${c('member_id')} AND ek.club_id = ${c('club_id')} AND (ek.category_id IS NULL OR mk.category_id = ek.category_id) AND ${h.canInCategory('ek.club_id', 'ek.category_id', 'events.manage')})`,
    },
    superAdminAll,
  ],
  sponsor_leads: [permAll('partners.manage'), superAdminAll],
  anonymous_page_views: [
    permRead('stats.read'),
    superAdminAll,
  ],
  club_requests: [permRead('members.read'), permAll('members.write')],
  club_gallery: [
    { cmd: 'select', to: 'public', using: (c, h) => h.isPublicClub(c('club_id')) },
    permAll('content.write'),
  ],
  club_site_settings: [
    { cmd: 'select', to: 'public', using: (c, h) => h.isPublicClub(c('club_id')) },
    { cmd: 'select', to: 'authenticated', using: (c, h) => h.isClubStaff(c('club_id')) },
    {
      cmd: 'insert',
      to: 'authenticated',
      check: (c, h) => `(${h.can(c('club_id'), 'content.write')} OR ${h.isSuperAdmin})`,
    },
    {
      cmd: 'update',
      to: 'authenticated',
      using: (c, h) => `(${h.can(c('club_id'), 'content.write')} OR ${h.isSuperAdmin})`,
    },
  ],
  club_site_media: [
    { cmd: 'select', to: 'public', using: (c, h) => h.isPublicClub(c('club_id')) },
    {
      cmd: 'all',
      to: 'authenticated',
      using: (c, h) => `(${h.can(c('club_id'), 'content.write')} OR ${h.isSuperAdmin})`,
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
  // Journal des e-mails : lu par ceux qui suivent les familles ; écrit uniquement par le serveur (service).
  email_log: [permRead('members.read', 'communication.manage'), superAdminAll],
  // Pré-inscriptions et liste d'attente : comme les dossiers. Le dépôt public passe par le serveur (service).
  preregistrations: [permRead('members.read'), permAll('members.write'), superAdminAll],
  // Relances envoyées : lues par le bureau qui suit les dossiers ; écrites uniquement par la tâche planifiée.
  reminder_log: [permRead('members.read'), superAdminAll],
  // scheduled_runs : service et équipe Licyo uniquement.
  scheduled_runs: [{ cmd: 'select', to: 'authenticated', using: (_c, h) => h.isSuperAdmin }],
};

/** Colonnes de clubs modifiables par un utilisateur (ancien GRANT UPDATE(...) de 0002). */
export const CLUB_USER_UPDATABLE = new Set([
  'name', 'sport_type', 'theme_preset', 'primary_color', 'secondary_color', 'logo_url', 'hero_image_url',
  'club_history_text', 'president_word_text', 'president_name', 'president_signature_url', 'rna_number',
  'siret_number', 'federation_name', 'affiliation_number', 'city', 'postal_code', 'nearby_cities',
  'contact_email', 'contact_phone', 'social_links', 'sibling_discount_rules', 'accepts_pass_sport',
  'pass_sport_amount', 'accepts_caf_aids', 'accepts_installments', 'pass_stripe_fees_to_parents',
  'enabled_modules', 'current_season', 'registration_form', 'reminder_policy',
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
