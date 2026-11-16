// Authentification et habillage partagés par les pages /admin/* : un mot de passe (haché) ouvre une
// session enregistrée dans D1 — le cookie ne contient qu'un jeton aléatoire, jamais le mot de passe —,
// plus l'en-tête HTML, le bandeau de navigation et les petits composants communs (icônes, statuts,
// avatars, messages). CSS correspondant : assets/css/admin.css.
import {
  sha256Hex,
  randomToken,
  timingSafeEqual,
  hashPassword,
  verifyPassword,
  isPasswordHash,
  clientKey,
  hitRateLimit,
  isRateLimited,
  clearRateLimit,
} from './security.js';
import { dossierStatus, ARCHIVE_MOTIFS, ARCHIVE_MOTIFS_MANUELS, ensureSchema } from './inscriptions-db.js';
import { resolveOrganization } from './organization.js';
import { DEMO_ORG_ID } from './schema.js';
import { getAdminPasswordHash, setAdminPasswordHash as storeAdminPasswordHash } from './settings-kv.js';
import { verifyUserLogin, sessionIdentity, can } from './admin-users.js';

export const COOKIE_NAME = 'admin_session';
// Ancien cookie, qui contenait le mot de passe lui-même : effacé à chaque connexion et déconnexion.
const LEGACY_COOKIE_NAME = 'admin_auth';
const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
// Déconnexion après inactivité (2026-10-10, demande de l'utilisateur) : la session expire SESSION_IDLE_SECONDS après la
// dernière activité (expires_at glissant, jamais au-delà de created_at + SESSION_TTL_SECONDS). Chaque page admin la
// prolonge, ainsi que assets/js/admin-session.js (clics, frappes, défilement), qui prévient SESSION_WARNING_SECONDS
// avant la coupure. Écriture en base au plus une fois par minute et par session.
export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_WARNING_SECONDS = 2 * 60;
const SESSION_TOUCH_SECONDS = 60;
// 5 mots de passe erronés depuis une même connexion bloquent les essais pendant 15 minutes.
const LOGIN_LIMIT = { limit: 5, windowSeconds: 15 * 60 };

// Mot de passe admin PROPRE À CHAQUE ORGANISATION : empreinte PBKDF2 dans le KV, clé
// org:<organizationId>:admin_password (voir settings-kv.js). Le mot de passe d'une organisation n'ouvre
// jamais l'espace d'une autre. Le secret Cloudflare ADMIN_PASSWORD (antérieur au multi-organisation) ne
// vaut que pour Demoville, et seulement tant qu'aucun mot de passe n'a été enregistré depuis
// /admin/parametres. Une organisation sans mot de passe enregistré ne peut pas se connecter.
export class AdminAuthUnavailableError extends Error {
  constructor() {
    super('Vérification du mot de passe impossible pour le moment');
    this.name = 'AdminAuthUnavailableError';
  }
}

export async function verifyAdminPassword(env, organizationId, candidate) {
  if (typeof candidate !== 'string' || !candidate || !organizationId) return false;
  let stored = null;
  try {
    stored = await getAdminPasswordHash(env, organizationId);
  } catch {
    // KV illisible : connexion refusée (AdminAuthUnavailableError, message « réessayez »). Le secret historique ne doit
    // JAMAIS servir de repli ici : il réactiverait un ancien mot de passe après un changement depuis Paramètres
    // (relevé par une revue Codex, 2026-10-08).
    throw new AdminAuthUnavailableError();
  }
  if (stored) {
    const ok = await verifyPassword(candidate, stored);
    // Valeur enregistrée en clair avant le hachage : remplacée par son empreinte à la première connexion.
    if (ok && !isPasswordHash(stored)) await setAdminPasswordHash(env, organizationId, await hashPassword(candidate)).catch(() => {});
    return ok;
  }
  return organizationId === DEMO_ORG_ID && Boolean(env.ADMIN_PASSWORD) && timingSafeEqual(candidate, env.ADMIN_PASSWORD);
}

export async function setAdminPasswordHash(env, organizationId, passwordHash) {
  await storeAdminPasswordHash(env, organizationId, passwordHash);
}

// La table admin_sessions (et son organization_id) est créée par les migrations (schema.js).
const ensureSessionsTable = (db) => ensureSchema(db);

function readCookie(request, name) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

const cookie = (name, value, maxAge) => `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=${maxAge}`;

export const withCookies = (response, cookies) => {
  for (const value of cookies) response.headers.append('Set-Cookie', value);
  return response;
};

