// Comptes nominatifs, appartenances aux clubs, rôles et journal d'audit (phase 3 de la feuille de route, 2026-10-20).
//
// Trois objets distincts (docs/ROADMAP.md) :
//   - users : un COMPTE DE CONNEXION (e-mail + mot de passe haché), global à la plateforme : une même personne peut
//     être responsable dans plusieurs clubs avec un seul compte. Ce n'est PAS une personne du CRM (contacts).
//   - organization_memberships : l'APPARTENANCE d'un compte à un club, avec un rôle et un statut. C'est elle qui
//     ouvre l'espace admin d'un club, jamais le compte seul.
//   - user_tokens : jetons à usage unique (invitation, réinitialisation du mot de passe), stockés par leur empreinte
//     SHA-256 uniquement, rattachés au club qui les a émis.
//   - admin_audit_log : journal des actions des comptes dans un club (qui, quoi, quand), sans donnée personnelle
//     d'adhérent (le chemin et l'action, jamais le contenu d'un formulaire).
//
// Règles :
//   - plus de mot de passe partagé par le bureau : chaque responsable a son compte ;
//   - un club garde toujours au moins un « Responsable du club » (owner) actif ;
//   - seul un owner peut nommer, modifier ou retirer un owner ;
//   - le premier owner d'un club est créé par /admin/premier-acces avec le secret de plateforme SETUP_SECRET
//     (en attendant la console plateforme, phase 6) ;
//   - toutes les requêtes sur les tables rattachées à un club filtrent organization_id (tests/tenant-scoping).
import { sha256Hex, randomToken, hashPassword, verifyPassword } from './security.js';

export const ACCOUNTS_MIGRATION_VERSION = 14;

// Durées de validité des jetons.
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const RESET_TTL_SECONDS = 60 * 60;
export const PASSWORD_MIN_LENGTH = 10;

// Permissions de l'espace club. Les clés sont stockées nulle part (calculées depuis le rôle) : on peut les faire
// évoluer sans migration.
export const PERMISSIONS = Object.freeze({
  'inscriptions.read': 'Consulter les inscriptions, adhérents et pré-inscriptions',
  'inscriptions.write': 'Gérer les dossiers (validation, relances, modifications, archivage)',
  'finance.write': 'Enregistrer les paiements',
  'emails.send': 'Écrire aux familles depuis l’admin',
  'settings.manage': 'Paramètres, catégories, ouverture des inscriptions',
  'users.manage': 'Inviter et gérer les utilisateurs du club',
  'inscriptions.all': 'Voir tous les groupes (sans elle : seulement les groupes attribués au compte)',
  'attendance.write': 'Faire l’appel des présents aux séances',
});

const ALL = Object.keys(PERMISSIONS);

// Rôles d'un compte DANS un club. Clés stockées en base : ne jamais en renommer une.
export const ROLES = Object.freeze({
  owner: { label: 'Responsable du club', description: 'Tous les droits, y compris nommer d’autres responsables.', permissions: ALL },
  admin: { label: 'Administrateur', description: 'Tous les droits, sauf toucher aux responsables du club.', permissions: ALL },
  secretary: { label: 'Secrétaire', description: 'Dossiers, relances et e-mails aux familles.', permissions: ['inscriptions.read', 'inscriptions.all', 'inscriptions.write', 'emails.send', 'attendance.write'] },
  treasurer: { label: 'Trésorier', description: 'Consultation et enregistrement des paiements.', permissions: ['inscriptions.read', 'inscriptions.all', 'finance.write'] },
  coach: { label: 'Entraîneur', description: 'Ses groupes seulement : consultation des inscrits et appel des présents.', permissions: ['inscriptions.read', 'attendance.write'] },
  volunteer: { label: 'Bénévole', description: 'Tableau de bord seulement.', permissions: [] },
});

export const ROLE_KEYS = Object.keys(ROLES);
export const permissionsFor = (role) => [...(ROLES[role]?.permissions || [])];
export const roleLabel = (role) => ROLES[role]?.label || role;

export class AccountError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// Schéma (migration 14, additive : 4 nouvelles tables et une colonne nullable sur admin_sessions).

export const ACCOUNTS_TABLES = ['users', 'organization_memberships', 'user_tokens', 'admin_audit_log'];

const ROLE_CHECK = ROLE_KEYS.map((r) => `'${r}'`).join(', ');

