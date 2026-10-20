// Middleware racine : fichiers internes du dépôt jamais servis, quelle que soit l'écriture de l'URL
// (voir functions/_shared/internal-paths.js). S'exécute avant les Functions et avant les fichiers statiques
// pour TOUTE requête : _routes.json n'exclut rien, pas même /assets/* (un préfixe exclu permettait
// /assets/..%2fpackage.json avec le serveur statique de wrangler).
//
// Chemin avec un segment vide (//equipe, /assets//x, //robots.txt) : aucune Function ne lui correspond, pas même
// le catch-all [[path]], et next() le transmettait directement au serveur statique, qui le normalise et servait les
// pages, métadonnées et 404.html de Sportville sur n'importe quel domaine (constaté sous wrangler). Il est donc
// confié ici au routeur public (organisation du domaine, version publiée, 404 de l'organisation ou neutre).
import { internalPathsMiddleware } from './_shared/internal-paths.js';
import { onRequest as publicSite } from './_shared/public-site.js';
import { withSecurityHeaders } from './_shared/security-headers.js';
import { resolveOrganization, replaceDemoContact, DEMO_CONTACT_EMAIL } from './_shared/organization.js';

// Pages famille (gabarits écrits pour le club de démo) : adresse de contact de l'organisation du domaine.
const FAMILY_PAGES = /^\/(depot|reinscription|espace-famille)(\/|$)/;
async function withClubContact(request, env, response) {
  const type = response.headers.get('Content-Type') || '';
  if (!FAMILY_PAGES.test(new URL(request.url).pathname) || !type.includes('text/html') || !response.body) return response;
  const body = await response.text();
  if (!body.includes(DEMO_CONTACT_EMAIL)) return new Response(body, response);
  const organization = await resolveOrganization(request, env).catch(() => null);
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(replaceDemoContact(body, organization), { status: response.status, statusText: response.statusText, headers });
}

const hasEmptySegment = (request) => new URL(request.url).pathname.includes('//');

// En-têtes de sécurité et « no-store » des pages privées sur toutes les réponses, Functions comprises (_headers ne
// vaut que pour les fichiers statiques) : voir functions/_shared/security-headers.js.
export const onRequest = async (context) =>
  withSecurityHeaders(
    context.request,
    await withClubContact(
      context.request,
      context.env,
      await internalPathsMiddleware({ ...context, next: () => (hasEmptySegment(context.request) ? publicSite(context) : context.next()) })
    )
  );
