// Pré-inscriptions et liste d'attente : règles communes au site public, au back-office et à la tâche planifiée.
//
// - Une catégorie « open » accepte les inscriptions tant qu'il reste des places ; ensuite les familles rejoignent la
//   liste d'attente. « preregistration » : seulement la liste d'intérêt. « closed » : ni l'un ni l'autre.
// - Places restantes = capacité - dossiers actifs de la saison - invitations en cours (une invitation RÉSERVE la place).
// - Le rang suit l'ordre d'arrivée (created_at). Une invitation donne un lien personnel valable INVITE_VALID_DAYS jours,
//   qui ouvre l'inscription pour cette catégorie même complète ou fermée aux inscriptions directes.
//
// Module sans dépendance à Next.js (SQL brut sur l'interface D1) : testé sur SQLite (tests/waitlist.test.ts).

import type { SqlDatabase } from './db/query.ts';
import type { Category, RegistrationMode } from '../types/database.ts';

export const INVITE_VALID_DAYS = 7;

/** Statuts de dossier qui n'occupent pas de place (refusé, simple essai). */
export const NON_OCCUPYING_STATUSES = ['rejected', 'trial_requested', 'trial_done'] as const;

export type CategoryAvailability = {
  categoryId: string;
  mode: RegistrationMode;
  capacity: number;
  occupied: number;
  invited: number;
  waiting: number;
  remaining: number;
  /** Ce que voit une famille : inscription directe, liste d'attente, pré-inscription, ou rien. */
  publicState: 'open' | 'waitlist' | 'preregistration' | 'closed';
};

export function publicStateOf(mode: RegistrationMode, remaining: number): CategoryAvailability['publicState'] {
  if (mode === 'closed') return 'closed';
  if (mode === 'preregistration') return 'preregistration';
  return remaining > 0 ? 'open' : 'waitlist';
}

export const PUBLIC_STATE_LABELS: Record<CategoryAvailability['publicState'], string> = {
  open: 'Inscriptions ouvertes',
  waitlist: 'Complet : liste d’attente',
  preregistration: 'Pré-inscriptions',
  closed: 'Fermé',
};

type Row = Record<string, unknown>;
const all = async <T = Row>(db: SqlDatabase, sql: string, ...params: unknown[]) =>
  ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];

/** Places et file d'attente de chaque catégorie d'un club pour une saison. */
export async function clubAvailability(
  db: SqlDatabase,
  clubId: string,
  season: string,
  categories: Pick<Category, 'id' | 'max_capacity' | 'registration_mode'>[],
): Promise<Map<string, CategoryAvailability>> {
  const occupied = await all<{ category_id: string; n: number }>(
    db,
    `SELECT category_id, count(*) AS n FROM members WHERE club_id = ? AND season = ? AND category_id IS NOT NULL
       AND dossier_status NOT IN (${NON_OCCUPYING_STATUSES.map(() => '?').join(',')}) GROUP BY category_id`,
    clubId,
    season,
    ...NON_OCCUPYING_STATUSES,
  );
  const queue = await all<{ category_id: string; status: string; n: number }>(
    db,
    `SELECT category_id, status, count(*) AS n FROM preregistrations WHERE club_id = ? AND season = ?
       AND status IN ('waiting','invited') GROUP BY category_id, status`,
    clubId,
    season,
  );
  const out = new Map<string, CategoryAvailability>();
  for (const c of categories) {
    const occ = Number(occupied.find((o) => o.category_id === c.id)?.n ?? 0);
    const invited = Number(queue.find((q) => q.category_id === c.id && q.status === 'invited')?.n ?? 0);
    const waiting = Number(queue.find((q) => q.category_id === c.id && q.status === 'waiting')?.n ?? 0);
    const remaining = Math.max(0, c.max_capacity - occ - invited);
    out.set(c.id, {
      categoryId: c.id,
      mode: c.registration_mode,
      capacity: c.max_capacity,
      occupied: occ,
      invited,
      waiting,
      remaining,
      publicState: publicStateOf(c.registration_mode, remaining),
    });
  }
  return out;
}

