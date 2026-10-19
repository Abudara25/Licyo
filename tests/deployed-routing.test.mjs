// Phase 4D.2B (dernier P1) : routage de l'output RÉELLEMENT déployé. Le dossier publié est construit (buildPublic),
// son _routes.json est lu, et chaque requête est traitée comme par Cloudflare Pages :
//   - URL routée par _routes.json → middleware racine, puis la Function la plus précise, sinon le catch-all ;
//   - URL exclue → serveur statique, qui décode et normalise le chemin, et répond par 404.html faute de fichier.
// Le binding ASSETS des Functions est ce même serveur statique. Vérifie les corps, pas seulement les statuts : aucun
// contenu de Sportville (logo, navigation, titre, actualités) pour un autre domaine, quelle que soit l'URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, posix } from 'node:path';
import { buildPublic } from '../scripts/build-public.mjs';
import { onRequest as rootMiddleware } from '../functions/_middleware.js';
import { internalPathsMiddleware } from '../functions/_shared/internal-paths.js';
import { onRequest as catchAll } from '../functions/[[path]].js';
import { onRequestGet as articleFunction } from '../functions/actualites/[slug].js';
import { onRequestGet as newsApi } from '../functions/api/actualites.js';
import { saveDraftSiteConfig, publishSiteConfig, clearPublishedSiteCache } from '../functions/_shared/site-config.js';
import { clearPageDataCache } from '../functions/_shared/page-data.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { exempleSite } from './fixtures/site-exemple.mjs';
import { fixture } from './helpers/inscriptions.mjs';

const B = exempleSite.organizationId;
const SG_HOST = 'clubdemo.licyo.fr';
const B_HOST = 'atelier.example';
const UNKNOWN_HOST = 'unknown.example';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };

let dist;
test.before(async () => {
  dist = await buildPublic(await mkdtemp(join(tmpdir(), 'demo-deployed-')));
});
test.after(async () => dist && rm(dist, { recursive: true, force: true }));

