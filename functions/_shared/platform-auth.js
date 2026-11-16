// Console fondateur (« Platform », lot 2 Licyo, 2026-11-16) : comptes de l'équipe Licyo, sessions, droits, journal.
//
// Surface DISTINCTE de l'admin des clubs (ADR-018) : autre cookie (platform_session, Path=/platform), autres comptes
// (platform_operators), autres rôles. Un compte de club n'ouvre jamais la console, et inversement.
// La console ne répond que sur les hôtes déclarés (PLATFORM_HOSTNAMES, séparés par des virgules) et en local :
// partout ailleurs, /platform renvoie 404 comme une page inexistante.
//
// Rôles plateforme : le propriétaire (owner) a tous les droits, dont l'équipe ; personne d'autre ne reçoit tous les
// pouvoirs par facilité. Chaque action sensible est inscrite au journal (platform_audit).
//
// Premier accès : tant qu'aucun opérateur n'existe, /platform/demarrage crée le compte propriétaire, à condition de
// présenter le secret PLATFORM_BOOTSTRAP_TOKEN et l'adresse PLATFORM_OWNER_EMAIL (secrets Cloudflare). Ensuite, ce
// chemin ne sert plus jamais.
import { sha256Hex, randomToken, hashPassword, verifyPassword, timingSafeEqual, clientKey, hitRateLimit, isRateLimited, clearRateLimit, isSameOrigin } from './security.js';
import { ensureSchema } from './inscriptions-db.js';
import { sqlNow } from './educateurs.js';

export const PLATFORM_COOKIE = 'platform_session';
const SESSION_IDLE_SECONDS = 30 * 60;
const SESSION_MAX_SECONDS = 12 * 60 * 60;
const TOUCH_SECONDS = 60;
const LOGIN_LIMIT = { limit: 5, windowSeconds: 15 * 60 };
export const INVITE_DAYS = 7;
export const MIN_PASSWORD_LENGTH = 12;

export const PLATFORM_ROLES = ['owner', 'admin', 'support', 'sales'];
export const PLATFORM_ROLE_LABELS = Object.freeze({
  owner: 'Propriétaire',
  admin: 'Administrateur',
  support: 'Support',
  sales: 'Commercial',
});
export const PLATFORM_ROLE_DESCRIPTIONS = Object.freeze({
  owner: 'Tous les droits, dont l’équipe Licyo. Réservé au fondateur.',
  admin: 'Crée et gère les clubs (statut, domaines, accès du président), sans gérer l’équipe.',
  support: 'Consulte les clubs et renvoie l’accès d’un président ; ne suspend pas.',
  sales: 'Consulte les clubs et en crée de nouveaux.',
});

export const PLATFORM_PERMISSIONS = ['platform.read', 'orgs.create', 'orgs.manage', 'orgs.support', 'audit.read', 'team.manage'];
const ROLE_PERMISSIONS = Object.freeze({
  owner: PLATFORM_PERMISSIONS,
  admin: ['platform.read', 'orgs.create', 'orgs.manage', 'orgs.support', 'audit.read'],
  support: ['platform.read', 'orgs.support', 'audit.read'],
  sales: ['platform.read', 'orgs.create'],
});

export const canPlatform = (operator, permission) =>
  Boolean(operator && PLATFORM_ROLES.includes(operator.role) && ROLE_PERMISSIONS[operator.role].includes(permission));

export class PlatformError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlatformError';
  }
}

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
export const isEmail = (value) => EMAIL_RE.test(value) && value.length <= 200;

// --- Hôte ----------------------------------------------------------------------------------------------------

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
export function platformHostAllowed(request, env) {
  const host = new URL(request.url).hostname.toLowerCase();
  if (LOOPBACK.has(host)) return true;
  const allowed = String(env.PLATFORM_HOSTNAMES || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(host);
}

// --- Sessions ------------------------------------------------------------------------------------------------

function readCookie(request, name) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}
const cookie = (value, maxAge) => `${PLATFORM_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/platform; Max-Age=${maxAge}`;

export async function createPlatformSession(env, operatorId) {
  await ensureSchema(env.DB);
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM platform_sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO platform_sessions (token_hash, operator_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256Hex(token), operatorId, now, now + SESSION_IDLE_SECONDS),
  ]);
  return [cookie(token, SESSION_MAX_SECONDS)];
}