/** Rang (1 = prochaine personne) d'une demande en attente dans sa catégorie. */
export async function queuePosition(db: SqlDatabase, preregistrationId: string): Promise<number | null> {
  const rows = await all<{ rank: number }>(
    db,
    `SELECT (SELECT count(*) FROM preregistrations q WHERE q.category_id = p.category_id AND q.season = p.season
        AND q.status = 'waiting' AND (q.created_at < p.created_at OR (q.created_at = p.created_at AND q.id <= p.id))) AS rank
     FROM preregistrations p WHERE p.id = ? AND p.status = 'waiting'`,
    preregistrationId,
  );
  return rows[0] ? Number(rows[0].rank) : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const tokenHash = sha256Hex;

/**
 * Invite une demande en attente (ou expirée) : génère le lien personnel, réserve la place. Renvoie le jeton EN CLAIR
 * (à envoyer par e-mail, jamais stocké), ou null si la demande n'est plus invitable (déjà traitée par quelqu'un d'autre).
 */
export async function issueInvitation(
  db: SqlDatabase,
  clubId: string,
  preregistrationId: string,
  now = new Date(),
  validDays = INVITE_VALID_DAYS,
): Promise<string | null> {
  const token = newToken();
  const expires = new Date(now.getTime() + validDays * 86400000).toISOString();
  const res = await db
    .prepare(
      `UPDATE preregistrations SET status = 'invited', invite_token_hash = ?, invited_at = ?, invite_expires_at = ?, updated_at = ?
       WHERE id = ? AND club_id = ? AND status IN ('waiting','expired')`,
    )
    .bind(await sha256Hex(token), now.toISOString(), expires, now.toISOString(), preregistrationId, clubId)
    .run();
  return Number(res.meta?.changes ?? 0) === 1 ? token : null;
}

/** Change le statut d'une demande (annulation, refus, inscription faite à la main). Le lien éventuel est invalidé. */
export async function setPreregistrationStatus(
  db: SqlDatabase,
  clubId: string,
  preregistrationId: string,
  status: 'waiting' | 'declined' | 'cancelled' | 'registered',
  now = new Date(),
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE preregistrations SET status = ?, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?
       WHERE id = ? AND club_id = ? AND status <> 'registered'`,
    )
    .bind(status, now.toISOString(), preregistrationId, clubId)
    .run();
  return Number(res.meta?.changes ?? 0) === 1;
}

export type InvitationRow = {
  id: string;
  club_id: string;
  category_id: string;
  season: string;
  first_name: string;
  last_name: string;
  birth_date: string;
  gender: 'M' | 'F' | 'X';
  contact_name: string;
  email: string;
  phone: string;
};

/** Invitation valide pour ce club (lien non expiré), ou null. */
export async function findInvitation(db: SqlDatabase, clubId: string, token: string, now = new Date()): Promise<InvitationRow | null> {
  if (!token || token.length > 100) return null;
  const rows = await all<InvitationRow>(
    db,
    `SELECT id, club_id, category_id, season, first_name, last_name, birth_date, gender, contact_name, email, phone
     FROM preregistrations WHERE invite_token_hash = ? AND club_id = ? AND status = 'invited' AND invite_expires_at > ?`,
    await sha256Hex(token),
    clubId,
    now.toISOString(),
  );
  return rows[0] ?? null;
}

/** Après l'inscription : la demande est close et rattachée à l'adhérent créé ; le lien ne sert plus. */
export async function completeInvitation(db: SqlDatabase, preregistrationId: string, memberId: string, now = new Date()) {
  await db
    .prepare(
      `UPDATE preregistrations SET status = 'registered', member_id = ?, invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?
       WHERE id = ? AND status = 'invited'`,
    )
    .bind(memberId, now.toISOString(), preregistrationId)
    .run();
}

export type InviteSender = (row: InvitationRow, token: string, expiresAt: string) => Promise<void>;

/**
 * Tâche planifiée « liste d'attente » :
 * 1. les invitations dépassées expirent (la place est rendue) ;
 * 2. pour les catégories ouvertes en invitation automatique, les places libres sont proposées aux suivants.
 */
export async function runWaitlistMaintenance(db: SqlDatabase, now: Date, send: InviteSender): Promise<string> {
  const expired = await db
    .prepare(
      `UPDATE preregistrations SET status = 'expired', invite_token_hash = NULL, invite_expires_at = NULL, updated_at = ?
       WHERE status = 'invited' AND invite_expires_at <= ?`,
    )
    .bind(now.toISOString(), now.toISOString())
    .run();

  const cats = await all<{ id: string; club_id: string; max_capacity: number; registration_mode: RegistrationMode; season: string }>(
    db,
    `SELECT c.id, c.club_id, c.max_capacity, c.registration_mode, cl.current_season AS season
     FROM categories c JOIN clubs cl ON cl.id = c.club_id
     WHERE c.auto_invite = 1 AND c.registration_mode = 'open' AND cl.status IN ('active','demo')`,
  );
  let invited = 0;
  let failures = 0;
  for (const c of cats) {
    const availability = (await clubAvailability(db, c.club_id, c.season, [c])).get(c.id)!;
    if (availability.remaining <= 0) continue;
    const next = await all<{ id: string }>(
      db,
      `SELECT id FROM preregistrations WHERE category_id = ? AND season = ? AND status = 'waiting' ORDER BY created_at, id LIMIT ?`,
      c.id,
      c.season,
      availability.remaining,
    );
    for (const { id } of next) {
      const token = await issueInvitation(db, c.club_id, id, now);
      if (!token) continue;
      const row = (await all<InvitationRow & { invite_expires_at: string }>(
        db,
        `SELECT id, club_id, category_id, season, first_name, last_name, birth_date, gender, contact_name, email, phone, invite_expires_at
         FROM preregistrations WHERE id = ?`,
        id,
      ))[0];
      try {
        await send(row, token, row.invite_expires_at);
        invited++;
      } catch {
        // E-mail impossible : l'invitation est annulée pour ne pas bloquer une place sans prévenir la famille.
        await setPreregistrationStatus(db, c.club_id, id, 'waiting', now);
        failures++;
      }
    }
  }
  return `expirees=${Number(expired.meta?.changes ?? 0)} invitees=${invited} echecs=${failures}`;
}
