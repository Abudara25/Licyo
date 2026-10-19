// Phase 4B.1 : fichiers internes du dépôt jamais servis, quelle que soit l'écriture de l'URL (audit Codex).
// Complété par des requêtes HTTP réelles (curl --path-as-is) sur wrangler pages dev et sur la prévisualisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { internalPathReason, internalPathsMiddleware } from '../functions/_shared/internal-paths.js';
import { onRequest as rootMiddleware } from '../functions/_middleware.js';

const INTERNAL = [
  // chemins canoniques
  '/.github/workflows/check.yml', '/.github/', '/.github', '/package.json', '/package-lock.json', '/.gitignore', '/.gitattributes',
  '/CLAUDE.md', '/AGENTS.md', '/agents.md', '/status.json', '/tests/helpers/d1.mjs', '/tests/', '/tests', '/scripts/crm-reconcile.mjs', '/workers/cron/index.js',
  '/workers/cron/wrangler.toml', '/functions/_shared/security.js', '/styles/site.json', '/styles/themes/dynamic-diagonal/1/hero.css', '/styles%2fbase%2freset.css', '/tests/visual/package.json', '/.git/config', '/.wrangler/state',
  '/renderer/render.js', '/renderer/blocks.js', '/renderer/registration.js', '/sites/segments.js', '/sites/club-demo/content/accueil.js', '/sites%2fclub-demo%2fcontent%2finscription.js', '/sites/club-demo/content/../site.js', '/renderer/', '/sites/index.js', '/sites/club-demo/site.js', '/sites/club-demo/fragments/accueil.html', '/Renderer/html.js', '/sites%2fclub-demo%2fsite.js', '/%72enderer/render.js', '/assets/..%2frenderer/render.js', '//sites/index.js',
  // sources des actualités (P1 audit 4D.2B) : jamais téléchargeables, sous aucune écriture
  '/content/articles.json', '/content//articles.json', '//content/articles.json', '/Content/articles.json', '/CONTENT/ARTICLES.JSON', '/%63ontent/articles.json',
  '/content%2Farticles.json', '/content%2farticles.json', '/content/', '/content', '/%2fcontent/articles.json', '/assets/..%2fcontent/articles.json', '/content%252farticles.json',
  '/content/organizations/org_x/articles.json',
  '/.vscode/settings.json', '/node_modules/x/package.json', '/assets/node_modules/x.js', '/_routes.json', '/desktop.ini',
  // casse, slash final, slashs multiples
  '/PACKAGE.JSON', '/Package.Json', '/TESTS/helpers/d1.mjs', '/.GitHub/workflows/check.yml', '/claude.md', '/package.json/',
  '//.github/workflows/check.yml', '//tests/helpers/d1.mjs', '///package.json', '/./package.json', '/assets/../package.json',
  // encodages (audit Codex, puis variantes)
  '/%2egithub/workflows/check.yml', '/%2Egithub/workflows/check.yml', '/.%67ithub/workflows/check.yml', '/%2e%67%69%74%68%75%62/workflows/check.yml',
  '/.github%2fworkflows%2fcheck.yml', '/.github%2Fworkflows%2Fcheck.yml', '/package%2ejson', '/package%2Ejson', '/%70ackage.json',
  '/tests%2fhelpers%2fd1.mjs', '/scripts%2fcrm-reconcile.mjs', '/workers%2fcron%2findex.js', '/%2ftests/helpers/d1.mjs',
  '/assets%2f..%2ftests%2fhelpers%2fd1.mjs', '/assets/..%2ftests/helpers/d1.mjs', '/assets/%2e%2e/package.json', '/assets%5c..%5cpackage.json',
  '/tests%5chelpers%5cd1.mjs', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json',
  // tout segment ".." (4B.2), même vers un fichier public ou inexistant
  '/CLAUDE.md.bak/../index.html', '/assets/../index.html', '/foo/%2e%2e/bar', '/assets/css/..%2fstyles.css',
  // double et triple encodage
  '/%252egithub/workflows/check.yml', '/package%252ejson', '/tests%252fhelpers%252fd1.mjs', '/%25252egithub/x', '/%252e%252e%252fpackage.json',
];

const REFUSED_MALFORMED = ['/%', '/%zz', '/%2', '/%E0%A4%A', '/pack%00age.json', '/%00', '/%2525252525252e'];

