// Phase 3.1, P1-5 : la réconciliation par défaut est un VRAI audit en lecture seule (anomalie = code non nul), et
// --apply répare puis ré-audite. Bases FICTIVES ; le CLI est aussi exercé de bout en bout sur un export SQL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runCrmAudit } from '../scripts/crm-audit-lib.mjs';
import { syncInscription } from '../functions/_shared/crm.js';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { createD1, createKV } from './helpers/d1.mjs';
import { seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const family = (n, overrides = {}) => ({
  enfant_prenom: `Enfant${n}`, enfant_nom: `Fictif${n}`, naissance: '2018-03-04', categorie: 'U8 - U9',
  parent_prenom: `Parent${n}`, parent_nom: `Fictif${n}`, email: `parent${n}@example.test`, telephone: `06000000${String(n).padStart(2, '0')}`, ...overrides,
});

// Base fictive migrée, avec deux inscriptions dont la première est déjà reliée au CRM.
async function database({ synced = 2 } = {}) {
  resetSchemaCacheForTests();
  const sqlite = new DatabaseSync(':memory:');
  const db = createD1(sqlite);
  const env = { DB: db, INSCRIPTION_STATUS: createKV() };
  await ensureSchema(db);
  await getCategoriesConfig(env, A);
  const rows = [await seedInscription(db, family(1, { parent2_prenom: 'Karim', parent2_nom: 'Fictif1' })), await seedInscription(db, family(2))];
  for (const row of rows.slice(0, synced)) await syncInscription(env, A, row.id);
  return { sqlite, db, env, rows };
}
const audit = (sqlite, options = {}) => runCrmAudit({ sqlite, ...options });

test('E : base saine → audit lecture seule : code 0', async () => {
  const { sqlite } = await database();
  const result = await audit(sqlite);
  assert.equal(result.exitCode, 0, result.problems.join(' | '));
  assert.equal(result.report.anomalies, 0);
});

test('A : inscription non reliée → audit lecture seule : code non nul (sans --apply)', async () => {
  const { sqlite } = await database({ synced: 1 });
  const result = await audit(sqlite);
  assert.equal(result.exitCode, 1);
  assert.equal(result.first.inscriptionsUnmapped, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memberships').get().n, 1, 'l’audit n’a rien écrit');
});

test('B : adhésion orpheline (inscription source disparue) → code non nul, même avec --apply (non réparable)', async () => {
  const { sqlite } = await database();
  sqlite.prepare('UPDATE memberships SET legacy_inscription_id = 9999 WHERE legacy_inscription_id = 1').run();
  const dry = await audit(sqlite);
  assert.equal(dry.exitCode, 1);
  assert.ok(dry.first.membershipsWithMissingInscription >= 1);
  const applied = await audit(sqlite, { apply: true });
  assert.equal(applied.exitCode, 1, 'une adhésion orpheline ne se « répare » pas en supprimant des données : revue humaine');
  assert.ok(applied.report.membershipsWithMissingInscription >= 1);
});

test('C : relation incohérente (sans provenance / emplacement non relié) → code non nul', async () => {
  const { sqlite } = await database();
  sqlite.prepare("DELETE FROM contact_relationship_sources WHERE source_role = 'guardian2'").run();
  const dry = await audit(sqlite);
  assert.equal(dry.exitCode, 1);
  assert.ok(dry.first.inscriptionsStale >= 1 && dry.first.relationshipsWithoutSource >= 1);
});

test('C bis : provenance vers une inscription disparue → code non nul', async () => {
  const { sqlite } = await database();
  sqlite.prepare('UPDATE contact_relationship_sources SET legacy_inscription_id = 9999 WHERE legacy_inscription_id = 1 AND source_role = ?').run('guardian2');
  const dry = await audit(sqlite);
  assert.equal(dry.exitCode, 1);
  assert.ok(dry.first.sourcesWithMissingInscription >= 1);
});

test('D : groupe d’adhésion incohérent → code non nul', async () => {
  const { sqlite } = await database();
  sqlite.prepare("UPDATE group_memberships SET group_label = 'Autre groupe'").run();
  const dry = await audit(sqlite);
  assert.equal(dry.exitCode, 1);
  assert.ok(dry.first.inscriptionsStale >= 1);
});

test('D bis : adhésion sans groupe, contact orphelin, identité périmée → code non nul', async () => {
  const one = await database();
  one.sqlite.prepare('DELETE FROM group_memberships').run();
  assert.equal((await audit(one.sqlite)).exitCode, 1);
  const two = await database();
  two.sqlite.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, source) VALUES (?, 'Orphelin', 'Fictif', 'orphelin fictif', 'legacy_inscription')").run(A);
  assert.equal((await audit(two.sqlite)).exitCode, 1);
  const three = await database();
  three.sqlite.prepare("UPDATE inscriptions SET enfant_prenom = 'Renomme' WHERE id = 1").run(); // édition non synchronisée
  const stale = await audit(three.sqlite);
  assert.equal(stale.exitCode, 1);
  assert.ok(stale.first.inscriptionsStale >= 1);
});

test('F : base réparable → dry-run rouge, --apply répare puis ré-audite : code 0 ; second passage sans effet', async () => {
  const { sqlite } = await database({ synced: 1 });
  sqlite.prepare("UPDATE group_memberships SET group_label = 'Autre groupe'").run();
  sqlite.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, source) VALUES (?, 'Orphelin', 'Fictif', 'orphelin fictif', 'legacy_inscription')").run(A);
  sqlite.prepare("UPDATE inscriptions SET enfant_prenom = 'Corrige' WHERE id = 1").run();
  assert.equal((await audit(sqlite)).exitCode, 1, 'audit seul : rouge');
  const lines = [];
  const repaired = await audit(sqlite, { apply: true, log: (line) => lines.push(line) });
  assert.equal(repaired.exitCode, 0, repaired.problems.join(' | '));
  assert.equal(repaired.report.anomalies, 0);
  assert.equal(repaired.report.inscriptionsMapped, 2);
  assert.ok(lines.some((line) => /second passage : aucun doublon/.test(line)));
  assert.equal((await audit(sqlite)).exitCode, 0, 'et l’audit en lecture seule est ensuite vert');
});

