// Raccourci de démarrage de ensureSchema (2026-10-08) : contrôle complet une fois par build et par structure de base,
// puis un seul aller-retour D1 aux démarrages suivants. Toute modification de structure relance le contrôle complet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, resetSchemaCacheForTests, setSchemaFastPathForTests } from '../functions/_shared/inscriptions-db.js';
import { createD1 } from './helpers/d1.mjs';
import { buildInfoModule } from '../scripts/build-news.mjs';

// Compte les allers-retours vers la base : chaque requête exécutée seule, ou chaque batch.
function counting(db) {
  const stats = { roundTrips: 0 };
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const wrap = (statement) => ({
    ...statement,
    bind: (...args) => wrap(statement.bind(...args)),
    run: () => (stats.roundTrips++, statement.run()),
    all: () => (stats.roundTrips++, statement.all()),
    first: (...a) => (stats.roundTrips++, statement.first(...a)),
    raw: (...a) => (stats.roundTrips++, statement.raw(...a)),
    __inner: statement,
  });
  db.prepare = (sql) => wrap(prepare(sql));
  db.batch = (statements) => (stats.roundTrips++, batch(statements.map((s) => s.__inner || s)));
  return stats;
}

const start = async (db) => {
  resetSchemaCacheForTests();
  await ensureSchema(db);
};

test('raccourci : contrôle complet au premier démarrage, un seul aller-retour ensuite', async (t) => {
  t.after(() => setSchemaFastPathForTests(null));
  setSchemaFastPathForTests('build-a');
  const db = createD1();
  const stats = counting(db);
  await start(db);
  const first = stats.roundTrips;
  assert.ok(first > 50, `contrôle complet attendu (${first})`);
  stats.roundTrips = 0;
  await start(db);
  assert.equal(stats.roundTrips, 1);
});

test('raccourci : nouveau build ou objet supprimé = contrôle complet (et réparation)', async (t) => {
  t.after(() => setSchemaFastPathForTests(null));
  setSchemaFastPathForTests('build-a');
  const db = createD1();
  const stats = counting(db);
  await start(db);

  setSchemaFastPathForTests('build-b');
  stats.roundTrips = 0;
  await start(db);
  assert.ok(stats.roundTrips > 50, 'nouveau build');

  const index = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_inscriptions_org_created_at'").first())?.name;
  assert.equal(index, 'idx_inscriptions_org_created_at');
  await db.prepare('DROP INDEX idx_inscriptions_org_created_at').run();
  stats.roundTrips = 0;
  await start(db);
  assert.ok(stats.roundTrips > 50, 'index supprimé');
  assert.ok(await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE name = 'idx_inscriptions_org_created_at'").first(), 'index recréé');

  stats.roundTrips = 0;
  await start(db);
  assert.equal(stats.roundTrips, 1);
});

test('raccourci désactivé hors build Pages (« dev ») : comportement inchangé', async () => {
  setSchemaFastPathForTests(null);
  const db = createD1();
  const stats = counting(db);
  await start(db);
  stats.roundTrips = 0;
  await start(db);
  assert.ok(stats.roundTrips > 50);
  assert.equal(await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE name = 'schema_checks'").first(), null);
});

test('identifiant de build : commit Pages + horodatage, sinon « dev »', () => {
  assert.match(buildInfoModule({}), /"buildId":"dev"/);
  assert.match(buildInfoModule({ CF_PAGES_COMMIT_SHA: 'abc1234' }), /"buildId":"abc1234-[0-9a-z]+"/);
  assert.match(buildInfoModule({ CF_PAGES_COMMIT_SHA: '"; alert(1)' }), /"buildId":"dev"/);
});
