// Phase 4E.1 — services Article et services d'état (contrat 4E v3.1 §9 à §16, §23 à §29) : T3 à T15, T24 à T26, T28,
// T29, T32 à T34, T42 à T44, T46, T47. Organisation A = Sportville, organisation B = « Atelier Exemple » (tests
// seulement). Les courses sont rejouées de façon déterministe en interceptant prepare/batch de la base simulée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  createArticle, saveArticle, publishArticle, unpublishArticle, archiveArticle, restoreArticle, getArticle, listArticles,
  listPublishedArticles, findPublishedArticle, ArticleNotFoundError, SlugConflictError, NewsStateConflictError,
} from '../functions/_shared/articles.js';
import {
  importLegacyNews, auditLegacyNews, validateLegacyNews, invalidateNewsValidation, cutoverNews, rollbackNews, readNewsState,
  readPublicNews, findPublicNewsArticle, setNewsClockForTests,
} from '../functions/_shared/news-state.js';
import { spawnSync } from 'node:child_process';
import { ArticleValidationError } from '../functions/_shared/article-model.js';
import { ConfigConflictError } from '../functions/_shared/public-data.js';
import { NewsUnavailableError, setNewsSourcesForTests } from '../functions/_shared/news.js';
import { resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { TENANT_TABLES } from '../functions/_shared/schema.js';
import { sha256Hex } from '../functions/_shared/security.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { onRequestGet as newsApi } from '../functions/api/actualites.js';
import { onRequestGet as newsPage } from '../functions/actualites/[slug].js';
import { A, B, ctxA, ctxB, LEGACY, clone, setupNews, draft, rowOf, stateOf, countArticles } from './helpers/news.mjs';

const create = (env, ctx, overrides = {}, slug) => createArticle(env, ctx, { expectedRevision: 0, draft: draft(overrides), slug });
const createB = (env, overrides = {}, slug) => create(env, ctxB, { category: 'vie', ...overrides }, slug);
const raw = (env, sql, ...params) => env.DB.prepare(sql).bind(...params).run();
const is409 = (error) => error instanceof ConfigConflictError || error instanceof NewsStateConflictError || error instanceof SlugConflictError;

// Interception : exécute `before` juste avant la première instruction dont le SQL correspond à `pattern`.
function beforeStatement(t, env, pattern, before) {
  const prepare = env.DB.prepare.bind(env.DB);
  let done = false;
  t.mock.method(env.DB, 'prepare', (sql) => {
    const statement = prepare(sql);
    if (done || !pattern.test(sql)) return statement;
    const wrap = (s) => ({
      ...s,
      bind: (...args) => wrap(s.bind(...args)),
      run: async () => {
        if (!done) {
          done = true;
          await before();
        }
        return s.run();
      },
    });
    return wrap(statement);
  });
}

// Import, validation et bascule de A (source legacy fictive).
async function toD1(env) {
  const r0 = (await readNewsState(env, ctxA)).revision;
  const imported = await importLegacyNews(env, ctxA, { expectedStateRevision: r0 });
  assert.ok(imported.ok, JSON.stringify(imported));
  const validated = await validateLegacyNews(env, ctxA, { expectedStateRevision: imported.newStateRevision });
  assert.ok(validated.ok, JSON.stringify(validated.audit?.gaps));
  await cutoverNews(env, ctxA, { expectedStateRevision: validated.newStateRevision });
  assert.equal((await readNewsState(env, ctxA)).source, 'd1');
}

// Source legacy de A avec un compteur de lectures (espion).
function spyLegacy() {
  const spy = { reads: 0 };
  const data = clone(LEGACY);
  setNewsSourcesForTests({
    [A]: {
      get articles() {
        spy.reads++;
        return data.articles;
      },
    },
  });
  return spy;
}

// ---------------------------------------------------------------------------------------------------------------

test('T3 — organisations A et B : A ne lit, n’écrit, ne publie, n’archive jamais un article de B (identifiant de B depuis A : 404, aucune écriture)', async () => {
  const env = await setupNews();
  const b = await createB(env, { title: 'Article de B' }, 'article-b');
  await publishArticle(env, ctxB, { id: b.id, expectedRevision: 1 });
  const before = await rowOf(env, b.id);
  const stateB = await stateOf(env, B);
  const attempts = [
    () => getArticle(env, ctxA, b.id),
    () => saveArticle(env, ctxA, { id: b.id, expectedRevision: 2, draft: draft({ title: 'Piraté' }) }),
    () => publishArticle(env, ctxA, { id: b.id, expectedRevision: 2 }),
    () => unpublishArticle(env, ctxA, { id: b.id, expectedRevision: 2 }),
    () => archiveArticle(env, ctxA, { id: b.id, expectedRevision: 2 }),
    () => restoreArticle(env, ctxA, { id: b.id, expectedRevision: 2 }),
  ];
  for (const attempt of attempts) await assert.rejects(attempt(), (e) => e instanceof ArticleNotFoundError && e.status === 404);
  assert.deepEqual(await rowOf(env, b.id), before, 'article de B intact');
  assert.deepEqual(await stateOf(env, B), stateB, 'état de B intact');
  assert.deepEqual((await listArticles(env, ctxA)).map((a) => a.id), [], 'A ne découvre pas l’article de B');
  assert.equal(await findPublishedArticle(env.DB, A, 'article-b'), null);
  // Restauration inter-organisations : même refus.
  await archiveArticle(env, ctxB, { id: b.id, expectedRevision: 2 });
  await assert.rejects(restoreArticle(env, ctxA, { id: b.id, expectedRevision: 3 }), ArticleNotFoundError);
});

test('T4 — même slug chez A et B : les deux réussissent ; lecture par (organisation, slug) sans croisement', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA, { title: 'Version A' }, 'meme-slug');
  const b = await createB(env, { title: 'Version B' }, 'meme-slug');
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  await publishArticle(env, ctxB, { id: b.id, expectedRevision: 1 });
  assert.equal((await findPublishedArticle(env.DB, A, 'meme-slug')).article.title, 'Version A');
  assert.equal((await findPublishedArticle(env.DB, B, 'meme-slug')).article.title, 'Version B');
  assert.deepEqual((await listPublishedArticles(env.DB, A)).map((x) => x.title), ['Version A']);
  await assert.rejects(create(env, ctxA, { title: 'Doublon' }, 'meme-slug'), SlugConflictError);
});