export async function destroyPlatformSession(request, env) {
  const token = readCookie(request, PLATFORM_COOKIE);
  if (token && env.DB) {
    await ensureSchema(env.DB).catch(() => {});
    await env.DB.prepare('DELETE FROM platform_sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run().catch(() => {});
  }
  return [cookie('', 0)];
}

// Opérateur de la requête { id, email, name, role } ou null (pas de session, session expirée, compte désactivé).
export async function platformOperator(request, env, { touch = true } = {}) {
  const token = readCookie(request, PLATFORM_COOKIE);
  if (!token || !env.DB) return null;
  try {
    await ensureSchema(env.DB);
    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      `SELECT s.created_at, s.expires_at, o.id, o.email, o.name, o.role FROM platform_sessions s
       JOIN platform_operators o ON o.id = s.operator_id AND o.status = 'active'
       WHERE s.token_hash = ?`
    )
      .bind(tokenHash)
      .first();
    const now = Math.floor(Date.now() / 1000);
    if (!row || row.expires_at <= now || row.created_at + SESSION_MAX_SECONDS <= now) return null;
    const target = Math.min(now + SESSION_IDLE_SECONDS, row.created_at + SESSION_MAX_SECONDS);
    if (touch && target - row.expires_at >= TOUCH_SECONDS) {
      await env.DB.prepare('UPDATE platform_sessions SET expires_at = ? WHERE token_hash = ?').bind(target, tokenHash).run().catch(() => {});
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  } catch {
    return null;
  }
}

// --- CSRF (même principe que l'admin des clubs : jeton dérivé de la session, origine vérifiée) ----------------

export const PLATFORM_CSRF_FIELD = '_csrf';
export async function platformCsrfToken(request) {
  const token = readCookie(request, PLATFORM_COOKIE);
  return token ? sha256Hex(`platform-csrf:v1:${token}`) : null;
}

export async function checkPlatformCsrf(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) return true;
  if (!isSameOrigin(request)) return false;
  const expected = await platformCsrfToken(request);
  if (!expected) return true; // sans session : connexion, invitation, démarrage (origine vérifiée ci-dessus)
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return false;
  try {
    const submitted = (await request.clone().formData()).get(PLATFORM_CSRF_FIELD);
    return typeof submitted === 'string' && timingSafeEqual(submitted, expected);
  } catch {
    return false;
  }
}

export function injectPlatformCsrf(html, token) {
  if (!token) return html;
  const field = `<input type="hidden" name="${PLATFORM_CSRF_FIELD}" value="${token}">`;
  return html.replace(/<form\b[^>]*>/gi, (tag) => (/\bmethod\s*=\s*["']?post\b/i.test(tag) ? tag + field : tag));
}

// --- Connexion -----------------------------------------------------------------------------------------------

let dummyHash;
const dummy = async () => (dummyHash ??= await hashPassword(randomToken(16)));

// { operator } si les identifiants sont bons, { error, status } sinon. Limite : 5 échecs par 15 minutes et par adresse.
export async function platformLogin(request, env, email, password) {
  await ensureSchema(env.DB);
  const bucket = `platform-login:${await clientKey(request)}`;
  if (await isRateLimited(env.DB, bucket, LOGIN_LIMIT).catch(() => false)) return { error: 'Trop de tentatives. Réessayez dans 15 minutes.', status: 429 };
  const clean = normalizeEmail(email);
  const row = isEmail(clean) ? await env.DB.prepare('SELECT * FROM platform_operators WHERE email = ?').bind(clean).first() : null;
  const ok = await verifyPassword(String(password || ''), row?.password_hash || (await dummy()));
  if (!row || !ok || row.status !== 'active') {
    await hitRateLimit(env.DB, bucket, LOGIN_LIMIT).catch(() => {});
    return { error: 'Adresse e-mail ou mot de passe incorrect.', status: 401 };
  }
  await clearRateLimit(env.DB, bucket).catch(() => {});
  await env.DB.prepare('UPDATE platform_operators SET last_login_at = ? WHERE id = ?').bind(sqlNow(), row.id).run().catch(() => {});
  await audit(env.DB, row, 'operator.login');
  return { operator: { id: row.id, email: row.email, name: row.name, role: row.role } };
}

export function checkNewPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) throw new PlatformError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  if (password.length > 200) throw new PlatformError('Mot de passe trop long (200 caractères au plus).');
  if (password !== confirm) throw new PlatformError('Les deux mots de passe ne correspondent pas.');
}

function cleanIdentity({ email, name, role }) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!isEmail(cleanEmail)) throw new PlatformError('Adresse e-mail invalide.');
  if (!cleanName || cleanName.length > 120) throw new PlatformError('Indiquez le nom (120 caractères au plus).');
  if (!PLATFORM_ROLES.includes(role)) throw new PlatformError('Rôle inconnu.');
  return { email: cleanEmail, name: cleanName, role };
}

