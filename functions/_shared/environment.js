// Séparation production / prévisualisation / local (consolidation de la phase SaaS, 2026-09-23).
//
// Une prévisualisation Cloudflare Pages (chaque branche poussée, servie sur
// <déploiement>.licyo.pages.dev) utilise les liaisons « Preview » du projet. Si celles-ci
// pointent vers la base, le KV ou le bucket de PRODUCTION, la moindre visite d'une prévisualisation
// appliquerait les migrations et écrirait dans les données réelles. Le dépôt ne permet pas de vérifier
// la configuration du dashboard : ce garde-fou refuse donc toute Function qui touche aux données sur un
// hôte de prévisualisation, tant que la variable APP_ENV=preview n'a pas été définie pour l'environnement
// Preview (à faire APRÈS avoir lié des ressources de staging distinctes, voir CLAUDE.md).
// Production (clubdemo.licyo.fr, licyo.pages.dev) et local (localhost) ne sont pas concernés.

// <déploiement>.<projet>.pages.dev ; le domaine nu <projet>.pages.dev est celui de la production.
export const isPreviewHost = (hostname) => /\.pages\.dev$/i.test(hostname) && hostname.split('.').length > 3;

export function previewGuard(request, env) {
  const { hostname } = new URL(request.url);
  if (!isPreviewHost(hostname) || env.APP_ENV === 'preview') return null;
  return new Response(
    'Prévisualisation non isolée : les données de cette prévisualisation ne sont pas séparées de la production. ' +
      'Lier des ressources de staging (D1, KV, R2) à l’environnement Preview puis définir APP_ENV=preview.',
    { status: 503, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store' } }
  );
}

// Middleware Pages (functions/<dossier>/_middleware.js) : placé dans les dossiers qui touchent aux données
// seulement, pour que les pages statiques du site ne déclenchent pas de Function à chaque visite.
export const onRequest = ({ request, env, next }) => previewGuard(request, env) || next();
