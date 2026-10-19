// Phase 4D.2B (durcissement) : intégrité de la configuration du site en base.
//   - site_configs est créée par la migration 11, et seulement par elle ; absente alors que la migration est
//     enregistrée, ou structurellement différente (colonnes, types, NOT NULL, défauts, clé primaire, clé étrangère,
//     contraintes CHECK) : échec explicite, jamais recréée, remplacée, modifiée ni réamorcée ;
//   - migration 12 : marqueur d'initialisation hors de site_configs ; une ligne disparue après initialisation n'est
//     jamais confondue avec un premier accès (aucun réamorçage, aucune republication de la référence du code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { repairSchemaInvariants, SchemaIntegrityError, SITE_CONFIGS_COLUMNS, siteConfigsStructureProblems } from '../functions/_shared/schema.js';
import { ensureInscriptionsTable } from '../functions/_shared/inscriptions-db.js';
import { readSiteConfig, saveDraftSiteConfig, publishSiteConfig, loadPublishedSite, clearPublishedSiteCache } from '../functions/_shared/site-config.js';
import { onRequest } from '../functions/_shared/public-site.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { site as demoSite } from '../sites/club-demo/site.js';
import { exempleSite } from './fixtures/site-exemple.mjs';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = exempleSite.organizationId;
const COLUMNS = SITE_CONFIGS_COLUMNS.map(([name]) => name).join(', ');
const clone = (value) => JSON.parse(JSON.stringify(value));
const tableSql = async (db) => (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'site_configs'").first())?.sql ?? null;
const rows = async (db) => (await db.prepare('SELECT * FROM site_configs ORDER BY organization_id').all()).results;
const marker = async (db, org) => (await db.prepare('SELECT site_config_initialized_at AS at FROM organizations WHERE id = ?').bind(org).first())?.at ?? null;
// Nouvelle instance du Worker : même base, préparation du schéma relancée (cache par binding).
const freshBinding = (db) => ({ prepare: (sql) => db.prepare(sql), batch: (statements) => db.batch(statements) });

async function setup({ withB = false } = {}) {
  clearPublishedSiteCache();
  clearOrganizationCache();
  const env = await fixture();
  if (withB) {
    await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'atelier-exemple', 'Atelier Exemple')").bind(B).run();
    await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('atelier.example', ?)").bind(B).run();
  }
  // Configuration réellement modifiée puis publiée depuis l'admin : c'est elle qu'il ne faut jamais perdre.
  const edited = clone(demoSite);
  edited.brand.tagline = 'Accroche publiée par le club';
  await readSiteConfig(env, A);
  await saveDraftSiteConfig(env, A, edited, { expectedRevision: 1 });
  await publishSiteConfig(env, A);
  return env;
}

// Remplace site_configs par une variante de sa définition (données recopiées), comme une table reconstruite à la main.
async function alterTable(db, mutate) {
  const sql = await tableSql(db);
  const altered = mutate(sql);
  assert.notEqual(altered, sql, 'la variante doit différer');
  await db.batch([
    db.prepare('ALTER TABLE site_configs RENAME TO site_configs_old'),
    db.prepare(altered),
    db.prepare(`INSERT INTO site_configs (${COLUMNS}) SELECT ${COLUMNS} FROM site_configs_old`),
    db.prepare('DROP TABLE site_configs_old'),
  ]);
}

// --- P1 #3 : contrôle structurel ------------------------------------------------------------------------------------

test('table créée par la migration 11 : acceptée (colonnes, types, NOT NULL, défauts, clés, contraintes)', async () => {
  const env = await fixture();
  assert.ok(await env.DB.prepare('SELECT 1 FROM schema_migrations WHERE version = 11').first());
  const { results } = await env.DB.prepare('PRAGMA table_info(site_configs)').all();
  assert.deepEqual(results.map((c) => [c.name, c.type, c.notnull, c.dflt_value, c.pk]), SITE_CONFIGS_COLUMNS);
  assert.deepEqual(await siteConfigsStructureProblems(env.DB), []);
  assert.equal(await repairSchemaInvariants(env.DB), 0, 'rien à réparer');
  await ensureInscriptionsTable(freshBinding(env.DB));
});

