// Droits par rôle sur tout l'espace /admin (lot 1 Licyo, 2026-11-16), vérifiés à UN SEUL endroit : le middleware
// functions/admin/_middleware.js, avant chaque page. Une route nouvelle sans règle est refusée à tous sauf au
// président (refus par défaut) : ajouter sa règle ici.
//
// Lecture (GET) et écriture (POST) peuvent demander des permissions différentes ; sur les fiches d'inscription,
// l'action envoyée par le formulaire décide (paiements → finance.write, le reste → members.write).
import { isAuthed, adminHead, escapeHtml } from './admin-auth.js';
import { can } from './admin-users.js';

// Actions de paiement des fiches et de la liste des inscriptions : réservées à finance.write.
const FINANCE_ACTIONS = new Set([
  'cheque-encaisse', 'cheques', 'exemption', 'exemption-retrait', 'passsport-deduire',
  'versement', 'versement-correction', 'versement-modification', 'versement-suppression', 'toggle-paye',
]);
// Actions sans effet (export) : la lecture suffit.
const READ_ACTIONS = new Set(['bulk-export']);

const membersWrite = (action) => (FINANCE_ACTIONS.has(action) ? 'finance.write' : READ_ACTIONS.has(action) ? 'members.read' : 'members.write');

// [préfixe, permission en lecture, permission (ou fonction de l'action) en écriture]. Le préfixe le plus long gagne.
const RULES = [
  ['/admin/session', null, null],
  ['/admin/logout', null, null],
  ['/admin/invitation/', null, null],
  ['/admin/comptes', 'club.admin', 'club.admin'],
  // Le mot de passe commun du club donne les droits du président : seul un président le change.
  ['/admin/parametres', 'settings.manage', (action) => (action.startsWith('password') ? 'club.admin' : 'settings.manage')],
  ['/admin/inscription-status', 'members.read', 'settings.manage'],
  ['/admin/helloasso', 'finance.read', 'finance.write'],
  ['/admin/newsletter', 'communication.manage', 'communication.manage'],
  ['/admin/email', 'communication.manage', 'communication.manage'],
  ['/admin/educateurs', 'sport.manage', 'sport.manage'],
  ['/admin/categories', 'sport.manage', 'sport.manage'],
  ['/admin/events', 'sport.manage', 'sport.manage'],
  ['/admin/inscriptions', 'members.read', membersWrite],
  ['/admin/adherents', 'members.read', 'members.write'],
  ['/admin/contacts', 'members.read', 'members.write'],
  ['/admin/preinscriptions', 'members.read', 'members.write'],
  ['/admin/reinscription', 'members.read', 'members.write'],
  ['/admin/a-traiter', 'members.read', 'members.write'],
  ['/admin/dashboard', 'members.read', 'members.write'],
  ['/admin/recherche', 'members.read', 'members.read'],
].sort((a, b) => b[0].length - a[0].length);

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// Permission demandée par une requête, null si aucune (pages ouvertes : session, déconnexion, invitation) ;
// 'club.admin' pour une route inconnue (seul le président y accède).
export function requiredPermission(method, pathname, action = '') {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/admin') return null; // simple redirection vers la page d'arrivée
  const rule = RULES.find(([prefix]) => {
    const base = prefix.replace(/\/$/, '');
    return path === base || path.startsWith(`${base}/`);
  });
  if (!rule) return 'club.admin';
  const [, read, write] = rule;
  if (SAFE.has(method.toUpperCase())) return read;
  return typeof write === 'function' ? write(String(action || '')) : write;
}

async function submittedAction(request) {
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return '';
  try {
    return String((await request.clone().formData()).get('action') || '');
  } catch {
    return '';
  }
}

export function forbiddenPage(admin) {
  return `${adminHead('Accès refusé')}
<main class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h1 class="adm-h2">Accès réservé</h1>
    <p class="adm-help" style="margin-top:8px;">Votre rôle${admin?.name ? ` (${escapeHtml(admin.name)})` : ''} ne permet pas cette action. Rien n’a été modifié. Demandez à un président du club si vous en avez besoin.</p>
    <p style="margin-top:16px;"><a class="adm-btn adm-btn-primary" href="/admin/a-traiter">Revenir à l’espace admin</a></p>
  </section>
</main>
</body></html>`;
}

// Middleware : sans session, la page s'en charge (écran de connexion). Avec session, la permission est exigée.
export async function adminPermissionMiddleware({ request, env, next }) {
  const url = new URL(request.url);
  const admin = await isAuthed(request, env, { touch: false });
  if (!admin) return next();
  const action = SAFE.has(request.method.toUpperCase()) ? '' : await submittedAction(request);
  const permission = requiredPermission(request.method, url.pathname, action);
  if (permission && !can(admin, permission)) {
    return new Response(forbiddenPage(admin), { status: 403, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
  }
  return next();
}
