import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { getDatabase } from '@/lib/db/d1';
import type { SqlDatabase } from '@/lib/db/query';
import { isoIn, randomToken, sha256Hex } from './tokens';

export const SESSION_COOKIE = 'licyo_session';
const SESSION_SECONDS = 30 * 24 * 3600;
const LOGIN_TOKEN_SECONDS = 15 * 60;

export type AuthUser = { id: string; email: string; email_confirmed_at: string | null };

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/** Utilisateur de la session en cours (une lecture par requête). */
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await getDatabase()
    .prepare(
      `SELECT u.id, u.email, u.email_confirmed_at FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(hash)
    .all<AuthUser>();
  return row.results[0] ?? null;
});

/** Ouvre une session et pose le cookie (Server Action ou Route Handler uniquement). */
export async function startSession(userId: string): Promise<void> {
  const token = randomToken();
  const db = getDatabase();
  await db.batch([
    db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), userId, isoIn(SESSION_SECONDS)),
    db.prepare("UPDATE auth_users SET last_sign_in_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(userId),
    // Ménage opportuniste des sessions expirées de cet utilisateur.
    db.prepare("DELETE FROM auth_sessions WHERE user_id = ? AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(userId),
  ]);
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(SESSION_SECONDS));
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDatabase().prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  }
  store.set(SESSION_COOKIE, '', cookieOptions(0));
}

/** Révoque toutes les sessions d'un utilisateur (retrait d'accès, compromission). */
export async function revokeUserSessions(userId: string): Promise<void> {
  await getDatabase().prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
}

export async function findUserByEmail(email: string, db: SqlDatabase = getDatabase()): Promise<AuthUser | null> {
  const res = await db
    .prepare('SELECT id, email, email_confirmed_at FROM auth_users WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .all<AuthUser>();
  return res.results[0] ?? null;
}

/** Crée le compte s'il n'existe pas (adresse non confirmée tant que le lien n'est pas ouvert). */
export async function ensureUser(email: string, db: SqlDatabase = getDatabase()): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  await db.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?) ON CONFLICT (email) DO NOTHING').bind(crypto.randomUUID(), normalized).run();
  const user = await findUserByEmail(normalized, db);
  if (!user) throw new Error('Compte introuvable après création');
  return user;
}

/** Jeton de lien de connexion à usage unique ; renvoie le jeton en clair à envoyer. */
export async function createLoginToken(email: string, createUser: boolean, db: SqlDatabase = getDatabase()): Promise<string> {
  const token = randomToken();
  await db
    .prepare('INSERT INTO auth_login_tokens (token_hash, email, create_user, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), email.trim().toLowerCase(), createUser ? 1 : 0, isoIn(LOGIN_TOKEN_SECONDS))
    .run();
  return token;
}

/**
 * Consomme un jeton de connexion : usage unique, non expiré.
 * Confirme l'adresse (le lien prouve l'accès à la boîte) et renvoie l'utilisateur.
 */
export async function consumeLoginToken(token: string): Promise<AuthUser | null> {
  if (!token || token.length > 100) return null;
  const db = getDatabase();
  const hash = await sha256Hex(token);
  // Marquage atomique : un second clic sur le même lien échoue.
  const claimed = await db
    .prepare(
      `UPDATE auth_login_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
       RETURNING email, create_user`,
    )
    .bind(hash)
    .all<{ email: string; create_user: number }>();
  const row = claimed.results[0];
  if (!row) return null;
  let user = await findUserByEmail(row.email, db);
  if (!user && row.create_user === 1) user = await ensureUser(row.email, db);
  if (!user) return null;
  if (!user.email_confirmed_at) {
    await db.prepare("UPDATE auth_users SET email_confirmed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(user.id).run();
  }
  return user;
}

/**
 * Limite simple par fenêtre fixe. Renvoie false si la limite est dépassée.
 * Les clés ne contiennent pas d'adresse en clair (empreinte).
 */
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000).toISOString();
  const bucket = await sha256Hex(key);
  const res = await getDatabase()
    .prepare(
      `INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1)
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = hits + 1 RETURNING hits`,
    )
    .bind(bucket, windowStart)
    .all<{ hits: number }>();
  return (res.results[0]?.hits ?? 1) <= max;
}