// --- Démarrage : premier compte propriétaire ------------------------------------------------------------------

export async function operatorCount(db) {
  await ensureSchema(db);
  return (await db.prepare('SELECT COUNT(*) AS n FROM platform_operators').first()).n;
}

export const bootstrapConfigured = (env) => Boolean(env.PLATFORM_BOOTSTRAP_TOKEN && env.PLATFORM_OWNER_EMAIL && String(env.PLATFORM_BOOTSTRAP_TOKEN).length >= 24);

export async function bootstrapOwner(env, { token, email, name, password, confirm }) {
  if (!bootstrapConfigured(env)) throw new PlatformError('Démarrage non configuré.');
  if (!timingSafeEqual(String(token || ''), String(env.PLATFORM_BOOTSTRAP_TOKEN))) throw new PlatformError('Lien de démarrage invalide.');
  const identity = cleanIdentity({ email, name, role: 'owner' });
  if (identity.email !== normalizeEmail(env.PLATFORM_OWNER_EMAIL)) throw new PlatformError('Cette adresse n’est pas celle du propriétaire déclaré.');
  checkNewPassword(password, confirm);
  const hash = await hashPassword(password);
  // Création conditionnelle : jamais si un opérateur existe déjà (même en cas de requêtes simultanées).
  const result = await env.DB.prepare(
    `INSERT INTO platform_operators (email, name, role, password_hash)
     SELECT ?, ?, 'owner', ? WHERE NOT EXISTS (SELECT 1 FROM platform_operators)`
  )
    .bind(identity.email, identity.name, hash)
    .run();
  if (!result.meta?.changes) throw new PlatformError('Le compte propriétaire existe déjà.');
  const owner = await env.DB.prepare('SELECT id, email, name, role FROM platform_operators WHERE email = ?').bind(identity.email).first();
  await audit(env.DB, owner, 'operator.bootstrap');
  return owner;
}

// --- Équipe : invitations et comptes ---------------------------------------------------------------------------