// Contexte admin de la requête : { organizationId, userId, role, name, email, shared } si la session est valide,
// sinon null. userId null et shared vrai : session ouverte avec le mot de passe partagé (droits du président).
// Les droits se lisent avec can(admin, permission) (admin-users.js).
// L'organisation vient de la session (fixée à la connexion), jamais d'un paramètre du navigateur :
// toutes les requêtes des pages admin filtrent ensuite sur admin.organizationId.
// Authentifié ne veut pas dire « accès à tout » : uniquement aux données de cette organisation.
export async function isAuthed(request, env, { touch = true } = {}) {
  const session = await readSession(request, env, { touch });
  return session && { organizationId: session.organizationId, userId: session.userId, role: session.role, name: session.name, email: session.email, shared: session.shared };
}

// Session de la requête : { organizationId, expiresAt } ou null. touch : prolonge l'expiration (activité) ; false pour
// une simple lecture (GET /admin/session, qui ne doit pas maintenir la session ouverte à elle seule).
export async function readSession(request, env, { touch = true } = {}) {
  const token = readCookie(request, COOKIE_NAME);
  if (!token || !env.DB) return null;
  try {
    await ensureSessionsTable(env.DB);
    const tokenHash = await sha256Hex(token);
    // Recherche par jeton, donc sans organisation connue à l'avance (le jeton désigne sa session et son
    // organisation). Même requête : l'organisation doit exister et être active.
    const row = await env.DB.prepare(
      `SELECT s.created_at, s.expires_at, s.organization_id, s.user_id FROM admin_sessions s /* toutes-organisations */
       JOIN organizations o ON o.id = s.organization_id AND o.status = 'active'
       WHERE s.token_hash = ?`
    )
      .bind(tokenHash)
      .first();
    const now = Math.floor(Date.now() / 1000);
    if (!row || row.expires_at <= now || !row.organization_id) return null;
    // Compte désactivé ou supprimé entre-temps : la session ne vaut plus rien.
    const identity = await sessionIdentity(env.DB, row.organization_id, row.user_id);
    if (!identity) return null;
    let expiresAt = row.expires_at;
    // Échéance d'inactivité : jamais plus loin que maintenant + SESSION_IDLE_SECONDS (les sessions ouvertes avant la
    // mise en place, valables 14 jours, sont ramenées à cette limite même par une simple lecture).
    const idleLimit = Math.min(now + SESSION_IDLE_SECONDS, row.created_at + SESSION_TTL_SECONDS);
    const target = touch ? idleLimit : Math.min(expiresAt, idleLimit);
    if (target < expiresAt || target - expiresAt >= SESSION_TOUCH_SECONDS) {
      await env.DB.prepare('UPDATE admin_sessions SET expires_at = ? WHERE organization_id = ? AND token_hash = ?')
        .bind(target, row.organization_id, tokenHash)
        .run()
        .catch(() => {});
      expiresAt = target;
    }
    if (expiresAt <= now) return null;
    return { organizationId: row.organization_id, expiresAt, ...identity };
  } catch {
    return null;
  }
}

// Ouvre une session pour une organisation, et pour un compte nominatif (userId) ou le mot de passe partagé (null) ;
// renvoie les en-têtes Set-Cookie à ajouter à la réponse.
export async function createSession(env, organizationId, userId = null) {
  if (!organizationId) throw new Error('createSession : organisation requise');
  await ensureSessionsTable(env.DB);
  const token = randomToken();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM admin_sessions WHERE organization_id = ? AND expires_at <= ?').bind(organizationId, now).run();
  await env.DB.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at, organization_id, user_id) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(token), now, now + SESSION_IDLE_SECONDS, organizationId, userId)
    .run();
  return [cookie(COOKIE_NAME, token, SESSION_TTL_SECONDS), cookie(LEGACY_COOKIE_NAME, '', 0)];
}

export async function destroySession(request, env) {
  const token = readCookie(request, COOKIE_NAME);
  if (token && env.DB) {
    try {
      await ensureSessionsTable(env.DB);
      // Le jeton désigne à lui seul la session (et donc son organisation).
      await env.DB.prepare('DELETE FROM admin_sessions /* toutes-organisations */ WHERE token_hash = ?').bind(await sha256Hex(token)).run();
    } catch {
      // le cookie est effacé quoi qu'il arrive
    }
  }
  return [cookie(COOKIE_NAME, '', 0), cookie(LEGACY_COOKIE_NAME, '', 0)];
}

// Après un changement du mot de passe partagé : toutes les sessions ouvertes AVEC CE MOT DE PASSE, sur tous les
// appareils, sont fermées. Les sessions des comptes nominatifs n'en dépendent pas et restent ouvertes.
export async function revokeAllSessions(env, organizationId) {
  await ensureSessionsTable(env.DB);
  await env.DB.prepare('DELETE FROM admin_sessions WHERE organization_id = ? AND user_id IS NULL').bind(organizationId).run();
}

