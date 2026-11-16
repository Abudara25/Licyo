// Comptes nominatifs du bureau (lot 1 Licyo, 2026-11-16), table admin_users (migration 14).
//
// Chaque membre du bureau a son compte : e-mail, nom, rôle, mot de passe (empreinte PBKDF2, security.js). Les droits
// viennent du RÔLE, par une liste de PERMISSIONS : une page ou une action demande une permission, jamais une liste de
// rôles écrite en dur. L'encadrement (éducateurs, dirigeants) garde son espace par lien (educateurs.js).
//
// Entrée : invitation par lien personnel (7 jours, une seule fois). Seule l'empreinte SHA-256 du lien est enregistrée.
// Le lien est affiché à la personne qui invite (à transmettre), et envoyé par e-mail quand l'envoi est configuré.
//
// Transition : le mot de passe partagé du club (admin-auth.js) reste valable et donne les droits du président, pour
// que le club puisse créer les premiers comptes. Garde-fous : le club garde toujours au moins un président actif, et
// personne ne désactive ni ne rétrograde son propre compte.
import { sha256Hex, randomToken, hashPassword, verifyPassword } from './security.js';
import { ensureSchema } from './inscriptions-db.js';
import { sqlNow } from './educateurs.js';

export const ADMIN_ROLES = ['president', 'vice_president', 'secretary', 'assistant_secretary', 'treasurer', 'assistant_treasurer'];

export const ROLE_LABELS = Object.freeze({
  president: 'Président(e)',
  vice_president: 'Vice-président(e)',
  secretary: 'Secrétaire',
  assistant_secretary: 'Secrétaire adjoint(e)',
  treasurer: 'Trésorier(ère)',
  assistant_treasurer: 'Trésorier(ère) adjoint(e)',
});

export const ROLE_DESCRIPTIONS = Object.freeze({
  president: 'Tous les droits, dont les comptes du bureau et le mot de passe partagé.',
  vice_president: 'Tous les droits sauf la gestion des comptes.',
  secretary: 'Inscriptions, adhérents, familles, éducateurs, communication et paramètres.',
  assistant_secretary: 'Inscriptions, adhérents, familles et éducateurs, sans les paramètres.',
  treasurer: 'Paiements, chèques et HelloAsso ; lecture des inscriptions.',
  assistant_treasurer: 'Paiements et chèques ; lecture des inscriptions.',
});

export const PERMISSIONS = [
  'members.read', // inscriptions, adhérents, contacts, pièces
  'members.write', // valider, relancer, archiver, réinscrire, pré-inscriptions
  'finance.read',
  'finance.write', // paiements, chèques, HelloAsso
  'sport.manage', // éducateurs, catégories, événements
  'communication.manage', // e-mails et newsletter
  'settings.manage', // paramètres du club
  'club.admin', // comptes du bureau et mot de passe partagé
];

const ALL = PERMISSIONS;
export const ROLE_PERMISSIONS = Object.freeze({
  president: ALL,
  vice_president: ALL.filter((p) => p !== 'club.admin'),
  secretary: ['members.read', 'members.write', 'finance.read', 'sport.manage', 'communication.manage', 'settings.manage'],
  assistant_secretary: ['members.read', 'members.write', 'finance.read', 'sport.manage', 'communication.manage'],
  treasurer: ['members.read', 'finance.read', 'finance.write'],
  assistant_treasurer: ['members.read', 'finance.read', 'finance.write'],
});

export const isAdminRole = (role) => ADMIN_ROLES.includes(role);

// admin : contexte renvoyé par isAuthed (admin-auth.js). Sans rôle connu : aucun droit.
export function can(admin, permission) {
  return Boolean(admin && isAdminRole(admin.role) && ROLE_PERMISSIONS[admin.role].includes(permission));
}

export const INVITE_DAYS = 7;
const INVITE_TOKEN_RE = /^i[A-Za-z0-9_-]{43}$/;
export const isInviteTokenShape = (token) => typeof token === 'string' && INVITE_TOKEN_RE.test(token);
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
export const MIN_PASSWORD_LENGTH = 10;

export class AdminUserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminUserError';
  }
}

export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

function cleanIdentity({ email, name, role }) {
  const cleanEmail = normalizeEmail(email);
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
  if (!EMAIL_RE.test(cleanEmail) || cleanEmail.length > 200) throw new AdminUserError('Adresse e-mail invalide.');
  if (!cleanName || cleanName.length > 120) throw new AdminUserError('Indiquez le nom (120 caractères au plus).');
  if (!isAdminRole(role)) throw new AdminUserError('Rôle inconnu.');
  return { email: cleanEmail, name: cleanName, role };
}