const VARIANTS = {
  'clé étrangère absente': (sql) => sql.replace(' REFERENCES organizations(id)', ''),
  'clé étrangère avec ON DELETE CASCADE': (sql) => sql.replace('REFERENCES organizations(id)', 'REFERENCES organizations(id) ON DELETE CASCADE'),
  'NOT NULL manquant': (sql) => sql.replace('draft_json TEXT NOT NULL', 'draft_json TEXT'),
  'mauvais type': (sql) => sql.replace('draft_revision INTEGER NOT NULL', 'draft_revision TEXT NOT NULL'),
  'mauvaise valeur par défaut': (sql) => sql.replace("DEFAULT 'reference'", "DEFAULT 'edited'"),
  'clé primaire absente': (sql) => sql.replace('organization_id TEXT PRIMARY KEY NOT NULL', 'organization_id TEXT NOT NULL'),
  'clé primaire remplacée par UNIQUE': (sql) => sql.replace('organization_id TEXT PRIMARY KEY NOT NULL', 'organization_id TEXT UNIQUE NOT NULL'),
  'contrainte publiée ⇔ révision absente': (sql) => sql.replace(',\n        CHECK ((published_json IS NULL) = (published_revision IS NULL))', ''),
  'contrainte JSON absente': (sql) => sql.replace(' CHECK (json_valid(draft_json))', ''),
  'contrainte de révision affaiblie': (sql) => sql.replace('CHECK (draft_revision >= 1)', 'CHECK (draft_revision >= 0)'),
  'colonne en plus': (sql) => sql.replace('updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')),', 'updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')),\n        extra TEXT,'),
};

for (const [name, mutate] of Object.entries(VARIANTS)) {
  test(`table altérée (${name}) : refusée, jamais modifiée, aucune donnée perdue`, async () => {
    const env = await setup();
    const published = (await rows(env.DB))[0].published_json;
    await alterTable(env.DB, mutate);
    // État de la table altérée (valeurs éventuellement converties par la copie) : le contrôle ne doit rien y changer.
    const before = await rows(env.DB);
    assert.equal(before[0].published_json, published, 'configuration publiée recopiée');
    const sql = await tableSql(env.DB);
    assert.ok((await siteConfigsStructureProblems(env.DB)).length > 0, 'écart détecté');
    await assert.rejects(repairSchemaInvariants(env.DB), SchemaIntegrityError);
    await assert.rejects(ensureInscriptionsTable(freshBinding(env.DB)), SchemaIntegrityError);
    assert.equal(await tableSql(env.DB), sql, 'table jamais remplacée');
    assert.deepEqual(await rows(env.DB), before, 'données intactes');
  });
}

test('garde-fous de la migration 12 : date de publication ⇔ version publiée, imposée par la base', async () => {
  const env = await setup();
  await assert.rejects(env.DB.prepare('UPDATE site_configs SET published_at = NULL WHERE organization_id = ?').bind(A).run(), /date de publication/);
  await assert.rejects(
    env.DB.prepare("INSERT INTO site_configs (organization_id, origin, draft_json, draft_revision, published_json, published_revision) VALUES (?, 'edited', '{}', 1, '{}', 1)").bind(A).run(),
    /date de publication/
  );
});

