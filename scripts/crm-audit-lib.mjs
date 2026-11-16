// Audit inscriptions ↔ CRM sur une base SQLite EN MÉMOIRE (copie d'un export). Partagé par
// scripts/crm-reconcile.mjs et par les tests. Ne parle jamais à Cloudflare.
//
// MODE PAR DÉFAUT = VRAI AUDIT EN LECTURE SEULE : toutes les vérifications tournent (inscriptions non reliées,
// adhésions orphelines, relations sans provenance, groupes incohérents, identités périmées…) ; seuls des compteurs
// sont produits ; code de sortie non nul dès qu'une anomalie existe.
// `apply` : répare ce qui est explicitement réparable (relier, remettre en concordance, retirer les contacts sans plus
// aucune raison d'exister), relance l'audit, vérifie un second passage sans effet, et ne sort à 0 que si tout est
// cohérent et si aucune table préexistante n'a changé.
import { createD1, createKV } from '../tests/helpers/d1.mjs';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { backfillOrganization, crmReport } from '../functions/_shared/crm.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { createHash } from 'node:crypto';
import { CRM_TABLES } from '../functions/_shared/crm-schema.js';

// Tables créées par les migrations du CRM : absentes d'un export antérieur, donc hors comparaison « avant ».
const IGNORED = new Set(['schema_migrations', 'sqlite_sequence', ...CRM_TABLES]);

export async function runCrmAudit({ sqlite, organizationId = DEMO_ORG_ID, apply = false, log = () => {}, afterApply = null }) {
  const db = createD1(sqlite);
  const env = { DB: db, INSCRIPTION_STATUS: createKV() };
  const problems = [];
  const check = (ok, message) => {
    log(`${ok ? 'OK ' : 'KO '} ${message}`);
    if (!ok) problems.push(message);
  };

  // Empreintes de TOUTES les tables préexistantes (colonnes présentes avant), hors schema_migrations : c'est ce que
  // « legacy intact » veut dire ici. Rien de ce qui existait ne doit changer, ni par la migration ni par le remplissage.
  const tables = () => sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name).filter((n) => !IGNORED.has(n));
  const before = new Map();
  for (const table of tables()) {
    const columns = sqlite.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);
    before.set(table, { columns, digest: digest(sqlite, table, columns) });
  }
  const legacyChanges = () => [...before].filter(([table, { columns, digest: was }]) => digest(sqlite, table, columns) !== was).map(([table]) => table);
  const legacyCount = before.size;

  resetSchemaCacheForTests();
  try {
    await ensureSchema(db); // migrations (dont le CRM) sur la copie en mémoire
  } catch (error) {
    // Schéma CRM incohérent (ex. table de provenance perdue alors que des relations existent) : FAIL CLOSED. Rien n'est
    // recréé ni réparé, dans aucun mode ; une perte de provenance ne se reconstruit pas par supposition.
    check(false, `schéma CRM incohérent, arrêt sans rien modifier : ${error.message}`);
    return { exitCode: 1, problems, report: null, first: null, dry: null };
  }

  const first = await crmReport(db, organizationId);
  log(`Audit : ${first.inscriptions} inscription(s), ${first.inscriptionsMapped} reliée(s), ${first.anomalies} anomalie(s), ${first.warnings} point(s) à vérifier`);
  const dry = await backfillOrganization(env, organizationId);
  log(`Travail restant (à blanc, rien n'est écrit) : ${dry.unmapped} à relier, ${dry.stale} à remettre en concordance`);
  // Audit seul : toute anomalie est un échec. Avec --apply, l'état avant réparation est seulement rapporté ; c'est
  // l'audit APRÈS réparation qui décide.
  if (apply) log(`Avant réparation : ${first.anomalies} anomalie(s)`);
  else check(first.anomalies === 0, `cohérence inscriptions ↔ CRM (${first.anomalies} anomalie(s))`);
  check(legacyChanges().length === 0, `${legacyCount} table(s) préexistante(s) identiques après migration`);

  let after = first;
  if (apply) {
    const summary = await backfillOrganization(env, organizationId, { dryRun: false });
    log(`Réparation appliquée à la copie : ${summary.processed} traitée(s), ${summary.failed} en échec, ${summary.remaining} restante(s)`);
    if (afterApply) await afterApply({ sqlite, db });
    after = await crmReport(db, organizationId);
    check(after.anomalies === 0, `après réparation : ${after.anomalies} anomalie(s)`);
    check(summary.failed === 0, 'aucune inscription en échec');
    check(legacyChanges().length === 0, `${legacyCount} table(s) préexistante(s) identiques après remplissage`);
    const snapshot = () => JSON.stringify(['contacts', 'contact_relationships', 'contact_relationship_sources', 'periods', 'memberships', 'group_memberships'].map((t) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n));
    const counts = snapshot();
    const second = await backfillOrganization(env, organizationId, { dryRun: false });
    check(second.pending === 0 && second.processed === 0, 'second passage : rien à faire');
    check(snapshot() === counts, 'second passage : aucun doublon');
  }
  return { exitCode: problems.length ? 1 : 0, problems, report: after, first, dry };
}

function digest(sqlite, table, columns) {
  const rows = sqlite.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" ORDER BY rowid`).all();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