test('T5 — accès par identifiant (IDOR) : identifiant inventé ou d’une autre organisation → 404 ; organizationId dans l’entrée → 422', async () => {
  const env = await setupNews();
  const invented = `art_${'0'.repeat(32)}`;
  await assert.rejects(getArticle(env, ctxA, invented), ArticleNotFoundError);
  await assert.rejects(saveArticle(env, ctxA, { id: invented, expectedRevision: 1, draft: draft() }), ArticleNotFoundError);
  for (const key of ['organizationId', 'organization_id']) {
    await assert.rejects(createArticle(env, ctxA, { expectedRevision: 0, draft: { ...draft(), [key]: B } }), (e) => e instanceof ArticleValidationError && e.status === 422);
  }
  const a = await create(env, ctxA);
  const before = await rowOf(env, a.id);
  const is422 = (e) => e instanceof ArticleValidationError && e.status === 422;
  await assert.rejects(saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: { ...draft(), organizationId: B } }), is422);
  // organizationId forgé dans l'ENVELOPPE de la commande : 422, aucune écriture.
  await assert.rejects(createArticle(env, ctxA, { expectedRevision: 0, draft: draft(), organizationId: B }), is422);
  await assert.rejects(saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft({ title: 'X' }), organizationId: B }), is422);
  await assert.rejects(publishArticle(env, ctxA, { id: a.id, expectedRevision: 1, organizationId: B }), is422);
  assert.deepEqual(await rowOf(env, a.id), before, 'aucune écriture');
  assert.equal(await countArticles(env, B), 0);
  assert.equal(await countArticles(env, A), 1);
});

test('T6 — SAVE avec révision périmée : 409, rien d’écrit', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft({ title: 'Deux' }) });
  const before = await rowOf(env, a.id);
  await assert.rejects(saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft({ title: 'Périmé' }) }), ConfigConflictError);
  assert.deepEqual(await rowOf(env, a.id), before);
});

test('T7 — PUBLISH avec révision périmée : 409, rien d’écrit', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft({ title: 'Deux' }) });
  const before = await rowOf(env, a.id);
  await assert.rejects(publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 }), ConfigConflictError);
  assert.deepEqual(await rowOf(env, a.id), before);
});

test('T8 — brouillon modifié entre la validation et l’UPDATE : 0 ligne, 409, version publiée intacte', async (t) => {
  const env = await setupNews();
  const a = await create(env, ctxA, { title: 'Publié v1' });
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 2, draft: draft({ title: 'Brouillon v2' }) });
  const publishedBefore = (await rowOf(env, a.id)).published_json;
  beforeStatement(t, env, /SET published_json = draft_json/, () =>
    raw(env, "UPDATE articles SET draft_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ? AND revision = 3",
      JSON.stringify({ ...JSON.parse(publishedBefore), title: 'Modifié entre-temps' }), A, a.id)
  );
  await assert.rejects(publishArticle(env, ctxA, { id: a.id, expectedRevision: 3 }), ConfigConflictError);
  const row = await rowOf(env, a.id);
  assert.equal(row.published_json, publishedBefore, 'version publiée intacte');
  assert.equal(JSON.parse(row.draft_json).title, 'Modifié entre-temps');
});

test('T9 — double publication (même R) : une réussit, l’autre 409 ; first_published_at posé une seule fois', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  const results = await Promise.allSettled([publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 }), publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(is409(results.find((r) => r.status === 'rejected').reason));
  const row = await rowOf(env, a.id);
  assert.deepEqual([row.revision, row.published_revision], [2, 2]);
  assert.equal(row.first_published_at, row.last_published_at);
  // Republier ne change jamais first_published_at.
  const first = row.first_published_at;
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 2, draft: draft({ title: 'Mise à jour' }) });
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 3 });
  assert.equal((await rowOf(env, a.id)).first_published_at, first);
});

test('T10 — UNPUBLISH et SAVE concurrents : une seule réussit', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  const results = await Promise.allSettled([
    unpublishArticle(env, ctxA, { id: a.id, expectedRevision: 2 }),
    saveArticle(env, ctxA, { id: a.id, expectedRevision: 2, draft: draft({ title: 'Concurrent' }) }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(is409(results.find((r) => r.status === 'rejected').reason));
  assert.equal((await rowOf(env, a.id)).revision, 3);
});

test('T11 — ARCHIVE et PUBLISH concurrents : une seule réussit ; jamais archivé et publié', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  const results = await Promise.allSettled([archiveArticle(env, ctxA, { id: a.id, expectedRevision: 1 }), publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 })]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const row = await rowOf(env, a.id);
  assert.ok(!(row.archived_at !== null && row.published_json !== null));
  // Et sur un article publié : l'archivage dépublie dans la même instruction.
  const b = await create(env, ctxA, {}, 'autre');
  await publishArticle(env, ctxA, { id: b.id, expectedRevision: 1 });
  await Promise.allSettled([archiveArticle(env, ctxA, { id: b.id, expectedRevision: 2 }), publishArticle(env, ctxA, { id: b.id, expectedRevision: 2 })]);
  const rb = await rowOf(env, b.id);
  assert.ok(!(rb.archived_at !== null && rb.published_json !== null));
});

test('T12 — ARCHIVE d’un article publié : dépublié dans la même instruction ; unpublished_at et archived_at = now', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  const published = await rowOf(env, a.id);
  await archiveArticle(env, ctxA, { id: a.id, expectedRevision: 2 });
  const row = await rowOf(env, a.id);
  assert.deepEqual([row.published_json, row.published_revision, row.published_title, row.published_for_at], [null, null, null, null]);
  assert.ok(row.archived_at && row.archived_at === row.unpublished_at && row.archived_at === row.updated_at);
  assert.deepEqual([row.first_published_at, row.last_published_at, row.draft_json, row.slug], [published.first_published_at, published.last_published_at, published.draft_json, published.slug]);
  assert.equal((await getArticle(env, ctxA, a.id)).state, 'archived');
});

test('T13 — RESTORE : non publié, révision + 1 ; toute autre modification d’un archivé refusée', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  await archiveArticle(env, ctxA, { id: a.id, expectedRevision: 2 });
  await assert.rejects(saveArticle(env, ctxA, { id: a.id, expectedRevision: 3, draft: draft({ title: 'Non' }) }), NewsStateConflictError);
  await assert.rejects(publishArticle(env, ctxA, { id: a.id, expectedRevision: 3 }), NewsStateConflictError);
  await assert.rejects(raw(env, "UPDATE articles SET draft_json = '{}', revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?", A, a.id), /archivé non modifiable/);
  await assert.rejects(raw(env, "UPDATE articles SET archived_at = NULL, slug = 'autre', revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?", A, a.id), /archivé non modifiable|slug figé/);
  await restoreArticle(env, ctxA, { id: a.id, expectedRevision: 3 });
  const view = await getArticle(env, ctxA, a.id);
  assert.deepEqual([view.state, view.revision, view.publishedRevision], ['draft', 4, null]);
  await assert.rejects(restoreArticle(env, ctxA, { id: a.id, expectedRevision: 4 }), NewsStateConflictError);
});

