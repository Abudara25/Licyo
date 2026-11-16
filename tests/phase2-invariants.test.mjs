// Consolidation phase 2.1 : invariants du schéma des données publiques (groupes, lieux, créneaux, tarifs),
// contraintes D1 et non-régression sur les inscriptions existantes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { createD1 } from './helpers/d1.mjs';
import { seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const names = async (db, type) => new Set((await db.prepare('SELECT name FROM sqlite_master WHERE type = ?').bind(type).all()).results.map((r) => r.name));

async function migrated() {
  resetSchemaCacheForTests();
  const db = createD1();
  await ensureSchema(db);
  return db;
}
const restart = async (db) => {
  resetSchemaCacheForTests();
  await ensureSchema(db);
};
const snapshotInscriptions = async (db) => JSON.stringify((await db.prepare('SELECT * FROM inscriptions ORDER BY id').all()).results);
const structure = async (db) => JSON.stringify((await db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY name').all()).results);

for (const dropped of [['group_schedules', 'groups'], ['prices'], ['group_schedules', 'locations'], ['group_schedules']]) {
  test(`migration 6 enregistrée mais ${dropped.join(' + ')} absent : recréé au démarrage, inscriptions intactes`, async () => {
    const db = await migrated();
    await seedInscription(db, { enfant_prenom: 'Lina' });
    const before = await snapshotInscriptions(db);
    for (const table of dropped) await db.prepare(`DROP TABLE ${table}`).run();
    assert.ok(!(await names(db, 'table')).has(dropped[0]));

    await restart(db);

    const tables = await names(db, 'table');
    for (const table of dropped) assert.ok(tables.has(table), `${table} recréée`);
    await db.prepare('SELECT * FROM groups WHERE organization_id = ?').bind(A).all(); // ne lève plus « no such table »
    assert.equal(await snapshotInscriptions(db), before, 'aucune inscription touchée');
  });
}

test('index manquants recréés, second passage sans effet', async () => {
  const db = await migrated();
  await db.prepare('DROP INDEX idx_locations_org').run();
  await db.prepare('DROP INDEX idx_group_schedules_org').run();
  await restart(db);
  const indexes = await names(db, 'index');
  assert.ok(indexes.has('idx_locations_org'));
  assert.ok(indexes.has('idx_group_schedules_org'));
  const before = await structure(db);
  await restart(db);
  assert.equal(await structure(db), before, 'idempotent');
});

test('colonne organization_id absente d’une table de la phase 2 : recréée, lignes rattachées à la seule organisation', async () => {
  const db = await migrated();
  await db.prepare('DROP TABLE prices').run();
  await db.prepare(
    `CREATE TABLE prices (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, label TEXT NOT NULL, amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR', is_public INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, group_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  await db.prepare("INSERT INTO prices (slug, label, amount_cents) VALUES ('adhesion-saison', 'Adhésion', 18000)").run();
  await restart(db);
  assert.deepEqual({ ...(await db.prepare('SELECT organization_id, amount_cents FROM prices').first()) }, { organization_id: A, amount_cents: 18000 });
});

test('colonne essentielle (is_public) absente : ajoutée avec sa valeur par défaut, lignes conservées', async () => {
  const db = await migrated();
  for (const table of ['group_schedules', 'prices', 'groups']) await db.prepare(`DROP TABLE ${table}`).run();
  await db.prepare(
    `CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL REFERENCES organizations(id), slug TEXT NOT NULL, name TEXT NOT NULL,
      birth_year_min INTEGER, birth_year_max INTEGER, is_active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (organization_id, slug))`
  ).run();
  await db.prepare("INSERT INTO groups (organization_id, slug, name) VALUES (?, 'u8-u9', 'U8 - U9')").bind(A).run();
  await restart(db);
  assert.deepEqual({ ...(await db.prepare("SELECT slug, is_public FROM groups WHERE slug = 'u8-u9'").first()) }, { slug: 'u8-u9', is_public: 1 });
});

test('doublon de groupe (organisation, slug) sans contrainte d’unicité : échec explicite, rien n’est supprimé', async () => {
  const db = await migrated();
  for (const table of ['group_schedules', 'prices', 'groups']) await db.prepare(`DROP TABLE ${table}`).run();
  await db.prepare(
    `CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT, birth_year_min INTEGER, birth_year_max INTEGER, capacity INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0, payment_url TEXT, payment_widget_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  ).run();
  await db.prepare("INSERT INTO groups (organization_id, slug, name) VALUES (?, 'x', 'X1'), (?, 'x', 'X2')").bind(A, A).run();
  await assert.rejects(restart(db), /groups.*doublon/i);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM groups').first()).n, 2, 'aucune ligne supprimée');
});

test('contraintes : créneau, tarif et booléens invalides refusés par la base', async () => {
  const db = await migrated();
  const schedule = (start, end, weekday = 4) =>
    db.prepare('INSERT INTO group_schedules (organization_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)').bind(A, weekday, start, end).run();
  await assert.rejects(schedule('18:00', '17:00'), /heure|début/i);
  await assert.rejects(schedule('17:00', '17:00'), /heure|début/i);
  await assert.rejects(schedule('17:00', '18:00', 8));
  await assert.rejects(schedule('5pm', '6pm'), /heure|format/i);
  await schedule('17:00', '18:00');
  await assert.rejects(db.prepare("INSERT INTO prices (organization_id, slug, label, amount_cents) VALUES (?, 'p', 'P', -1)").bind(A).run(), /montant/i);
  await assert.rejects(db.prepare("INSERT INTO groups (organization_id, slug, name, is_active) VALUES (?, 'g', 'G', 2)").bind(A).run(), /0 ou 1/i);
  await assert.rejects(db.prepare("UPDATE group_schedules SET end_time = '10:00'").run(), /heure|début/i);
});

test('créneau strictement identique refusé (même organisation, groupe, lieu, jour, heures)', async () => {
  const db = await migrated();
  const insert = () =>
    db.prepare("INSERT INTO group_schedules (organization_id, group_id, location_id, weekday, start_time, end_time) VALUES (?, NULL, NULL, 4, '17:00', '18:00')").bind(A).run();
  await insert();
  await assert.rejects(insert(), /UNIQUE|unique/);
});

test('des doublons de créneaux déjà présents ne bloquent pas le démarrage et ne sont pas supprimés', async () => {
  const db = await migrated();
  await db.prepare('DROP INDEX idx_group_schedules_unique').run();
  await db.prepare('DELETE FROM schema_migrations WHERE version = 7').run();
  for (let i = 0; i < 2; i++) {
    await db.prepare("INSERT INTO group_schedules (organization_id, weekday, start_time, end_time) VALUES (?, 4, '17:00', '18:00')").bind(A).run();
  }
  await restart(db);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM group_schedules').first()).n, 2, 'doublons conservés');
  assert.ok(!(await names(db, 'index')).has('idx_group_schedules_unique'), 'index non créé tant que des doublons existent');
  assert.ok((await names(db, 'trigger')).size > 0, 'les garde-fous sans risque restent posés');
});
