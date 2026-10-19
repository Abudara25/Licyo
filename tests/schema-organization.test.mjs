import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { applyMigrations, MIGRATIONS, DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { resolveOrganization, clearOrganizationCache } from '../functions/_shared/organization.js';
import { createD1 } from './helpers/d1.mjs';

// Base dans l'état de la production avant la phase 1 : tables créées par l'ancien code, sans organization_id.
async function legacyDatabase() {
  resetSchemaCacheForTests();
  const db = createD1();
  await db.prepare(`CREATE TABLE inscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    enfant_prenom TEXT NOT NULL, enfant_nom TEXT NOT NULL, naissance TEXT NOT NULL, categorie TEXT NOT NULL,
    taille_maillot TEXT NOT NULL, parent_prenom TEXT NOT NULL, parent_nom TEXT NOT NULL, email TEXT NOT NULL,
    telephone TEXT, adresse TEXT, code_postal TEXT, ville TEXT, autorisation INTEGER NOT NULL, droit_image INTEGER NOT NULL,
    rgpd INTEGER NOT NULL, upload_token TEXT, paye INTEGER NOT NULL DEFAULT 0, saison TEXT)`).run();
  await db.prepare(`INSERT INTO inscriptions (enfant_prenom, enfant_nom, naissance, categorie, taille_maillot, parent_prenom, parent_nom, email, autorisation, droit_image, rgpd, upload_token, paye, saison)
    VALUES ('Léa', 'Durand', '2020-02-29', 'U6 - U7', '6 ans', 'Samia', 'Durand', 'a@example.fr', 1, 0, 1, 'tok-lea', 1, '2026-2027'),
           ('Tom', 'Petit', '2019-05-01', 'U8 - U9', '8 ans', 'Karim', 'Petit', 'b@example.fr', 1, 1, 1, 'tok-tom', 0, '2026-2027')`).run();
  await db.prepare("CREATE TABLE email_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), kind TEXT NOT NULL, origin TEXT, inscription_id INTEGER, recipients TEXT, subject TEXT, ok INTEGER NOT NULL, status INTEGER, message_id TEXT, error TEXT)").run();
  await db.prepare("INSERT INTO email_log (kind, inscription_id, recipients, ok) VALUES ('relance', 1, 'a@example.fr', 1)").run();
  await db.prepare('CREATE TABLE admin_sessions (token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
  await db.prepare("INSERT INTO admin_sessions VALUES ('hash', 1, 9999999999)").run();
  return db;
}

test('migration d’une base existante : aucune donnée perdue, tout rattaché à Sportville', async () => {
  const db = await legacyDatabase();
  await ensureSchema(db);

  const { results } = await db.prepare('SELECT enfant_prenom, upload_token, paye, organization_id FROM inscriptions ORDER BY id').all();
  assert.deepEqual(results.map((r) => ({ ...r })), [
    { enfant_prenom: 'Léa', upload_token: 'tok-lea', paye: 1, organization_id: DEMO_ORG_ID },
    { enfant_prenom: 'Tom', upload_token: 'tok-tom', paye: 0, organization_id: DEMO_ORG_ID },
  ]);
  assert.equal((await db.prepare('SELECT organization_id FROM email_log').first()).organization_id, DEMO_ORG_ID);
  assert.equal((await db.prepare('SELECT organization_id FROM admin_sessions').first()).organization_id, DEMO_ORG_ID, 'les sessions ouvertes restent valides');
  const org = await db.prepare('SELECT * FROM organizations').all();
  assert.equal(org.results.length, 1, 'une seule organisation en production');
  assert.equal(org.results[0].slug, 'club-demo');
  const { results: versions } = await db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  assert.deepEqual(versions.map((v) => v.version), MIGRATIONS.map((m) => m.version));
});

test('migration rejouée (nouvelle instance) et lancée deux fois en parallèle : aucune corruption', async () => {
  const db = await legacyDatabase();
  await Promise.all([applyMigrationsAfterLegacy(db), applyMigrationsAfterLegacy(db)]);
  resetSchemaCacheForTests();
  await ensureSchema(db);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 2);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM organizations').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM organization_domains').first()).n, 3);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').first()).n, MIGRATIONS.length);
});

async function applyMigrationsAfterLegacy(db) {
  await ensureSchema(db); // même promesse partagée dans une instance…
  await applyMigrations(db); // …puis un second passage direct, comme un autre Worker
}

test('migration en échec : rien d’appliqué pour elle, erreur remontée, reprise possible', async () => {
  const db = await legacyDatabase();
  await ensureSchema(db);
  let broken = true;
  const extra = [...MIGRATIONS, {
    version: 999,
    name: 'test_en_echec',
    statements: (d) => [
      d.prepare('CREATE TABLE test_partielle (id INTEGER)'),
      d.prepare(broken ? 'INSERT INTO table_absente VALUES (1)' : 'INSERT INTO test_partielle VALUES (1)'),
    ],
  }];
  await assert.rejects(applyMigrations(db, extra));
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'test_partielle'").first(), null, 'transaction annulée');
  assert.equal(await db.prepare('SELECT version FROM schema_migrations WHERE version = 999').first(), null);
  broken = false;
  await applyMigrations(db, extra);
  assert.ok(await db.prepare('SELECT version FROM schema_migrations WHERE version = 999').first());
});

test('organisation déterminée par le domaine, jamais par le navigateur', async () => {
  resetSchemaCacheForTests();
  clearOrganizationCache();
  const env = { DB: createD1() };
  const at = (url) => resolveOrganization(new Request(url), env);

  assert.equal((await at('https://clubdemo.licyo.fr/inscription.html')).id, DEMO_ORG_ID);
  assert.equal((await at('https://www.clubdemo.licyo.fr/')).id, DEMO_ORG_ID);
  assert.equal((await at('https://3f2a1b.licyo.pages.dev/')).id, DEMO_ORG_ID, 'prévisualisation Cloudflare');
  assert.equal((await at('http://localhost:8788/')).id, DEMO_ORG_ID, 'développement local');
  assert.equal((await at('https://clubdemo.licyo.fr/?organization_id=org_autre')).id, DEMO_ORG_ID, 'paramètre ignoré');

  assert.equal(await at('https://inconnu.example/'), null);
  assert.equal(await at('https://clubdemo.licyo.fr.evil.example/'), null, 'domaine piégé');
  assert.equal(await at('https://faux-clubdemo.licyo.fr/'), null);

  await env.DB.prepare("UPDATE organizations SET status = 'suspended'").run();
  clearOrganizationCache();
  assert.equal(await at('https://clubdemo.licyo.fr/'), null, 'organisation suspendue');
});
