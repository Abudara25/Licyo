// Invariants du schéma multi-organisation (audit contradictoire de la phase 1) : une base peut indiquer
// des migrations appliquées sans avoir le schéma correspondant (restauration partielle, table recréée),
// ou recevoir des lignes sans organisation après un retour temporaire à l'ancien code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { createD1 } from './helpers/d1.mjs';

const columns = async (db, table) => new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map((c) => c.name));
const indexes = async (db, table) => new Set((await db.prepare(`PRAGMA index_list(${table})`).all()).results.map((i) => i.name));

async function migratedDatabase() {
  resetSchemaCacheForTests();
  const db = createD1();
  await ensureSchema(db);
  return db;
}

// Ce que l'ancien code (avant la phase 1) écrit : aucune colonne organization_id.
const legacyInsert = (db, prenom) =>
  db.prepare(
    `INSERT INTO inscriptions (enfant_prenom, enfant_nom, naissance, categorie, taille_maillot, parent_prenom, parent_nom, email, autorisation, droit_image, rgpd, upload_token, saison)
     VALUES (?, 'Durand', '2020-02-29', 'U6 - U7', '6 ans', 'Samia', 'Durand', 'a@example.fr', 1, 0, 1, ?, '2026-2027')`
  ).bind(prenom, `tok-${prenom}`).run();

test('migrations marquées appliquées mais organization_id absent : la colonne est recréée et remplie', async () => {
  resetSchemaCacheForTests();
  const db = createD1();
  // État incohérent : les tables existent sans organization_id, mais schema_migrations dit 1, 2 et 3.
  await db.prepare(`CREATE TABLE inscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    enfant_prenom TEXT NOT NULL, enfant_nom TEXT NOT NULL, naissance TEXT NOT NULL, categorie TEXT NOT NULL, taille_maillot TEXT NOT NULL,
    parent_prenom TEXT NOT NULL, parent_nom TEXT NOT NULL, email TEXT NOT NULL, autorisation INTEGER NOT NULL, droit_image INTEGER NOT NULL,
    rgpd INTEGER NOT NULL, upload_token TEXT, saison TEXT)`).run();
  await legacyInsert(db, 'Léa');
  await db.prepare("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
  await db.prepare("INSERT INTO schema_migrations (version, name) VALUES (1, 'organizations'), (2, 'baseline_email_log_admin_sessions'), (3, 'organization_id_phase1')").run();

  await ensureSchema(db);

  for (const table of ['inscriptions', 'email_log', 'admin_sessions']) {
    assert.ok((await columns(db, table)).has('organization_id'), `${table}.organization_id`);
  }
  assert.equal((await db.prepare('SELECT organization_id FROM inscriptions').first()).organization_id, DEMO_ORG_ID);
  assert.ok(await db.prepare("SELECT id FROM organizations WHERE id = ? AND status = 'active'").bind(DEMO_ORG_ID).first(), 'organisation recréée');
  assert.ok(await db.prepare("SELECT domain FROM organization_domains WHERE domain = 'clubdemo.licyo.fr'").first(), 'domaine recréé');
  assert.ok((await indexes(db, 'inscriptions')).has('idx_inscriptions_org_created_at'));
  assert.ok((await indexes(db, 'email_log')).has('idx_email_log_org_id'));
});

test('retour à l’ancien code puis nouveau code : les fiches sans organisation sont récupérées', async () => {
  const db = await migratedDatabase();
  await legacyInsert(db, 'Tom'); // écrit par l'ancien code, déployé temporairement
  await db.prepare("INSERT INTO email_log (kind, ok) VALUES ('relance', 1)").run();
  await db.prepare("INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES ('h', 1, 9999999999)").run();
  assert.equal((await db.prepare("SELECT organization_id FROM inscriptions WHERE enfant_prenom = 'Tom'").first()).organization_id, null);

  resetSchemaCacheForTests(); // nouvelle instance du nouveau code
  await ensureSchema(db);

  for (const table of ['inscriptions', 'email_log', 'admin_sessions']) {
    const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id IS NULL`).first();
    assert.equal(n, 0, `${table} sans ligne orpheline`);
  }
  assert.equal((await db.prepare("SELECT organization_id FROM inscriptions WHERE enfant_prenom = 'Tom'").first()).organization_id, DEMO_ORG_ID);
});

test('lignes sans organisation alors que plusieurs organisations existent : échec explicite, rien de deviné', async () => {
  const db = await migratedDatabase();
  await db.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'b', 'B')").run();
  await legacyInsert(db, 'Zoé');
  resetSchemaCacheForTests();
  await assert.rejects(ensureSchema(db), /organization_id.*inscriptions.*plusieurs organisations/s);
  assert.equal((await db.prepare("SELECT organization_id FROM inscriptions WHERE enfant_prenom = 'Zoé'").first()).organization_id, null, 'aucun rattachement deviné');
});

test('schéma cohérent : le contrôle ne change rien au second passage', async () => {
  const db = await migratedDatabase();
  await legacyInsert(db, 'Inès');
  resetSchemaCacheForTests();
  await ensureSchema(db);
  const snapshot = JSON.stringify((await db.prepare('SELECT * FROM inscriptions ORDER BY id').all()).results);
  const versions = (await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').first()).n;
  resetSchemaCacheForTests();
  await ensureSchema(db);
  assert.equal(JSON.stringify((await db.prepare('SELECT * FROM inscriptions ORDER BY id').all()).results), snapshot);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').first()).n, versions);
});

test('migration 5 : helloasso_orders existante reconstruite sans perte, rattachée à Sportville, rejouable', async () => {
  resetSchemaCacheForTests();
  const db = createD1();
  // Table telle que l'ancien code la créait, avec des commandes déjà traitées.
  await db.prepare(`CREATE TABLE helloasso_orders (order_id TEXT PRIMARY KEY, received_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL, inscription_ids TEXT, payer_email TEXT, detail TEXT)`).run();
  await db.prepare("INSERT INTO helloasso_orders (order_id, received_at, status, inscription_ids, payer_email) VALUES ('C-1', '2026-09-10 10:00:00', 'matched', '4', 'p@example.fr'), ('C-2', '2026-09-11 10:00:00', 'unmatched', '', NULL)").run();

  await ensureSchema(db);
  const rows = (await db.prepare('SELECT organization_id, order_id, received_at, status, inscription_ids, payer_email FROM helloasso_orders ORDER BY order_id').all()).results;
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { organization_id: DEMO_ORG_ID, order_id: 'C-1', received_at: '2026-09-10 10:00:00', status: 'matched', inscription_ids: '4', payer_email: 'p@example.fr' },
    { organization_id: DEMO_ORG_ID, order_id: 'C-2', received_at: '2026-09-11 10:00:00', status: 'unmatched', inscription_ids: '', payer_email: null },
  ]);
  // Même numéro de commande pour une autre organisation : accepté ; doublon dans la même : refusé.
  await db.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'b', 'B')").run();
  await db.prepare("INSERT INTO helloasso_orders (organization_id, order_id, status) VALUES ('org_b', 'C-1', 'matched')").run();
  await assert.rejects(db.prepare("INSERT INTO helloasso_orders (organization_id, order_id, status) VALUES ('org_b', 'C-1', 'matched')").run(), /UNIQUE/);

  resetSchemaCacheForTests();
  await ensureSchema(db);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM helloasso_orders').first()).n, 3, 'second passage sans effet');
});