test('empreintes : --apply échoue si une table préexistante change pendant la réparation', async () => {
  const { sqlite } = await database({ synced: 1 });
  const tampered = await audit(sqlite, {
    apply: true,
    afterApply: ({ sqlite: db }) => db.prepare("UPDATE inscriptions SET taille_maillot = '12 ans' WHERE id = 1").run(),
  });
  assert.equal(tampered.exitCode, 1);
  assert.ok(tampered.problems.some((p) => /préexistante/.test(p)));
});

test('aucune donnée personnelle dans la sortie de l’audit', async () => {
  const { sqlite } = await database({ synced: 1 });
  const lines = [];
  await audit(sqlite, { apply: true, log: (line) => lines.push(line) });
  assert.doesNotMatch(lines.join('\n'), /Enfant\d|Fictif|Parent\d|example\.test|0600000/);
});

// ---------------------------------------------------------------------------------------------
// CLI de bout en bout, sur un export SQL

const sqlValue = (value) => (value === null ? 'NULL' : typeof value === 'number' || typeof value === 'bigint' ? String(value) : `'${String(value).replaceAll("'", "''")}'`);
// Même ordre qu'un export réel (sqlite .dump, wrangler d1 export) : tables, données, PUIS index et triggers. Rejouer
// les triggers avant les données les déclencherait au chargement (ex. migration 13 : une organisation insérée crée sa
// ligne d'état, puis la ligne d'état exportée entre en conflit).
function dump(sqlite) {
  const lines = [];
  const objects = sqlite.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid").all();
  const tables = objects.filter((o) => o.type === 'table');
  for (const object of tables) lines.push(`${object.sql};`);
  for (const table of tables) {
    for (const row of sqlite.prepare(`SELECT * FROM "${table.name}"`).all()) {
      lines.push(`INSERT INTO "${table.name}" (${Object.keys(row).map((c) => `"${c}"`).join(', ')}) VALUES (${Object.values(row).map(sqlValue).join(', ')});`);
    }
  }
  for (const object of objects.filter((o) => o.type !== 'table')) lines.push(`${object.sql};`);
  return lines.join('\n');
}
const cli = (file, ...args) => spawnSync(process.execPath, ['--no-warnings', 'scripts/crm-reconcile.mjs', file, ...args], { encoding: 'utf8' });

test('CLI : base saine → 0 ; base incohérente → 1 en lecture seule ; --apply → 0 ; --remote refusé', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-'));
  try {
    const healthy = await database();
    const healthyFile = join(dir, 'saine.sql');
    writeFileSync(healthyFile, dump(healthy.sqlite));
    assert.equal(cli(healthyFile).status, 0);

    const broken = await database({ synced: 1 });
    const brokenFile = join(dir, 'incoherente.sql');
    writeFileSync(brokenFile, dump(broken.sqlite));
    const readOnly = cli(brokenFile);
    assert.equal(readOnly.status, 1, readOnly.stdout);
    assert.doesNotMatch(readOnly.stdout, /Réconciliation sans anomalie/);
    assert.doesNotMatch(readOnly.stdout, /Enfant\d|Fictif|Parent\d|example\.test/, 'compteurs seulement');
    const applied = cli(brokenFile, '--apply');
    assert.equal(applied.status, 0, applied.stdout);

    assert.equal(cli(healthyFile, '--remote').status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