export const ACCOUNTS_DEFINITIONS = [
  [
    'users',
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
      is_platform_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_platform_admin IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    )`,
  ],
  [
    'organization_memberships',
    `CREATE TABLE IF NOT EXISTS organization_memberships (
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL CHECK (role IN (${ROLE_CHECK})),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'revoked')),
      invited_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (organization_id, user_id)
    )`,
  ],
  [
    'user_tokens',
    `CREATE TABLE IF NOT EXISTS user_tokens (
      token_hash TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset')),
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    )`,
  ],
  [
    'admin_audit_log',
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      organization_id TEXT NOT NULL REFERENCES organizations(id),
      user_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ],
];

export const ACCOUNTS_INDEXES = [
  ['idx_memberships_user', 'CREATE INDEX IF NOT EXISTS idx_memberships_user ON organization_memberships (user_id)'],
  ['idx_user_tokens_org_user', 'CREATE INDEX IF NOT EXISTS idx_user_tokens_org_user ON user_tokens (organization_id, user_id, purpose)'],
  ['idx_admin_audit_org', 'CREATE INDEX IF NOT EXISTS idx_admin_audit_org ON admin_audit_log (organization_id, id)'],
];

export function accountsMigrationStatements(db) {
  return [
    ...ACCOUNTS_DEFINITIONS.map(([, sql]) => db.prepare(sql)),
    ...ACCOUNTS_INDEXES.map(([, sql]) => db.prepare(sql)),
    db.prepare('ALTER TABLE admin_sessions ADD COLUMN user_id TEXT REFERENCES users(id)'),
  ];
}

// Contrôle à chaque démarrage (repairSchemaInvariants), seulement si la migration 14 est enregistrée : tables et index
// manquants recréés (aucune donnée à reprendre pour une table absente), colonne admin_sessions.user_id rajoutée si
// elle a disparu. Rien n'est jamais supprimé.
export async function repairAccountsInvariants(db, { tableExists, columnNames }) {
  const statements = [];
  for (const [table, sql] of ACCOUNTS_DEFINITIONS) if (!(await tableExists(db, table))) statements.push(db.prepare(sql));
  for (const [name, sql] of ACCOUNTS_INDEXES) {
    if (!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").bind(name).first())) statements.push(db.prepare(sql));
  }
  if ((await tableExists(db, 'admin_sessions')) && !(await columnNames(db, 'admin_sessions')).has('user_id')) {
    statements.push(db.prepare('ALTER TABLE admin_sessions ADD COLUMN user_id TEXT REFERENCES users(id)'));
  }
  return statements;
}

// ---------------------------------------------------------------------------------------------
// Groupes attribués à un compte (migration 15, 2026-10-20) : un compte SANS la permission inscriptions.all (l'entraîneur)
// ne voit que les inscrits des groupes listés dans organization_memberships.group_scope (tableau JSON de libellés de
// catégorie, comparés sans casse ni espaces ni tirets). Aucun groupe attribué = aucun inscrit visible.

export const GROUP_SCOPE_MIGRATION_VERSION = 15;
const GROUP_SCOPE_COLUMN_SQL = 'ALTER TABLE organization_memberships ADD COLUMN group_scope TEXT';

export function groupScopeMigrationStatements(db) {
  return [db.prepare(GROUP_SCOPE_COLUMN_SQL)];
}

export async function repairGroupScopeInvariants(db, { tableExists, columnNames }) {
  if ((await tableExists(db, 'organization_memberships')) && !(await columnNames(db, 'organization_memberships')).has('group_scope')) {
    return [db.prepare(GROUP_SCOPE_COLUMN_SQL)];
  }
  return [];
}

export const normalizeGroupLabel = (value) => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s\u2010-\u2015_-]+/g, '');

export function parseGroupScope(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list.filter((v) => typeof v === 'string' && v.trim()).slice(0, 30) : [];
  } catch {
    return [];
  }
}

// Enregistre les groupes d'un compte du club (libellés nettoyés, 30 au plus, doublons retirés).
export async function setGroupScope(db, organizationId, userId, labels) {
  const seen = new Set();
  const clean = [];
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const key = normalizeGroupLabel(label);
    if (!label || seen.has(key)) continue;
    seen.add(key);
    clean.push(label);
    if (clean.length >= 30) break;
  }
  const result = await db
    .prepare("UPDATE organization_memberships SET group_scope = ?, updated_at = datetime('now') WHERE organization_id = ? AND user_id = ?")
    .bind(JSON.stringify(clean), organizationId, userId)
    .run();
  if (!result.meta?.changes) throw new AccountError('missing', 'Compte introuvable dans ce club.');
  return clean;
}

// ---------------------------------------------------------------------------------------------
// Utilitaires

const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]+$/;
export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 200 && EMAIL_RE.test(email) ? email : null;
}

export function cleanName(value) {
  // eslint-disable-next-line no-control-regex
  const name = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= 100 ? name : null;
}

export function passwordProblem(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) return `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  if (password.length > 200) return 'Le mot de passe est trop long (200 caractères au plus).';
  const lower = password.toLowerCase();
  if (email && lower === email.toLowerCase()) return 'Le mot de passe ne doit pas être votre adresse e-mail.';
  if (name && lower === name.toLowerCase()) return 'Le mot de passe ne doit pas être votre nom.';
  if (/^(.)\1+$/.test(password)) return 'Le mot de passe est trop simple.';
  return null;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);
