// Serveur local des tests visuels (Playwright). Sert le site tel qu'il est publié, avec des données
// déterministes et fictives :
// - fichiers statiques de la racine, tels quels (les 5 pages alimentées par D1 ressortent identiques
//   octet pour octet avec les données de Sportville, voir tests/page-data.test.mjs) ;
// - actualités remplacées par tests/visual/fixtures/articles.json (aucun contenu réel) ;
// - /actualites/<slug> et /api/actualites servis par les vraies Functions (functions/actualites/[slug].js,
//   functions/api/actualites.js) sur ces articles ;
// - /api/inscription-status : inscriptions ouvertes ; /api/categories : 503 (le formulaire garde les
//   valeurs écrites dans la page) ; toute autre API : 404. Aucun service externe ; la seule base est une D1
//   simulée en mémoire (node:sqlite, tests/helpers), qui résout l'organisation de la page d'actualité.
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onRequestGet as renderArticle } from '../../functions/actualites/[slug].js';
import { onRequestGet as listArticles } from '../../functions/api/actualites.js';
import { setNewsSourcesForTests } from '../../functions/_shared/news.js';
import { DEMO_ORG_ID } from '../../functions/_shared/schema.js';
import { buildPublic } from '../../scripts/build-public.mjs';
import { fixture } from '../helpers/inscriptions.mjs';

// Dossier publié, reconstruit à chaque démarrage dans un dossier temporaire (jamais dans le dépôt).
const ROOT = resolve(await buildPublic(await mkdtemp(join(tmpdir(), 'demo-visual-dist-'))));
const FIXTURE_ARTICLES = fileURLToPath(new URL('./fixtures/articles.json', import.meta.url));
const PORT = Number(process.env.VISUAL_PORT || 4173);
// Base en mémoire, schéma à jour (organisation Sportville) : localhost résout org_demo.
const { DB } = await fixture();
// Actualités fictives (les vraies sont lues par les Functions, jamais publiées).
setNewsSourcesForTests({ [DEMO_ORG_ID]: JSON.parse(await readFile(FIXTURE_ARTICLES, 'utf8')) });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

async function readAsset(pathname) {
  const decoded = decodeURIComponent(pathname);
  const file = normalize(join(ROOT, decoded === '/' ? '/index.html' : decoded));
  if (!file.startsWith(ROOT + sep)) return null;
  // Dossiers jamais servis ici : outils et dépendances de développement.
  if (/[\\/](node_modules|tests|scripts|functions|workers)[\\/]/.test(file.slice(ROOT.length))) return null;
  try {
    if (!(await stat(file)).isFile()) return null;
    return { body: await readFile(file), type: TYPES[extname(file).toLowerCase()] || 'application/octet-stream' };
  } catch {
    return null;
  }
}

const assetsBinding = (origin) => ({
  async fetch(input) {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input), origin);
    const asset = await readAsset(pathname);
    return asset ? new Response(asset.body, { headers: { 'Content-Type': asset.type } }) : new Response('Not found', { status: 404 });
  },
});

async function handle(req) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;
  const json = (status, data) => ({ status, type: TYPES['.json'], body: JSON.stringify(data) });

  if (pathname === '/api/inscription-status') return json(200, { status: 'open', dateLimiteReinscription: null });
  if (pathname === '/api/categories') return json(503, { error: 'fixture' });
  if (pathname === '/api/actualites') {
    const response = await listArticles({ request: new Request(url), env: { ASSETS: assetsBinding(url.origin), DB } });
    return { status: response.status, type: TYPES['.json'], body: Buffer.from(await response.arrayBuffer()) };
  }
  if (pathname.startsWith('/api/')) return json(404, { error: 'fixture' });

  const article = /^\/actualites\/([a-z0-9-]+)$/.exec(pathname);
  if (article) {
    const response = await renderArticle({ request: new Request(url), params: { slug: article[1] }, env: { ASSETS: assetsBinding(url.origin), DB } });
    return { status: response.status, type: response.headers.get('Content-Type') || TYPES['.html'], body: Buffer.from(await response.arrayBuffer()) };
  }

  const asset = await readAsset(pathname);
  if (asset) return { status: 200, ...asset };
  const notFound = await readAsset('/404.html');
  return { status: 404, ...notFound };
}

createServer(async (req, res) => {
  try {
    const { status, type, body } = await handle(req);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(error?.stack || error));
  }
}).listen(PORT, '127.0.0.1', () => console.log(`visual server on http://127.0.0.1:${PORT}`));
