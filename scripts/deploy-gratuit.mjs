// Déploiement sur l'offre GRATUITE de Cloudflare Workers, en attendant le premier client (ensuite : offre Workers
// Paid à 5 $/mois et `npm run deploy`, build complet). Voir docs/HEBERGEMENT_GRATUIT.md.
//
// 1. Build allégé (LICYO_LITE=1 : le générateur d'images de partage n'est pas embarqué ; rien n'est supprimé).
// 2. Mesure de la taille compressée par un déploiement à blanc : arrêt si elle dépasse 3 Mo (limite gratuite).
// 3. Déploiement, seulement avec --deploy (sinon : mesure seule).
//
// Usage : node scripts/deploy-gratuit.mjs            (build + mesure)
//         node scripts/deploy-gratuit.mjs --deploy   (build + mesure + déploiement)

import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LIMIT_KIB = 3 * 1024; // 3 Mo compressé (offre gratuite)
const MARGIN_KIB = 30; // marge de sécurité
const env = { ...process.env, LICYO_LITE: '1' };
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });

run('npx opennextjs-cloudflare build');

const out = mkdtempSync(join(tmpdir(), 'licyo-dry-'));
let report = '';
try {
  report = execSync(`npx wrangler deploy --dry-run --outdir "${out}"`, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} finally {
  rmSync(out, { recursive: true, force: true });
}
const gzip = Number(/gzip:\s*([\d.]+)\s*KiB/i.exec(report)?.[1]);
if (!gzip) {
  console.error('Taille du Worker introuvable dans le rapport de wrangler : arrêt.');
  process.exit(1);
}
console.log(`\nWorker compressé : ${gzip.toFixed(0)} Kio (limite gratuite : ${LIMIT_KIB} Kio).`);
if (gzip > LIMIT_KIB - MARGIN_KIB) {
  console.error('Trop lourd pour l’offre gratuite : rien n’a été déployé. Passer à Workers Paid (npm run deploy) ou alléger encore.');
  process.exit(1);
}
if (process.argv.includes('--deploy')) run('npx opennextjs-cloudflare deploy');
else console.log('Mesure seule. Ajouter --deploy pour déployer.');