test('T14 — slug après la première publication : SAVE 422 ; UPDATE direct refusé (G3)', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA, {}, 'slug-fige');
  // Avant publication : modifiable.
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft(), slug: 'slug-change' });
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 2 });
  await assert.rejects(saveArticle(env, ctxA, { id: a.id, expectedRevision: 3, draft: draft(), slug: 'nouveau' }), (e) => e instanceof ArticleValidationError && /figé/.test(e.message));
  await assert.rejects(raw(env, "UPDATE articles SET slug = 'nouveau', revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?", A, a.id), /slug figé/);
  // Même après dépublication.
  await unpublishArticle(env, ctxA, { id: a.id, expectedRevision: 3 });
  await assert.rejects(saveArticle(env, ctxA, { id: a.id, expectedRevision: 4, draft: draft(), slug: 'nouveau' }), ArticleValidationError);
  assert.equal((await rowOf(env, a.id)).slug, 'slug-change');
});

test('T15 — brouillon jamais public : aucune lecture publique ne renvoie draft_json ; un SAVE après publication ne change pas le public', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA, { title: 'Titre publié', content: 'Corps publié.' }, 'public-ou-pas');
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 2, draft: draft({ title: 'BROUILLON SECRET', content: 'Corps secret.' }) });
  const list = await listPublishedArticles(env.DB, A);
  const detail = await findPublishedArticle(env.DB, A, 'public-ou-pas');
  assert.ok(!JSON.stringify([list, detail]).includes('SECRET'));
  assert.equal(detail.article.title, 'Titre publié');
  assert.equal(detail.blocks[0].children[0].value, 'Corps publié.');
  // Jamais de brouillon, d'identifiant, de révision ni de champ legacy/import dans la lecture publique.
  assert.deepEqual(Object.keys(list[0]).sort(), ['category', 'date', 'excerpt', 'image', 'slug', 'title']);
  const source = readFileSync('functions/_shared/articles.js', 'utf8');
  const publicPart = source.slice(source.indexOf('export async function listPublishedArticles'));
  assert.ok(!/draft_json/.test(publicPart), 'les lectures publiques ne sélectionnent jamais draft_json');
  // Brouillon jamais publié : absent.
  await create(env, ctxA, { title: 'Jamais publié' }, 'jamais');
  assert.equal(await findPublishedArticle(env.DB, A, 'jamais'), null);
});

test('T24 — aucun repli de D1 vers le JSON : source d1 et D1 en échec → 503 ; le module legacy n’est jamais lu (espion)', async (t) => {
  const env = await setupNews();
  await toD1(env);
  const spy = spyLegacy();
  // Lecture normale en source d1 : aucune lecture du JSON.
  assert.equal((await readPublicNews(env, A)).source, 'd1');
  assert.ok(await findPublicNewsArticle(env, A, 'premier-article'));
  // D1 en échec sur la table des articles : 503, jamais le JSON.
  const prepare = env.DB.prepare.bind(env.DB);
  t.mock.method(env.DB, 'prepare', (sql) => {
    if (/FROM articles/.test(sql)) throw new Error('D1 indisponible');
    return prepare(sql);
  });
  await assert.rejects(readPublicNews(env, A), NewsUnavailableError);
  await assert.rejects(findPublicNewsArticle(env, A, 'premier-article'), NewsUnavailableError);
  assert.equal(spy.reads, 0, 'la source legacy n’est jamais lue en source d1');
  // Code : aucune lecture legacy dans la branche d1.
  const code = readFileSync('functions/_shared/news-state.js', 'utf8');
  const d1Branch = code.slice(code.indexOf('export async function readPublicNews'));
  assert.equal((d1Branch.match(/legacyArticlesForOrganization/g) || []).length, 2, 'uniquement dans les branches json');
});

test('T25 — état illisible : 503, aucune source devinée', async (t) => {
  const env = await setupNews();
  const spy = spyLegacy();
  // Organisation sans ligne d'état.
  await assert.rejects(readPublicNews(env, 'org_inconnue'), NewsUnavailableError);
  // Lecture de l'état en échec.
  const prepare = env.DB.prepare.bind(env.DB);
  const mock = t.mock.method(env.DB, 'prepare', (sql) => {
    if (/organization_news_state/.test(sql)) throw new Error('D1 indisponible');
    return prepare(sql);
  });
  await assert.rejects(readPublicNews(env, A), NewsUnavailableError);
  await assert.rejects(findPublicNewsArticle(env, A, 'premier-article'), NewsUnavailableError);
  mock.mock.restore();
  // Table d'état disparue : le schéma est refusé (SchemaIntegrityError), la lecture publique répond 503.
  await raw(env, 'DROP TABLE organization_news_state');
  resetSchemaCacheForTests();
  await assert.rejects(readPublicNews(env, A), NewsUnavailableError);
  assert.equal(spy.reads, 0, 'aucune source devinée');
});

test('T26 — bascule et retour arrière en CAS : révision périmée 409 ; bascule sans validation refusée ; le retour arrière efface la validation', async () => {
  const env = await setupNews();
  const r0 = (await readNewsState(env, ctxA)).revision;
  const imported = await importLegacyNews(env, ctxA, { expectedStateRevision: r0 });
  // Bascule sans validation : refusée (service, puis S4 et CHECK en écriture directe).
  await assert.rejects(cutoverNews(env, ctxA, { expectedStateRevision: imported.newStateRevision }), ConfigConflictError);
  await assert.rejects(raw(env, "UPDATE organization_news_state SET source = 'd1', cutover_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ?", A), /bascule invalide|CHECK/);
  const validated = await validateLegacyNews(env, ctxA, { expectedStateRevision: imported.newStateRevision });
  await assert.rejects(cutoverNews(env, ctxA, { expectedStateRevision: imported.newStateRevision }), ConfigConflictError, 'révision périmée');
  await cutoverNews(env, ctxA, { expectedStateRevision: validated.newStateRevision });
  const d1 = await readNewsState(env, ctxA);
  await assert.rejects(rollbackNews(env, ctxA, { expectedStateRevision: d1.revision - 1 }), ConfigConflictError);
  const rolled = await rollbackNews(env, ctxA, { expectedStateRevision: d1.revision });
  const after = await readNewsState(env, ctxA);
  assert.deepEqual([after.source, after.validatedAt, after.validatedArticlesRevision, after.cutoverAt, after.importBatchId], ['json', null, null, d1.cutoverAt, d1.importBatchId]);
  assert.equal(rolled.newStateRevision, after.revision);
  await assert.rejects(rollbackNews(env, ctxA, { expectedStateRevision: after.revision }), NewsStateConflictError, 'déjà en json');
  // Nouvelle bascule : exige une nouvelle validation.
  await assert.rejects(cutoverNews(env, ctxA, { expectedStateRevision: after.revision }), ConfigConflictError);
  // Fenêtre de 30 jours : voir le test « P2-2 » (horloge du serveur).
});

