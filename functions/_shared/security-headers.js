// En-têtes de sécurité sur les réponses des Functions (2026-10-16, après l'audit de sécurité) : Cloudflare Pages
// n'applique _headers qu'aux fichiers statiques, pas aux pages produites par les Functions (admin, espace famille,
// réinscription, API, pages publiques rendues). Le middleware racine ajoute donc les mêmes en-têtes à toute réponse
// qui ne les a pas déjà, et interdit la mise en cache des réponses qui portent des données personnelles.
// Les valeurs doivent rester identiques au bloc « /* » de _headers (vérifié par tests/family-links.test.mjs).
import { forbiddenPageHtml, shouldServeForbiddenPage } from './forbidden-page.js';

export const SECURITY_HEADERS = Object.freeze({
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(self "https://www.helloasso.com")',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://cdnjs.cloudflare.com https://unpkg.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://avatars.githubusercontent.com; font-src 'self' https://cdn.jsdelivr.net; media-src blob:; manifest-src 'self'; worker-src 'self' blob:; frame-src https://challenges.cloudflare.com https://www.google.com https://www.helloasso.com blob:; connect-src 'self' blob: data: https://data.geopf.fr https://geo.api.gouv.fr https://unpkg.com https://api.github.com https://cloudflareinsights.com https://static.cloudflareinsights.com; form-action 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
});

// Données personnelles : jamais en cache (navigateur, proxy, Cloudflare). Admin (fiches, photos, dossiers, exports CSV),
// espace famille, réinscription, demande de lien, API, connexion du CMS.
const PRIVATE_PREFIXES = ['/admin', '/depot/', '/reinscription/', '/espace-famille', '/api/', '/auth', '/callback'];
// Liens secrets dans l'URL : aucun référent transmis, même vers le site lui-même.
const TOKEN_PREFIXES = ['/depot/', '/reinscription/'];
// Relais OAuth du CMS (_shared/oauth-common.js) : sa page de retour exécute un script en ligne, que la CSP bloquerait.
const NO_CSP_PATHS = new Set(['/auth', '/callback']);

const startsWithAny = (path, prefixes) => prefixes.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p));

export function isPrivatePath(pathname) {
  return startsWithAny(pathname, PRIVATE_PREFIXES);
}

export function withSecurityHeaders(request, response) {
  if (!response || response.status === 101 || response.webSocket) return response;
  // 403 en texte brut vu par un navigateur : page « Erreur 403 » aux couleurs du club (forbidden-page.js).
  if (shouldServeForbiddenPage(request, response)) {
    response = new Response(forbiddenPageHtml(), { status: 403, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });
  }
  const { pathname } = new URL(request.url);
  const headers = new Headers(response.headers);
  let changed = false;
  const set = (name, value, force = false) => {
    if (!force && headers.has(name)) return;
    headers.set(name, value);
    changed = true;
  };
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === 'Content-Security-Policy' && NO_CSP_PATHS.has(pathname)) continue;
    set(name, value);
  }
  if (isPrivatePath(pathname)) {
    // Remplace toute valeur plus permissive (ex. photo en cache privé 24 h).
    if (headers.get('Cache-Control') !== 'no-store') set('Cache-Control', 'no-store', true);
    if (startsWithAny(pathname, TOKEN_PREFIXES) && headers.get('Referrer-Policy') !== 'no-referrer') set('Referrer-Policy', 'no-referrer', true);
  }
  if (!changed) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
