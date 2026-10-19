// Génère une vraie page HTML indexable par article (voir la convention SEO documentée dans CLAUDE.md : « chaque
// article = une page indexable »).
//
// Phase 4D.1 : la page est rendue par le moteur de site générique (renderer/), avec l'identité, la navigation
// et le footer de la configuration du site de l'organisation.
// Phase 4D.2B : la configuration est la version PUBLIÉE de l'organisation en base (jamais son brouillon), et
// l'article est cherché UNIQUEMENT parmi les actualités de cette organisation (_shared/news.js) : deux
// organisations peuvent avoir le même slug, aucune ne voit les articles d'une autre.
// Organisation résolue d'après le domaine : domaine inconnu ou organisation sans site publié → 404 neutre ;
// article absent → la page 404 de l'organisation ; base ou fichier illisibles → 503. Jamais le site d'une autre.
import { renderPage } from '../../renderer/render.js';
import { newsArticlePage } from '../../renderer/news.js';
import { resolveOrganization } from '../_shared/organization.js';
import { loadPublishedSite } from '../_shared/site-config.js';
import { findArticle } from '../_shared/news.js';
import { neutralResponse, organizationNotFound } from '../_shared/public-site.js';
import { ASSET_VERSIONS } from '../_shared/asset-versions.js';

const HTML = { 'Content-Type': 'text/html;charset=UTF-8' };

const unavailable = () =>
  new Response('Service momentanément indisponible.', { status: 503, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Retry-After': '60' } });

export async function onRequestGet({ request, params, env }) {
  let organization;
  let published;
  try {
    organization = await resolveOrganization(request, env);
    published = organization ? await loadPublishedSite(env, organization.id) : null;
  } catch (error) {
    // Base indisponible : on ne devine pas le site (échec fermé), la page sera redemandée.
    console.warn(`Actualité : organisation ou configuration publiée non lue (${error?.name || 'Error'})`);
    return unavailable();
  }
  if (!organization || !published) return neutralResponse(404, request);
  const site = published.config;
  if (!site?.news) return organizationNotFound(request, env, organization, published);

  let article;
  try {
    article = findArticle(organization.id, String(params.slug));
  } catch (error) {
    console.warn(`Actualité : actualités non lues pour ${organization.id} (${error?.name || 'Error'})`);
    return unavailable();
  }
  if (!article) return organizationNotFound(request, env, organization, published);

  let html;
  try {
    html = renderPage({ site, page: newsArticlePage(site, article), locale: site.locale, assetVersions: ASSET_VERSIONS, mode: 'static', base: '/' });
  } catch (error) {
    // Article ou version publiée invalides : jamais servis à moitié.
    console.warn(`Actualité : page non rendue pour ${organization.id} (${error?.name || 'Error'})`);
    return unavailable();
  }
  return new Response(html, { headers: HTML });
}