// Formulaire de connexion (POST /admin/inscriptions sans action).
export async function handleLogin(request, env, form) {
  const html = (error, status) => new Response(loginPage({ error }), { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  const bucket = `login:${await clientKey(request)}`;

  if (await isRateLimited(env.DB, bucket, LOGIN_LIMIT).catch(() => false)) {
    return html('Trop de tentatives. Réessayez dans 15 minutes.', 429);
  }
  // Organisation du domaine sur lequel on se connecte : son mot de passe, et lui seul, est vérifié.
  // Une panne de la base n'est pas un domaine inconnu (2026-11-13 : « Espace introuvable » affiché pendant une panne).
  let organization;
  try {
    organization = await resolveOrganization(request, env);
  } catch {
    return html('Connexion impossible pour le moment (base de données indisponible). Réessayez dans un instant.', 503);
  }
  if (!organization) return html('Espace introuvable pour ce site.', 404);
  // Avec une adresse e-mail : compte nominatif. Sans adresse : mot de passe partagé du club (transition).
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  let valid;
  let userId = null;
  try {
    if (email) {
      const user = await verifyUserLogin(env.DB, organization.id, email, password);
      valid = Boolean(user);
      userId = user?.id ?? null;
    } else {
      valid = await verifyAdminPassword(env, organization.id, password);
    }
  } catch (error) {
    if (error instanceof AdminAuthUnavailableError) return html('Connexion impossible pour le moment (stockage indisponible). Réessayez dans un instant.', 503);
    return html('Connexion impossible pour le moment (base de données indisponible). Réessayez dans un instant.', 503);
  }
  if (!valid) {
    await hitRateLimit(env.DB, bucket, LOGIN_LIMIT).catch(() => {});
    return html(email ? 'Adresse e-mail ou mot de passe incorrect.' : 'Mot de passe incorrect.', 401);
  }
  await clearRateLimit(env.DB, bucket).catch(() => {});

  let cookies;
  try {
    cookies = await createSession(env, organization.id, userId);
  } catch {
    return html('Connexion impossible pour le moment (base de données indisponible). Réessayez dans un instant.', 503);
  }
  // Arrivée sur « À traiter » (2026-11-10) : la liste des actions du jour, point d'entrée du bénévole.
  return withCookies(new Response('', { status: 302, headers: { Location: '/admin/a-traiter' } }), cookies);
}

export const escapeHtml = (str = '') =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Version (?v=) de tous les assets chargés par l'admin — Cloudflare Pages les met en cache 4h sans
// possibilité de le changer (voir CLAUDE.md). Valeur écrite par `npm run sync` (empreinte des assets) :
// ne pas la modifier à la main.
const ASSETS_VERSION = '52c68fc4d9';
const asset = (path) => `${path}?v=${ASSETS_VERSION}`;

// Icônes au trait (viewBox 24, stroke 1.8), même convention que les SVG du site public.
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  whatsapp: '<path d="M3.5 20.5l1.3-4.3A8.5 8.5 0 1 1 8 19.3z"/><path d="M9.2 8.6c0 3.2 2.6 6.2 6.2 6.2l1-1.5-1.9-1-1 .9a4.5 4.5 0 0 1-2.7-2.7l.9-1-1-1.9z"/>',
  sms: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
};

export function icon(name) {
  return `<svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

export function adminHead(title, bodyClass = 'adm') {
  return `<!doctype html><html lang="fr"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${escapeHtml(title)} — Admin Club Exemple</title>
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="/assets/images/favicon.ico">
<link rel="manifest" href="/manifest-admin.json">
<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">
<meta name="theme-color" content="#4f1414">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Admin Club Exemple">
<link rel="preload" href="/assets/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<script src="${asset('/assets/js/admin-layout.js')}"></script>
<link rel="stylesheet" href="${asset('/assets/css/styles.css')}">
<link rel="stylesheet" href="${asset('/assets/css/admin.css')}">
<script src="${asset('/assets/js/admin-session.js')}" defer></script>
<script src="${asset('/assets/js/admin-search.js')}" defer></script>
</head><body class="${bodyClass}" data-idle-seconds="${SESSION_IDLE_SECONDS}" data-warning-seconds="${SESSION_WARNING_SECONDS}">`;
}

// Scripts externes uniquement : le CSP du site bloque les <script> inline (voir _headers).
// Bouton « Trouver d'après la ville » (assets/js/naissance-autocomplete.js) : seulement né en France, ville connue,
// code postal absent. Masqué sans JavaScript.
export function cpLookupButton(inputId, r) {
  const france = ['', 'france', 'fr'].includes(String(r.pays_naissance || '').trim().toLowerCase());
  if (!france || !r.ville_naissance || r.cp_naissance) return '';
  return `<button type="button" class="adm-btn adm-btn-sm adm-btn-ghost" data-cp-lookup="${inputId}" data-cp-status="${inputId}-status" data-city="${escapeHtml(r.ville_naissance)}" hidden>${icon('search')}Trouver d'après la ville</button>
            <small id="${inputId}-status" class="adm-help" role="status"></small>`;
}

export function adminScripts(...names) {
  return names.map((name) => `<script src="${asset(`/assets/js/${name}.js`)}"></script>`).join('\n');
}

// Navigation commune : barre latérale sur ordinateur, cinq entrées en bas sur mobile.
// Les rubriques sont partagées avec le menu « Plus » : une seule liste de destinations.
const ADMIN_NAV_LINKS = [
  { key: 'dashboard', perm: 'members.read', href: '/admin/dashboard', label: 'Vue d’ensemble', short: 'Accueil', icon: 'dashboard', mobile: 1 },
  // « À traiter » (2026-11-10) : dans la barre du haut et dans la barre du bas du mobile. Barre du bas : Accueil, À
  // traiter, Inscriptions, Adhérents (toujours visibles, demande de l'utilisateur), puis « Plus ».
  { key: 'a-traiter', perm: 'members.read', href: '/admin/a-traiter', label: 'À traiter', short: 'À traiter', icon: 'check', mobile: 2 },
  { key: 'inscriptions', perm: 'members.read', href: '/admin/inscriptions', label: 'Inscriptions', short: 'Inscriptions', icon: 'file', mobile: 3,
    badgeLabel: (n) => `${n} dossier${n > 1 ? 's' : ''} à vérifier` },
  { key: 'adherents', perm: 'members.read', href: '/admin/adherents', label: 'Adhérents', short: 'Adhérents', icon: 'users', mobile: 4 },
  { key: 'preinscriptions', perm: 'members.read', href: '/admin/preinscriptions', label: 'Pré-inscriptions', icon: 'plus' },
  { key: 'reinscription', perm: 'members.read', href: '/admin/reinscription', label: 'Réinscription', icon: 'refresh' },
  { key: 'archive', perm: 'members.read', href: '/admin/inscriptions?view=archive', label: 'Corbeille', icon: 'trash' },
  { key: 'events', perm: 'sport.manage', href: '/admin/events', label: 'Événements', icon: 'activity' },
  // Newsletter (2026-11-13) : un texte envoyé à toutes les familles, avec lien de désinscription.
  { key: 'newsletter', perm: 'communication.manage', href: '/admin/newsletter', label: 'Newsletter', icon: 'mail' },
  { key: 'email', perm: 'communication.manage', href: '/admin/email', label: 'Écrire un e-mail', icon: 'send' },
  // Éducateurs (2026-11-12) : fiches remplies par les encadrants eux-mêmes ; raccourci sur le tableau de bord.
  { key: 'educateurs', perm: 'sport.manage', href: '/admin/educateurs', label: 'Éducateurs', icon: 'user' },
  { key: 'categories', perm: 'sport.manage', href: '/admin/categories', label: 'Catégories', icon: 'tag' },
  // Import de l'export des paiements HelloAsso (2026-11-13) : échéances, paiements en ligne et Tap to pay.
  { key: 'parametres', perm: 'settings.manage', href: '/admin/parametres', label: 'Paramètres', icon: 'settings' },
  // Comptes nominatifs du bureau (lot 1 Licyo, 2026-11-16) : président seulement.
  { key: 'comptes', perm: 'club.admin', href: '/admin/comptes', label: 'Comptes du bureau', icon: 'lock' },
];

// Rubriques (2026-11-13, refonte « boîte de traitement ») : on arrive sur « À traiter » ; la saison se lit dans l'ordre
// du parcours d'un enfant (pré-inscription, inscription, réinscription, adhérent). Paramètres et Corbeille en pied de barre.
const ADMIN_NAV_GROUPS = [
  { label: 'Aujourd’hui', keys: ['a-traiter', 'dashboard'] },
  { label: 'Saison', keys: ['preinscriptions', 'inscriptions', 'reinscription', 'adherents'] },
  { label: 'Club', keys: ['educateurs', 'categories'] },
  { label: 'Communication', keys: ['newsletter', 'email', 'events'] },
];
const ADMIN_NAV_FOOT = ['comptes', 'parametres', 'archive'];

// Pastilles de compteur des onglets (2026-10-09) : nombre de dossiers signés à vérifier (fiches actives de
// l'organisation de la session), sur l'onglet Inscriptions. Une seule requête COUNT, même règle que
// dossierStatus() === 'a_verifier'. Appelée par chaque page admin avant adminShell (qui reste synchrone) ;
// une erreur ne casse jamais la page : pas de pastille.
export async function adminBadges(env, admin) {
  try {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM inscriptions
       WHERE organization_id = ? AND archived_at IS NULL AND dossier_uploaded_at IS NOT NULL
         AND (dossier_status IS NULL OR dossier_status NOT IN ('valide', 'refuse'))`
    )
      .bind(admin.organizationId)
      .first();
    const n = Number(row?.n) || 0;
    return { ...(n > 0 ? { inscriptions: n } : {}), ...viewerEntry(admin) };
  } catch {
    return viewerEntry(admin);
  }
}

