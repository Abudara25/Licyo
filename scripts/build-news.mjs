// Actualités lues par les Functions : content/articles.json (source, éditée par le CMS Sveltia) → module ES ordinaire
// functions/_generated/articles.js (généré, jamais versionné, jamais publié).
//
// Pourquoi un module généré : l'image de build de Cloudflare Pages regroupe les Functions avec wrangler 3 (3.114.17
// constaté), dont esbuild refuse l'import JSON avec attributs (`with { type: 'json' }`) ; Node 24, lui, exige ces
// attributs pour importer un JSON. Un module `export default {…}` convient aux deux.
//
// Quand : au début de scripts/build-public.mjs (commande de build Pages, exécutée AVANT le regroupement des Functions :
// « Executing user command … Finished », puis « Found Functions directory at /functions ») ; avant les tests
// (`npm test`) ; au démarrage du serveur des tests visuels. JSON illisible ou sans liste d'articles : échec (le build
// s'arrête, la version en ligne reste en place ; rien n'est deviné).
//
// Usage : node scripts/build-news.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const NEWS_SOURCE = resolve(ROOT, 'content/articles.json');
export const NEWS_MODULE = resolve(ROOT, 'functions/_generated/articles.js');

export function newsModule(json) {
  const data = JSON.parse(json);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.articles)) {
    throw new Error('content/articles.json : objet { "articles": [...] } attendu');
  }
  // JSON.stringify produit une expression JavaScript valide (ES2019 : U+2028/U+2029 admis dans les chaînes).
  return `// GÉNÉRÉ par scripts/build-news.mjs depuis content/articles.json : ne pas modifier, ne pas versionner.\nexport default ${JSON.stringify(data)};\n`;
}

// Identifiant du build (même moments de génération que les actualités) : functions/_generated/build-info.js. Sert au
// raccourci de ensureSchema (functions/_shared/inscriptions-db.js) : le contrôle complet du schéma D1 n'est refait
// qu'une fois par déploiement. Hors build Cloudflare Pages (tests, serveur local) : « dev », raccourci désactivé.
export const BUILD_INFO_MODULE = resolve(ROOT, 'functions/_generated/build-info.js');
export function buildInfoModule(env = process.env) {
  const commit = /^[0-9a-f]{7,40}$/i.test(env.CF_PAGES_COMMIT_SHA || '') ? env.CF_PAGES_COMMIT_SHA : '';
  const buildId = commit ? `${commit}-${Date.now().toString(36)}` : 'dev';
  return `// GÉNÉRÉ par scripts/build-news.mjs : ne pas modifier, ne pas versionner.
export default ${JSON.stringify({ buildId })};
`;
}

export async function buildNews() {
  const code = newsModule(await readFile(NEWS_SOURCE, 'utf8'));
  await mkdir(dirname(NEWS_MODULE), { recursive: true });
  await writeFile(NEWS_MODULE, code);
  await writeFile(BUILD_INFO_MODULE, buildInfoModule());
  return NEWS_MODULE;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildNews();
  console.log('Actualités générées : functions/_generated/articles.js');
}