const PUBLIC = [
  '/', '/index.html', '/equipe', '/equipe.html', '/entrainements.html', '/inscription.html', '/contact.html', '/actualites.html', '/partenaires.html',
  '/mentions-legales.html', '/confidentialite.html', '/404.html', '/actualites/bienvenue-nouveau-site', '/depot/abc', '/reinscription/abc',
  '/admin/inscriptions', '/admin/', '/admin/index.html', '/admin/config.yml', '/api/inscription-status',
  '/assets/css/styles.css', '/assets/js/main.js', '/assets/images/logo.webp', '/assets/images/icons/icon-192.png', '/assets/fonts/inter.woff2',
  '/assets/images/actualites/WhatsApp%20Image%202026-09-18%20at%2008.21.47.jpg', '/assets/css/styles.css?v=abc',
  '/manifest.json', '/manifest-admin.json', '/robots.txt', '/sitemap.xml', '/llms.txt', '/favicon.ico', '/.well-known/security.txt',
  '/tests.html', '/scripts-club', '/assets/images/tests.png',
];

test('chemins internes : refusés sous toutes leurs écritures (canonique, casse, slashs, encodages, traversées, double encodage)', () => {
  for (const path of INTERNAL) assert.ok(internalPathReason(path), `devrait être refusé : ${path}`);
});

test('URL mal formées ou encodage trop profond : refus sans erreur (fail closed)', () => {
  for (const path of REFUSED_MALFORMED) assert.ok(internalPathReason(path), `devrait être refusé : ${path}`);
});

test('fichiers et pages publics : jamais bloqués', () => {
  for (const path of PUBLIC) assert.equal(internalPathReason(path.split('?')[0]), null, path);
});

test('tous les fichiers réellement présents dans les dossiers internes du dépôt sont couverts', () => {
  for (const dir of ['tests', 'scripts', 'workers', '.github']) assert.ok(internalPathReason(`/${dir}/x`), dir);
  for (const file of ['package.json', '.gitignore', '.gitattributes', 'CLAUDE.md', 'status.json']) {
    if (existsSync(file)) assert.ok(internalPathReason(`/${file}`), file);
  }
});

test('.well-known : exception limitée au premier segment (phase 4B.2)', () => {
  for (const path of ['/.well-known/security.txt', '/.well-known/', '/.WELL-KNOWN/security.txt', '/%2ewell-known/security.txt']) assert.equal(internalPathReason(path), null, path);
  for (const path of ['/foo/.well-known/security.txt', '/assets/.well-known/x', '/foo/.well-known/.git/config', '/foo/.well-known/../package.json', '/.well-known/../package.json', '/.well-known/%2e%2e/package.json', '/.well-known/..%2fpackage.json', '/.well-known/.git/config', '/.well-known/.env', '/foo/%2ewell-known/x', '/.well-known/.well-known/x']) {
    assert.ok(internalPathReason(path), `devrait être refusé : ${path}`);
  }
});

test('middleware racine : 404 sans corps révélateur pour un chemin interne, requête transmise sinon', async () => {
  let forwarded = 0;
  const next = () => { forwarded++; return new Response('fichier'); };
  for (const path of ['/%2egithub/workflows/check.yml', '/package%2ejson', '/%zz']) {
    const res = await rootMiddleware({ request: new Request(`https://clubdemo.licyo.fr${path}`), next });
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), 'Not Found');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
  }
  assert.equal(forwarded, 0);
  for (const method of ['GET', 'HEAD', 'POST']) {
    assert.equal((await internalPathsMiddleware({ request: new Request('https://clubdemo.licyo.fr/tests/helpers/d1.mjs', { method }), next })).status, 404, method);
  }
  // Sources des actualités : refusées pour toute méthode, sur tout domaine.
  for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    for (const host of ['clubdemo.licyo.fr', 'inconnu.example']) {
      assert.equal((await rootMiddleware({ request: new Request(`https://${host}/content/articles.json`, { method }), next })).status, 404, `${method} ${host}`);
    }
  }
  assert.equal((await rootMiddleware({ request: new Request('https://clubdemo.licyo.fr/equipe'), next })).status, 200);
  assert.equal(forwarded, 1);
});

// Aucune exclusion, pas même /assets/* : le serveur de fichiers statiques de wrangler résout /assets/..%2fpackage.json
// en package.json (constaté en phase 4B.1). Toute requête doit passer par le middleware racine.
test('_routes.json : toutes les requêtes passent par le middleware racine, sans exclusion', () => {
  const routes = JSON.parse(readFileSync('_routes.json', 'utf8'));
  assert.deepEqual(routes, { version: 1, include: ['/*'], exclude: [] });
});