// Qui consulte (rôle, pour masquer les rubriques non permises ; le serveur vérifie de toute façon, voir
// admin-permissions.js). Sans rôle connu (appelant qui ne passe que l'organisation) : rien n'est masqué.
const viewerOf = (admin) => (admin?.role ? { role: admin.role, name: admin.name, shared: admin.shared } : null);
const viewerEntry = (admin) => (viewerOf(admin) ? { viewer: viewerOf(admin) } : {});
const allowedLink = (link, badges) => !link.perm || !badges?.viewer || can(badges.viewer, link.perm);

// Pastille d'un onglet : chiffre visible (plafonné à « 9+ »), phrase complète pour les lecteurs d'écran.
function navBadge(link, badges) {
  const n = Number(badges?.[link.key]) || 0;
  if (!Number.isFinite(n) || n <= 0 || !link.badgeLabel) return { dot: '', text: '' };
  const count = Math.floor(n);
  return {
    dot: `<span class="adm-badge" aria-hidden="true">${count > 9 ? '9+' : count}</span>`,
    text: `<span class="visually-hidden"> (${link.badgeLabel(count)})</span>`,
  };
}

// Bandeau commun (navigation + titre de page). title/eyebrow/subtitle/meta/lead/actions sont du HTML
// déjà échappé par l'appelant ; stats = [{ value, label }] (valeurs calculées, jamais saisies).
export function adminShell({ active, eyebrow = '', title, subtitle = '', stats = [], actions = '', back = null, lead = '', meta = '', badges = {} }) {
  const current = (key) => (key === active ? ' is-active" aria-current="page' : '');
  const navLink = (l) => {
    const badge = navBadge(l, badges);
    return `<a href="${l.href}" class="adm-nav-link${current(l.key)}" data-nav-label="${l.label}">${icon(l.icon)}<span>${l.label}${badge.text}</span>${badge.dot}</a>`;
  };
  const navGroups = (mobile = false) => ADMIN_NAV_GROUPS.map((group) => {
    const links = group.keys.map((key) => ADMIN_NAV_LINKS.find((l) => l.key === key)).filter((l) => (!mobile || !l.mobile) && allowedLink(l, badges));
    return links.length ? `<div class="adm-nav-section"><p class="adm-nav-label">${group.label}</p>${links.map(navLink).join('')}</div>` : '';
  }).join('');
  const footLinks = ADMIN_NAV_FOOT.map((key) => ADMIN_NAV_LINKS.find((l) => l.key === key)).filter((l) => allowedLink(l, badges)).map(navLink).join('');
  const mobileLinks = ADMIN_NAV_LINKS.filter((l) => l.mobile && allowedLink(l, badges))
    .sort((a, b) => a.mobile - b.mobile)
    .map((l) => {
      const badge = navBadge(l, badges);
      return `<a href="${l.href}" class="adm-tabbar-link${current(l.key)}"><span class="adm-tabbar-ico">${icon(l.icon)}${badge.dot}</span><span>${l.short}</span>${badge.text}</a>`;
    })
    .join('');
  const moreLinks = ADMIN_NAV_LINKS.filter((l) => !l.mobile && allowedLink(l, badges));
  const moreActive = moreLinks.some((l) => l.key === active);

  // La barre du haut est hors du bandeau pour rester collée en haut au défilement (.adm-hero a un
  // overflow: hidden, qui empêcherait position: sticky de fonctionner à l'intérieur).
  return `<a href="#adm-main" class="skip-link">Aller au contenu</a>
<aside class="adm-sidebar" id="adm-sidebar">
  <div class="adm-sidebar-head">
    <a href="/admin/a-traiter" class="adm-sidebar-brand" aria-label="Club Exemple — À traiter">
      <img src="/assets/images/logo-96.webp" alt="" width="40" height="40">
      <span><strong>Club Exemple</strong><small>Gestion du club</small></span>
    </a>
    <button class="adm-sidebar-toggle" type="button" aria-controls="adm-sidebar" aria-expanded="true" aria-label="Replier la barre latérale" title="Replier la barre latérale" hidden>${icon('arrowLeft')}</button>
  </div>
  <nav class="adm-sidebar-nav" aria-label="Navigation admin">${navGroups()}</nav>
  <div class="adm-sidebar-foot">${footLinks}</div>
</aside>
<div class="adm-sidebar-tooltip" aria-hidden="true" hidden></div>
<div class="adm-topnav">
  <div class="adm-wrap adm-topbar">
    <a href="/admin/dashboard" class="adm-brand">
      <img src="/assets/images/logo-96.webp" alt="" width="40" height="40">
      <span><strong>Club Exemple</strong><small>Espace admin</small></span>
    </a>
    <form class="adm-global-search" action="/admin/recherche" method="GET" role="search" aria-label="Rechercher dans l’admin">
      <label class="visually-hidden" for="adm-global-query">Enfant, parent, éducateur, e-mail ou téléphone</label>
      <input id="adm-global-query" type="search" name="q" placeholder="Enfant, parent, éducateur…" minlength="2" maxlength="200" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="adm-global-suggest">
      <div class="adm-suggest" id="adm-global-suggest" role="listbox" aria-label="Suggestions" hidden></div>
      <button type="submit" aria-label="Rechercher">${icon('search')}</button>
    </form>
    <a href="/admin/recherche" class="adm-logout adm-find-link${active === 'recherche' ? ' is-active' : ''}" title="Rechercher">${icon('search')}<span class="visually-hidden">Rechercher</span></a>
    <a href="/admin/logout" class="adm-logout" title="Déconnexion">${icon('logout')}<span class="visually-hidden">Déconnexion</span></a>
  </div>
</div>
<header class="adm-hero">
  <div class="adm-wrap">
    <div class="adm-hero-main">
      <div class="adm-hero-heading">
        ${lead}
        <div class="adm-hero-text">
          ${back ? `<a href="${back.href}" class="adm-back">${icon('arrowLeft')}${escapeHtml(back.label)}</a>` : ''}
          ${eyebrow ? `<p class="adm-eyebrow">${eyebrow}</p>` : ''}
          <h1>${title}</h1>
          ${subtitle ? `<p class="adm-hero-sub">${subtitle}</p>` : ''}
          ${meta}
        </div>
      </div>
      ${actions ? `<div class="adm-hero-actions">${actions}</div>` : ''}
    </div>
    ${stats.length ? `<div class="adm-stats">${stats.map((s) => `<div class="adm-stat"><strong>${s.value}</strong><span>${s.label}</span></div>`).join('')}</div>` : ''}
  </div>
</header>
<nav class="adm-tabbar" aria-label="Navigation mobile">
  ${mobileLinks}
  <details class="adm-more" data-dismiss>
    <summary class="adm-tabbar-link${moreActive ? ' is-active' : ''}">${icon('more')}<span>Plus</span></summary>
    <div class="adm-more-menu">
      ${navGroups(true)}
      <div class="adm-more-foot">${footLinks}<a href="/admin/logout">${icon('logout')}Déconnexion</a></div>
    </div>
  </details>
</nav>`;
}

