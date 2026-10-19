// Remplace la mise à jour manuelle des ?v=AAAAMMJJ (voir CLAUDE.md, cache 4h de Cloudflare Pages) :
//   - chaque référence à assets/css/*.css ou assets/js/*.js dans les Functions reçoit l'empreinte du fichier
//     (?v=<10 caractères>) : elle change toute seule quand le fichier change ;
//   - ASSETS_VERSION (functions/_shared/admin-auth.js) reçoit l'empreinte de l'ensemble des assets ;
//   - les pages HTML de la racine et functions/_shared/asset-versions.js sont régénérés par le moteur de site
//     (scripts/build-pages.mjs, phase 4D.1) : header, footer et empreintes viennent d'une seule source.
//
// npm run sync             → applique
// npm run sync -- --check  → n'écrit rien, sort en erreur si quelque chose n'est pas à jour
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest } from './asset-versions.mjs';
import { buildPages } from './build-pages.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const checkOnly = process.argv.includes('--check');

const read = (file) => readFileSync(join(root, file), 'utf8');
const lf = (content) => content.replaceAll('\r\n', '\n');

function walk(dir, filter) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, filter);
    return filter(entry.name) ? [path.replace(/\\/g, '/')] : [];
  });
}

const functionFiles = walk('functions', (name) => name.endsWith('.js'));
const assetFiles = [...walk('assets/css', (n) => n.endsWith('.css')), ...walk('assets/js', (n) => n.endsWith('.js'))].sort();

const changes = [];
const pending = new Map();
const contentOf = (file) => pending.get(file) ?? (existsSync(join(root, file)) ? read(file) : '');
const update = (file, next, reason) => {
  if (next === contentOf(file)) return;
  pending.set(file, next);
  changes.push(`${file} : ${reason}`);
};

// 1. Versions des assets référencés en dur dans les Functions (pages admin, espace famille…)
const assetHash = new Map(assetFiles.map((file) => [file, digest(read(file))]));
const ASSET_REF = /(\/?)(assets\/(?:css|js)\/[\w.-]+\.(?:css|js))\?v=[\w-]+/g;
for (const file of functionFiles) {
  const next = contentOf(file).replace(ASSET_REF, (match, slash, path) => (assetHash.has(path) ? `${slash}${path}?v=${assetHash.get(path)}` : match));
  update(file, next, 'versions des assets');
}

const adminAuth = 'functions/_shared/admin-auth.js';
const globalHash = digest(assetFiles.map((file) => `${file}:${assetHash.get(file)}`).join('\n'));
update(adminAuth, contentOf(adminAuth).replace(/const ASSETS_VERSION = '[\w-]+';/, `const ASSETS_VERSION = '${globalHash}';`), 'ASSETS_VERSION');

// 2. Pages HTML générées et empreintes des pages rendues à l'exécution (même source que npm run pages).
for (const { file, html } of buildPages()) {
  if (lf(contentOf(file)) !== html) update(file, html, 'régénéré par le moteur de site');
}

if (!changes.length) {
  console.log('Tout est à jour.');
} else if (checkOnly) {
  console.error(`À mettre à jour (lancez npm run sync) :\n- ${changes.join('\n- ')}`);
  process.exitCode = 1;
} else {
  for (const [file, content] of pending) writeFileSync(join(root, file), content);
  console.log(`Mis à jour :\n- ${changes.join('\n- ')}`);
}
console.log(`(${relative(root, root) || '.'} — ${assetFiles.length} assets suivis)`);
