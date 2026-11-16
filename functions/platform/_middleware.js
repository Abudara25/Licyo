// Garde de toute la console fondateur (/platform/*), dans l'ordre :
// 1. hôte autorisé (PLATFORM_HOSTNAMES ou local), sinon 404 neutre : la console n'existe pas sur les domaines des clubs ;
// 2. CSRF : origine vérifiée pour tout envoi, jeton dérivé de la session exigé dès qu'une session existe ;
// 3. session obligatoire hors connexion, invitation et démarrage ;
// 4. permission du rôle pour la route et la méthode (refus par défaut : route inconnue = propriétaire seulement).
// L'opérateur vérifié est transmis aux pages dans context.data.operator.
import {
  platformHostAllowed,
  checkPlatformCsrf,
  platformOperator,
  canPlatform,
  platformCsrfToken,
  injectPlatformCsrf,
} from '../_shared/platform-auth.js';
import { platformAuthPage } from '../_shared/platform-ui/shell.js';

const OPEN = new Set(['/platform/connexion', '/platform/deconnexion', '/platform/demarrage']);
const isOpen = (path) => OPEN.has(path) || path.startsWith('/platform/invitation/');

// [préfixe, permission en lecture, permission en écriture (ou fonction de l'action)].
const RULES = [
  ['/platform/organisations/nouvelle', 'orgs.create', 'orgs.create'],
  ['/platform/organisations/', 'platform.read', (action) => (action === 'president-invite' ? 'orgs.support' : 'orgs.manage')],
  ['/platform/organisations', 'platform.read', 'orgs.manage'],
  ['/platform/domaines', 'platform.read', 'orgs.manage'],
  ['/platform/journal', 'audit.read', 'audit.read'],
  ['/platform/equipe', 'team.manage', 'team.manage'],
];

export function platformPermission(method, path, action = '') {
  const clean = path.replace(/\/+$/, '') || '/';
  if (clean === '/platform') return 'platform.read';
  const rule = RULES.find(([prefix]) => (prefix.endsWith('/') ? clean.startsWith(prefix) : clean === prefix || clean.startsWith(`${prefix}/`)));
  if (!rule) return 'team.manage';
  const write = rule[2];
  if (['GET', 'HEAD'].includes(method.toUpperCase())) return rule[1];
  return typeof write === 'function' ? write(action) : write;
}

const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store' } });
const htmlResponse = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });

async function submittedAction(request) {
  try {
    return String((await request.clone().formData()).get('action') || '');
  } catch {
    return '';
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!platformHostAllowed(request, env)) return text('Page introuvable', 404);
  if (!(await checkPlatformCsrf(request))) return text('Requête refusée : rechargez la page puis recommencez. Rien n’a été modifié.', 403);
  const path = new URL(request.url).pathname;
  if (!isOpen(path)) {
    const operator = await platformOperator(request, env);
    if (!operator) {
      if (request.method.toUpperCase() !== 'GET') return text('Session expirée : reconnectez-vous.', 401);
      return new Response('', { status: 303, headers: { Location: '/platform/connexion', 'Cache-Control': 'no-store' } });
    }
    const action = ['GET', 'HEAD'].includes(request.method.toUpperCase()) ? '' : await submittedAction(request);
    const permission = platformPermission(request.method, path, action);
    if (!canPlatform(operator, permission)) {
      return htmlResponse(
        platformAuthPage({ title: 'Accès réservé', content: '<h1>Accès réservé</h1><p class="lead">Votre rôle ne permet pas cette action. Rien n’a été modifié.</p><a class="btn btn-secondary btn-block" href="/platform">Revenir au tableau de bord</a>' }),
        403
      );
    }
    context.data = { ...(context.data || {}), operator };
  }
  const response = await context.next();
  const token = await platformCsrfToken(request);
  if (!token || !(response.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) return response;
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(injectPlatformCsrf(await response.text(), token), { status: response.status, headers });
}