// Serveur statique de Pages (simplifié) : chemin décodé et normalisé, index/.html implicites, 404.html sinon.
async function staticServer(request) {
  let path;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    path = new URL(request.url).pathname;
  }
  path = posix.normalize(path.replace(/\\/g, '/'));
  const candidates = path.endsWith('/') ? [`${path}index.html`] : [path, `${path}.html`];
  for (const candidate of candidates) {
    const file = join(dist, candidate);
    if (!file.startsWith(dist)) continue;
    try {
      if ((await stat(file)).isFile()) {
        return new Response(request.method === 'HEAD' ? null : await readFile(file), { headers: { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', ETag: '"x"', 'Cache-Control': 'public, max-age=0, must-revalidate' } });
      }
    } catch {
      // fichier absent : candidat suivant
    }
  }
  return new Response(request.method === 'HEAD' ? null : await readFile(join(dist, '404.html')), { status: 404, headers: { 'Content-Type': TYPES['.html'] } });
}

const glob = (rule, path) => (rule.endsWith('/*') ? path.startsWith(rule.slice(0, -1)) || path === rule.slice(0, -2) : path === rule);

// Une requête comme Cloudflare Pages avec le _routes.json donné.
// Comme Pages (constaté sous wrangler) : aucune Function, pas même le catch-all [[path]], ne correspond à un chemin
// qui contient un segment vide (//equipe, /assets//x) ; next() le transmet alors au serveur statique.
async function pages(env, routes, host, path, method = 'GET', headers = {}, middleware = rootMiddleware) {
  const request = new Request(`https://${host}${path}`, { method, headers });
  const { pathname } = new URL(request.url);
  const routed = routes.include.some((r) => glob(r, pathname)) && !routes.exclude.some((r) => glob(r, pathname));
  const response = !routed
    ? await staticServer(request)
    : await middleware({
        request,
        env,
        next: () => {
          if (pathname.includes('//')) return staticServer(request);
          const article = /^\/actualites\/([^/]+)$/.exec(pathname);
          if (article && method === 'GET') return articleFunction({ request, params: { slug: article[1] }, env });
          if (pathname === '/api/actualites' && method === 'GET') return newsApi({ request, env });
          return catchAll({ request, env });
        },
      });
  return { status: response.status, headers: response.headers, body: method === 'HEAD' ? '' : await response.text() };
}

async function setup() {
  clearPublishedSiteCache();
  clearPageDataCache();
  clearOrganizationCache();
  const env = { ...(await fixture()), ASSETS: { fetch: (input) => staticServer(input instanceof Request ? input : new Request(input)) } };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'atelier-exemple', 'Atelier Exemple')").bind(B).run();
  await env.DB.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(B_HOST, B).run();
  await saveDraftSiteConfig(env, B, JSON.parse(JSON.stringify(exempleSite)), { expectedRevision: 0 });
  await publishSiteConfig(env, B);
  return env;
}

const deployedRoutes = async () => JSON.parse(await readFile(join(dist, '_routes.json'), 'utf8'));
// Toute trace de Sportville : titre, marque, logo, navigation, textes, actualités.
const DEMO = /Sportville|DEMO|licyo|assets\/images\/logo(?:-96)?\.webp|Le Club|Entraînements|Stade municipal|Bienvenue sur le nouveau site/i;

const SUSPICIOUS = [
  '/assets/..%2fcontent/articles.json', '/assets/%252e%252e%252fcontent%252farticles.json', '/assets/../content/articles.json',
  '/assets/%2e%2e/content/articles.json', '/assets/%2E%2E/content/articles.json', '/assets/%2e%2e%2fcontent/articles.json',
  '/assets/%252e%252e/content/articles.json', '/content/articles.json', '/content//articles.json', '//content/articles.json',
  '/Content/articles.json', '/%63ontent/articles.json', '/content%2Farticles.json', '/assets/inexistant.css', '/assets/..%2f404.html',
  '/.well-known/..%2findex.html', '/.well-known/inexistant', '/robots.txt/..%2fequipe', '/manifest.json%2f..%2findex.html',
];
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'];

test('output déployé : _routes.json sans exclusion (assets compris)', async () => {
  assert.deepEqual(await deployedRoutes(), { version: 1, include: ['/*'], exclude: [] });
});

test('contrôle : avec l’ancienne exclusion /assets/*, le simulateur reproduit la fuite du 404.html de Sportville', async () => {
  const env = await setup();
  const old = { version: 1, include: ['/*'], exclude: ['/assets/*', '/.well-known/*'] };
  const res = await pages(env, old, UNKNOWN_HOST, '/assets/..%2fcontent/articles.json');
  assert.equal(res.status, 404);
  assert.match(res.body, /Page introuvable — Club Démo/, 'fuite reproduite : le test détecterait une régression');
});

test('chemins suspects, toutes méthodes : aucun contenu de Sportville pour B ni pour un domaine inconnu', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  for (const host of [B_HOST, UNKNOWN_HOST]) {
    for (const path of SUSPICIOUS) {
      for (const method of METHODS) {
        const res = await pages(env, routes, host, path, method);
        assert.ok([404, 405].includes(res.status), `${method} ${host}${path} : ${res.status}`);
        assert.doesNotMatch(res.body, DEMO, `${method} ${host}${path}`);
        assert.doesNotMatch(res.body, /"articles"|"slug"/, `${method} ${host}${path} : actualités`);
      }
    }
  }
});

test('Sportville : chemins suspects refusés sans actualités ; fichiers source jamais servis', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  for (const path of SUSPICIOUS) {
    for (const method of METHODS) {
      const res = await pages(env, routes, SG_HOST, path, method);
      assert.ok([404, 405].includes(res.status), `${method} ${path} : ${res.status}`);
      assert.doesNotMatch(res.body, /"articles"|"slug"/, `${method} ${path}`);
    }
  }
});

