// Routage du site public, piloté par la configuration PUBLIÉE de l'organisation (phase 4D.2B, durcissement).
//
// functions/[[path]].js reçoit toute requête que ne sert aucune Function plus précise (admin, API, dépôt,
// réinscription, actualités/<slug>…). Pour une URL de page (sans extension, ou .html) :
//   1. l'organisation est résolue CÔTÉ SERVEUR d'après le domaine (jamais d'après le navigateur) ;
//   2. seule sa configuration PUBLIÉE est lue (loadPublishedSite ; jamais le brouillon) ;
//   3. le chemin est cherché parmi les routes de CETTE configuration : une route ajoutée est servie, une route
//      retirée ou renommée ne l'est plus (404), quel que soit le fichier statique qui existe encore ;
//   4. la page est rendue par le moteur (renderSitePage), puis complétée par les données publiques (page-data.js).
//
// Optimisation sûre : pour Sportville, tant que la version publiée est EXACTEMENT la configuration de référence
// du code, le fichier statique est son rendu (npm run check le garantit) et il est servi tel quel.
//
// Échec fermé. Le secours statique (fichiers générés de Sportville) n'est servi qu'à Sportville : base
// indisponible, configuration illisible ou invalide. Pour toute autre organisation : configuration illisible ou
// invalide → 503 neutre ; aucune version publiée → 404 neutre ; route absente → sa propre page 404. Domaine
// inconnu → 404 neutre. Une réponse neutre ne contient ni nom, ni texte, ni navigation d'aucune organisation.
import { resolveOrganization } from './organization.js';
import { previewGuard } from './environment.js';
import { DEMO_ORG_ID, DEMO_DOMAINS } from './schema.js';
import { loadPublishedSite, referenceSiteJson } from './site-config.js';
import { applyPublicData, loadPublicContext } from './page-data.js';
import { renderSitePage, validateSite } from '../../renderer/render.js';
import { ASSET_VERSIONS } from './asset-versions.js';

// Chemins servis par des Functions dédiées ou des fichiers techniques : jamais interprétés comme une page du site.
// Une URL inconnue sous ces préfixes reçoit la 404 de l'organisation (jamais la page 404 statique de Sportville).
const TECHNICAL = /^\/(?:admin|api|depot|reinscription|auth|callback|cdn-cgi)(?:\/|$)/;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

// URL de page : dernier segment sans extension, ou en .html.
const isPageLike = (path) => {
  const last = path.slice(path.lastIndexOf('/') + 1);
  return !last.includes('.') || last.endsWith('.html');
};