// Analyse statique des requêtes des modules 4E (même règle que tests/tenant-scoping.test.mjs).
const stripJsComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, (c) => (c === '/* toutes-organisations */' ? c : c.replace(/[^\n]/g, ' '))).replace(/(^|[^:\\])\/\/.*$/gm, '$1');
test('T28 — tenant-scoping : toute requête sur articles et organization_news_state filtre organization_id ou porte le marqueur explicite', () => {
  assert.ok(TENANT_TABLES.includes('articles') && TENANT_TABLES.includes('organization_news_state'));
  const TABLE = /\b(?:FROM|UPDATE|INTO|JOIN)\s+(articles|organization_news_state)\b/i;
  const problems = [];
  for (const file of ['functions/_shared/articles.js', 'functions/_shared/news-state.js', 'functions/_shared/news-schema.js']) {
    const source = stripJsComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/`[^`]*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)) {
      const sql = match[0];
      const scoped = /\borganization_id\s*(=|IS\b|IN\b)/i.test(sql) || /\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+\w+\s*\([^)]*\borganization_id\b/i.test(sql);
      if (TABLE.test(sql) && !scoped && !sql.includes('/* toutes-organisations */')) problems.push(`${file} : ${sql.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(problems, []);
});

// --- T29 : aucun effet public --------------------------------------------------------------------------------------
function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsFiles(path) : /\.(js|mjs)$/.test(name) ? [path] : [];
  });
}
const NEWS_SERVICES = new Set(['functions/_shared/articles.js', 'functions/_shared/news-state.js', 'functions/_shared/article-model.js', 'functions/_shared/news-schema.js', 'functions/_shared/schema.js']);

test('T29 — aucun effet public en 4E.1 : aucune route ne lit la table articles, la source publique reste le JSON', async () => {
  // Statique : aucun module public n'importe les services 4E ni n'interroge la table articles.
  for (const file of jsFiles('functions').map((f) => relative('.', f).replaceAll('\\', '/'))) {
    if (NEWS_SERVICES.has(file)) continue;
    const source = stripJsComments(readFileSync(file, 'utf8'));
    // (functions/_generated/articles.js est la source JSON legacy, importée seulement par news.js : voir T47.)
    assert.doesNotMatch(source, /['"](?:\.{1,2}\/)+(?:_shared\/)?(articles|news-state|article-model|news-schema)\.js['"]/, `${file} importe un service 4E`);
    assert.doesNotMatch(source, /\b(FROM|UPDATE|INTO|JOIN)\s+(articles|organization_news_state)\b/i, `${file} lit la table des actualités`);
  }
  // Fonctionnel : un article PUBLIÉ en base chez A n'apparaît nulle part côté public ; le JSON reste servi à l'identique.
  const env = await setupNews();
  clearOrganizationCache();
  const a = await create(env, ctxA, { title: 'Article uniquement en base' }, 'article-d1');
  await publishArticle(env, ctxA, { id: a.id, expectedRevision: 1 });
  env.ASSETS = { fetch: async () => new Response('page 404', { status: 404, headers: { 'Content-Type': 'text/html' } }) };
  const api = await newsApi({ request: new Request('https://clubdemo.licyo.fr/api/actualites'), env });
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { articles: clone(LEGACY.articles) });
  const d1Page = await newsPage({ request: new Request('https://clubdemo.licyo.fr/actualites/article-d1'), params: { slug: 'article-d1' }, env });
  assert.equal(d1Page.status, 404);
  const legacyPage = await newsPage({ request: new Request('https://clubdemo.licyo.fr/actualites/premier-article'), params: { slug: 'premier-article' }, env });
  assert.equal(legacyPage.status, 200);
  assert.match(await legacyPage.text(), /Premier article/);
  assert.equal((await readNewsState(env, ctxA)).source, 'json');
});

test('T32 — CREATE avec un id fourni par le client : 422 ArticleValidationError ; aucune ligne ; valeur reprise nulle part', async () => {
  const env = await setupNews();
  const forged = `art_${'f'.repeat(32)}`;
  const is422 = (e) => e instanceof ArticleValidationError && e.status === 422;
  // Dans le brouillon comme dans l'enveloppe de la commande : refus, aucune ligne.
  await assert.rejects(createArticle(env, ctxA, { expectedRevision: 0, draft: { ...draft(), id: forged } }), is422);
  await assert.rejects(createArticle(env, ctxA, { expectedRevision: 0, draft: draft(), id: forged }), is422);
  assert.equal(await countArticles(env), 0);
  assert.equal(await rowOf(env, forged), null);
  assert.equal((await stateOf(env, A)).articles_revision, 0, 'aucune écriture');
});

test('T33 — identifiant mal formé : 404 sans aucune requête D1 (espion prepare)', async (t) => {
  const env = await setupNews();
  const spy = t.mock.method(env.DB, 'prepare');
  for (const id of ['art_XYZ', '../etc', `art_${crypto.randomUUID()}`, '', null, 42, `ART_${'0'.repeat(32)}`, `org_demo`]) {
    await assert.rejects(getArticle(env, ctxA, id), ArticleNotFoundError);
    await assert.rejects(saveArticle(env, ctxA, { id, expectedRevision: 1, draft: draft() }), ArticleNotFoundError);
    for (const action of [publishArticle, unpublishArticle, archiveArticle, restoreArticle]) {
      await assert.rejects(action(env, ctxA, { id, expectedRevision: 1 }), ArticleNotFoundError);
    }
  }
  assert.equal(spy.mock.callCount(), 0);
});

test('T34 — CREATE normal : identifiant généré par le serveur, /^art_[0-9a-f]{32}$/, jamais issu de l’entrée', async () => {
  const env = await setupNews();
  const ids = new Set();
  for (let i = 0; i < 20; i++) {
    const a = await create(env, ctxA, { title: `Article ${i}` }, `article-${i}`);
    assert.match(a.id, /^art_[0-9a-f]{32}$/);
    assert.equal(a.revision, 1);
    ids.add(a.id);
  }
  assert.equal(ids.size, 20);
  const derived = await createArticle(env, ctxA, { expectedRevision: 0, draft: draft({ title: 'Été à la plage !' }) });
  assert.equal(derived.slug, 'ete-a-la-plage', 'slug dérivé du titre');
  await assert.rejects(createArticle(env, ctxA, { expectedRevision: 1, draft: draft() }), ConfigConflictError, 'CREATE exige expectedRevision = 0');
});

test('T42 — toute mutation en json validé est refusée (G10, S2) ; l’autre organisation n’est pas affectée ; la bascule repose sur un état inchangé', async () => {
  const env = await setupNews();
  const archived = await create(env, ctxA, {}, 'archive');
  await archiveArticle(env, ctxA, { id: archived.id, expectedRevision: 1 });
  const draftA = await create(env, ctxA, {}, 'brouillon');
  const r0 = (await readNewsState(env, ctxA)).revision;
  const imported = await importLegacyNews(env, ctxA, { expectedStateRevision: r0 });
  const legacyRow = await env.DB.prepare("SELECT id, revision FROM articles WHERE organization_id = ? AND legacy_key = 'premier-article'").bind(A).first();
  const validated = await validateLegacyNews(env, ctxA, { expectedStateRevision: imported.newStateRevision });
  assert.ok(validated.ok);
  const frozen = await stateOf(env, A);
  const rowsBefore = await env.DB.prepare('SELECT * FROM articles WHERE organization_id = ? ORDER BY id').bind(A).all();
  const locked = (e) => e instanceof NewsStateConflictError && e.status === 409;
  await assert.rejects(create(env, ctxA, {}, 'nouveau'), locked);
  await assert.rejects(saveArticle(env, ctxA, { id: draftA.id, expectedRevision: 1, draft: draft({ title: 'X' }) }), locked);
  await assert.rejects(publishArticle(env, ctxA, { id: draftA.id, expectedRevision: 1 }), locked);
  await assert.rejects(unpublishArticle(env, ctxA, { id: legacyRow.id, expectedRevision: legacyRow.revision }), locked);
  await assert.rejects(archiveArticle(env, ctxA, { id: draftA.id, expectedRevision: 1 }), locked);
  await assert.rejects(restoreArticle(env, ctxA, { id: archived.id, expectedRevision: 2 }), locked);
  await assert.rejects(importLegacyNews(env, ctxA, { expectedStateRevision: frozen.revision }), locked);
  // En écriture directe : triggers G10 (articles) et S2 (import).
  await assert.rejects(raw(env, "UPDATE articles SET draft_json = '{}', revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?", A, draftA.id), /état validé figé/);
  await assert.rejects(raw(env, 'DELETE FROM articles WHERE organization_id = ? AND id = ?', A, archived.id), /état validé figé/);
  await assert.rejects(raw(env, "INSERT INTO articles (id, organization_id, slug, draft_json) VALUES (?, ?, 'direct', '{}')", `art_${'1'.repeat(32)}`, A), /état validé figé/);
  await assert.rejects(
    raw(env, "UPDATE organization_news_state SET import_batch_id = ?, legacy_digest = ?, imported_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ?", `imp_${'2'.repeat(32)}`, 'c'.repeat(64), A),
    /import hors source json/
  );
  assert.deepEqual(await env.DB.prepare('SELECT * FROM articles WHERE organization_id = ? ORDER BY id').bind(A).all(), rowsBefore);
  assert.deepEqual(await stateOf(env, A), frozen);
  // L'organisation B n'est pas affectée.
  const b = await createB(env, {}, 'libre');
  await publishArticle(env, ctxB, { id: b.id, expectedRevision: 1 });
  // La bascule repose sur l'état validé, inchangé.
  await cutoverNews(env, ctxA, { expectedStateRevision: frozen.revision });
  assert.equal((await readNewsState(env, ctxA)).source, 'd1');
  // En source d1, les mutations d'articles redeviennent possibles.
  await saveArticle(env, ctxA, { id: draftA.id, expectedRevision: 1, draft: draft({ title: 'Après bascule' }) });
});

test('T43 — INVALIDATE_VALIDATION en CAS : révision périmée 409 ; sinon mutation permise ensuite ; validation sur un articles_revision périmé refusée', async (t) => {
  const env = await setupNews();
  const a = await create(env, ctxA, {}, 'avant');
  const imported = await importLegacyNews(env, ctxA, { expectedStateRevision: (await readNewsState(env, ctxA)).revision });
  const validated = await validateLegacyNews(env, ctxA, { expectedStateRevision: imported.newStateRevision });
  await assert.rejects(invalidateNewsValidation(env, ctxA, { expectedStateRevision: imported.newStateRevision }), ConfigConflictError);
  const invalidated = await invalidateNewsValidation(env, ctxA, { expectedStateRevision: validated.newStateRevision });
  await saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft({ title: 'Permis' }) });
  const s = await readNewsState(env, ctxA);
  assert.deepEqual([s.phase, s.validatedAt, s.cutoverAt], ['json_open', null, null]);
  assert.equal(invalidated.newStateRevision, s.revision);
  // Mutation d'un article entre l'audit et l'écriture de la validation : 0 ligne, 409.
  beforeStatement(t, env, /SET validated_at = datetime\('now'\)/, () =>
    raw(env, "UPDATE articles SET draft_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ?", JSON.stringify(draft({ title: 'Course' })), A, a.id)
  );
  await assert.rejects(validateLegacyNews(env, ctxA, { expectedStateRevision: s.revision }), ConfigConflictError);
  const after = await readNewsState(env, ctxA);
  assert.equal(after.validatedAt, null, 'validation non posée');
  // En écriture directe (S3) : validated_articles_revision doit être le compteur courant.
  await assert.rejects(
    raw(env, "UPDATE organization_news_state SET validated_at = datetime('now'), validated_articles_revision = articles_revision - 1, revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ?", A),
    /validation invalide|CHECK/
  );
});

test('T44 — import et bascule concurrents : jamais d’écriture legacy après d1 ; import sur révision d’état ou de ligne périmée : lot entièrement annulé ; bascule sur état périmé refusée', async (t) => {
  // Import avec une révision d'état changée entre la lecture et le lot : CAS par trigger, rien écrit.
  const env = await setupNews();
  const r0 = (await readNewsState(env, ctxA)).revision;
  const batch = env.DB.batch.bind(env.DB);
  const mock = t.mock.method(env.DB, 'batch', async (statements) => {
    mock.mock.restore();
    await raw(env, "UPDATE organization_news_state SET revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ?", A);
    return batch(statements);
  });
  await assert.rejects(importLegacyNews(env, ctxA, { expectedStateRevision: r0 }), ConfigConflictError);
  assert.equal(await countArticles(env, A), 0, 'aucun article créé');
  assert.equal((await stateOf(env, A)).import_batch_id, null, 'lot non enregistré');

  // Republication d'import avec une révision de ligne changée entre-temps : lot annulé (G2).
  const env2 = await setupNews();
  const first = await importLegacyNews(env2, ctxA, { expectedStateRevision: (await readNewsState(env2, ctxA)).revision });
  const changed = clone(LEGACY);
  changed.articles[0].body = 'Corps modifié dans le CMS.';
  setNewsSourcesForTests({ [A]: changed });
  const plan = await importLegacyNews(env2, ctxA, { expectedStateRevision: first.newStateRevision, dryRun: true });
  assert.deepEqual(plan.decisions.map((d) => d.action).sort(), ['republish', 'unchanged']);
  const stateBefore = await stateOf(env2, A);
  const rowsBefore = await env2.DB.prepare('SELECT * FROM articles WHERE organization_id = ? ORDER BY id').bind(A).all();
  const batch2 = env2.DB.batch.bind(env2.DB);
  const mock2 = t.mock.method(env2.DB, 'batch', async (statements) => {
    mock2.mock.restore();
    // Ligne republiée à l'identique par une autre voie : sa révision change.
    await raw(env2, "UPDATE articles SET published_json = draft_json, published_revision = revision + 1, last_published_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND legacy_key = 'premier-article'", A);
    return batch2(statements);
  });
  await assert.rejects(importLegacyNews(env2, ctxA, { expectedStateRevision: first.newStateRevision }), ConfigConflictError);
  const stateAfter = await stateOf(env2, A);
  assert.equal(stateAfter.import_batch_id, stateBefore.import_batch_id, 'lot inchangé : tout annulé');
  assert.equal(stateAfter.revision, stateBefore.revision);
  assert.notDeepEqual(await env2.DB.prepare('SELECT * FROM articles WHERE organization_id = ? ORDER BY id').bind(A).all(), rowsBefore); // seule l'écriture concurrente est passée

  // Import puis validation avec l'ancienne révision : la validation échoue en CAS.
  const env3 = await setupNews();
  const s3 = (await readNewsState(env3, ctxA)).revision;
  await importLegacyNews(env3, ctxA, { expectedStateRevision: s3 });
  await assert.rejects(validateLegacyNews(env3, ctxA, { expectedStateRevision: s3 }), ConfigConflictError);

  // Après la bascule : aucune écriture legacy possible (service et base).
  const env4 = await setupNews();
  await toD1(env4);
  const d1 = await readNewsState(env4, ctxA);
  await assert.rejects(importLegacyNews(env4, ctxA, { expectedStateRevision: d1.revision }), NewsStateConflictError);
  await assert.rejects(
    raw(env4, "UPDATE organization_news_state SET import_batch_id = ?, legacy_digest = ?, imported_at = datetime('now'), revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ?", `imp_${'3'.repeat(32)}`, 'd'.repeat(64), A),
    /import hors source json|état basculé figé/
  );
  await assert.rejects(
    raw(env4, `INSERT INTO articles (id, organization_id, slug, draft_json, published_json, published_revision, published_title, published_excerpt,
      published_category, published_for_at, first_published_at, last_published_at, legacy_source, legacy_key, import_checksum, import_batch_id)
      SELECT ?, ?, 'apres-bascule', d, d, 1, 'T', 'R', 'club', '2026-02-28', datetime('now'), datetime('now'), 'content/articles.json', 'apres-bascule', ?, ?
      FROM (SELECT '{"title":"T","excerpt":"R","category":"club","date":"2026-02-28"}' AS d)`, `art_${'4'.repeat(32)}`, A, 'e'.repeat(64), d1.importBatchId),
    /import hors lot courant/
  );
  // Bascule sur état périmé : refusée.
  const env5 = await setupNews();
  const im = await importLegacyNews(env5, ctxA, { expectedStateRevision: (await readNewsState(env5, ctxA)).revision });
  const va = await validateLegacyNews(env5, ctxA, { expectedStateRevision: im.newStateRevision });
  await invalidateNewsValidation(env5, ctxA, { expectedStateRevision: va.newStateRevision });
  await assert.rejects(cutoverNews(env5, ctxA, { expectedStateRevision: va.newStateRevision }), ConfigConflictError);
  assert.equal((await readNewsState(env5, ctxA)).source, 'json');
});

test('T46 — l’organisation B lance importLegacyNews : 0 article de Sportville lu ou écrit ; digest de "[]" ; aucune ligne legacy chez B ni chez A', async () => {
  const env = await setupNews();
  const spy = spyLegacy();
  const report = await importLegacyNews(env, ctxB, { expectedStateRevision: (await readNewsState(env, ctxB)).revision });
  assert.ok(report.ok);
  assert.deepEqual(report.decisions, []);
  assert.equal(report.digest, await sha256Hex('[]'));
  assert.equal((await stateOf(env, B)).legacy_digest, await sha256Hex('[]'));
  assert.equal(spy.reads, 0, 'la source de Sportville n’est jamais lue pour B');
  assert.equal(await countArticles(env), 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE legacy_source IS NOT NULL').first()).n, 0);
  const audit = await auditLegacyNews(env, ctxB);
  assert.ok(audit.ok, JSON.stringify(audit.gaps));
  assert.deepEqual((await readNewsState(env, ctxA)).importBatchId, null, 'A intact');
});

test('T47 — paramètres forgés (slug de Sportville, identifiant d’article, organization_id en requête, en-tête, corps ; contexte admin de B) : aucune influence ; seul news.js importe le module généré', async () => {
  const env = await setupNews();
  const a = await create(env, ctxA, {}, 'premier-article');
  const forged = { organization_id: A, organizationId: A, tenantId: A, orgId: A, headers: { 'X-Organization': A }, query: { organization: A } };
  const is422 = (e) => e instanceof ArticleValidationError && e.status === 422;
  const stateB = await stateOf(env, B);
  // Champs forgés dans une commande d'état : 422, aucune lecture ni écriture de la source de A.
  for (const [key, value] of Object.entries(forged)) {
    await assert.rejects(importLegacyNews(env, ctxB, { expectedStateRevision: 1, [key]: value }), is422, key);
  }
  await assert.rejects(importLegacyNews(env, ctxB, { expectedStateRevision: 1, slug: 'premier-article' }), is422);
  assert.deepEqual(await stateOf(env, B), stateB);
  // Contexte de B (champs parasites du contexte ignorés : seule organizationId compte) : source de B, jamais celle de A.
  const report = await importLegacyNews(env, { ...ctxB, organization_id: A }, { expectedStateRevision: 1 });
  assert.ok(report.ok);
  assert.equal(report.digest, await sha256Hex('[]'), 'source de B (vide), jamais celle de A');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM articles WHERE organization_id = ?').bind(B).first()).n, 0);
  await assert.rejects(getArticle(env, ctxB, a.id), ArticleNotFoundError);
  await assert.rejects(saveArticle(env, ctxB, { id: a.id, expectedRevision: 1, draft: draft() }), ArticleNotFoundError);
  await assert.rejects(saveArticle(env, ctxB, { ...forged, id: a.id, expectedRevision: 1, draft: draft() }), is422);
  await assert.rejects(createArticle(env, ctxB, { expectedRevision: 0, draft: { ...draft({ category: 'vie' }), organization_id: A } }), is422);
  await assert.rejects(createArticle(env, ctxB, { expectedRevision: 0, draft: draft({ category: 'vie' }), organizationId: A }), is422);
  assert.equal(await countArticles(env, B), 0, 'aucune ligne créée');
  // Contexte sans organisation : refus, jamais d'organisation par défaut.
  for (const context of [null, {}, { organization_id: A }, { organizationId: '' }]) {
    await assert.rejects(createArticle(env, context, { expectedRevision: 0, draft: draft() }), /organisation du contexte serveur requise/);
    await assert.rejects(importLegacyNews(env, context, { expectedStateRevision: 1 }), /organisation du contexte serveur requise/);
  }
  // Statique : aucun module autre que news.js n'importe functions/_generated/articles.js.
  const importers = [];
  for (const dir of ['functions', 'renderer', 'sites', 'scripts']) {
    for (const file of jsFiles(dir).map((f) => relative('.', f).replaceAll('\\', '/'))) {
      if (file.startsWith('functions/_generated/')) continue;
      const source = stripJsComments(readFileSync(file, 'utf8'));
      if (/(import\s[^;]*?from\s*|import\s*\(\s*)['"`][^'"`]*_generated\/articles(\.js)?['"`]/.test(source)) importers.push(file);
    }
  }
  assert.deepEqual(importers, ['functions/_shared/news.js']);
  // L'accès legacy est unique et renvoie une copie profonde.
  const { legacyArticlesForOrganization } = await import('../functions/_shared/news.js');
  const copy = legacyArticlesForOrganization(A);
  copy[0].title = 'altéré';
  assert.notEqual(legacyArticlesForOrganization(A)[0].title, 'altéré');
  for (const id of [B, 'org_inconnue', '__proto__', 'constructor', '', null, 42]) assert.deepEqual(legacyArticlesForOrganization(id), [], String(id));
});