export function checkNewPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new AdminUserError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
  }
  if (password.length > 200) throw new AdminUserError('Mot de passe trop long (200 caractères au plus).');
  if (confirm !== undefined && password !== confirm) throw new AdminUserError('Les deux mots de passe ne correspondent pas.');
}

// --- Invitations ---------------------------------------------------------------------------------------------

// Crée une invitation et renvoie le lien en clair (jamais enregistré). Une invitation encore valable pour la même
// adresse est remplacée : un seul lien actif par personne.
export async function createInvite(db, organizationId, input, { invitedBy = null, now = Date.now() } = {}) {
  await ensureSchema(db);
  const { email, name, role } = cleanIdentity(input);
  const existing = await db
    .prepare('SELECT id FROM admin_users WHERE organization_id = ? AND email = ?')
    .bind(organizationId, email)
    .first();
  if (existing) throw new AdminUserError('Un compte existe déjà pour cette adresse.');
  const token = `i${randomToken(32)}`;
  await db.batch([
    db
      .prepare('UPDATE admin_user_invites SET revoked_at = ? WHERE organization_id = ? AND email = ? AND used_at IS NULL AND revoked_at IS NULL')
      .bind(sqlNow(now), organizationId, email),
    db
      .prepare(
        'INSERT INTO admin_user_invites (organization_id, email, name, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(organizationId, email, name, role, await sha256Hex(token), invitedBy, sqlNow(now), sqlNow(now + INVITE_DAYS * 86_400_000)),
  ]);
  return { token, email, name, role };
}

// Invitation valable (ni utilisée, ni révoquée, ni expirée) pour ce lien, dans CETTE organisation ; sinon null.
export async function findInvite(db, organizationId, token, now = Date.now()) {
  if (!isInviteTokenShape(token)) return null;
  await ensureSchema(db);
  const row = await db
    .prepare('SELECT * FROM admin_user_invites WHERE organization_id = ? AND token_hash = ?')
    .bind(organizationId, await sha256Hex(token))
    .first();
  if (!row || row.used_at || row.revoked_at || row.expires_at <= sqlNow(now)) return null;
  return row;
}

// Accepte l'invitation : crée le compte avec le mot de passe choisi. Le lien ne sert qu'une fois : la mise à jour
// conditionnelle (used_at IS NULL) et l'insertion partent dans la même transaction.
export async function acceptInvite(db, organizationId, token, password, confirm, now = Date.now()) {
  const invite = await findInvite(db, organizationId, token, now);
  if (!invite) throw new AdminUserError('Ce lien d’invitation n’est plus valable. Demandez-en un nouveau.');
  checkNewPassword(password, confirm);
  const passwordHash = await hashPassword(password);
  const at = sqlNow(now);
  try {
    const results = await db.batch([
      db
        .prepare('UPDATE admin_user_invites SET used_at = ? WHERE organization_id = ? AND id = ? AND used_at IS NULL AND revoked_at IS NULL')
        .bind(at, organizationId, invite.id),
      db
        .prepare(
          `INSERT INTO admin_users (organization_id, email, name, role, password_hash, created_at)
           SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`
        )
        .bind(organizationId, invite.email, invite.name, invite.role, passwordHash, at),
    ]);
    const created = results?.[1]?.meta?.changes;
    if (created === 0) throw new AdminUserError('Ce lien d’invitation vient d’être utilisé.');
  } catch (error) {
    if (error instanceof AdminUserError) throw error;
    if (/UNIQUE/i.test(String(error?.message))) throw new AdminUserError('Un compte existe déjà pour cette adresse.');
    throw error;
  }
  const user = await db
    .prepare('SELECT * FROM admin_users WHERE organization_id = ? AND email = ?')
    .bind(organizationId, invite.email)
    .first();
  if (!user) throw new AdminUserError('Ce lien d’invitation vient d’être utilisé.');
  return user;
}

export async function revokeInvite(db, organizationId, inviteId, now = Date.now()) {
  await ensureSchema(db);
  await db
    .prepare('UPDATE admin_user_invites SET revoked_at = ? WHERE organization_id = ? AND id = ? AND used_at IS NULL AND revoked_at IS NULL')
    .bind(sqlNow(now), organizationId, Number(inviteId))
    .run();
}

export async function pendingInvites(db, organizationId, now = Date.now()) {
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, email, name, role, created_at, expires_at FROM admin_user_invites
       WHERE organization_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`
    )
    .bind(organizationId, sqlNow(now))
    .all();
  return results;
}

// --- Comptes -------------------------------------------------------------------------------------------------

export async function listUsers(db, organizationId) {
  await ensureSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, email, name, role, status, created_at, last_login_at FROM admin_users
       WHERE organization_id = ? ORDER BY status, name COLLATE NOCASE`
    )
    .bind(organizationId)
    .all();
  return results;
}

