// Moteur de rendu des pages publiques (phase 4D.1). Fonctions PURES : elles reçoivent une configuration de site
// déjà résolue, une route (ou une page), des données publiques et une langue, et renvoient du HTML. Elles ne
// lisent ni D1, ni KV, ni fichier, ne connaissent ni la requête ni le nom d'hôte, n'envoient rien. La résolution
// de l'organisation et du site, et le chargement des données, se font AVANT (scripts/build-pages.mjs, Functions).
//
// Depuis la phase 4D.2A, une page n'est faite QUE de sections structurées (aucun fragment HTML).
//   SiteConfig  = structure, textes éditoriaux et valeurs de secours (versionnés avec le site) ;
//   publicData  = données métier vivantes (D1 : groupes, créneaux, lieux, tarif, coordonnées). Aujourd'hui elles
//                 sont injectées à l'exécution par functions/_shared/page-data.js dans les éléments marqués
//                 data-org-* (mode « markers ») ; le moteur les reçoit déjà en paramètre pour la suite.
import { strings } from './i18n.js';
import { escapeStrict, escapeText } from './html.js';
import { renderFooter, renderHead, renderHeader, renderLightbox, renderScripts } from './layout.js';
import { SECTIONS } from './sections.js';
import { validatePage, validateSite } from './validate.js';

export { validateSite, validatePage } from './validate.js';

// Page servie pour une route : page connue, sinon la page 404 du site (statut 404). Jamais la page d'un autre site.
export function resolvePage(site, route) {
  const page = site.pages.find((p) => p.route === route);
  if (page) return { page, status: page.id === site.notFoundPage ? 404 : 200 };
  return { page: site.pages.find((p) => p.id === site.notFoundPage), status: 404 };
}

function checkOptions({ site, mode, base }) {
  if (!site) throw new Error('Aucun site : rendu refusé (jamais de site par défaut)');
  if (mode !== 'markers' && mode !== 'static') throw new Error(`Mode inconnu : ${mode}`);
  if (base !== '' && base !== '/') throw new Error(`Base inconnue : ${base}`);
}

function renderDocument({ site, page, publicData, locale, assetVersions, mode, base }) {
  const strict = page.escape === 'strict';
  const ctx = { site, page, publicData, locale, strings: strings(locale), assetVersions, mode, base, strict, text: strict ? escapeStrict : escapeText };
  // Sections séparées par une ligne vide ; commentaire de développeur facultatif, écrit tel quel : la validation
  // n'y admet ni « < », ni « > », ni « -- », ni « - » final.
  const sections = page.sections
    .map((section) => `${section.comment ? `  <!-- ${section.comment} -->\n` : ''}${SECTIONS[section.type].render(section, ctx)}`)
    .join('\n');
  const scripts = renderScripts(ctx);
  // Header et footer : textes de la configuration du site (code relu), jamais le contenu de la page ; ils gardent
  // l'échappement standard même quand la page est en échappement strict.
  const layout = { ...ctx, strict: false, text: escapeText };
  return `<!DOCTYPE html>
<html lang="${ctx.strings.htmlLang}">
${renderHead(ctx)}
<body>
<a href="#main" class="skip-link">${escapeText(ctx.strings.skipLink)}</a>

${renderHeader(layout)}

<main id="main">
${page.mainLeadingBlankLine === false ? '' : '\n'}${sections}</main>

${renderFooter(layout, page.footer || 'full')}

${page.lightbox ? `${renderLightbox(ctx)}\n\n` : ''}${scripts ? `${scripts}\n` : ''}</body>
</html>
`;
}

/**
 * Page de la configuration du site pour une route.
 * @param {object} input
 * @param {object} input.site            configuration du site (SiteConfig), validée ici (échec fermé)
 * @param {string} input.route           route publique, par ex. « / » ou « /equipe »
 * @param {object} [input.publicData]    données publiques vivantes (voir l'en-tête)
 * @param {string} input.locale          langue, par ex. « fr-FR »
 * @param {object} input.assetVersions   empreinte (?v=) de chaque feuille de style et script
 * @param {'markers'|'static'} [input.mode]  liaisons de données : marqueurs pour page-data.js, ou valeurs écrites
 * @param {''|'/'} [input.base]          base des chemins d'assets (« » à la racine, « / » ailleurs)
 * @returns {{ status: number, html: string, page: object }}
 */
export function renderSitePage({ site, route, publicData = {}, locale, assetVersions, mode = 'markers', base = '' }) {
  checkOptions({ site, mode, base });
  validateSite(site);
  const { page, status } = resolvePage(site, route);
  return { status, page, html: renderDocument({ site, page, publicData, locale, assetVersions, mode, base }) };
}

/**
 * Page construite à l'exécution (ex. une actualité), rendue avec l'identité, la navigation et le footer du site.
 * Même validation que les pages de la configuration.
 */
export function renderPage({ site, page, publicData = {}, locale, assetVersions, mode = 'static', base = '/' }) {
  checkOptions({ site, mode, base });
  validateSite(site);
  validatePage(page, { site });
  return renderDocument({ site, page, publicData, locale, assetVersions, mode, base });
}
