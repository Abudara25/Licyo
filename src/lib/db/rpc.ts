// Anciennes fonctions Postgres (SECURITY DEFINER) réécrites côté serveur.
// Elles s'exécutent avec la base complète : chaque fonction vérifie elle-même ses droits.

import { toDbError, type DbResult, type SqlDatabase } from './query.ts';
import type { SecurityContext } from './policies.ts';

const RESERVED_SLUGS = new Set([
  'www', 'app', 'admin', 'api', 'sites', 'login', 'super-admin', 'club-admin',
  'espace-adherent', 'decouvrir', 'commencer', 'tarifs', 'modeles', 'auth', 'media', 'files',
]);
const TEMPLATES = new Set(['club', 'arena', 'studio', 'heritage']);
const DEFAULT_MODULES = {
  vitrine: true, inscriptions: true, payments: true, attendance: true, trials: true, events: true,
  boutique: true, sponsors: true, news: true, gallery: false, private_lessons: false, member_portal: true,
};

class RpcError extends Error {}

function ok<T>(data: T): DbResult<T> {
  return { data, error: null, count: null, status: 200 };
}

async function confirmedEmail(db: SqlDatabase, userId: string): Promise<string | null> {
  const res = await db
    .prepare('SELECT email FROM auth_users WHERE id = ? AND email_confirmed_at IS NOT NULL')
    .bind(userId)
    .all<{ email: string }>();
  return res.results[0]?.email ?? null;
}

/** Saison sportive courante : de juillet à juin. */
export function currentSeasonLabel(now = new Date()): string {
  const year = now.getUTCFullYear() - (now.getUTCMonth() < 6 ? 1 : 0);
  return `${year}-${year + 1}`;
}

/** Création d'un club et de son premier gestionnaire, de façon atomique. */
async function provisionClub(db: SqlDatabase, ctx: SecurityContext, payload: Record<string, unknown>): Promise<string> {
  if (ctx.role !== 'authenticated') throw new RpcError('Connectez-vous avec une adresse confirmée');
  const mail = await confirmedEmail(db, ctx.userId);
  if (!mail) throw new RpcError('Connectez-vous avec une adresse confirmée');

  const presidencies = await db
    .prepare("SELECT count(*) AS n FROM staff_members WHERE user_id = ? AND role = 'president'")
    .bind(ctx.userId)
    .all<{ n: number }>();
  if (Number(presidencies.results[0]?.n ?? 0) >= 3) throw new RpcError('Contactez Licyo pour créer un autre club');

  const memberCount = Number(payload.memberCount);
  if (!Number.isInteger(memberCount) || memberCount < 0 || memberCount > 1_000_000) throw new RpcError('Effectif invalide');
  const tier = await db
    .prepare(
      `SELECT id FROM membership_tiers WHERE is_active = 1 AND ? >= min_members AND (max_members IS NULL OR ? <= max_members)
       ORDER BY min_members DESC LIMIT 1`,
    )
    .bind(memberCount, memberCount)
    .all<{ id: string }>();
  const tierId = tier.results[0]?.id;
  if (!tierId) throw new RpcError('Aucune tranche disponible pour cet effectif');

  const template = String(payload.template ?? '');
  if (!TEMPLATES.has(template)) throw new RpcError('Modèle invalide');
  const sport = String(payload.sport ?? '');
  if (sport.length < 2 || sport.length > 80) throw new RpcError('Sport invalide');
  const slug = String(payload.slug ?? '');
  if (RESERVED_SLUGS.has(slug)) throw new RpcError('Adresse réservée');

  const clubId = crypto.randomUUID();
  // D1 exécute un batch dans une transaction : tout ou rien.
  await db.batch([
    db
      .prepare(
        `INSERT INTO clubs (id, name, slug, sport_type, theme_preset, city, postal_code, contact_email,
          declared_member_count, membership_tier_id, enabled_modules, current_season)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        clubId, String(payload.name ?? ''), slug, sport, template, String(payload.city ?? ''), String(payload.postalCode ?? ''),
        mail, memberCount, tierId, JSON.stringify(DEFAULT_MODULES), currentSeasonLabel(),
      ),
    db
      .prepare("INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, ?, ?, 'president')")
      .bind(crypto.randomUUID(), ctx.userId, clubId, String(payload.ownerName ?? ''), mail),
    db
      .prepare("INSERT INTO audit_events (id, club_id, actor_id, action, object_id) VALUES (?, ?, ?, 'club.created', ?)")
      .bind(crypto.randomUUID(), clubId, ctx.userId, clubId),
  ]);
  return clubId;
}

/** Rattache l'utilisateur aux dossiers payés avec son adresse confirmée (jamais une adresse fournie). */
async function claimFamilyAccess(db: SqlDatabase, ctx: SecurityContext): Promise<null> {
  if (ctx.role !== 'authenticated') throw new RpcError('Adresse non confirmée');
  const mail = await confirmedEmail(db, ctx.userId);
  if (!mail) throw new RpcError('Adresse non confirmée');
  await db
    .prepare(
      `INSERT INTO family_access (club_id, family_id, user_id)
       SELECT club_id, id, ? FROM family_registrations WHERE lower(payer_email) = ?
       ON CONFLICT DO NOTHING`,
    )
    .bind(ctx.userId, mail.toLowerCase())
    .run();
  return null;
}

/** Compteur d'audience anonyme, borné, sans donnée personnelle. */
async function incrementPageView(db: SqlDatabase, args: Record<string, unknown>): Promise<null> {
  const clubId = String(args.target_club ?? '');
  const path = String(args.path ?? '/').slice(0, 200) || '/';
  await db
    .prepare(
      `INSERT INTO anonymous_page_views (id, club_id, view_month, page_path)
       SELECT ?, id, strftime('%Y-%m','now'), ? FROM public_clubs WHERE id = ?
       ON CONFLICT (club_id, view_month, page_path) DO UPDATE SET views_count = views_count + 1`,
    )
    .bind(crypto.randomUUID(), path, clubId)
    .run();
  return null;
}

export async function callRpc(
  db: SqlDatabase,
  ctx: SecurityContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<DbResult<unknown>> {
  try {
    switch (name) {
      case 'provision_club':
        return ok(await provisionClub(db, ctx, (args.payload ?? {}) as Record<string, unknown>));
      case 'claim_family_access':
        return ok(await claimFamilyAccess(db, ctx));
      case 'increment_page_view':
        return ok(await incrementPageView(db, args));
      default:
        return { data: null, error: { message: `Fonction inconnue : ${name}`, code: '42883' }, count: null, status: 404 };
    }
  } catch (error) {
    const err = error instanceof RpcError ? { message: error.message, code: 'P0001' } : toDbError(error);
    return { data: null, error: err, count: null, status: 400 };
  }
}