// --- Correctifs de l'audit Codex (NO_GO_4E1) ------------------------------------------------------------------------

test('P1-1 — enveloppes de commandes fermées : clé inconnue ou interdite → 422 AVANT toute requête D1, aucune écriture', async (t) => {
  const env = await setupNews();
  const a = await create(env, ctxA);
  const before = { row: await rowOf(env, a.id), state: await stateOf(env, A), n: await countArticles(env) };
  const FORBIDDEN = { id: `art_${'e'.repeat(32)}`, organizationId: B, organization_id: B, tenantId: B, orgId: B, inconnue: 1, now: 0 };
  const commands = [
    ['CREATE', (extra) => createArticle(env, ctxA, { expectedRevision: 0, draft: draft(), ...extra }), ['id', 'organizationId', 'organization_id', 'tenantId', 'orgId', 'inconnue']],
    ['SAVE', (extra) => saveArticle(env, ctxA, { id: a.id, expectedRevision: 1, draft: draft({ title: 'X' }), ...extra }), ['organizationId', 'organization_id', 'tenantId', 'orgId', 'inconnue']],
    ['PUBLISH', (extra) => publishArticle(env, ctxA, { id: a.id, expectedRevision: 1, ...extra }), ['organizationId', 'organization_id', 'tenantId', 'orgId', 'inconnue', 'draft', 'slug']],
    ['UNPUBLISH', (extra) => unpublishArticle(env, ctxA, { id: a.id, expectedRevision: 1, ...extra }), ['organizationId', 'draft', 'inconnue']],
    ['ARCHIVE', (extra) => archiveArticle(env, ctxA, { id: a.id, expectedRevision: 1, ...extra }), ['organizationId', 'draft', 'inconnue']],
    ['RESTORE', (extra) => restoreArticle(env, ctxA, { id: a.id, expectedRevision: 1, ...extra }), ['organizationId', 'draft', 'inconnue']],
    ['IMPORT', (extra) => importLegacyNews(env, ctxA, { expectedStateRevision: 1, ...extra }), ['organizationId', 'organization_id', 'inconnue', 'now', 'slug']],
    ['VALIDATE', (extra) => validateLegacyNews(env, ctxA, { expectedStateRevision: 1, ...extra }), ['organizationId', 'inconnue']],
    ['INVALIDATE', (extra) => invalidateNewsValidation(env, ctxA, { expectedStateRevision: 1, ...extra }), ['organizationId', 'inconnue']],
    ['CUTOVER', (extra) => cutoverNews(env, ctxA, { expectedStateRevision: 1, ...extra }), ['organizationId', 'inconnue']],
    ['ROLLBACK', (extra) => rollbackNews(env, ctxA, { expectedStateRevision: 1, ...extra }), ['organizationId', 'now', 'inconnue']],
  ];
  const is422 = (e) => e instanceof ArticleValidationError && e.status === 422;
  const spy = t.mock.method(env.DB, 'prepare');
  for (const [name, run, keys] of commands) {
    for (const key of keys) await assert.rejects(run({ [key]: FORBIDDEN[key] ?? 'x' }), is422, `${name} ${key}`);
  }
  // Enveloppe qui n'est pas un objet simple : 422 aussi.
  for (const bad of [null, [], 'x', Object.create(null), undefined]) {
    await assert.rejects(createArticle(env, ctxA, bad), is422);
    await assert.rejects(publishArticle(env, ctxA, bad), is422);
    await assert.rejects(cutoverNews(env, ctxA, bad), is422);
  }
  await assert.rejects(importLegacyNews(env, ctxA, { expectedStateRevision: 1, dryRun: 'oui' }), is422);
  assert.equal(spy.mock.callCount(), 0, 'aucune requête D1 pour une enveloppe invalide');
  spy.mock.restore();
  assert.deepEqual({ row: await rowOf(env, a.id), state: await stateOf(env, A), n: await countArticles(env) }, before, 'zéro écriture');
});

