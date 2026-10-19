// Phase 4E.1 — migration 13, contraintes et triggers en base (contrat 4E v3.1 §2 à §8) : T1, T16, T19 à T23, T27,
// T30, T31, T35 à T41. Écritures SQL directes (hostiles) : la base elle-même doit refuser, sans le code des services.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { repairSchemaInvariants, SchemaIntegrityError, MIGRATIONS } from '../functions/_shared/schema.js';
import {
  ARTICLES_TABLE_SQL, NEWS_STATE_TABLE_SQL, ARTICLES_INDEXES, NEWS_TRIGGERS, NEWS_DATA_CHECKS, NEWS_STATE_BACKFILL_SQL,
} from '../functions/_shared/news-schema.js';
import { newArticleId, newImportBatchId, isArticleId, isImportBatchId } from '../functions/_shared/article-model.js';
import { seedInscription } from './helpers/inscriptions.mjs';
import { createD1 } from './helpers/d1.mjs';
import { snapshot, compareSnapshots, MIGRATION_13_OBJECTS } from '../scripts/d1-snapshot.mjs';
import { A, B, setupNews, rowOf, stateOf } from './helpers/news.mjs';

const run = (env, sql, ...params) => env.DB.prepare(sql).bind(...params).run();
const first = (env, sql, ...params) => env.DB.prepare(sql).bind(...params).first();
const all = async (env, sql, ...params) => (await env.DB.prepare(sql).bind(...params).all()).results;
const DIGEST = 'a'.repeat(64);
const CHECKSUM = 'b'.repeat(64);
const X_OK = JSON.stringify({ title: 'Titre', excerpt: 'Résumé', category: 'club', date: '2026-02-28' });

// Brouillon normal (forme A de G1) inséré directement.
async function insertDraft(env, org = A, slug = `brouillon-${Math.random().toString(16).slice(2, 8)}`, draftJson = '{"v":1}') {
  const id = newArticleId();
  await run(env, 'INSERT INTO articles (id, organization_id, slug, draft_json) VALUES (?, ?, ?, ?)', id, org, slug, draftJson);
  return id;
}
// Lot d'import courant (action d'état conforme à S1/S2).
async function openImportBatch(env, org = A) {
  const batch = newImportBatchId();
  const state = await stateOf(env, org);
  await run(
    env,
    `UPDATE organization_news_state SET import_batch_id = ?, legacy_digest = ?, imported_at = datetime('now'), revision = ? + 1, updated_at = datetime('now') WHERE organization_id = ?`,
    batch, DIGEST, state.revision, org
  );
  return batch;
}
// INSERT legacy publié (forme B de G1), avec projections explicites.
function insertLegacy(env, { org = A, key = 'cle-legacy', slug = key, draftJson = X_OK, publishedJson = draftJson, projections, batch, revision = 1, checksum = CHECKSUM } = {}) {
  const p = projections ?? (() => { const o = JSON.parse(publishedJson); return [o.title, o.excerpt, o.category, o.date]; })();
  return run(
    env,
    `INSERT INTO articles (id, organization_id, slug, draft_json, published_json, published_revision, published_title, published_excerpt,
       published_category, published_for_at, first_published_at, last_published_at, legacy_source, legacy_key, import_checksum, import_batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 'content/articles.json', ?, ?, ?)`,
    newArticleId(), org, slug, draftJson, publishedJson, revision, ...p, key, checksum, batch
  );
}
// Publication par UPDATE d'un brouillon (chemin A de T36) : draft_json = published_json = X, dates et révision de G6.
function publishRaw(env, id, x, projections) {
  const p = projections ?? (() => { const o = JSON.parse(x); return [o.title, o.excerpt, o.category, o.date]; })();
  return run(
    env,
    `UPDATE articles SET draft_json = ?, published_json = ?, published_revision = revision + 1, published_title = ?, published_excerpt = ?,
       published_category = ?, published_for_at = ?, first_published_at = COALESCE(first_published_at, datetime('now')),
       last_published_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?`,
    x, x, ...p, A, id
  );
}
const CHECK_FAILED = /CHECK constraint failed/;

// ---------------------------------------------------------------------------------------------------------------