test('garde-fou manquant : recréé (additif) ; garde-fou modifié : refusé sans rien toucher', async () => {
  const env = await setup();
  const before = await rows(env.DB);
  await env.DB.prepare('DROP TRIGGER site_configs_published_at_update').run();
  assert.equal(await repairSchemaInvariants(env.DB), 1);
  assert.ok(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'site_configs_published_at_update'").first());
  assert.deepEqual(await rows(env.DB), before);

  await env.DB.batch([
    env.DB.prepare('DROP TRIGGER site_configs_published_at_insert'),
    env.DB.prepare("CREATE TRIGGER site_configs_published_at_insert BEFORE INSERT ON site_configs WHEN 0 BEGIN SELECT RAISE(ABORT, 'x'); END"),
  ]);
  await assert.rejects(repairSchemaInvariants(env.DB), (error) => error instanceof SchemaIntegrityError && /site_configs_published_at_insert/.test(error.message));
  assert.match((await env.DB.prepare("SELECT sql FROM sqlite_master WHERE name = 'site_configs_published_at_insert'").first()).sql, /WHEN 0/, 'non remplacé');
});

test('lignes qui violent les invariants (garde-fous contournés) : échec explicite, rien modifié', async () => {
  const env = await setup();
  await env.DB.batch([
    env.DB.prepare('DROP TRIGGER site_configs_published_at_update'),
    env.DB.prepare('UPDATE site_configs SET published_at = NULL WHERE organization_id = ?').bind(A),
  ]);
  const before = await rows(env.DB);
  await assert.rejects(repairSchemaInvariants(env.DB), (error) => error instanceof SchemaIntegrityError && /violent ses invariants/.test(error.message));
  assert.deepEqual(await rows(env.DB), before);
  assert.equal(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE name = 'site_configs_published_at_update'").first(), null, 'garde-fou non recréé sur des données incohérentes');
});

test('table absente alors que la migration 11 est enregistrée : échec explicite, rien recréé ni réamorcé', async (t) => {
  const env = await setup();
  await env.DB.prepare('DROP TABLE site_configs').run();
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(repairSchemaInvariants(env.DB), (error) => error instanceof SchemaIntegrityError && /site_configs a disparu/.test(error.message));
  await assert.rejects(ensureInscriptionsTable(freshBinding(env.DB)), SchemaIntegrityError);
  assert.equal(await tableSql(env.DB), null, 'table non recréée');
  clearPublishedSiteCache();
  await assert.rejects(loadPublishedSite({ DB: freshBinding(env.DB) }, A));
  await assert.rejects(saveDraftSiteConfig({ DB: freshBinding(env.DB) }, A, clone(demoSite), { expectedRevision: 2 }));
  assert.equal(await tableSql(env.DB), null);
});

test('migration 11 pas encore appliquée : l’absence de la table n’est pas une erreur (la migration la créera)', async () => {
  const env = await fixture();
  await env.DB.batch([env.DB.prepare('DROP TABLE site_configs'), env.DB.prepare('DELETE FROM schema_migrations WHERE version = 11')]);
  assert.equal(await repairSchemaInvariants(env.DB), 0);
  await ensureInscriptionsTable(freshBinding(env.DB));
  assert.deepEqual(await siteConfigsStructureProblems(env.DB), [], 'créée par la migration 11, conforme');
});

// --- P1 #2 : marqueur d'initialisation --------------------------------------------------------------------------------

test('premier amorçage : ligne créée ET marqueur posé (même transaction) ; accès concurrents sans erreur', async () => {
  clearPublishedSiteCache();
  const env = await fixture();
  assert.equal(await marker(env.DB, A), null, 'jamais initialisée');
  const [first, second] = await Promise.all([readSiteConfig(env, A), loadPublishedSite(env, A)]);
  assert.equal(first.publishedRevision, 1);
  assert.ok(second);
  assert.ok(await marker(env.DB, A), 'marqueur posé');
  assert.equal((await rows(env.DB)).length, 1);
});

test('première configuration d’une organisation sans référence : marqueur posé avec la ligne', async () => {
  const env = await setup({ withB: true });
  assert.equal(await marker(env.DB, B), null);
  await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
  assert.ok(await marker(env.DB, B));
});

test('ligne supprimée après initialisation : erreur d’intégrité, aucun réamorçage ni republication, rien remplacé', async (t) => {
  const env = await setup({ withB: true });
  await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
  await publishSiteConfig(env, B);
  const markers = { a: await marker(env.DB, A), b: await marker(env.DB, B) };
  const rowB = (await rows(env.DB)).find((r) => r.organization_id === B);
  await env.DB.prepare('DELETE FROM site_configs WHERE organization_id = ?').bind(A).run();
  clearPublishedSiteCache();
  t.mock.method(console, 'warn', () => {});

  await assert.rejects(loadPublishedSite(env, A), SchemaIntegrityError);
  await assert.rejects(readSiteConfig(env, A), SchemaIntegrityError);
  await assert.rejects(saveDraftSiteConfig(env, A, clone(demoSite), { expectedRevision: 0 }), SchemaIntegrityError);
  await assert.rejects(publishSiteConfig(env, A), SchemaIntegrityError);
  assert.equal((await rows(env.DB)).length, 1, 'aucune ligne recréée pour Sportville');
  assert.deepEqual((await rows(env.DB))[0], rowB, 'ligne de B intacte');
  assert.deepEqual({ a: await marker(env.DB, A), b: await marker(env.DB, B) }, markers, 'marqueurs inchangés');

  // Site public : Sportville sert son secours statique, sans republier la référence ; B n'est pas affectée.
  const ASSETS = { fetch: async () => new Response('<p>statique</p>', { headers: { 'Content-Type': 'text/html' } }) };
  const sg = await onRequest({ request: new Request('https://clubdemo.licyo.fr/equipe'), env: { ...env, ASSETS } });
  assert.equal(sg.status, 200);
  assert.equal((await rows(env.DB)).length, 1, 'toujours aucune ligne recréée');
  assert.equal((await loadPublishedSite(env, B)).config.organizationId, B);

  // Même chose pour B (futur client) : ligne supprimée → erreur, jamais une nouvelle configuration vide.
  await env.DB.prepare('DELETE FROM site_configs WHERE organization_id = ?').bind(B).run();
  clearPublishedSiteCache();
  await assert.rejects(loadPublishedSite(env, B), SchemaIntegrityError);
  await assert.rejects(saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 }), SchemaIntegrityError);
  const pageB = await onRequest({ request: new Request('https://atelier.example/'), env: { ...env, ASSETS } });
  assert.equal(pageB.status, 503, 'B : échec fermé');
  assert.equal((await rows(env.DB)).length, 0);
});