export function loginPage({ error } = {}) {
  return `${adminHead('Connexion', 'adm adm-login-body')}
<main class="adm-login">
  <form method="POST" action="/admin/inscriptions" class="adm-login-card">
    <img src="/assets/images/logo-96.webp" alt="Blason du Club Exemple" width="72" height="72">
    <p class="adm-eyebrow">Espace admin</p>
    <h1>Connexion</h1>
    ${error ? flash('error', typeof error === 'string' ? error : 'Mot de passe incorrect.') : ''}
    <div id="login-inactif" hidden>${flash('info', 'Vous avez été déconnecté après 30 minutes d’inactivité.')}</div>
    <div class="form-field">
      <label for="email">Adresse e-mail</label>
      <input type="email" id="email" name="email" autocomplete="username" autocapitalize="off" spellcheck="false" inputmode="email" maxlength="200" autofocus>
    </div>
    <div class="form-field">
      <label for="password">Mot de passe</label>
      <div class="adm-password">
        <input type="password" id="password" name="password" autocomplete="current-password" autocapitalize="off" spellcheck="false" required>
        <button type="button" class="adm-password-toggle" data-password-toggle="password" aria-pressed="false" aria-label="Afficher le mot de passe" hidden>${icon('eye')}</button>
      </div>
    </div>
    <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('lock')}Se connecter</button>
    <p class="adm-help" style="margin-top:12px;">Mot de passe commun du club : laissez l’adresse vide. Chaque membre du bureau peut avoir son propre compte, sur invitation du président.</p>
  </form>
</main>
${adminScripts('admin-login')}
</body></html>`;
}