async function toVersion12(env) {
  await env.DB.batch([
    env.DB.prepare('DROP TRIGGER organizations_news_state_insert'),
    env.DB.prepare('DROP TABLE articles'),
    env.DB.prepare('DROP TABLE organization_news_state'),
    env.DB.prepare('DELETE FROM schema_migrations WHERE version = 13'),
  ]);
}
async function dumpTables(env, except = []) {
  const tables = (await all(env, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((t) => t.name);
  const out = {};
  for (const t of tables.filter((name) => !except.includes(name))) out[t] = await all(env, `SELECT * FROM "${t}" ORDER BY rowid`);
  return out;
}
const schemaObjects = async (env) => all(env, "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name");

test('T1 — migration 13 sur une base en 12 : tables, 3 index, 30 triggers, une ligne json par organisation, aucun article, second passage sans changement', async () => {
  const env = await setupNews();
  await toVersion12(env);
  await seedInscription(env.DB);
  assert.equal((await first(env, 'SELECT MAX(version) AS v FROM schema_migrations')).v, 12);
  const before = await dumpTables(env);

  resetSchemaCacheForTests();
  await ensureSchema(env.DB);
  assert.equal((await first(env, 'SELECT MAX(version) AS v FROM schema_migrations')).v, 13);
  assert.equal(MIGRATIONS.at(-1).version, 13);
  assert.equal(MIGRATIONS.at(-1).name, 'news_articles');
  const names = async (type) => (await all(env, 'SELECT name FROM sqlite_master WHERE type = ? AND name NOT LIKE ? ORDER BY name', type, 'sqlite_%')).map((r) => r.name);
  assert.ok((await names('table')).includes('articles') && (await names('table')).includes('organization_news_state'));
  const named = (await names('index')).filter((n) => n.startsWith('idx_articles_'));
  assert.deepEqual(named, ['idx_articles_org_legacy', 'idx_articles_org_public', 'idx_articles_org_updated']);
  const triggers = new Set(await names('trigger'));
  assert.equal(NEWS_TRIGGERS.length, 30);
  assert.equal(NEWS_TRIGGERS.filter(([, table]) => table === 'articles').length, 18);
  for (const [name] of NEWS_TRIGGERS) assert.ok(triggers.has(name), `trigger ${name}`);
  const states = await all(env, 'SELECT organization_id, source, revision, articles_revision, import_batch_id, validated_at, cutover_at FROM organization_news_state ORDER BY organization_id');
  assert.deepEqual(states.map((s) => s.organization_id).sort(), [A, B].sort());
  for (const s of states) assert.deepEqual([s.source, s.revision, s.articles_revision, s.import_batch_id, s.validated_at, s.cutover_at], ['json', 1, 0, null, null, null]);
  assert.equal((await first(env, 'SELECT COUNT(*) AS n FROM articles')).n, 0, 'aucun import dans la migration');
  // Toutes les tables préexistantes identiques (hors l'enregistrement de la migration).
  const after = await dumpTables(env, ['articles', 'organization_news_state']);
  const strip = (dump) => ({ ...dump, schema_migrations: dump.schema_migrations.filter((m) => m.version !== 13) });
  assert.deepEqual(strip(after), before);
  // Second passage : aucune modification (données et schéma).
  const objects = await schemaObjects(env);
  const full = await dumpTables(env);
  resetSchemaCacheForTests();
  await ensureSchema(env.DB);
  assert.equal(await repairSchemaInvariants(env.DB), 0);
  assert.deepEqual(await schemaObjects(env), objects);
  assert.deepEqual(await dumpTables(env), full);
});

test('T16 — draft_json corrompu (non JSON, pas un objet, plus de 200 Ko) : refusé par la CHECK', async () => {
  const env = await setupNews();
  for (const bad of ['pas du json', '[1,2]', '"texte"', '42', 'null', `{"a":"${'x'.repeat(204_800)}"}`]) {
    await assert.rejects(run(env, 'INSERT INTO articles (id, organization_id, slug, draft_json) VALUES (?, ?, ?, ?)', newArticleId(), A, 'x', bad), CHECK_FAILED, bad.slice(0, 20));
  }
  assert.equal((await first(env, 'SELECT COUNT(*) AS n FROM articles')).n, 0);
});

test('T19 — table articles absente, migration 13 enregistrée : SchemaIntegrityError, rien recréé', async () => {
  const env = await setupNews();
  await run(env, 'DROP TABLE articles');
  await assert.rejects(repairSchemaInvariants(env.DB), SchemaIntegrityError);
  assert.equal(await first(env, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'articles'"), null);
});

test('T20 — table d’état absente, ou ligne d’une organisation manquante : SchemaIntegrityError, rien recréé', async () => {
  const env = await setupNews();
  await run(env, 'DROP TABLE organization_news_state');
  await assert.rejects(repairSchemaInvariants(env.DB), SchemaIntegrityError);
  assert.equal(await first(env, "SELECT 1 FROM sqlite_master WHERE name = 'organization_news_state'"), null);

  const env2 = await setupNews();
  await run(env2, 'DROP TRIGGER organizations_news_state_insert');
  await run(env2, "INSERT INTO organizations (id, slug, name) VALUES ('org_c', 'club-c', 'Club C')");
  await assert.rejects(repairSchemaInvariants(env2.DB), /organisation sans ligne d’état/);
  assert.equal(await stateOf(env2, 'org_c'), null, 'aucune ligne créée rétroactivement');
  assert.equal(await first(env2, "SELECT 1 FROM sqlite_master WHERE name = 'organizations_news_state_insert'"), null, 'trigger non recréé');
  // Suppression d'une ligne d'état : refusée par la base.
  await assert.rejects(run(env2, 'DELETE FROM organization_news_state WHERE organization_id = ?', A), /suppression interdite/);
});

// Remplace une table par une variante altérée (mêmes index et triggers), avec une ligne de données.
async function replaceTable(env, table, sql) {
  await run(env, `DROP TABLE ${table}`);
  await run(env, sql);
  if (table === 'organization_news_state') await run(env, NEWS_STATE_BACKFILL_SQL);
  for (const [, def] of ARTICLES_INDEXES) if (table === 'articles') await run(env, def);
  for (const [, t, def] of NEWS_TRIGGERS) if (t === table) await run(env, def);
}
const V3_PROJECTIONS = (sql) =>
  sql
    .replace("json_type(published_json, '$.title') IS 'text'", "json_type(published_json, '$.title') = 'text'")
    .replace("published_title IS json_extract(published_json, '$.title')", "published_title = json_extract(published_json, '$.title')")
    .replace("json_type(published_json, '$.excerpt') IS 'text'", "json_type(published_json, '$.excerpt') = 'text'")
    .replace("published_excerpt IS json_extract(published_json, '$.excerpt')", "published_excerpt = json_extract(published_json, '$.excerpt')")
    .replace("json_type(published_json, '$.category') IS 'text'", "json_type(published_json, '$.category') = 'text'")
    .replace("published_category IS json_extract(published_json, '$.category')", "published_category = json_extract(published_json, '$.category')")
    .replace("json_type(published_json, '$.date') IS 'text'", "json_type(published_json, '$.date') = 'text'")
    .replace("published_for_at IS json_extract(published_json, '$.date')", "published_for_at = json_extract(published_json, '$.date')");
const ARTICLE_VARIANTS = [
  ['clé étrangère', (s) => s.replace('organization_id TEXT NOT NULL REFERENCES organizations(id)', 'organization_id TEXT NOT NULL')],
  ['NOT NULL', (s) => s.replace('  slug TEXT NOT NULL\n', '  slug TEXT\n')],
  ['type', (s) => s.replace('revision INTEGER NOT NULL DEFAULT 1 CHECK', 'revision NUMERIC NOT NULL DEFAULT 1 CHECK')],
  ['défaut', (s) => s.replace('revision INTEGER NOT NULL DEFAULT 1 CHECK', 'revision INTEGER NOT NULL DEFAULT 2 CHECK')],
  ['clé primaire', (s) => s.replace('id TEXT PRIMARY KEY NOT NULL', 'id TEXT NOT NULL')],
  ['CHECK des projections v3 (=)', V3_PROJECTIONS],
  ['autre CHECK', (s) => s.replace('length(slug) BETWEEN 1 AND 100', 'length(slug) BETWEEN 1 AND 101')],
  ['colonne en plus', (s) => s.replace('CHECK (datetime(updated_at) IS updated_at),', 'CHECK (datetime(updated_at) IS updated_at),\n  extra TEXT,')],
];
const STATE_VARIANTS = [
  ['clé étrangère', (s) => s.replace('organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id)', 'organization_id TEXT PRIMARY KEY NOT NULL')],
  ['NOT NULL', (s) => s.replace("source TEXT NOT NULL DEFAULT 'json'", "source TEXT DEFAULT 'json'")],
  ['type', (s) => s.replace('articles_revision INTEGER NOT NULL DEFAULT 0', 'articles_revision NUMERIC NOT NULL DEFAULT 0')],
  ['défaut', (s) => s.replace("updated_at TEXT NOT NULL DEFAULT (datetime('now'))", "updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))")],
  ['clé primaire', (s) => s.replace('organization_id TEXT PRIMARY KEY NOT NULL REFERENCES', 'organization_id TEXT UNIQUE NOT NULL REFERENCES')],
  ['CHECK', (s) => s.replace("CHECK (source IN ('json', 'd1'))", "CHECK (source IN ('json', 'd1', 'x'))")],
  ['colonne en plus', (s) => s.replace('CHECK (datetime(updated_at) IS updated_at),', 'CHECK (datetime(updated_at) IS updated_at),\n  extra TEXT,')],
];

test('T21 — structure altérée (clé étrangère, NOT NULL, type, défaut, clé primaire, CHECK dont la forme = v3, colonne en plus) : refusée, table et données intactes', async () => {
  for (const [table, base, variants] of [['articles', ARTICLES_TABLE_SQL, ARTICLE_VARIANTS], ['organization_news_state', NEWS_STATE_TABLE_SQL, STATE_VARIANTS]]) {
    for (const [what, alter] of variants) {
      const altered = alter(base);
      assert.notEqual(altered, base, `${table} / ${what} : variante effective`);
      const env = await setupNews();
      await replaceTable(env, table, altered);
      // Ligne de données (révision explicite : la variante « défaut » change la valeur par défaut).
      if (table === 'articles') await run(env, "INSERT INTO articles (id, organization_id, slug, draft_json, revision) VALUES (?, ?, 'donnee', '{}', 1)", newArticleId(), A);
      const sqlBefore = (await first(env, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table)).sql;
      const rowsBefore = await all(env, `SELECT * FROM ${table} ORDER BY rowid`);
      await assert.rejects(repairSchemaInvariants(env.DB), SchemaIntegrityError, `${table} / ${what}`);
      assert.equal((await first(env, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", table)).sql, sqlBefore, 'table intacte');
      assert.deepEqual(await all(env, `SELECT * FROM ${table} ORDER BY rowid`), rowsBefore, 'données intactes');
    }
  }
});

test('T22 — index ou trigger manquant : recréé seulement si structure et données conformes ; modifié : erreur', async () => {
  // Manquants, base saine : recréés à l'identique, dans une seule transaction.
  const env = await setupNews();
  const objects = await schemaObjects(env);
  await run(env, 'DROP INDEX idx_articles_org_public');
  await run(env, 'DROP TRIGGER articles_update_publish');
  await run(env, 'DROP TRIGGER news_state_cutover');
  await run(env, 'DROP TRIGGER organizations_news_state_insert');
  assert.equal(await repairSchemaInvariants(env.DB), 4);
  assert.deepEqual(await schemaObjects(env), objects);

  // Modifiés : erreur, rien touché.
  for (const [drop, create] of [
    ['DROP INDEX idx_articles_org_updated', 'CREATE INDEX idx_articles_org_updated ON articles (organization_id, created_at DESC)'],
    ['DROP TRIGGER articles_update_slug', "CREATE TRIGGER articles_update_slug BEFORE UPDATE OF slug ON articles WHEN 0 BEGIN SELECT RAISE(ABORT, 'x'); END"],
    ['DROP TRIGGER news_state_validate', "CREATE TRIGGER news_state_validate BEFORE UPDATE ON organization_news_state WHEN 0 BEGIN SELECT RAISE(ABORT, 'x'); END"],
  ]) {
    const e = await setupNews();
    await run(e, drop);
    await run(e, create);
    await assert.rejects(repairSchemaInvariants(e.DB), /différent de la migration 13/, create.slice(0, 40));
  }
  // Objet inconnu attaché aux tables : refusé.
  const extra = await setupNews();
  await run(extra, 'CREATE TRIGGER articles_contournement BEFORE UPDATE ON articles BEGIN SELECT 1; END');
  await assert.rejects(repairSchemaInvariants(extra.DB), /objet inattendu/);

  // Manquant MAIS données non conformes : erreur, rien recréé (la ligne incohérente n'est pas réparée).
  const bad = await setupNews();
  await run(bad, 'DROP TRIGGER articles_update_publish');
  await run(bad, 'PRAGMA ignore_check_constraints = ON');
  await run(bad, "INSERT INTO articles (id, organization_id, slug, draft_json, last_published_at) VALUES (?, ?, 'incoherent', '{}', datetime('now'))", newArticleId(), A);
  await run(bad, 'PRAGMA ignore_check_constraints = OFF');
  await assert.rejects(repairSchemaInvariants(bad.DB), /articles incohérents/);
  assert.equal(await first(bad, "SELECT 1 FROM sqlite_master WHERE name = 'articles_update_publish'"), null);
  assert.ok(await first(bad, "SELECT 1 FROM articles WHERE slug = 'incoherent' AND last_published_at IS NOT NULL"), 'ligne non réparée');

  // Index unique legacy manquant avec des doublons : erreur, rien supprimé.
  const dup = await setupNews();
  await run(dup, 'DROP INDEX idx_articles_org_legacy');
  const batch = await openImportBatch(dup);
  await insertLegacy(dup, { key: 'meme-cle', slug: 'meme-cle-1', batch });
  await insertLegacy(dup, { key: 'meme-cle', slug: 'meme-cle-2', batch });
  await assert.rejects(repairSchemaInvariants(dup.DB), /doublons/);
  assert.equal((await first(dup, "SELECT COUNT(*) AS n FROM articles WHERE legacy_key = 'meme-cle'")).n, 2);
});

test('T23 — organisation créée après la migration : ligne d’état json créée par le trigger', async () => {
  const env = await setupNews();
  await run(env, "INSERT INTO organizations (id, slug, name) VALUES ('org_nouvelle', 'nouvelle', 'Nouvelle')");
  const s = await stateOf(env, 'org_nouvelle');
  assert.deepEqual([s.source, s.revision, s.articles_revision, s.validated_at, s.cutover_at], ['json', 1, 0, null, null]);
  // Une ligne d'état ne se crée que sous sa forme initiale (news_state_insert_form).
  await run(env, "INSERT INTO organizations (id, slug, name) VALUES ('org_autre', 'autre', 'Autre')");
  await assert.rejects(run(env, "INSERT INTO organization_news_state (organization_id, source) VALUES ('org_x', 'd1')"), /création invalide|CHECK|FOREIGN KEY/);
  assert.equal(await repairSchemaInvariants(env.DB), 0);
});

test('T27 — garde-fous des triggers : révision + 2, changement d’organisation, updated_at falsifié, published_json différent du brouillon : refusés', async () => {
  const env = await setupNews();
  const id = await insertDraft(env, A, 'garde-fous', '{"v":1}');
  const upd = (set, ...params) => run(env, `UPDATE articles SET ${set} WHERE organization_id = ? AND id = ?`, ...params, A, id);
  await assert.rejects(upd("revision = revision + 2, updated_at = datetime('now')"), /identité, révision/);
  await assert.rejects(upd("organization_id = ?, revision = revision + 1, updated_at = datetime('now')", B), /identité, révision/);
  await assert.rejects(upd("revision = revision + 1, updated_at = '2000-01-01 00:00:00'"), /identité, révision/);
  await assert.rejects(upd("revision = revision + 1, updated_at = datetime('now', '+1 second')"), /identité, révision/);
  await assert.rejects(upd("created_at = '2000-01-01 00:00:00', revision = revision + 1, updated_at = datetime('now')"), /identité, révision/);
  await assert.rejects(upd("id = ?, revision = revision + 1, updated_at = datetime('now')", newArticleId()), /identité, révision/);
  await assert.rejects(
    upd(`published_json = ?, published_revision = revision + 1, published_title = 'Titre', published_excerpt = 'Résumé', published_category = 'club',
      published_for_at = '2026-02-28', first_published_at = datetime('now'), last_published_at = datetime('now'), revision = revision + 1, updated_at = datetime('now')`, X_OK),
    /publication invalide/
  );
  const row = await rowOf(env, id);
  assert.deepEqual([row.revision, row.organization_id, row.published_json], [1, A, null]);
});

test('T30 — format des identifiants : newArticleId() accepté ; newImportBatchId() accepté dans les tuples d’import complets (article et état)', async () => {
  const env = await setupNews();
  for (let i = 0; i < 50; i++) {
    assert.ok(isArticleId(newArticleId()));
    assert.ok(isImportBatchId(newImportBatchId()));
  }
  const id = await insertDraft(env);
  assert.match(id, /^art_[0-9a-f]{32}$/);
  const before = await stateOf(env, A);
  const batch = await openImportBatch(env);
  const after = await stateOf(env, A);
  assert.deepEqual([after.import_batch_id, after.legacy_digest, after.revision], [batch, DIGEST, before.revision + 1]);
  assert.equal(after.imported_at, after.updated_at);
  await insertLegacy(env, { key: 'cle-valide', batch });
  const row = await first(env, "SELECT * FROM articles WHERE legacy_key = 'cle-valide'");
  assert.deepEqual([row.legacy_source, row.import_checksum, row.import_batch_id], ['content/articles.json', CHECKSUM, batch]);
});

test('T31 — identifiants mal formés (UUID avec tirets, majuscules, mauvais préfixe, 31 ou 33 caractères) : refusés par isArticleId et par la CHECK', async () => {
  const env = await setupNews();
  const hex = newArticleId().slice(4);
  const bad = [`art_${crypto.randomUUID()}`, `art_${hex.toUpperCase()}`, `atr_${hex}`, `art_${hex.slice(1)}`, `art_${hex}0`, `ART_${hex}`, `art_${hex.slice(0, 31)}g`, `imp_${hex}`];
  for (const id of bad) {
    assert.equal(isArticleId(id), false, id);
    await assert.rejects(run(env, 'INSERT INTO articles (id, organization_id, slug, draft_json) VALUES (?, ?, ?, ?)', id, A, 'x', '{}'), CHECK_FAILED, id);
  }
  for (const batch of [`imp_${crypto.randomUUID()}`, `imp_${hex.toUpperCase()}`, `art_${hex}`, `imp_${hex.slice(1)}`]) {
    assert.equal(isImportBatchId(batch), false, batch);
    const state = await stateOf(env, A);
    await assert.rejects(
      run(env, `UPDATE organization_news_state SET import_batch_id = ?, legacy_digest = ?, imported_at = datetime('now'), revision = ? + 1, updated_at = datetime('now') WHERE organization_id = ?`, batch, DIGEST, state.revision, A),
      CHECK_FAILED,
      batch
    );
  }
});

test('T35 — published_revision non entière (1.5, \'abc\') : refusée (triggers, puis CHECK seule)', async () => {
  const env = await setupNews();
  const id = await insertDraft(env, A, 'rev', X_OK);
  const attempt = (value) =>
    run(env, `UPDATE articles SET published_json = draft_json, published_revision = ?, published_title = 'Titre', published_excerpt = 'Résumé',
      published_category = 'club', published_for_at = '2026-02-28', first_published_at = datetime('now'), last_published_at = datetime('now'),
      revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?`, value, A, id);
  for (const value of [1.5, 'abc', 2.5]) await assert.rejects(attempt(value), /publication invalide|CHECK/);
  // La CHECK seule (triggers retirés, base de test) : typeof(published_revision) = 'integer' exigé.
  for (const [name] of NEWS_TRIGGERS) await run(env, `DROP TRIGGER IF EXISTS ${name}`);
  for (const value of [1.5, 'abc']) await assert.rejects(attempt(value), CHECK_FAILED, String(value));
  assert.equal((await rowOf(env, id)).published_json, null);
});

// --- T36 ------------------------------------------------------------------------------------------------------------
const T36_VARIANTS = [
  ['1 title absente', { excerpt: 'Résumé', category: 'club', date: '2026-02-28' }, null],
  ['2 excerpt absente', { title: 'Titre', category: 'club', date: '2026-02-28' }, null],
  ['3 category absente', { title: 'Titre', excerpt: 'Résumé', date: '2026-02-28' }, null],
  ['4 date absente', { title: 'Titre', excerpt: 'Résumé', category: 'club' }, null],
  ['5 scénario Codex', {}, ['FAUX', 'FAUX', 'club', '2026-02-28']],
  ['6 title de mauvais type', { title: 5, excerpt: 'Résumé', category: 'club', date: '2026-02-28' }, ['5', 'Résumé', 'club', '2026-02-28']],
  ['7 excerpt de mauvais type', { title: 'Titre', excerpt: 7, category: 'club', date: '2026-02-28' }, ['Titre', '7', 'club', '2026-02-28']],
  ['8 category de mauvais type', { title: 'Titre', excerpt: 'Résumé', category: 9, date: '2026-02-28' }, ['Titre', 'Résumé', '9', '2026-02-28']],
  ['9 date de mauvais type', { title: 'Titre', excerpt: 'Résumé', category: 'club', date: ['2026-02-28'] }, null],
  ['10 published_title différent', JSON.parse(X_OK), ['Autre', 'Résumé', 'club', '2026-02-28']],
  ['11 published_excerpt différent', JSON.parse(X_OK), ['Titre', 'Autre', 'club', '2026-02-28']],
  ['12 published_category différent', JSON.parse(X_OK), ['Titre', 'Résumé', 'evenement', '2026-02-28']],
  ['13 published_for_at différent', JSON.parse(X_OK), ['Titre', 'Résumé', 'club', '2026-03-01']],
];
const NORMAL = ['Titre', 'Résumé', 'club', '2026-02-28'];

test('T36 — cohérence published_json / projections : 13 variantes refusées par la CHECK sur les deux chemins, cas positifs acceptés', async () => {
  const env = await setupNews();
  const published = async () => (await first(env, 'SELECT COUNT(*) AS n FROM articles WHERE published_json IS NOT NULL')).n;
  // Chemin A : PUBLISH par UPDATE d'un brouillon normal.
  const idA = await insertDraft(env, A, 'chemin-a');
  let refusals = 0;
  for (const [name, json, projections] of T36_VARIANTS) {
    await assert.rejects(publishRaw(env, idA, JSON.stringify(json), projections ?? NORMAL), CHECK_FAILED, `A ${name}`);
    refusals++;
  }
  assert.equal(await published(), 0);
  await publishRaw(env, idA, X_OK);
  assert.equal(await published(), 1, 'cas positif A accepté');
  // Chemin B : INSERT legacy publié (forme B, lot courant, source json non validée).
  const batch = await openImportBatch(env);
  for (const [name, json, projections] of T36_VARIANTS) {
    const x = JSON.stringify(json);
    await assert.rejects(insertLegacy(env, { key: 'chemin-b', draftJson: x, publishedJson: x, projections: projections ?? NORMAL, batch }), CHECK_FAILED, `B ${name}`);
    refusals++;
  }
  assert.equal(refusals, 26);
  assert.equal(await published(), 1, 'nombre de publiés inchangé après les refus');
  await insertLegacy(env, { key: 'chemin-b', batch });
  assert.equal(await published(), 2, 'cas positif B accepté');
  // Contrôle de données du §8 : 0 sur une base saine.
  for (const [, sql] of NEWS_DATA_CHECKS) assert.equal((await first(env, sql)).n, 0);
  assert.equal(await repairSchemaInvariants(env.DB), 0);
  // La CHECK v3 (=) accepte la variante 5 : défaut reproduit (pris en compte par T21).
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE v3 (published_json TEXT, published_title TEXT, published_excerpt TEXT, published_category TEXT, published_for_at TEXT,
    CHECK (published_json IS NULL OR (json_type(published_json, '$.title') = 'text' AND published_title = json_extract(published_json, '$.title')
      AND json_type(published_json, '$.excerpt') = 'text' AND published_excerpt = json_extract(published_json, '$.excerpt')
      AND json_type(published_json, '$.category') = 'text' AND published_category = json_extract(published_json, '$.category')
      AND json_type(published_json, '$.date') = 'text' AND published_for_at = json_extract(published_json, '$.date'))))`);
  sqlite.prepare('INSERT INTO v3 VALUES (?, ?, ?, ?, ?)').run('{}', 'FAUX', 'FAUX', 'club', '2026-02-28');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v3').get().n, 1);
});

test('T37 — published_revision modifiée pendant un SAVE : refusée (G6)', async () => {
  const env = await setupNews();
  const id = await insertDraft(env, A, 'save-rev', X_OK);
  await publishRaw(env, id, X_OK);
  await assert.rejects(
    run(env, `UPDATE articles SET draft_json = ?, published_revision = published_revision + 1, revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?`,
      JSON.stringify({ ...JSON.parse(X_OK), title: 'Nouveau' }), A, id),
    /publication invalide/
  );
  assert.equal((await rowOf(env, id)).published_revision, 2);
});

test('T38 — faux first_published_at sur un brouillon jamais publié (UPDATE ou INSERT forme A) : refusé', async () => {
  const env = await setupNews();
  const id = await insertDraft(env, A, 'jamais-publie');
  await assert.rejects(
    run(env, `UPDATE articles SET first_published_at = datetime('now'), last_published_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?`, A, id),
    /historique de publication/
  );
  await assert.rejects(
    run(env, "INSERT INTO articles (id, organization_id, slug, draft_json, first_published_at, last_published_at) VALUES (?, ?, 'faux', '{}', datetime('now'), datetime('now'))", newArticleId(), A),
    /insertion hors des formes/
  );
  await assert.rejects(
    run(env, "INSERT INTO articles (id, organization_id, slug, draft_json, first_published_at) VALUES (?, ?, 'faux2', '{}', '2020-01-01 00:00:00')", newArticleId(), A),
    /insertion hors des formes/
  );
  assert.equal((await rowOf(env, id)).first_published_at, null);
});

test('T39 — last_published_at modifié hors PUBLISH (valeur future, now + 1 s) et faux unpublished_at : refusés', async () => {
  const env = await setupNews();
  const id = await insertDraft(env, A, 'dates', X_OK);
  await publishRaw(env, id, X_OK);
  const upd = (set) => run(env, `UPDATE articles SET ${set}, revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?`, A, id);
  await assert.rejects(upd("last_published_at = '2099-01-01 00:00:00'"), /publication invalide/);
  await assert.rejects(upd("last_published_at = datetime('now', '+1 second')"), /publication invalide/);
  await assert.rejects(upd("unpublished_at = datetime('now')"), /historique de publication/);
  await assert.rejects(upd("first_published_at = '2000-01-01 00:00:00'"), /historique de publication/);
  // Dépublication avec une date falsifiée : refusée (G7).
  await assert.rejects(
    upd("published_json = NULL, published_revision = NULL, published_title = NULL, published_excerpt = NULL, published_category = NULL, published_for_at = NULL, unpublished_at = '2000-01-01 00:00:00'"),
    /dépublication invalide/
  );
  const row = await rowOf(env, id);
  assert.equal(row.unpublished_at, null);
  assert.equal(row.first_published_at, row.last_published_at);
});

test('T40 — INSERT legacy publié complet (forme B, lot courant, json non validée) : accepté ; published_revision = revision = 1 ; first = last = now', async () => {
  const env = await setupNews();
  const batch = await openImportBatch(env);
  await insertLegacy(env, { key: 'legacy-ok', batch });
  const row = await first(env, "SELECT *, datetime('now') AS now FROM articles WHERE legacy_key = 'legacy-ok'");
  assert.deepEqual([row.revision, row.published_revision, row.published_json === row.draft_json], [1, 1, true]);
  assert.equal(row.first_published_at, row.last_published_at);
  assert.ok(Math.abs(Date.parse(`${row.now}Z`) - Date.parse(`${row.first_published_at}Z`)) <= 2000);
  assert.equal((await stateOf(env, A)).articles_revision, 1, 'compteur incrémenté (G13)');
});

test('T41 — INSERT publié sans tuple legacy complet, lot non courant, ou lot d’une autre organisation : refusé', async () => {
  const env = await setupNews();
  // Publié sans tuple legacy (forme non autorisée).
  await assert.rejects(
    run(env, `INSERT INTO articles (id, organization_id, slug, draft_json, published_json, published_revision, published_title, published_excerpt,
      published_category, published_for_at, first_published_at, last_published_at) VALUES (?, ?, 'sans-legacy', ?, ?, 1, 'Titre', 'Résumé', 'club', '2026-02-28', datetime('now'), datetime('now'))`,
      newArticleId(), A, X_OK, X_OK),
    /insertion hors des formes/
  );
  // Tuple legacy incomplet : CHECK (tout ou rien).
  const batchA = await openImportBatch(env);
  await assert.rejects(insertLegacy(env, { key: 'incomplet', batch: batchA, checksum: null }), /CHECK|insertion/);
  // Lot qui n'est pas le lot courant.
  await assert.rejects(insertLegacy(env, { key: 'mauvais-lot', batch: newImportBatchId() }), /import hors lot courant/);
  // Lot courant d'une autre organisation.
  const batchB = await openImportBatch(env, B);
  await assert.rejects(insertLegacy(env, { key: 'lot-de-b', batch: batchB }), /import hors lot courant/);
  // Import en source json validée : refusé (G10 / G11).
  assert.equal((await first(env, 'SELECT COUNT(*) AS n FROM articles WHERE legacy_source IS NOT NULL')).n, 0);
});

// --- T2 (local) : instantané structure + données, seuls les objets de la migration 13 sont nouveaux ------------------

async function version12Copy() {
  const sqlite = new DatabaseSync(':memory:');
  const env = { DB: createD1(sqlite) };
  resetSchemaCacheForTests();
  await ensureSchema(env.DB);
  await run(env, "INSERT INTO organizations (id, slug, name) VALUES (?, 'atelier-exemple', 'Atelier Exemple')", B);
  await seedInscription(env.DB);
  await seedInscription(env.DB, { enfant_prenom: 'Autre' });
  await toVersion12(env);
  return { sqlite, env };
}

test('T2 (local) — migration 13 sur une copie en 12 : structure et données préexistantes identiques ; objets nouveaux = exactement ceux de la migration 13', async () => {
  const { sqlite, env } = await version12Copy();
  const before = snapshot(sqlite);
  assert.ok(Object.keys(before.structure).length > 40, 'instantané structurel complet');
  resetSchemaCacheForTests();
  await ensureSchema(env.DB);
  const after = snapshot(sqlite);
  assert.deepEqual(compareSnapshots(before, after), []);
  assert.equal(MIGRATION_13_OBJECTS.size, 2 + 3 + 4 + 30);
  // Second passage : aucun changement.
  resetSchemaCacheForTests();
  await ensureSchema(env.DB);
  assert.deepEqual(snapshot(sqlite), after);
});

test('T2 (local) — l’instantané détecte un objet préexistant modifié, un objet nouveau hors migration et des données modifiées', async () => {
  const cases = [
    ['index préexistant modifié', "DROP INDEX idx_email_log_created; CREATE INDEX idx_email_log_created ON email_log (created_at, kind)", /objet modifié : index:idx_email_log_created/],
    ['colonne ajoutée à une table préexistante', 'ALTER TABLE organizations ADD COLUMN extra TEXT', /objet modifié : table:organizations/],
    ['objet nouveau hors migration', 'CREATE INDEX idx_hors_migration ON inscriptions (email)', /objet nouveau hors migration : index:idx_hors_migration/],
    ['trigger préexistant supprimé', 'DROP TRIGGER site_configs_published_at_insert', /objet disparu : trigger:site_configs_published_at_insert/],
    ['vue ajoutée', 'CREATE VIEW v_hors_migration AS SELECT 1', /objet nouveau hors migration : view:v_hors_migration/],
    ['données modifiées', "UPDATE inscriptions SET ville = 'Autre ville'", /données modifiées : inscriptions/],
  ];
  for (const [what, sql, expected] of cases) {
    const { sqlite, env } = await version12Copy();
    const before = snapshot(sqlite);
    resetSchemaCacheForTests();
    await ensureSchema(env.DB);
    sqlite.exec(sql);
    const problems = compareSnapshots(before, snapshot(sqlite));
    assert.ok(problems.some((p) => expected.test(p)), `${what} : ${JSON.stringify(problems)}`);
  }
});
