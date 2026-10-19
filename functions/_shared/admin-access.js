// Contrôle des permissions par route dans l'espace admin (phase 3, 2026-10-20), appliqué par
// functions/admin/_middleware.js à TOUTES les routes /admin/*, après le contrôle CSRF :
//
// 1. Permission : chaque route (et, pour les envois de formulaire, chaque action) exige une permission de
//    accounts.js. Sans elle : page 403, rien n'est lu ni modifié. Les pages restent responsables de filtrer par
//    organisation (admin.organizationId) ; ici on ne décide que « ce rôle a-t-il le droit d'ouvrir cette page ».
// 2. Navigation : dans les pages HTML renvoyées, les liens vers des pages interdites au rôle sont retirés (onglets,
//    menu « Plus », raccourcis du tableau de bord), et le menu du compte (nom, rôle) est inséré dans la barre du haut.
// 3. Journal d'audit : chaque envoi de formulaire accepté (statut < 400) est noté (chemin, action, compte), sans
//    aucun contenu de formulaire.
//
// Routes sans session (connexion, mot de passe oublié, invitation, premier accès) : laissées aux handlers.
import { isAuthed, escapeHtml, icon } from './admin-auth.js';
import { logAudit } from './accounts.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Pages ouvertes à tout compte connecté du club (et pages publiques de l'admin).
const OPEN = [/^\/admin\/?$/, /^\/admin\/(index\.html|config\.yml)$/, /^\/admin\/(dashboard|compte|session|logout)$/, /^\/admin\/(invitation|reinitialiser)\//, /^\/admin\/(mot-de-passe-oublie|premier-acces)$/];

// Actions de formulaire qui demandent une permission différente de celle de la page (POST sur /admin/inscriptions…).
const ACTION_PERMISSIONS = { 'toggle-paye': 'finance.write' };

// Permission exigée pour une requête, ou null si la page est ouverte à tout compte connecté.
export function requiredPermission(method, pathname, action = null) {
  const path = pathname.replace(/\/+$/, '') || '/admin';
  if (OPEN.some((re) => re.test(path))) return null;
  const write = !SAFE_METHODS.has(method.toUpperCase());
  if (path.startsWith('/admin/utilisateurs')) return 'users.manage';
  if (path === '/admin/journal') return 'users.manage';
  if (path.startsWith('/admin/parametres') || path.startsWith('/admin/categories') || path === '/admin/inscription-status') return 'settings.manage';
  if (path.startsWith('/admin/email')) return 'emails.send';
  if (/^\/admin\/(inscriptions|adherents|contacts|preinscriptions|reinscription|events)(\/|$)/.test(path)) {
    if (!write) return 'inscriptions.read';
    return ACTION_PERMISSIONS[action] || 'inscriptions.write';
  }
  // Toute autre route admin (future) : réservée aux comptes qui gèrent les paramètres, par prudence.
  return 'settings.manage';
}

async function formAction(request) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return null;
  try {
    const value = (await request.clone().formData()).get('action');
    return typeof value === 'string' ? value.slice(0, 60) : null;
  } catch {
    return null;
  }
}

export function forbiddenAdminPage(admin) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Accès réservé</title>
<link rel="stylesheet" href="/assets/css/admin.css"></head>
<body class="adm adm-login-body"><main class="adm-login"><div class="adm-login-card">
<p class="adm-eyebrow">Espace admin</p>
<h1>Accès réservé</h1>
<p>Votre rôle (${escapeHtml(admin?.roleLabel || '')}) ne donne pas accès à cette page. Demandez à un responsable du club si vous en avez besoin.</p>
<p><a class="adm-btn adm-btn-primary adm-btn-block" href="/admin/dashboard">Retour au tableau de bord</a></p>
</div></main></body></html>`;
  return new Response(html, { status: 403, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
}

// Retire de la page les liens <a href="/admin/..."> interdits au rôle (le contenu d'un lien ne contient jamais d'autre
// lien : un remplacement non gourmand suffit).
export function hideForbiddenLinks(html, admin) {
  return html.replace(/<a\b[^>]*\bhref="(\/admin\/[^"#]*)"[^>]*>[\s\S]*?<\/a>/g, (link, href) => {
    const path = href.split('?')[0];
    const permission = requiredPermission('GET', path);
    return !permission || admin.permissions.includes(permission) ? link : '';
  });
}

export function accountMenu(admin) {
  const name = admin.user?.name || admin.user?.email || 'Mon compte';
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  return `<a href="/admin/compte" class="adm-account" title="Mon compte : ${escapeHtml(name)} (${escapeHtml(admin.roleLabel)})">
      <span class="adm-account-avatar" aria-hidden="true">${escapeHtml(initials)}</span>
      <span class="adm-account-text"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(admin.roleLabel)}</small></span>
    </a>`;
}

export function decorateAdminHtml(html, admin) {
  let out = hideForbiddenLinks(html, admin);
  out = out.replace('<!--adm-account-->', accountMenu(admin));
  out = out.replace('<!--adm-account-more-->', `<a href="/admin/compte">${icon('user')}Mon compte</a>`);
  return out;
}

export async function adminAccessMiddleware({ request, env, next }) {
  const url = new URL(request.url);
  const admin = await isAuthed(request, env, { touch: false }).catch(() => null);
  if (!admin) return next(); // non connecté : la page affiche la connexion (ou est publique)

  const write = !SAFE_METHODS.has(request.method.toUpperCase());
  const action = write ? await formAction(request) : null;
  const permission = requiredPermission(request.method, url.pathname, action);
  if (permission && !admin.permissions.includes(permission)) return forbiddenAdminPage(admin);

  const response = await next();
  if (write && response.status < 400) {
    await logAudit(env.DB, admin.organizationId, { userId: admin.userId, action: `${url.pathname}${action ? `:${action}` : ''}` });
  }
  if (!(response.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) return response;
  const html = decorateAdminHtml(await response.text(), admin);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