// Boutons d'un responsable (fiches Inscription et Adhérent, 2026-10-09) : « E-mail » sur ordinateur et sur mobile, qui
// ouvre l'écriture dans l'admin (/admin/email, envoi depuis contact@) adressée à ce seul responsable ; « Appeler »
// seulement sur un appareil tactile (.adm-touch-only, fin d'admin.css). inscriptionId : fiche dont vient l'adresse
// (sans elle, pas de bouton E-mail). name (texte brut) est lu par les lecteurs d'écran pour distinguer deux responsables.
// Numéro au format international sans « + » (33612345678), pour wa.me, tel: et sms: ; null si non reconnu.
// Numéros français à 10 chiffres (06…), +33 / 0033 (avec ou sans le 0), ou tout numéro international en + / 00.
export function internationalPhone(phone) {
  const d = String(phone || '').replace(/[^\d+]/g, '');
  let m = /^0([1-9]\d{8})$/.exec(d);
  if (m) return `33${m[1]}`;
  m = /^(?:\+|00)330?([1-9]\d{8})$/.exec(d);
  if (m) return `33${m[1]}`;
  m = /^(?:\+|00)([1-9]\d{8,14})$/.exec(d);
  return m ? m[1] : null;
}

// Liens d'un numéro (2026-11-04, demande de l'utilisateur) : deux boutons séparés, sur mobile ET ordinateur :
// « Appel » (tel:) et « Message » (wa.me, sans logo ni nom de marque) ; l'appareil propose l'application à ouvrir
// (une seule fois ou toujours). « SMS » en plus sur appareil tactile, sur les fiches seulement (sms).
export function phoneLinks(phone, who = '', { sms = false } = {}) {
  const intl = internationalPhone(phone);
  const tel = intl ? `+${intl}` : String(phone || '').replace(/[^\d+]/g, '');
  if (!tel) return [];
  return [
    `<a class="adm-btn adm-btn-ghost" href="tel:${escapeHtml(tel)}">${icon('phone')}Appel${who}</a>`,
    sms ? `<a class="adm-btn adm-btn-ghost adm-touch-only" href="sms:${escapeHtml(tel)}">${icon('sms')}SMS${who}</a>` : '',
    intl ? `<a class="adm-btn adm-btn-ghost adm-wa" href="https://wa.me/${intl}" target="_blank" rel="noopener">${icon('sms')}Message${who}</a>` : '',
  ].filter(Boolean);
}