// Domaine de Sportville, reconnu SANS la base (secours quand elle est indisponible) : ses domaines de la migration 1
// et leurs sous-domaines (prévisualisations), et le poste local quand il n'est pas réglé sur une autre organisation.
export function isDemoHost(hostname, env = {}) {
  const host = String(hostname).toLowerCase();
  if (LOOPBACK.has(host)) return !env.LOCAL_ORGANIZATION_ID || env.LOCAL_ORGANIZATION_ID === DEMO_ORG_ID;
  return DEMO_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

// ---------------------------------------------------------------------------------------------
// Réponses

const NEUTRAL = {
  404: { title: 'Page introuvable', text: 'La page demandée n’existe pas.' },
  503: { title: 'Service momentanément indisponible', text: 'Merci de réessayer dans quelques instants.' },
};

// Réponse neutre : aucune donnée d'aucune organisation, jamais mise en cache, jamais indexée.
export function neutralResponse(status, request) {
  const { title, text } = NEUTRAL[status];
  const headers = { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' };
  if (status === 503) headers['Retry-After'] = '60';
  const body = `<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>${title}</title>\n</head>\n<body>\n<h1>${title}</h1>\n<p>${text}</p>\n</body>\n</html>\n`;
  return new Response(request?.method === 'HEAD' ? null : body, { status, headers });
}

const cleanHeaders = (source) => {
  const headers = new Headers(source);
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return headers;
};

// En-têtes d'une page rendue : ceux que Pages applique aux pages statiques (_headers, règle /* : CSP, HSTS…),
// relevés sur la page d'accueil statique (seuls ses en-têtes sont utilisés, jamais son contenu).
async function pageHeaders(env, url) {
  try {
    const asset = await env.ASSETS.fetch(new Request(new URL('/', url.origin)));
    return cleanHeaders(asset.headers);
  } catch {
    return cleanHeaders({});
  }
}

const redirect = (url, route) => new Response(null, { status: 308, headers: { Location: `${route}${url.search}` } });

// ---------------------------------------------------------------------------------------------
// Rendu

// Version publiée validée par le moteur avant tout routage (une version altérée en base n'est jamais servie, même en
// partie). Résultat mémorisé tant que la même version publiée reste en cache.
const validity = new WeakMap();
function isValidPublished(published) {
  if (!validity.has(published)) {
    let valid = true;
    try {
      validateSite(published.config);
    } catch {
      valid = false;
    }
    validity.set(published, valid);
  }
  return validity.get(published);
}

// Rendu mémorisé tant que la même version publiée reste en cache (la validation du moteur n'est faite qu'une fois).
const renderedPages = new WeakMap();
function renderPublished(published, route) {
  let pages = renderedPages.get(published);
  if (!pages) renderedPages.set(published, (pages = new Map()));
  if (!pages.has(route)) {
    const { config } = published;
    pages.set(route, renderSitePage({ site: config, route, locale: config.locale, assetVersions: ASSET_VERSIONS, mode: 'markers', base: '' }).html);
  }
  return pages.get(route);
}

// Données publiques de l'organisation injectées dans la page. Base en panne : Sportville garde sa page telle
// qu'elle est écrite ; une autre organisation n'affiche aucun fait (jamais les valeurs de Sportville).
async function withPublicData(env, template, organization) {
  const isSg = organization.id === DEMO_ORG_ID;
  try {
    const context = await loadPublicContext(env, organization);
    if (context.unavailable && isSg) return template;
    return applyPublicData(template, { data: context.data, organization });
  } catch (error) {
    console.warn(`Site public : données non appliquées pour ${organization.id} (${error?.name || 'Error'})`);
    return isSg ? template : applyPublicData(template, { data: null, organization });
  }
}

async function finish(request, env, { template, headers, organization, status }) {
  const html = await withPublicData(env, template, organization);
  return new Response(request.method === 'HEAD' ? null : html, { status, headers });
}

// Secours statique de Sportville (et de Sportville seulement) : le fichier généré tel qu'il est publié.
async function demoStatic(request, env, organization) {
  const asset = await env.ASSETS.fetch(request);
  if (!organization || asset.status !== 200 || !(asset.headers.get('Content-Type') || '').includes('text/html')) return asset;
  return finish(request, env, { template: await asset.text(), headers: cleanHeaders(asset.headers), organization, status: 200 });
}

// 404 de l'organisation : sa propre page « introuvable », rendue depuis sa version publiée.
export async function organizationNotFound(request, env, organization, published) {
  const { config } = published;
  const page = config.pages.find((p) => p.id === config.notFoundPage);
  if (!page) return neutralResponse(404, request);
  let template;
  try {
    template = renderPublished(published, page.route);
  } catch (error) {
    console.warn(`Site public : page 404 non rendue pour ${organization.id} (${error?.name || 'Error'})`);
    return neutralResponse(404, request);
  }
  return finish(request, env, { template, headers: await pageHeaders(env, new URL(request.url)), organization, status: 404 });
}

// Organisation et version publiée, ou la réponse à renvoyer à leur place.
//   fallback : réponse de secours réservée à Sportville (null : réponse neutre).
async function resolveSite(request, env, { fallback }) {
  const url = new URL(request.url);
  let organization;
  try {
    organization = await resolveOrganization(request, env);
  } catch (error) {
    console.warn(`Site public : organisation non résolue (${error?.name || 'Error'})`);
    return { response: isDemoHost(url.hostname, env) && fallback ? await fallback(null) : neutralResponse(503, request) };
  }
  if (!organization) return { response: neutralResponse(404, request) };
  const isSg = organization.id === DEMO_ORG_ID;
  let published;
  try {
    published = await loadPublishedSite(env, organization.id);
  } catch (error) {
    console.warn(`Site public : configuration publiée non lue pour ${organization.id} (${error?.name || 'Error'})`);
    return { response: isSg && fallback ? await fallback(organization) : neutralResponse(503, request) };
  }
  if (!published) return { response: isSg && fallback ? await fallback(organization) : neutralResponse(404, request) };
  if (!isValidPublished(published)) {
    console.warn(`Site public : version publiée invalide pour ${organization.id}, non servie`);
    return { response: isSg && fallback ? await fallback(organization) : neutralResponse(503, request) };
  }
  return { organization, published, isSg };
}

// ---------------------------------------------------------------------------------------------
// Pages

async function servePage(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const staticFallback = (organization) => demoStatic(request, env, organization);
  const resolved = await resolveSite(request, env, { fallback: staticFallback });
  if (resolved.response) return resolved.response;
  const { organization, published, isSg } = resolved;
  const site = published.config;
  const pages = Array.isArray(site.pages) ? site.pages.filter((p) => p.id !== site.notFoundPage) : [];

  // Ancienne écriture en .html (et index.html) : redirigée vers la route, comme le fait Pages pour ses fichiers.
  if (path.endsWith('.html')) {
    const target = pages.find((p) => p.file && `/${p.file}` === path);
    return target ? redirect(url, target.route) : organizationNotFound(request, env, organization, published);
  }
  if (path.length > 1 && path.endsWith('/')) {
    const trimmed = path.replace(/\/+$/, '') || '/';
    if (pages.some((p) => p.route === trimmed)) return redirect(url, trimmed);
  }
  const page = pages.find((p) => p.route === path);
  if (!page) return organizationNotFound(request, env, organization, published);

  // Sportville, version publiée = référence du code : le fichier statique est exactement ce rendu.
  if (isSg && published.json === referenceSiteJson(DEMO_ORG_ID)) {
    const asset = await env.ASSETS.fetch(new Request(new URL(page.route, url.origin)));
    if (asset.status === 200 && (asset.headers.get('Content-Type') || '').includes('text/html')) {
      return finish(request, env, { template: await asset.text(), headers: cleanHeaders(asset.headers), organization, status: 200 });
    }
  }

  let template;
  try {
    template = renderPublished(published, page.route);
  } catch (error) {
    // Version publiée invalide (altérée en base) : jamais servie.
    console.warn(`Site public : version publiée non rendue pour ${organization.id} (${error?.name || 'Error'})`);
    return isSg ? staticFallback(organization) : neutralResponse(503, request);
  }
  return finish(request, env, { template, headers: await pageHeaders(env, url), organization, status: 200 });
}

// URL inconnue hors pages (fichier absent, chemin technique sans Function) : 404 de l'organisation.
async function notFound(request, env, asset) {
  const resolved = await resolveSite(request, env, { fallback: async () => asset });
  if (resolved.response) return resolved.response;
  return organizationNotFound(request, env, resolved.organization, resolved.published);
}

// Méthode autre que GET/HEAD sur une URL sans Function dédiée (formulaires et API ont la leur) : 405 neutre, jamais
// transmise au serveur statique (qui répondrait par une page de Sportville).
const methodNotAllowed = () =>
  new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

// ---------------------------------------------------------------------------------------------
// Fichiers statiques propres à Sportville : métadonnées écrites pour lui seul (nom, icônes, domaine, contact,
// sitemap) et CMS Sveltia (dépôt et articles de Sportville). Servis à Sportville seulement ; tout autre domaine
// reçoit une 404 neutre (aucune version par organisation n'existe encore : échec fermé). Chemin comparé sous forme
// normalisée (décodé, slashs, « . », casse, slash final), comme le serveur statique pourrait le résoudre.
const DEMO_FILES = new Set(['/manifest.json', '/manifest-admin.json', '/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/security.txt']);

function canonicalPath(pathname) {
  let path = pathname;
  for (let i = 0; i < 4; i++) {
    let decoded;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      break;
    }
    if (decoded === path) break;
    path = decoded;
  }
  path = path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/(?:\.\/)+/g, '/').replace(/\/\.$/, '/').toLowerCase();
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function isDemoFile(pathname) {
  const path = canonicalPath(pathname);
  return DEMO_FILES.has(path) || path === '/admin' || path.startsWith('/admin/');
}

// null : Sportville (fichier servi) ; sinon la réponse neutre à renvoyer.
async function demoOnly(request, env) {
  let organization;
  try {
    organization = await resolveOrganization(request, env);
  } catch (error) {
    console.warn(`Site public : organisation non résolue (${error?.name || 'Error'})`);
    return isDemoHost(new URL(request.url).hostname, env) ? null : neutralResponse(503, request);
  }
  return organization?.id === DEMO_ORG_ID ? null : neutralResponse(404, request);
}

// ---------------------------------------------------------------------------------------------
// Requêtes conditionnelles (If-None-Match) sur les fichiers statiques : appliquées ici, sans dépendre du comportement
// de env.ASSETS.fetch (qui peut renvoyer le fichier complet). Comparaison faible (RFC 9110 § 13.1.2), liste d'ETags
// et « * ». 304 sans corps, avec les en-têtes du fichier (ETag, Cache-Control, sécurité).
export function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  if (ifNoneMatch.trim() === '*') return true;
  const opaque = (tag) => tag.trim().replace(/^W\//, '');
  const target = opaque(etag);
  return ifNoneMatch.split(',').some((tag) => opaque(tag) === target);
}

function conditional(request, asset) {
  if (asset.status !== 200 || !etagMatches(request.headers.get('If-None-Match'), asset.headers.get('ETag'))) return asset;
  const headers = new Headers(asset.headers);
  headers.delete('Content-Length');
  return new Response(null, { status: 304, headers });
}

// Fichier demandé au serveur statique SANS en-têtes conditionnels : selon la version, env.ASSETS.fetch renvoie le
// fichier complet ou un 304 dépouillé de son ETag et de son Cache-Control (constaté sous wrangler 4). Le 304 est donc
// toujours construit ici, à partir de la réponse complète.
function fetchAsset(env, request) {
  if (!request.headers.has('If-None-Match') && !request.headers.has('If-Modified-Since')) return env.ASSETS.fetch(request);
  const headers = new Headers(request.headers);
  headers.delete('If-None-Match');
  headers.delete('If-Modified-Since');
  return env.ASSETS.fetch(new Request(request, { headers }));
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed();
  // Prévisualisation non isolée (hôte de prévisualisation du projet, sans base de staging) : aucune lecture de la
  // base ; fichiers statiques tels quels, comme avant (voir environment.js).
  if (previewGuard(request, env)) return env.ASSETS.fetch(request);
  const path = new URL(request.url).pathname;
  if (TECHNICAL.test(path) || !isPageLike(path)) {
    if (isDemoFile(path)) {
      const denied = await demoOnly(request, env);
      if (denied) return denied;
    }
    const asset = await fetchAsset(env, request);
    return asset.status === 404 ? notFound(request, env, asset) : conditional(request, asset);
  }
  return servePage(request, env);
}
