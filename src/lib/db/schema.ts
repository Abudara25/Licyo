// Métadonnées des tables D1 utiles à la conversion SQLite <-> objets JS.
// Doit rester aligné sur migrations/*.sql (vérifié par tests/db-schema.test.ts).

export type TableMeta = {
  /** Colonnes stockées en JSON texte (tableaux, objets). */
  json?: readonly string[];
  /** Colonnes stockées en INTEGER 0/1. */
  bool?: readonly string[];
  /** Colonnes UUID générées par l'application si absentes à l'insertion. */
  generated?: readonly string[];
  /** Vue en lecture seule. */
  view?: boolean;
};

const CLUB_JSON = ['nearby_cities', 'social_links', 'sibling_discount_rules', 'enabled_modules'] as const;
const CLUB_BOOL = [
  'accepts_pass_sport',
  'accepts_caf_aids',
  'accepts_installments',
  'pass_stripe_fees_to_parents',
  'stripe_connect_onboarded',
] as const;
const MEMBER_BOOL = [
  'is_minor',
  'health_questionnaire_passed',
  'pass_sport_verified',
  'consent_image_rights',
  'consent_emergency_medical',
  'consent_autonomous_exit',
] as const;

export const TABLES = {
  auth_users: {},
  auth_sessions: {},
  auth_login_tokens: { bool: ['create_user'] },
  rate_limits: {},
  membership_tiers: { bool: ['is_active'] },
  clubs: { json: CLUB_JSON, bool: CLUB_BOOL, generated: ['id'] },
  public_clubs: { json: CLUB_JSON, bool: CLUB_BOOL, view: true },
  club_mail_credentials: {},
  staff_members: { json: ['assigned_category_ids'], generated: ['id'] },
  facilities: { generated: ['id'] },
  categories: { generated: ['id'] },
  schedules: { generated: ['id'] },
  club_products: { json: ['available_sizes'], generated: ['id'] },
  family_registrations: { bool: ['is_adult_self_registration'], generated: ['id'] },
  payment_installments: { generated: ['id'] },
  members: { bool: MEMBER_BOOL, generated: ['id', 'magic_action_token'] },
  coach_roster: { bool: ['is_minor', 'consent_autonomous_exit'], view: true },
  coach_contacts: { view: true },
  member_product_orders: { generated: ['id'] },
  attendances: { bool: ['is_present'], generated: ['id'] },
  events: { bool: ['is_home'], generated: ['id'] },
  event_convocations: { generated: ['id', 'response_token'] },
  posts: { bool: ['is_published'], generated: ['id'] },
  sponsors: { generated: ['id'] },
  sponsor_leads: { generated: ['id'] },
  anonymous_page_views: { generated: ['id'] },
  club_requests: { generated: ['id'] },
  club_gallery: { generated: ['id'] },
  club_site_settings: { json: ['sections'] },
  club_site_media: {},
  family_access: {},
  saas_prospects: { generated: ['id'] },
  platform_announcements: { bool: ['is_active'], generated: ['id'] },
  audit_events: { generated: ['id'] },
} satisfies Record<string, TableMeta>;

export type TableName = keyof typeof TABLES;

export function isTableName(name: string): name is TableName {
  return Object.prototype.hasOwnProperty.call(TABLES, name);
}

export function tableMeta(name: TableName): TableMeta {
  return TABLES[name];
}

/** Valeur JS -> valeur liable à D1. */
export function toSql(meta: TableMeta, column: string, value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (meta.json?.includes(column)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** Ligne D1 -> objet JS typé comme sous Postgres. */
export function fromSql<T>(meta: TableMeta, row: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...row };
  for (const c of meta.json ?? []) {
    const v = out[c];
    if (typeof v === 'string') {
      try {
        out[c] = JSON.parse(v);
      } catch {
        out[c] = null;
      }
    }
  }
  for (const c of meta.bool ?? []) {
    const v = out[c];
    if (v !== null && v !== undefined) out[c] = v === 1 || v === true || v === '1';
  }
  return out as T;
}