export function contactActions({ phone, email, name = '', inscriptionId = null }) {
  const who = name ? `<span class="visually-hidden"> ${escapeHtml(name)}</span>` : '';
  const write = email && inscriptionId ? `/admin/email?inscription=${Number(inscriptionId)}&destinataire=${encodeURIComponent(email)}` : '';
  const phones = phoneLinks(phone, who, { sms: true });
  const links = [...phones, write ? `<a class="adm-btn adm-btn-ghost" href="${escapeHtml(write)}">${icon('mail')}E-mail${who}</a>` : ''].filter(Boolean);
  return links.length ? `<div class="adm-card-actions adm-contact-actions">${links.join('')}</div>` : '';
}

// Boutons d'une carte de liste (Inscriptions, Adhérents) : « Appel » et « Message » au premier responsable et
// « E-mail » à toute la famille de la fiche, écrit depuis l'admin (mobile et ordinateur). child : nom de l'enfant (texte
// brut), lu par les lecteurs d'écran.
export function familyActions({ phone, inscriptionId, child = '' }) {
  if (!inscriptionId) return '';
  const who = child ? `<span class="visually-hidden"> (famille de ${escapeHtml(child)})</span>` : '';
  return `<div class="adm-card-actions adm-contact-actions">
      ${phoneLinks(phone, who).join('')}
      <a class="adm-btn adm-btn-ghost" href="/admin/email?inscription=${Number(inscriptionId)}">${icon('mail')}E-mail${who}</a>
    </div>`;
}

// type : 'ok' | 'error' | 'info' — message en texte brut, échappé ici.
export function flash(type, message) {
  return `<p class="adm-flash adm-flash-${type}" role="${type === 'error' ? 'alert' : 'status'}">${icon(type === 'error' ? 'alert' : type === 'info' ? 'calendar' : 'check')}<span>${escapeHtml(message)}</span></p>`;
}

// noTone : 'no' (orange, un problème à régler) ou 'neutral' (gris, simplement rien reçu pour l'instant).
export function statusTag(ok, { yes = 'Validé', no = 'Non validé', noTone = 'no' } = {}) {
  return ok ? `<span class="adm-tag is-yes">${icon('check')}${yes}</span>` : `<span class="adm-tag is-${noTone}">${no}</span>`;
}

