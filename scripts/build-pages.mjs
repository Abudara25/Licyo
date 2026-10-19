// Génère les pages publiques HTML de la racine à partir de la configuration du site (phase 4D.1).
//
//   sites/club-demo/site.js         configuration (SiteConfig) : identité, navigation, footer, SEO, pages
//   sites/club-demo/content/        sections structurées de chaque page (aucun HTML, phase 4D.2A)
//   renderer/                              moteur de rendu générique, pur
//
// Ce projet Cloudflare Pages sert le site de l'organisation org_demo : ses pages sont écrites à la racine
// (même nom de fichier qu'avant, URL inchangées), puis copiées dans dist/ par scripts/build-public.mjs, et
// complétées à l'exécution par functions/_shared/page-data.js (données publiques en base). Les fichiers générés
// sont versionnés ; `npm run check` échoue s'ils ne correspondent plus à la configuration.
//
// Usage : node scripts/build-pages.mjs [--check]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSitePage } from '../renderer/render.js';
import { siteForOrganization } from '../sites/index.js';
import { assetVersions } from './asset-versions.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const ROOT_SITE_ORGANIZATION = 'org_demo';

// Empreintes des feuilles de style et scripts, pour les pages rendues à l'exécution (functions/actualites).
export const ASSET_VERSIONS_MODULE = 'functions/_shared/asset-versions.js';
export function assetVersionsModule(versions = assetVersions(ROOT)) {
  return `// Fichier généré par scripts/build-pages.mjs (npm run pages) : ne pas modifier à la main.
// Empreinte (?v=) de chaque feuille de style et script public, pour les pages rendues à l'exécution.
export const ASSET_VERSIONS = Object.freeze(${JSON.stringify(versions, null, 2)});
`;
}

export function buildPages() {
  const site = siteForOrganization(ROOT_SITE_ORGANIZATION);
  if (!site) throw new Error(`Aucun site pour ${ROOT_SITE_ORGANIZATION}`);
  const versions = assetVersions(ROOT);
  const pages = site.pages.map((page) => {
    const { html } = renderSitePage({ site, route: page.route, locale: site.locale, assetVersions: versions, mode: 'markers', base: '' });
    return { file: page.file, html };
  });
  return [...pages, { file: ASSET_VERSIONS_MODULE, html: assetVersionsModule(versions) }];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pages = buildPages();
  const stale = [];
  for (const { file, html } of pages) {
    const path = join(ROOT, file);
    const current = existsSync(path) ? readFileSync(path, 'utf8').split('\r').join('') : null;
    if (current === html) continue;
    stale.push(file);
    if (!process.argv.includes('--check')) writeFileSync(path, html);
  }
  if (process.argv.includes('--check')) {
    if (stale.length) {
      console.error(`Pages à régénérer (npm run pages) : ${stale.join(', ')}`);
      process.exit(1);
    }
    console.log(`Pages publiques à jour (${pages.length - 1} pages et les empreintes des assets).`);
  } else {
    console.log(stale.length ? `Pages écrites : ${stale.join(', ')}` : `Pages publiques déjà à jour (${pages.length}).`);
  }
}