export async function inviteOperator(db, actor, input, now = Date.now()) {
  await ensureSchema(db);
  const { email, name, role } = cleanIdentity(input);
  if (role === 'owner') throw new PlatformError('Le rôle Propriétaire ne se délègue pas par invitation.');
  if (await db.prepare('SELECT 1 FROM platform_operators WHERE email = ?').bind(email).first()) throw new PlatformError('Un compte existe déjà pour cette adresse.');
  const token = `p${randomToken(32)}`;
  await db.batch([
    db.prepare('UPDATE platform_operator_invites SET revoked_at = ? WHERE email = ? AND used_at IS NULL AND revoked_at IS NULL').bind(sqlNow(now), email),
    db
      .prepare('INSERT INTO platform_operator_invites (email, name, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(email, name, role, await sha256Hex(token), actor.id, sqlNow(now), sqlNow(now + INVITE_DAYS * 86_400_000)),
  ]);
  await audit(db, actor, 'operator.invite', null, { email, role });
  return { token, email, name, role };
}

const INVITE_TOKEN_RE = /^p[A-Za-z0-9_-]{43}$/;
export async function findOperatorInvite(db, token, now = Date.now()) {
  if (typeof token !== 'string' || !INVITE_TOKEN_RE.test(token)) return null;
  await ensureSchema(db);
  const row = await db.prepare('SELECT * FROM platform_operator_invites WHERE token_hash = ?').bind(await sha256Hex(token)).first();
  if (!row || row.used_at || row.revoked_at || row.expires_at <= sqlNow(now)) return null;
  return row;
}

export async function acceptOperatorInvite(db, token, password, confirm, now = Date.now()) {
  const invite = await findOperatorInvite(db, token, now);
  if (!invite) throw new PlatformError('Ce lien d’invitation n’est plus valable.');
  checkNewPassword(password, confirm);
  const hash = await hashPassword(password);
  try {
    const results = await db.batch([
      db.prepare('UPDATE platform_operator_invites SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').bind(sqlNow(now), invite.id),
      db.prepare('INSERT INTO platform_operators (email, name, role, password_hash) SELECT ?, ?, ?, ? WHERE changes() = 1').bind(invite.email, invite.name, invite.role, hash),
    ]);
    if (results?.[1]?.meta?.changes === 0) throw new PlatformError('Ce lien d’invitation vient d’être utilisé.');
  } catch (error) {
    if (error instanceof PlatformError) throw error;
    if (/UNIQUE/i.test(String(error?.message))) throw new PlatformError('Un compte existe déjà pour cette adresse.');
    throw error;
  }
  const operator = await db.prepare('SELECT id, email, name, role FROM platform_operators WHERE email = ?').bind(invite.email).first();
  await audit(db, operator, 'operator.join', null, { role: operator.role });
  return operator;
}

export async function listOperators(db) {
  await ensureSchema(db);
  return (await db.prepare('SELECT id, email, name, role, status, created_at, last_login_at FROM platform_operators ORDER BY status, name COLLATE NOCASE').all()).results;
}

export async function pendingOperatorInvites(db, now = Date.now()) {
  await ensureSchema(db);
  return (
    await db
      .prepare('SELECT id, email, name, role, expires_at FROM platform_operator_invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC')
      .bind(sqlNow(now))
      .all()
  ).results;
}

export async function revokeOperatorInvite(db, actor, inviteId, now = Date.now()) {
  await db.prepare('UPDATE platform_operator_invites SET revoked_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').bind(sqlNow(now), Number(inviteId)).run();
  await audit(db, actor, 'operator.invite_revoke', null, { inviteId: Number(inviteId) });
}

// Protection du propriétaire : son compte ne peut être ni désactivé ni rétrogradé depuis la console.
export async function setOperatorStatus(db, actor, operatorId, status) {
  if (!['active', 'disabled'].includes(status)) throw new PlatformError('Statut inconnu.');
  const target = await db.prepare('SELECT id, role, name FROM platform_operators WHERE id = ?').bind(Number(operatorId)).first();
  if (!target) throw new PlatformError('Compte introuvable.');
  if (target.id === actor.id) throw new PlatformError('Vous ne pouvez pas modifier votre propre accès.');
  if (target.role === 'owner') throw new PlatformError('Le compte du propriétaire est protégé.');
  const statements = [db.prepare('UPDATE platform_operators SET status = ?, updated_at = ? WHERE id = ?').bind(status, sqlNow(), target.id)];
  if (status === 'disabled') statements.push(db.prepare('DELETE FROM platform_sessions WHERE operator_id = ?').bind(target.id));
  await db.batch(statements);
  await audit(db, actor, status === 'disabled' ? 'operator.disable' : 'operator.enable', null, { operator: target.name });
}

// --- Journal -------------------------------------------------------------------------------------------------

export async function audit(db, actor, action, organizationId = null, detail = null) {
  try {
    await ensureSchema(db);
    await db
      .prepare('INSERT INTO platform_audit (operator_id, operator_name, action, target_organization_id, detail) VALUES (?, ?, ?, ?, ?)')
      .bind(actor?.id ?? null, actor?.name ?? 'Système', action, organizationId, detail ? JSON.stringify(detail) : null)
      .run();
  } catch {
    // Le journal ne bloque jamais l'action déjà faite ; son échec reste visible dans les journaux du Worker.
    console.error(`platform_audit : écriture impossible (${action})`);
  }
}

export async function auditEntries(db, { limit = 50, organizationId = null } = {}) {
  await ensureSchema(db);
  const sql = organizationId
    ? 'SELECT * FROM platform_audit WHERE target_organization_id = ? ORDER BY id DESC LIMIT ?'
    : 'SELECT * FROM platform_audit ORDER BY id DESC LIMIT ?';
  const stmt = organizationId ? db.prepare(sql).bind(organizationId, limit) : db.prepare(sql).bind(limit);
  return (await stmt.all()).results;
}

export const AUDIT_LABELS = Object.freeze({
  'operator.bootstrap': 'a créé le compte propriétaire',
  'operator.login': 's’est connecté',
  'operator.invite': 'a invité un membre de l’équipe',
  'operator.invite_revoke': 'a annulé une invitation d’équipe',
  'operator.join': 'a rejoint l’équipe',
  'operator.disable': 'a désactivé un compte de l’équipe',
  'operator.enable': 'a réactivé un compte de l’équipe',
  'org.create': 'a créé le club',
  'org.suspend': 'a suspendu le club',
  'org.reactivate': 'a réactivé le club',
  'org.domain_add': 'a ajouté un domaine',
  'org.domain_remove': 'a retiré un domaine',
  'org.president_invite': 'a envoyé l’accès du président',
});