test('assets légitimes : servis sur tous les domaines (GET, HEAD), en-têtes du serveur statique conservés', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  const css = await readFile(join(dist, 'assets/css/styles.css'), 'utf8');
  for (const host of [SG_HOST, B_HOST, UNKNOWN_HOST]) {
    for (const path of ['/assets/css/styles.css', '/assets/css/styles.css?v=abc', '/assets/js/main.js']) {
      const res = await pages(env, routes, host, path);
      assert.equal(res.status, 200, `${host}${path}`);
      assert.equal(res.headers.get('ETag'), '"x"', `${host}${path} : réponse du serveur statique`);
    }
    assert.equal((await pages(env, routes, host, '/assets/css/styles.css')).body, css);
    assert.equal((await pages(env, routes, host, '/assets/css/styles.css', 'HEAD')).status, 200);
  }
});

test('pages : chaque domaine reçoit son site (ou une réponse neutre), jamais celui d’un autre', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  assert.match((await pages(env, routes, SG_HOST, '/equipe')).body, /Club Démo/);
  const b = await pages(env, routes, B_HOST, '/equipe');
  assert.equal(b.status, 404);
  assert.match(b.body, /Atelier Exemple/);
  assert.doesNotMatch(b.body, DEMO);
  const unknown = await pages(env, routes, UNKNOWN_HOST, '/');
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(unknown.body, DEMO);
});

// --- Métadonnées propres à Sportville (manifestes, robots, sitemap, llms, security.txt, CMS) ------------------------

const SG_FILES = ['/manifest.json', '/manifest-admin.json', '/robots.txt', '/sitemap.xml', '/llms.txt', '/.well-known/security.txt', '/admin/', '/admin/index.html', '/admin/config.yml'];
const SG_FILE_VARIANTS = ['/Manifest.json', '//robots.txt', '/robots.txt/', '/%72obots.txt', '/manifest%2ejson', '/.well-known//security.txt', '/ADMIN/config.yml', '/admin', '/./robots.txt', '/%252e/robots.txt'];
const SG_METADATA = /Sportville|DEMO|licyo/i;

test('métadonnées : Sportville garde les siennes', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  const manifest = await pages(env, routes, SG_HOST, '/manifest.json');
  assert.equal(manifest.status, 200);
  assert.equal(JSON.parse(manifest.body).short_name, 'DEMO');
  const robots = await pages(env, routes, SG_HOST, '/robots.txt');
  assert.equal(robots.status, 200);
  assert.match(robots.body, /Sitemap: https:\/\/clubdemo\.licyo\.fr\/sitemap\.xml/);
  for (const path of SG_FILES) assert.equal((await pages(env, routes, SG_HOST, path)).status, 200, path);
});

test('métadonnées de Sportville : 404 neutre pour B et pour un domaine inconnu (toutes écritures, GET et HEAD)', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  for (const host of [B_HOST, UNKNOWN_HOST]) {
    for (const path of [...SG_FILES, ...SG_FILE_VARIANTS]) {
      for (const method of ['GET', 'HEAD']) {
        const res = await pages(env, routes, host, path, method);
        assert.equal(res.status, 404, `${method} ${host}${path}`);
        assert.doesNotMatch(res.body, SG_METADATA, `${method} ${host}${path}`);
        assert.doesNotMatch(res.body, DEMO, `${method} ${host}${path}`);
        assert.doesNotMatch(res.body, /icon-192|Sitemap:|mailto:/, `${method} ${host}${path}`);
      }
    }
  }
});

// --- Requêtes conditionnelles (le serveur statique simulé ignore If-None-Match : le routeur doit répondre 304) ----------