const newUserId = () => `usr_${randomToken(16).replace(/[^A-Za-z0-9]/g, '').slice(0, 24).toLowerCase()}`;

// ---------------------------------------------------------------------------------------------
// Comptes

export async function findUserByEmail(db, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(normalized).first();
}

export async function getUser(db, userId) {
  if (!userId) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
}

// Appartenance active d'un compte actif à un club : { user, membership } ou null.
export async function activeMembership(db, organizationId, userId) {
  if (!organizationId || !userId) return null;
  const row = await db
    .prepare(
      `SELECT m.role, m.status AS membership_status, u.id, u.email, u.name, u.status, u.password_hash
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active' AND u.status = 'active'`
    )
    .bind(organizationId, userId)
    .first();
  return row || null;
}

// Vérifie e-mail + mot de passe pour un club. Renvoie le compte (avec son rôle) ou null. Même durée de calcul quand
// le compte n'existe pas (un mot de passe factice est vérifié), pour ne pas révéler les adresses connues.
const DUMMY_HASH_PROMISE = hashPassword('licyo-compte-inexistant');
export async function authenticate(db, organizationId, email, password) {
  const normalized = normalizeEmail(email);
  const candidate = typeof password === 'string' ? password : '';
  const user = normalized ? await findUserByEmail(db, normalized) : null;
  if (!user || !user.password_hash || user.status !== 'active') {
    await verifyPassword(candidate || 'x', await DUMMY_HASH_PROMISE).catch(() => false);
    return null;
  }
  if (!(await verifyPassword(candidate, user.password_hash))) return null;
  const membership = await activeMembership(db, organizationId, user.id);
  if (!membership) return null;
  await db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").bind(user.id).run().catch(() => {});
  return membership;
}

export async function setPassword(db, userId, password) {
  await db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").bind(await hashPassword(password), userId).run();
}

export async function setName(db, userId, name) {
  await db.prepare("UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?").bind(name, userId).run();
}

// ---------------------------------------------------------------------------------------------
// Appartenances d'un club