test('P1-2 — bascule refusée si la source legacy déployée devient invalide après la validation (fail-closed, aucune écriture)', async () => {
  const variants = [
    ['troisième article avec clé inconnue', (d) => d.articles.push({ ...d.articles[0], slug: 'troisieme', auteur: 'x' })],
    ['troisième article au résumé invalide', (d) => d.articles.push({ ...d.articles[0], slug: 'troisieme', excerpt: 'ligne 1\nligne 2' })],
    ['clé legacy en double', (d) => d.articles.push({ ...d.articles[0] })],
    ['catégorie non publiée', (d) => d.articles.push({ ...d.articles[0], slug: 'troisieme', category: 'inconnue' })],
    ['corps avec caractère de contrôle', (d) => d.articles.push({ ...d.articles[0], slug: 'troisieme', body: 'a\rb' })],
    ['source qui n’est plus une liste', (d) => { d.articles = 'pas une liste'; }],
  ];
  for (const [what, corrupt] of variants) {
    const env = await setupNews();
    const imported = await importLegacyNews(env, ctxA, { expectedStateRevision: (await readNewsState(env, ctxA)).revision });
    assert.ok((await auditLegacyNews(env, ctxA)).ok, what);
    const validated = await validateLegacyNews(env, ctxA, { expectedStateRevision: imported.newStateRevision });
    assert.ok(validated.ok, what);
    const stateBefore = await stateOf(env, A);
    const rowsBefore = (await env.DB.prepare('SELECT * FROM articles ORDER BY id').all()).results;
    const source = clone(LEGACY);
    corrupt(source);
    setNewsSourcesForTests({ [A]: source });
    await assert.rejects(
      cutoverNews(env, ctxA, { expectedStateRevision: validated.newStateRevision }),
      (e) => e instanceof NewsStateConflictError || e instanceof NewsUnavailableError,
      what
    );
    const stateAfter = await stateOf(env, A);
    assert.deepEqual(stateAfter, stateBefore, `${what} : état inchangé (source, révision, cutover_at)`);
    assert.deepEqual([stateAfter.source, stateAfter.cutover_at], ['json', null]);
    assert.deepEqual((await env.DB.prepare('SELECT * FROM articles ORDER BY id').all()).results, rowsBefore, `${what} : aucune écriture d'article`);
  }
  // Source valide mais différente de celle validée : refus aussi.
  const env = await setupNews();
  const imported = await importLegacyNews(env, ctxA, { expectedStateRevision: 1 });
  const validated = await validateLegacyNews(env, ctxA, { expectedStateRevision: imported.newStateRevision });
  const changed = clone(LEGACY);
  changed.articles[0].title = 'Titre modifié après validation';
  setNewsSourcesForTests({ [A]: changed });
  await assert.rejects(cutoverNews(env, ctxA, { expectedStateRevision: validated.newStateRevision }), /a changé/);
  assert.equal((await stateOf(env, A)).source, 'json');
});