export async function getUser(db, organizationId, userId) {
  await ensureSchema(db);
  return db.prepare('SELECT * FROM admin_users WHERE organization_id = ? AND id = ?').bind(organizationId, Number(userId)).first();
}

// Empreinte factice : un e-mail inconnu coûte le même calcul qu'un mauvais mot de passe (pas d'énumération par le temps).
let dummyHash;
const dummy = async () => (dummyHash ??= await hashPassword(randomToken(16)));

// Compte actif correspondant à ces identifiants dans CETTE organisation, ou null.
export async function verifyUserLogin(db, organizationId, email, password, now = Date.now()) {
  await ensureSchema(db);
  const clean = normalizeEmail(email);
  const user = EMAIL_RE.test(clean)
    ? await db.prepare('SELECT * FROM admin_users WHERE organization_id = ? AND email = ?').bind(organizationId, clean).first()
    : null;
  const ok = await verifyPassword(String(password || ''), user?.password_hash || (await dummy()));
  if (!user || !ok || user.status !== 'active') return null;
  await db
    .prepare('UPDATE admin_users SET last_login_at = ? WHERE organization_id = ? AND id = ?')
    .bind(sqlNow(now), organizationId, user.id)
    .run()
    .catch(() => {});
  return user;
}

async function activePresidents(db, organizationId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM admin_users WHERE organization_id = ? AND role = 'president' AND status = 'active'")
    .bind(organizationId)
    .first();
  return row.n;
}

// Garde-fous communs au changement de rôle et à la désactivation. actorUserId : compte qui agit (null = mot de passe
// partagé).
async function guardChange(db, organizationId, target, actorUserId, { losesPresidency }) {
  if (!target) throw new AdminUserError('Compte introuvable.');
  if (actorUserId && target.id === actorUserId) throw new AdminUserError('Vous ne pouvez pas modifier votre propre accès. Demandez à un autre président.');
  if (losesPresidency && target.role === 'president' && target.status === 'active' && (await activePresidents(db, organizationId)) <= 1) {
    throw new AdminUserError('Le club doit garder au moins un président actif.');
  }
}

export async function setUserRole(db, organizationId, userId, role, { actorUserId = null, now = Date.now() } = {}) {
  if (!isAdminRole(role)) throw new AdminUserError('Rôle inconnu.');
  const target = await getUser(db, organizationId, userId);
  await guardChange(db, organizationId, target, actorUserId, { losesPresidency: role !== 'president' });
  await db
    .prepare('UPDATE admin_users SET role = ?, updated_at = ? WHERE organization_id = ? AND id = ?')
    .bind(role, sqlNow(now), organizationId, target.id)
    .run();
}

// Désactiver ferme aussitôt toutes les sessions du compte, sur tous les appareils.
export async function setUserStatus(db, organizationId, userId, status, { actorUserId = null, now = Date.now() } = {}) {
  if (!['active', 'disabled'].includes(status)) throw new AdminUserError('Statut inconnu.');
  const target = await getUser(db, organizationId, userId);
  await guardChange(db, organizationId, target, actorUserId, { losesPresidency: status === 'disabled' });
  const statements = [
    db.prepare('UPDATE admin_users SET status = ?, updated_at = ? WHERE organization_id = ? AND id = ?').bind(status, sqlNow(now), organizationId, target.id),
  ];
  if (status === 'disabled') {
    statements.push(db.prepare('DELETE FROM admin_sessions WHERE organization_id = ? AND user_id = ?').bind(organizationId, target.id));
  }
  await db.batch(statements);
}

// Contexte des droits d'une session : compte nominatif actif, ou mot de passe partagé (droits du président).
export async function sessionIdentity(db, organizationId, userId) {
  if (userId === null || userId === undefined) return { userId: null, role: 'president', name: 'Accès partagé du club', email: null, shared: true };
  const user = await db
    .prepare("SELECT id, email, name, role FROM admin_users WHERE organization_id = ? AND id = ? AND status = 'active'")
    .bind(organizationId, userId)
    .first();
  return user ? { userId: user.id, role: user.role, name: user.name, email: user.email, shared: false } : null;
}
