// Phase 4B.2 : le dossier publié (dist/, construit par scripts/build-public.mjs) ne contient QUE le site public.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { buildPublic, PUBLIC_ROOT_FILES, PUBLIC_DIRECTORIES, ROUTES } from '../scripts/build-public.mjs';
import { internalPathReason } from '../functions/_shared/internal-paths.js';

async function listFiles(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path, base)));
    else files.push(relative(base, path).split(sep).join('/'));
  }
  return files;
}

let built;
async function output() {
  if (!built) {
    const dir = await mkdtemp(join(tmpdir(), 'demo-dist-'));
    await buildPublic(dir);
    built = { dir, files: await listFiles(dir) };
  }
  return built;
}
test.after(async () => built && rm(built.dir, { recursive: true, force: true }));

// Catégories interdites : un seul fichier de ce type dans dist/ fait échouer la suite.
const FORBIDDEN = [
  /^tests\//, /^scripts\//, /^workers\//, /^functions\//, /^styles\//, /^renderer\//, /^sites\//, /^prototypes\//, /^\.github\//, /(^|\/)node_modules\//, /(^|\/)\.git(\/|$)/,
  /^\.gitignore$/, /^\.gitattributes$/, /^CLAUDE\.md$/i, /(^|\/)package(-lock)?\.json$/, /^status\.json$/, /(^|\/)desktop\.ini$/i,
  /(^|\/)\.(?!well-known\/)/, // tout fichier ou dossier caché, sauf .well-known/ à la racine
  /\.(mjs|sql|toml|md|env|log)$/i, /(^|\/)\.env/, /(^|\/)wrangler\./,
];

test('dossier publié : aucun fichier interne, quelle que soit sa profondeur', async () => {
  const { files } = await output();
  const leaks = files.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
  assert.deepEqual(leaks, []);
  // Défense en profondeur : aucun fichier publié ne serait non plus refusé par la politique d'exécution (sauf les
  // fichiers de configuration réservés de Pages, lus par la plateforme et jamais servis).
  const RESERVED = new Set(['_routes.json', '_headers']);
  assert.deepEqual(files.filter((file) => !RESERVED.has(file) && internalPathReason(`/${file}`)), []);
});

test('dossier publié : exactement l’allowlist (fichiers racine + dossiers publics) et rien d’autre', async () => {
  const { files } = await output();
  const roots = new Set(files.map((file) => file.split('/')[0]));
  assert.deepEqual([...roots].sort(), [...PUBLIC_ROOT_FILES, ...PUBLIC_DIRECTORIES, '_routes.json'].sort());
  for (const required of ['index.html', '404.html', 'admin/index.html', 'admin/config.yml', '.well-known/security.txt', 'assets/css/styles.css', 'assets/js/main.js', 'assets/fonts/inter.woff2', 'assets/images/logo.webp', 'assets/images/favicon.ico', '_headers', '_routes.json', 'manifest.json', 'robots.txt', 'sitemap.xml', 'llms.txt']) {
    assert.ok(files.includes(required), `manquant : ${required}`);
  }
});

test('dossier publié : copie à l’identique de chaque fichier public du dépôt (aucune transformation)', async () => {
  const { dir, files } = await output();
  for (const file of files.filter((f) => f !== '_routes.json')) {
    assert.ok((await readFile(join(dir, file))).equals(await readFile(file)), file);
  }
});

test('tout fichier de la racine du dépôt est classé : publié ou interne (une nouvelle page doit être ajoutée à l’allowlist)', async () => {
  const INTERNAL_ROOT = new Set(['CLAUDE.md', 'AGENTS.md', 'README.md', 'package.json', 'package-lock.json', 'status.json', '_routes.json', 'desktop.ini', 'dist', 'node_modules',
    'functions', 'tests', 'scripts', 'workers', 'styles', 'renderer', 'sites', 'content', 'prototypes']);
  const unclassified = (await readdir('.', { withFileTypes: true }))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.') || name === '.well-known')
    .filter((name) => !PUBLIC_ROOT_FILES.includes(name) && !PUBLIC_DIRECTORIES.includes(name) && !INTERNAL_ROOT.has(name));
  assert.deepEqual(unclassified, []);
});

test('routage : le _routes.json PUBLIÉ fait passer toute requête par les Functions (aucune exclusion, assets compris)', async () => {
  const { dir } = await output();
  // Fichier réellement déployé (dist/_routes.json), pas celui de la racine du dépôt.
  assert.deepEqual(JSON.parse(await readFile(join(dir, '_routes.json'), 'utf8')), { version: 1, include: ['/*'], exclude: [] });
  assert.deepEqual(ROUTES, { version: 1, include: ['/*'], exclude: [] });
  // Défense en profondeur : aucun fichier interne dans le dossier publié.
  for (const internal of ['package.json', 'CLAUDE.md', 'tests/helpers/d1.mjs', '.github/workflows/check.yml', 'functions/_middleware.js']) {
    assert.equal(existsSync(join(dir, internal)), false, internal);
  }
});
