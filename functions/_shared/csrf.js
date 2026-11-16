// Protection CSRF de l'espace admin (phase 4B), appliquée par functions/admin/_middleware.js à TOUTES les
// routes /admin/*, sans que chaque handler ait à y penser :
//
// 1. Origine : toute requête qui modifie (POST, PUT, PATCH, DELETE) doit venir de la même origine
//    (isSameOrigin, security.js). S'applique aussi à la connexion (pas de connexion forcée depuis un autre site).
// 2. Jeton : dès que la requête porte un cookie de session admin, le formulaire doit renvoyer le jeton
//    `_csrf` (ou l'en-tête X-CSRF-Token). Le jeton est DÉRIVÉ du jeton de session (empreinte SHA-256
//    préfixée) : rien à stocker, aucune migration, il change à chaque connexion et meurt avec la session.
//    Un autre site ne peut pas le lire (même politique d'origine) ni le calculer (il faudrait le cookie).
//    Il est ajouté côté serveur à chaque <form method="post"> des pages HTML de l'admin (injectCsrfField).
//    Sans cookie de session (formulaire de connexion), le contrôle d'origine suffit : sans session, aucune
//    action authentifiée n'est possible.
//
// Limite connue : un onglet ouvert AVANT la mise en ligne de cette protection n'a pas le jeton ; son envoi
// est refusé avec un message invitant à recharger la page (rien n'est modifié).
import { sha256Hex, timingSafeEqual, isSameOrigin, hasSameOriginSignal } from './security.js';
import { COOKIE_NAME } from './admin-auth.js';

export const CSRF_FIELD = '_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sessionToken(request) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  return match ? match[1] : null;
}

// Jeton CSRF de la session portée par la requête, ou null sans session.
export async function csrfTokenFor(request) {
  const token = sessionToken(request);
  return token ? sha256Hex(`csrf:v1:${token}`) : null;
}

// Ajoute le champ caché juste après chaque balise <form ... method="post" ...> (HTML produit par nos
// propres gabarits ; les formulaires GET ne sont pas touchés).
export function injectCsrfField(html, token) {
  if (!token) return html;
  const field = `<input type="hidden" name="${CSRF_FIELD}" value="${token}">`;
  return html.replace(/<form\b[^>]*>/gi, (tag) => (/\bmethod\s*=\s*["']?post\b/i.test(tag) ? tag + field : tag));
}

async function submittedToken(request) {
  const header = request.headers.get(CSRF_HEADER);
  if (header) return header;
  const type = (request.headers.get('Content-Type') || '').toLowerCase();
  if (!type.startsWith('application/x-www-form-urlencoded') && !type.startsWith('multipart/form-data')) return null;
  try {
    // Lecture sur une copie : le handler lit ensuite le corps d'origine, intact.
    const value = (await request.clone().formData()).get(CSRF_FIELD);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

// null si la requête est acceptable, sinon { status, reason }.
export async function checkCsrf(request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  if (!isSameOrigin(request)) return { status: 403, reason: 'origin' };
  const expected = await csrfTokenFor(request);
  if (!expected) return null;
  const submitted = await submittedToken(request);
  if (!submitted || !timingSafeEqual(submitted, expected)) return { status: 403, reason: 'token' };
  return null;
}

const MESSAGES = {
  origin: 'Requête refusée : elle ne provient pas de ce site.',
  token: 'Cette page a expiré ou a été ouverte avant une mise à jour de sécurité. Rechargez-la puis recommencez : rien n’a été modifié.',
};

export function csrfRejection({ status, reason }, { back = '/admin/inscriptions', backLabel = 'Revenir à l’espace admin' } = {}) {
  const message = MESSAGES[reason] || MESSAGES.origin;
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Requête refusée</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 24px;line-height:1.5;color:#201412">
<h1 style="font-size:1.3rem;color:#801818">Requête refusée</h1>
<p>${message}</p>
${back ? `<p><a href="${back}" style="color:#801818">${backLabel}</a></p>` : ''}
</body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
}

// Middleware Pages de /admin/* : refuse les requêtes non conformes, puis ajoute le jeton aux formulaires
// des pages HTML renvoyées.
export async function adminCsrfMiddleware({ request, next }) {
  const rejection = await checkCsrf(request);
  if (rejection) return csrfRejection(rejection);
  const response = await next();
  const token = await csrfTokenFor(request);
  if (!token || !(response.headers.get('Content-Type') || '').toLowerCase().startsWith('text/html')) return response;
  const html = injectCsrfField(await response.text(), token);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

// Middleware des pages à jeton des familles (/depot/*) : pas de session ni de jeton CSRF, donc un signal
// d'origine valide est exigé pour tout envoi (hasSameOriginSignal, security.js).
export function sameOriginMiddleware({ request, next }) {
  if (!SAFE_METHODS.has(request.method.toUpperCase()) && !hasSameOriginSignal(request)) return csrfRejection({ status: 403, reason: 'origin' }, { back: null });
  return next();
}
