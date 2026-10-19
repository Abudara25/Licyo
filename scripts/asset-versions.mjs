// Empreinte (?v=) des feuilles de style et scripts publics : sha256 du contenu (fins de ligne normalisées), 10
// caractères. Partagée par scripts/sync-assets.mjs et scripts/build-pages.mjs. Ordre trié : même fichier généré
// sous Windows et Linux.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const digest = (content) => createHash('sha256').update(content.replaceAll('\r\n', '\n')).digest('hex').slice(0, 10);

export function assetVersions(root) {
  const versions = {};
  for (const dir of ['assets/css', 'assets/js']) {
    for (const name of readdirSync(join(root, dir)).sort()) {
      if (/\.(css|js)$/.test(name)) versions[`${dir}/${name}`] = digest(readFileSync(join(root, dir, name), 'utf8'));
    }
  }
  return versions;
}