// Statuts des étapes d'une inscription. Rien reçu = gris ; l'orange/rouge est réservé à ce qui demande une
// action du club (dossier à vérifier, refusé).
export const PHOTO_TAG = { yes: 'Reçue', no: 'Non reçue', noTone: 'neutral' };
export const PAIEMENT_TAG = { yes: 'Payé', no: 'Non payé', noTone: 'neutral' };
// Photo : reçue, à refaire (demandée par le club, orange), ou pas encore reçue (gris).
export function photoTag(row) {
  if (row.photo_uploaded_at) return statusTag(true, PHOTO_TAG);
  if (row.photo_refused_at) return `<span class="adm-tag is-no">${icon('alert')}À refaire</span>`;
  return statusTag(false, PHOTO_TAG);
}

// Dossier signé : quatre états (voir dossierStatus dans _shared/inscriptions-db.js).
// Champs « pourquoi à la corbeille ? » (fiche et sélection multiple de /admin/inscriptions), lus par
// readArchiveReason(). Le choix est obligatoire ; la précision l'est aussi pour « Autre » (vérifié côté
// serveur, et par assets/js/admin-inscriptions.js avant l'envoi).
export function archiveReasonFields(prefix) {
  return `<fieldset class="adm-archive-motifs">
            <legend>Pourquoi mettre à la corbeille ?</legend>
            ${ARCHIVE_MOTIFS_MANUELS.map(
              (key, i) =>
                `<label class="adm-check"><input type="radio" name="archiveMotif" value="${key}"${i === 0 ? ' required' : ''}><span>${escapeHtml(ARCHIVE_MOTIFS[key])}</span></label>`
            ).join('')}
          </fieldset>
          <label class="adm-field" for="${prefix}-archive-commentaire">Précision <small>(obligatoire pour « Autre »)</small>
            <textarea id="${prefix}-archive-commentaire" name="archiveCommentaire" rows="2" maxlength="300" placeholder="Ex. : déménagement, inscrit dans un autre club…"></textarea>
          </label>`;
}

export function dossierTag(row) {
  return {
    valide: `<span class="adm-tag is-yes">${icon('check')}Validé</span>`,
    a_verifier: `<span class="adm-tag is-wait">${icon('eye')}À vérifier</span>`,
    refuse: `<span class="adm-tag is-no">${icon('alert')}Refusé</span>`,
    manquant: '<span class="adm-tag is-neutral">Non reçu</span>',
  }[dossierStatus(row)];
}

// Photo de l'enfant si elle a été déposée (functions/admin/inscriptions/[id]/photo.js), sinon ses
// initiales sur un fond choisi d'après l'id : chaque fiche garde la même couleur d'une page à
// l'autre, ce qui aide à la repérer dans la liste.
export function avatar(row, size = '') {
  const classes = `adm-avatar adm-tone-${Math.abs(Number(row.id) || 0) % 5}${size ? ` adm-avatar-${size}` : ''}`;
  if (row.photo_uploaded_at) {
    return `<img class="${classes} adm-avatar-photo" src="/admin/inscriptions/${row.id}/photo?v=${encodeURIComponent(row.photo_uploaded_at)}" alt="" loading="lazy">`;
  }
  const initials = `${String(row.enfant_prenom || '').trim().charAt(0)}${String(row.enfant_nom || '').trim().charAt(0)}`.toUpperCase() || '?';
  return `<span class="${classes}" aria-hidden="true">${escapeHtml(initials)}</span>`;
}

// `datetime('now')` (SQLite) renvoie "YYYY-MM-DD HH:MM:SS" en UTC, sans "T" ni "Z".
export function formatDateFr(sqliteDatetime, options = { day: 'numeric', month: 'short' }) {
  if (!sqliteDatetime) return '';
  try {
    return escapeHtml(
      new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'Europe/Paris' }).format(new Date(`${String(sqliteDatetime).replace(' ', 'T')}Z`))
    );
  } catch {
    return escapeHtml(sqliteDatetime);
  }
}

export const formatBirth = (iso) => escapeHtml(/^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso.split('-').reverse().join('/') : iso || '—');

// Catégorie d'un enfant dans les sous-titres de l'admin : la catégorie d'après la naissance (ageGroup) en gras, puis
// la catégorie saisie à l'inscription seulement si elle diffère (enfant à changer de groupe, ancienne saison).
export function ageAndCategory(age, categorie) {
  const saisie = String(categorie || '').trim();
  if (!age) return escapeHtml(saisie);
  const same = (x) => x.toLowerCase().replace(/[\s‐-―-]+/g, '');
  return !saisie || same(age) === same(saisie) ? `<strong>${escapeHtml(age)}</strong>` : `<strong>${escapeHtml(age)}</strong> · ${escapeHtml(saisie)}`;
}
