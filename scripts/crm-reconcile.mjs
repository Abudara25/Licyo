// Réconciliation inscriptions ↔ CRM sur une COPIE de la base (phase 3), entièrement en local : rien n'est envoyé
// à Cloudflare et la production n'est jamais écrite par ce script (il ne sait d'ailleurs lire qu'un export SQL).
//
// 1. Exporter la production (compte Cloudflare qui héberge le projet Pages) :
//      npx wrangler d1 export licyo-inscriptions --remote --output=prod-AAAA-MM-JJ.sql
// 2. AUDIT (par défaut, LECTURE SEULE, toutes les vérifications) :
//      node scripts/crm-reconcile.mjs prod-AAAA-MM-JJ.sql
//    Code de sortie 1 dès qu'une anomalie existe (inscription non reliée, adhésion orpheline, relation sans
//    provenance, groupe incohérent, identité périmée…). Une base saine sort à 0.
// 3. Réparer la copie en mémoire, relancer l'audit et vérifier un second passage :
//      node scripts/crm-reconcile.mjs prod-AAAA-MM-JJ.sql --apply
//    Sort à 0 seulement si tout est cohérent ET si aucune table préexistante n'a changé.
// 4. Supprimer l'export ensuite : il contient des données personnelles (mineurs). Ne jamais le committer.
//
// La sortie ne contient que des compteurs : aucun nom, e-mail, téléphone ou adresse.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { runCrmAudit } from './crm-audit-lib.mjs';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file || args.includes('--remote')) {
  console.error('Usage : node scripts/crm-reconcile.mjs <export.sql> [--apply]  (jamais de --remote : ce script ne touche pas à la production)');
  process.exit(2);
}
const organizationId = args.find((a) => a.startsWith('--org='))?.slice(6) || DEMO_ORG_ID;

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys = OFF');
sqlite.exec(readFileSync(file, 'utf8'));
sqlite.exec('PRAGMA foreign_keys = ON');

const { exitCode, report, problems } = await runCrmAudit({ sqlite, organizationId, apply: args.includes('--apply'), log: console.log });
console.log('\nDétail (compteurs) :');
for (const [key, value] of Object.entries(report ?? {})) console.log(`  ${key}: ${value}`);
console.log(problems.length ? `\n${problems.length} anomalie(s) : code de sortie 1.` : '\nRéconciliation sans anomalie.');
process.exit(exitCode);