test('P1-2 — aucun digest partiel : une source invalide n’a pas de digest (import, audit)', async () => {
  const bad = clone(LEGACY);
  bad.articles.push({ ...bad.articles[0], slug: 'invalide', auteur: 'x' });
  const env = await setupNews({ legacy: bad });
  const report = await importLegacyNews(env, ctxA, { expectedStateRevision: 1 });
  assert.deepEqual([report.ok, report.status, report.digest], [false, 422, null]);
  assert.equal((await stateOf(env, A)).legacy_digest, null);
  const audit = await auditLegacyNews(env, ctxA);
  assert.deepEqual([audit.ok, audit.digest], [false, null]);
});

test('P2-2 — horloge du retour arrière : serveur uniquement ; 0 ≤ maintenant − bascule ≤ 30 jours', async (t) => {
  t.after(() => setNewsClockForTests(null));
  const DAY = 86_400_000;
  const cutoverMsOf = (state) => Date.parse(`${state.cutoverAt.replace(' ', 'T')}Z`);
  const at = async (offset) => {
    setNewsClockForTests(null);
    const env = await setupNews();
    await toD1(env);
    const state = await readNewsState(env, ctxA);
    setNewsClockForTests(() => cutoverMsOf(state) + offset);
    return { env, state };
  };
  for (const [offset, allowed, what] of [
    [0, true, 'au moment de la bascule'],
    [29 * DAY, true, '+29 jours'],
    [30 * DAY, true, '+30 jours exactement (borne comprise)'],
    [30 * DAY + 1, false, '+30 jours + 1 ms'],
    [31 * DAY, false, '+31 jours'],
    [-1000, false, 'avant la bascule'],
  ]) {
    const { env, state } = await at(offset);
    const attempt = rollbackNews(env, ctxA, { expectedStateRevision: state.revision });
    if (allowed) {
      await attempt;
      assert.equal((await readNewsState(env, ctxA)).source, 'json', what);
    } else {
      await assert.rejects(attempt, /fenêtre de 30 jours/, what);
      assert.deepEqual(await readNewsState(env, ctxA), state, `${what} : rien d'écrit`);
    }
  }
  // Un champ `now` dans la commande n'est jamais une autorité : 422, rien d'écrit.
  const { env, state } = await at(31 * DAY);
  await assert.rejects(rollbackNews(env, ctxA, { expectedStateRevision: state.revision, now: cutoverMsOf(state) }), ArticleValidationError);
  assert.equal((await readNewsState(env, ctxA)).source, 'd1');
});

test('P2-1 — aucun cycle ESM : import direct de news-schema.js et de schema.js dans un processus neuf', () => {
  for (const module of ['functions/_shared/news-schema.js', 'functions/_shared/schema.js', 'functions/_shared/schema-utils.js']) {
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', `await import('./${module}'); console.log('ok');`], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${module} : ${run.stderr}`);
    assert.equal(run.stdout.trim(), 'ok');
  }
  assert.doesNotMatch(readFileSync('functions/_shared/news-schema.js', 'utf8'), /from '\.\/schema\.js'/, 'news-schema.js n’importe plus schema.js');
});