test('If-None-Match : 304 sans corps (GET, HEAD, liste, faible, *), 200 sinon, sur Sportville et B', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  for (const host of [SG_HOST, B_HOST]) {
    const plain = await pages(env, routes, host, '/assets/css/styles.css');
    assert.equal(plain.status, 200);
    const etag = plain.headers.get('ETag');
    assert.equal(etag, '"x"');
    for (const method of ['GET', 'HEAD']) {
      for (const inm of [etag, `"autre", ${etag}`, `W/${etag}`, '*']) {
        const res = await pages(env, routes, host, '/assets/css/styles.css', method, { 'If-None-Match': inm });
        assert.equal(res.status, 304, `${host} ${method} If-None-Match: ${inm}`);
        assert.equal(res.body, '', 'aucun corps');
        assert.equal(res.headers.get('ETag'), etag, 'ETag conservé');
        assert.equal(res.headers.get('Content-Type'), 'text/css; charset=utf-8', 'en-têtes du fichier conservés');
        assert.equal(res.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
      }
      const wrong = await pages(env, routes, host, '/assets/css/styles.css', method, { 'If-None-Match': '"faux"' });
      assert.equal(wrong.status, 200, `${host} ${method} mauvais ETag`);
    }
    assert.equal((await pages(env, routes, host, '/assets/css/styles.css', 'GET', { 'If-None-Match': '"faux"' })).body, plain.body);
  }
  // Fichier absent : jamais de 304, même avec « * ».
  assert.equal((await pages(env, routes, B_HOST, '/assets/inexistant.css', 'GET', { 'If-None-Match': '*' })).status, 404);
});

// --- Chemins à segment vide : aucune Function ne leur correspond, le middleware racine les confie au routeur ------------

const EMPTY_SEGMENT = ['//equipe', '//', '//index.html', '//robots.txt', '///robots.txt', '//manifest.json', '//assets/inexistant.css', '/assets//inexistant.css', '//actualites/bienvenue-nouveau-site', '/equipe//', '//api/actualites'];

test('contrôle : sans le relais du middleware, un segment vide sert les pages de Sportville à tout domaine', async () => {
  const env = await setup();
  const res = await pages(env, await deployedRoutes(), UNKNOWN_HOST, '//equipe', 'GET', {}, internalPathsMiddleware);
  assert.equal(res.status, 200);
  assert.match(res.body, /Le Club — Club Démo/, 'fuite reproduite : le test détecterait une régression');
});

test('segment vide : aucun contenu de Sportville pour B ni pour un domaine inconnu, toutes méthodes', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  for (const host of [B_HOST, UNKNOWN_HOST]) {
    for (const path of EMPTY_SEGMENT) {
      for (const method of METHODS) {
        const res = await pages(env, routes, host, path, method);
        assert.ok([404, 405, 308].includes(res.status), `${method} ${host}${path} : ${res.status}`);
        // 308 (« // » → « / », route de B) : redirection locale, sans corps.
        if (res.status === 308) assert.match(res.headers.get('Location'), /^\/(?!\/)/, `${host}${path} : redirection locale`);
        assert.doesNotMatch(res.body, DEMO, `${method} ${host}${path}`);
        assert.doesNotMatch(res.body, SG_METADATA, `${method} ${host}${path}`);
      }
    }
  }
  assert.match((await pages(env, routes, B_HOST, '//equipe')).body, /Atelier Exemple/, '404 de B');
});

test('If-None-Match : un 304 natif du serveur statique (sans ETag ni Cache-Control, wrangler 4) n’est jamais relayé', async () => {
  const env = await setup();
  const routes = await deployedRoutes();
  // Serveur statique qui répond lui-même 304, en perdant ETag et Cache-Control.
  env.ASSETS = {
    fetch: async (input) => {
      const request = input instanceof Request ? input : new Request(input);
      if (request.headers.get('If-None-Match')) return new Response(null, { status: 304 });
      return staticServer(request);
    },
  };
  for (const method of ['GET', 'HEAD']) {
    const res = await pages(env, routes, B_HOST, '/assets/css/styles.css', method, { 'If-None-Match': '"x"' });
    assert.equal(res.status, 304);
    assert.equal(res.headers.get('ETag'), '"x"');
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=0, must-revalidate');
    assert.equal(res.body, '');
  }
});