test('migration 12 sur une base déjà en migration 11 : organisations ayant une ligne marquées (date de création)', async () => {
  const env = await setup();
  const created = (await rows(env.DB))[0].created_at;
  await env.DB.batch([
    env.DB.prepare('ALTER TABLE organizations DROP COLUMN site_config_initialized_at'),
    env.DB.prepare('DELETE FROM schema_migrations WHERE version = 12'),
  ]);
  await ensureInscriptionsTable(freshBinding(env.DB));
  assert.equal(await marker(env.DB, A), created);
  const before = await rows(env.DB);
  assert.equal(before[0].published_json.includes('Accroche publiée par le club'), true, 'configuration intacte');
});

test('marqueur absent alors que la ligne existe : posé au démarrage (seule réparation, additive)', async () => {
  const env = await setup();
  await env.DB.prepare('UPDATE organizations SET site_config_initialized_at = NULL WHERE id = ?').bind(A).run();
  const before = await rows(env.DB);
  assert.equal(await repairSchemaInvariants(env.DB), 1);
  assert.ok(await marker(env.DB, A));
  assert.deepEqual(await rows(env.DB), before);
});

test('colonne de marqueur perdue alors que la migration 12 est enregistrée : échec explicite, rien recréé', async () => {
  const env = await setup();
  await env.DB.prepare('ALTER TABLE organizations DROP COLUMN site_config_initialized_at').run();
  await assert.rejects(repairSchemaInvariants(env.DB), (error) => error instanceof SchemaIntegrityError && /site_config_initialized_at/.test(error.message));
  const { results } = await env.DB.prepare('PRAGMA table_info(organizations)').all();
  assert.ok(!results.some((c) => c.name === 'site_config_initialized_at'), 'colonne non recréée');
});