export async function listMembers(db, organizationId) {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.email, u.name, u.last_login_at, u.status AS user_status, u.password_hash IS NOT NULL AS has_password,
              m.role, m.status, m.created_at, m.updated_at, m.group_scope
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
       WHERE m.organization_id = ? AND m.status != 'revoked'
       ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name, u.email`
    )
    .bind(organizationId)
    .all();
  return results;
}

export async function countActiveMembers(db, organizationId) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM organization_memberships WHERE organization_id = ? AND status = 'active'").bind(organizationId).first();
  return Number(row?.n) || 0;
}

async function countActiveOwners(db, organizationId) {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM organization_memberships WHERE organization_id = ? AND status = 'active' AND role = 'owner'")
    .bind(organizationId)
    .first();
  return Number(row?.n) || 0;
}

async function membershipRow(db, organizationId, userId) {
  return db.prepare('SELECT * FROM organization_memberships WHERE organization_id = ? AND user_id = ?').bind(organizationId, userId).first();
}

// L'acteur (son rôle dans le club) peut-il agir sur ce rôle ? Seul un owner touche aux owners.
function assertCanManageRole(actorRole, role) {
  if (!ROLES[role]) throw new AccountError('role', 'Rôle inconnu.');
  if (role === 'owner' && actorRole !== 'owner') throw new AccountError('forbidden', 'Seul un responsable du club peut nommer ou modifier un responsable.');
  if (!permissionsFor(actorRole).includes('users.manage')) throw new AccountError('forbidden', 'Vous ne pouvez pas gérer les utilisateurs.');
}

async function createToken(db, organizationId, userId, purpose, ttl) {
  const token = randomToken();
  const now = nowSeconds();
  // Un seul jeton valable par compte, club et usage : les précédents sont invalidés.
  await db.batch([
    db.prepare('UPDATE user_tokens SET used_at = ? WHERE organization_id = ? AND user_id = ? AND purpose = ? AND used_at IS NULL').bind(now, organizationId, userId, purpose),
    db.prepare('INSERT INTO user_tokens (token_hash, organization_id, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(await sha256Hex(token), organizationId, userId, purpose, now, now + ttl),
  ]);
  return token;
}

// Invite une adresse dans le club avec un rôle. Crée le compte s'il n'existe pas (sans mot de passe), puis
// l'appartenance en statut « invited ». Renvoie { token, user, existing } : le lien d'invitation est envoyé par e-mail.
export async function inviteMember(db, organizationId, { email, role, actor }) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new AccountError('email', 'Adresse e-mail invalide.');
  assertCanManageRole(actor.role, role);
  let user = await findUserByEmail(db, normalized);
  if (user && user.status !== 'active') throw new AccountError('disabled', 'Ce compte est désactivé sur la plateforme.');
  if (!user) {
    user = { id: newUserId(), email: normalized, name: '', password_hash: null };
    await db.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(user.id, normalized, '').run();
  }
  const existing = await membershipRow(db, organizationId, user.id);
  if (existing?.status === 'active') throw new AccountError('exists', 'Cette personne a déjà accès à l’espace du club.');
  if (existing) {
    await db
      .prepare("UPDATE organization_memberships SET role = ?, status = 'invited', invited_by = ?, updated_at = datetime('now') WHERE organization_id = ? AND user_id = ?")
      .bind(role, actor.userId, organizationId, user.id)
      .run();
  } else {
    await db
      .prepare("INSERT INTO organization_memberships (organization_id, user_id, role, status, invited_by) VALUES (?, ?, ?, 'invited', ?)")
      .bind(organizationId, user.id, role, actor.userId)
      .run();
  }
  const token = await createToken(db, organizationId, user.id, 'invite', INVITE_TTL_SECONDS);
  return { token, user, existing: Boolean(user.password_hash) };
}

// Jeton valable (non utilisé, non expiré) pour ce club et cet usage : { token_hash, user, membership } ou null.
export async function readToken(db, organizationId, token, purpose) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = await db
    .prepare(
      `SELECT t.token_hash, t.user_id, t.expires_at, t.used_at, u.email, u.name, u.password_hash, u.status AS user_status,
              m.role, m.status AS membership_status
       FROM user_tokens t JOIN users u ON u.id = t.user_id
       LEFT JOIN organization_memberships m ON m.organization_id = t.organization_id AND m.user_id = t.user_id
       WHERE t.organization_id = ? AND t.token_hash = ? AND t.purpose = ?`
    )
    .bind(organizationId, await sha256Hex(token), purpose)
    .first();
  if (!row || row.used_at || row.expires_at <= nowSeconds() || row.user_status !== 'active') return null;
  if (purpose === 'invite' && row.membership_status !== 'invited') return null;
  if (purpose === 'reset' && row.membership_status !== 'active') return null;
  return row;
}

// Le jeton est consommé dans la même transaction que l'effet (CAS sur used_at IS NULL) : un double clic ne
// l'applique qu'une fois.
async function consumeToken(db, organizationId, tokenHash, extraStatements) {
  const results = await db.batch([
    db.prepare('UPDATE user_tokens SET used_at = ? WHERE organization_id = ? AND token_hash = ? AND used_at IS NULL').bind(nowSeconds(), organizationId, tokenHash),
    ...extraStatements,
  ]);
  return Boolean(results[0]?.meta?.changes);
}

// Accepte une invitation. Nouveau compte : name et password obligatoires. Compte existant (déjà membre d'un autre
// club) : son mot de passe actuel est demandé pour confirmer que c'est bien lui.
export async function acceptInvitation(db, organizationId, token, { name, password }) {
  const row = await readToken(db, organizationId, token, 'invite');
  if (!row) throw new AccountError('token', 'Ce lien d’invitation n’est plus valable. Demandez une nouvelle invitation au club.');
  const statements = [];
  if (row.password_hash) {
    if (!(await verifyPassword(String(password || ''), row.password_hash))) throw new AccountError('password', 'Mot de passe incorrect.');
  } else {
    const cleanedName = cleanName(name);
    if (!cleanedName) throw new AccountError('name', 'Indiquez votre prénom et votre nom (2 caractères au moins).');
    const problem = passwordProblem(password, { email: row.email, name: cleanedName });
    if (problem) throw new AccountError('password', problem);
    statements.push(
      db.prepare("UPDATE users SET name = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ? AND password_hash IS NULL").bind(cleanedName, await hashPassword(password), row.user_id)
    );
  }
  statements.push(
    db.prepare("UPDATE organization_memberships SET status = 'active', updated_at = datetime('now') WHERE organization_id = ? AND user_id = ? AND status = 'invited'").bind(organizationId, row.user_id)
  );
  if (!(await consumeToken(db, organizationId, row.token_hash, statements))) throw new AccountError('token', 'Ce lien d’invitation a déjà été utilisé.');
  return { userId: row.user_id, role: row.role, email: row.email };
}

// Demande de réinitialisation : un jeton seulement si l'adresse a une appartenance ACTIVE à ce club et un mot de passe.
// Renvoie { token, user } ou null ; l'appelant répond toujours la même chose (aucune adresse n'est révélée).
export async function requestPasswordReset(db, organizationId, email) {
  const user = await findUserByEmail(db, email);
  if (!user || !user.password_hash || user.status !== 'active') return null;
  if (!(await activeMembership(db, organizationId, user.id))) return null;
  return { token: await createToken(db, organizationId, user.id, 'reset', RESET_TTL_SECONDS), user };
}

export async function resetPassword(db, organizationId, token, password) {
  const row = await readToken(db, organizationId, token, 'reset');
  if (!row) throw new AccountError('token', 'Ce lien n’est plus valable (il expire au bout d’une heure). Faites une nouvelle demande.');
  const problem = passwordProblem(password, { email: row.email, name: row.name });
  if (problem) throw new AccountError('password', problem);
  const ok = await consumeToken(db, organizationId, row.token_hash, [
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").bind(await hashPassword(password), row.user_id),
  ]);
  if (!ok) throw new AccountError('token', 'Ce lien a déjà été utilisé.');
  return { userId: row.user_id, email: row.email };
}

export async function changeRole(db, organizationId, { userId, role, actor }) {
  assertCanManageRole(actor.role, role);
  const current = await membershipRow(db, organizationId, userId);
  if (!current || current.status === 'revoked') throw new AccountError('missing', 'Utilisateur introuvable dans ce club.');
  if (current.role === 'owner') assertCanManageRole(actor.role, 'owner');
  if (current.role === 'owner' && role !== 'owner' && current.status === 'active' && (await countActiveOwners(db, organizationId)) <= 1) {
    throw new AccountError('last-owner', 'Le club doit garder au moins un responsable. Nommez-en un autre avant de changer ce rôle.');
  }
  await db
    .prepare("UPDATE organization_memberships SET role = ?, updated_at = datetime('now') WHERE organization_id = ? AND user_id = ? AND status != 'revoked'")
    .bind(role, organizationId, userId)
    .run();
}

// Retire l'accès d'un compte au club (le compte lui-même reste : il peut appartenir à d'autres clubs). Ses sessions et
// jetons pour ce club sont supprimés dans la même transaction.
export async function revokeMember(db, organizationId, { userId, actor }) {
  const current = await membershipRow(db, organizationId, userId);
  if (!current || current.status === 'revoked') throw new AccountError('missing', 'Utilisateur introuvable dans ce club.');
  assertCanManageRole(actor.role, current.role);
  if (current.role === 'owner' && current.status === 'active' && (await countActiveOwners(db, organizationId)) <= 1) {
    throw new AccountError('last-owner', 'Impossible de retirer le dernier responsable du club.');
  }
  await db.batch([
    db.prepare("UPDATE organization_memberships SET status = 'revoked', updated_at = datetime('now') WHERE organization_id = ? AND user_id = ?").bind(organizationId, userId),
    db.prepare('DELETE FROM admin_sessions WHERE organization_id = ? AND user_id = ?').bind(organizationId, userId),
    db.prepare('UPDATE user_tokens SET used_at = ? WHERE organization_id = ? AND user_id = ? AND used_at IS NULL').bind(nowSeconds(), organizationId, userId),
  ]);
}

// Premier responsable d'un club sans aucun membre actif (/admin/premier-acces). Échoue si le club a déjà un membre
// actif : la page ne sert qu'une fois. Si l'adresse a déjà un compte (autre club), son mot de passe est vérifié.
export async function createFirstOwner(db, organizationId, { email, name, password }) {
  if ((await countActiveMembers(db, organizationId)) > 0) throw new AccountError('exists', 'Ce club a déjà un responsable. Connectez-vous, ou demandez une invitation.');
  const normalized = normalizeEmail(email);
  if (!normalized) throw new AccountError('email', 'Adresse e-mail invalide.');
  let user = await findUserByEmail(db, normalized);
  const statements = [];
  if (user) {
    if (user.status !== 'active') throw new AccountError('disabled', 'Ce compte est désactivé sur la plateforme.');
    if (user.password_hash && !(await verifyPassword(String(password || ''), user.password_hash))) {
      throw new AccountError('password', 'Cette adresse a déjà un compte : saisissez son mot de passe actuel.');
    }
  }
  const cleanedName = cleanName(name);
  if (!user?.password_hash) {
    if (!cleanedName) throw new AccountError('name', 'Indiquez votre prénom et votre nom (2 caractères au moins).');
    const problem = passwordProblem(password, { email: normalized, name: cleanedName });
    if (problem) throw new AccountError('password', problem);
  }
  if (!user) {
    user = { id: newUserId(), email: normalized };
    statements.push(db.prepare('INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)').bind(user.id, normalized, cleanedName, await hashPassword(password)));
  } else if (!user.password_hash) {
    statements.push(db.prepare("UPDATE users SET name = ?, password_hash = ?, updated_at = datetime('now') WHERE id = ?").bind(cleanedName, await hashPassword(password), user.id));
  }
  // INSERT conditionnel : deux envois simultanés ne créent qu'un seul premier responsable.
  statements.push(
    db
      .prepare(
        `INSERT OR REPLACE INTO organization_memberships (organization_id, user_id, role, status)
         SELECT ?, ?, 'owner', 'active'
         WHERE NOT EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = ? AND status = 'active')`
      )
      .bind(organizationId, user.id, organizationId)
  );
  const results = await db.batch(statements);
  if (!results[results.length - 1]?.meta?.changes) throw new AccountError('exists', 'Ce club a déjà un responsable.');
  return { userId: user.id };
}

// ---------------------------------------------------------------------------------------------
// Journal d'audit

const AUDIT_RETENTION_DAYS = 400;

// action : code court (ex. 'connexion', 'utilisateur.invitation', 'POST /admin/inscriptions:toggle-paye') ;
// target : identifiant technique (compte, fiche), jamais un nom ou une adresse d'adhérent. Ne fait jamais échouer
// l'action qu'il journalise.
export async function logAudit(db, organizationId, { userId = null, action, target = null }) {
  if (!db || !organizationId || !action) return;
  try {
    await db
      .prepare('INSERT INTO admin_audit_log (organization_id, user_id, action, target) VALUES (?, ?, ?, ?)')
      .bind(organizationId, userId, String(action).slice(0, 120), target === null ? null : String(target).slice(0, 120))
      .run();
  } catch {
    // journal indisponible : l'action n'est pas bloquée
  }
}

export async function listAudit(db, organizationId, { limit = 100 } = {}) {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.action, a.target, a.created_at, a.user_id, u.name, u.email
       FROM admin_audit_log a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.organization_id = ? ORDER BY a.id DESC LIMIT ?`
    )
    .bind(organizationId, Math.min(Math.max(Number(limit) || 100, 1), 500))
    .all();
  return results;
}

export async function purgeAudit(db, organizationId) {
  await db
    .prepare(`DELETE FROM admin_audit_log WHERE organization_id = ? AND created_at < datetime('now', '-${AUDIT_RETENTION_DAYS} days')`)
    .bind(organizationId)
    .run();
}
