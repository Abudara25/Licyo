// État des Actualités d'une organisation (organization_news_state) et services de la phase 4E.1 (contrat 4E v3.1
// §1, §16, §23 à §29) : import legacy, audit, validation, invalidation, bascule, retour arrière, et choix de la
// source publique. SANS interface (4E.2) et JAMAIS appelés pour basculer la production en 4E.1 : la source publique
// reste 'json' pour toutes les organisations, et les routes publiques n'utilisent pas encore readPublicNews.
//
// - Organisation : toujours celle du contexte serveur (session admin) ; la source legacy est lue UNIQUEMENT par
//   legacyArticlesForOrganization(organizationId) (news.js). Aucun paramètre de requête ne choisit la source.
// - CAS : `expectedStateRevision` sur toute action ; écriture en une instruction avec `revision = ?` et meta.changes
//   = 1 exactement ; l'import (plusieurs instructions, db.batch) utilise un « CAS par trigger » : la révision attendue
//   est écrite littéralement (`revision = ? + 1`), les triggers S1 et G2 font alors échouer TOUT le lot si elle a changé.
// - Verrou de validation : dès la validation posée, les triggers G10 et S2 figent articles et import ; la validation
//   n'est posée que si articles_revision est celui de l'audit (aucune mutation invisible entre audit et bascule).
// - Aucun repli de D1 vers le JSON : en source 'd1', une erreur D1 donne 503 (NewsUnavailableError), jamais le JSON.
import { ensureSchema } from './inscriptions-db.js';
import { ConfigConflictError } from './public-data.js';
import { loadPublishedSite } from './site-config.js';
import { legacyArticlesForOrganization, NewsUnavailableError } from './news.js';
import { sha256Hex } from './security.js';
import { ASSET_VERSIONS } from './asset-versions.js';
import { renderPage } from '../../renderer/render.js';
import { newsArticlePage } from '../../renderer/news.js';
import { mapLegacyArticle, newArticleId, newImportBatchId, publicArticleDto } from './article-model.js';
import { NewsStateConflictError, commandOf, findPublishedArticle, listPublishedArticles, organizationOf } from './articles.js';
import { ArticleValidationError } from './article-model.js';

// Enveloppes des commandes d'état (DTO externes) : clés exactes, 422 avant toute lecture D1 (voir commandOf).
export const STATE_COMMAND_KEYS = Object.freeze({
  import: Object.freeze(['expectedStateRevision', 'dryRun']),
  validate: Object.freeze(['expectedStateRevision']),
  invalidate: Object.freeze(['expectedStateRevision']),
  cutover: Object.freeze(['expectedStateRevision']),
  rollback: Object.freeze(['expectedStateRevision']),
});

// Horloge du serveur (fenêtre de retour arrière). Jamais lue dans une commande : seuls les tests la remplacent.
let clock = () => Date.now();
export function setNewsClockForTests(fn) {
  clock = typeof fn === 'function' ? fn : () => Date.now();
}

export const LEGACY_SOURCE = 'content/articles.json';
export const ROLLBACK_WINDOW_DAYS = 30;

const STATE_COLUMNS = `organization_id, source, revision, articles_revision, import_batch_id, legacy_digest, imported_at, validated_at,
  validated_articles_revision, cutover_at, updated_at`;

async function readStateRow(db, organizationId) {
  const row = await db.prepare(`SELECT ${STATE_COLUMNS} FROM organization_news_state WHERE organization_id = ?`).bind(organizationId).first();
  if (!row) throw new NewsUnavailableError('Actualités : état de l’organisation illisible');
  return row;
}

const phaseOf = (row) => (row.source === 'd1' ? 'd1' : row.validated_at !== null ? 'json_validated' : 'json_open');

function stateView(row) {
  return {
    source: row.source,
    phase: phaseOf(row),
    revision: row.revision,
    articlesRevision: row.articles_revision,
    importBatchId: row.import_batch_id,
    legacyDigest: row.legacy_digest,
    importedAt: row.imported_at,
    validatedAt: row.validated_at,
    validatedArticlesRevision: row.validated_articles_revision,
    cutoverAt: row.cutover_at,
    updatedAt: row.updated_at,
  };
}

export async function readNewsState(env, context) {
  const organizationId = organizationOf(context);
  await ensureSchema(env.DB);
  return stateView(await readStateRow(env.DB, organizationId));
}

const requireStateRevision = (row, expected) => {
  if (!Number.isInteger(expected) || expected !== row.revision) throw new ConfigConflictError();
};

async function runSingle(statement) {
  const result = await statement.run();
  if (result?.meta?.changes !== 1) throw new ConfigConflictError();
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// §24. Source legacy transformée, checksums et digest (implémentation UNIQUE : import, audit, validation, bascule).

async function siteOf(env, organizationId) {
  return (await loadPublishedSite(env, organizationId))?.config || null;
}

export async function prepareLegacySource(organizationId, categories) {
  const legacy = legacyArticlesForOrganization(organizationId);
  const entries = [];
  const invalid = [];
  const keys = new Set();
  for (let i = 0; i < legacy.length; i++) {
    const article = legacy[i];
    const label = typeof article?.slug === 'string' ? article.slug : `#${i + 1}`;
    let valid;
    try {
      valid = mapLegacyArticle(article, { categories });
    } catch (error) {
      invalid.push({ key: label, errors: error.errors || [error.message] });
      continue;
    }
    if (keys.has(valid.slug)) {
      invalid.push({ key: label, errors: ['clé legacy en double'] });
      continue;
    }
    keys.add(valid.slug);
    entries.push({ key: valid.slug, json: valid.json, draft: valid.draft, projections: valid.projections, checksum: await sha256Hex(valid.json), legacy: article });
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // unités UTF-16 (clés ASCII)
  // Digest de la source COMPLÈTE uniquement : une source où un seul article est invalide n'a pas de digest (null), il ne
  // peut donc jamais servir de preuve (import, validation, bascule).
  const ok = invalid.length === 0;
  const digest = ok ? await sha256Hex(JSON.stringify(entries.map((e) => [e.key, e.checksum]))) : null;
  return { ok, entries, invalid, digest };
}

// Lignes de l'organisation utiles à l'import et à l'audit.
async function organizationRows(db, organizationId) {
  const { results } = await db
    .prepare(
      `SELECT id, slug, revision, draft_json, published_json, published_title, published_excerpt, published_category,
         published_for_at, archived_at, legacy_source, legacy_key, import_checksum
       FROM articles WHERE organization_id = ?`
    )
    .bind(organizationId)
    .all();
  return results;
}

// §25.2 : classement de chaque article legacy (trié par clé).
async function classify(entries, rows) {
  const byKey = new Map(rows.filter((r) => r.legacy_source === LEGACY_SOURCE).map((r) => [r.legacy_key, r]));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const decisions = [];
  for (const entry of entries) {
    const row = byKey.get(entry.key);
    if (!row) {
      decisions.push(bySlug.has(entry.key) ? { key: entry.key, action: 'conflict', reason: 'slug déjà pris par un autre article' } : { key: entry.key, action: 'insert', entry });
      continue;
    }
    if (row.archived_at !== null) {
      decisions.push({ key: entry.key, action: 'conflict', reason: 'archivé dans le CRM' });
      continue;
    }
    const intact = (await sha256Hex(row.draft_json)) === row.import_checksum && row.published_json === row.draft_json;
    if (entry.checksum === row.import_checksum) decisions.push({ key: entry.key, action: intact ? 'unchanged' : 'kept', row });
    else if (intact) decisions.push({ key: entry.key, action: 'republish', entry, row });
    else decisions.push({ key: entry.key, action: 'conflict', reason: 'modifié dans le CRM depuis l’import' });
  }
  const sourceKeys = new Set(entries.map((e) => e.key));
  const absentFromSource = [...byKey.keys()].filter((k) => !sourceKeys.has(k)).sort();
  return { decisions, absentFromSource };
}

const publicDecision = ({ key, action, reason }) => (reason ? { key, action, reason } : { key, action });

// ---------------------------------------------------------------------------------------------------------------
// §25. Import

// Toutes les instructions de l'import, dans l'ordre (a) état, (b) créations, (c) republications.
function importStatements(db, organizationId, stateRevision, batchId, digest, decisions) {
  const statements = [
    db
      .prepare(
        `UPDATE organization_news_state SET import_batch_id = ?, legacy_digest = ?, imported_at = datetime('now'),
  revision = ? + 1, updated_at = datetime('now') WHERE organization_id = ?`
      )
      .bind(batchId, digest, stateRevision, organizationId),
  ];
  for (const d of decisions) {
    if (d.action === 'insert') {
      statements.push(
        db
          .prepare(
            `INSERT INTO articles (id, organization_id, slug, draft_json, published_json, published_revision, published_title,
  published_excerpt, published_category, published_for_at, first_published_at, last_published_at,
  legacy_source, legacy_key, import_checksum, import_batch_id)
SELECT ?, ?, ?, d, d, 1, json_extract(d, '$.title'), json_extract(d, '$.excerpt'), json_extract(d, '$.category'),
       json_extract(d, '$.date'), datetime('now'), datetime('now'), 'content/articles.json', ?, ?, ?
FROM (SELECT ? AS d)`
          )
          .bind(newArticleId(), organizationId, d.entry.key, d.entry.key, d.entry.checksum, batchId, d.entry.json)
      );
    } else if (d.action === 'republish') {
      statements.push(
        db
          .prepare(
            `UPDATE articles SET draft_json = ?1, published_json = ?1, published_revision = ?2 + 1,
  published_title = json_extract(?1, '$.title'), published_excerpt = json_extract(?1, '$.excerpt'),
  published_category = json_extract(?1, '$.category'), published_for_at = json_extract(?1, '$.date'),
  last_published_at = datetime('now'), import_checksum = ?3, import_batch_id = ?4,
  revision = ?2 + 1, updated_at = datetime('now') WHERE organization_id = ?5 AND id = ?6`
          )
          .bind(d.entry.json, d.row.revision, d.entry.checksum, batchId, organizationId, d.row.id)
      );
    }
  }
  return statements;
}

export async function importLegacyNews(env, context, command) {
  const organizationId = organizationOf(context);
  const { expectedStateRevision, dryRun = false } = commandOf(command, STATE_COMMAND_KEYS.import, 'IMPORT');
  if (typeof dryRun !== 'boolean') throw new ArticleValidationError(['IMPORT : dryRun booléen attendu']);
  await ensureSchema(env.DB);
  const state = await readStateRow(env.DB, organizationId);
  requireStateRevision(state, expectedStateRevision);
  if (phaseOf(state) !== 'json_open') throw new NewsStateConflictError('Import possible seulement en source json non validée.');
  const categories = Object.keys((await siteOf(env, organizationId))?.news?.categories || {});
  const source = await prepareLegacySource(organizationId, categories);
  const report = { ok: false, dryRun: Boolean(dryRun), stateRevision: state.revision, digest: source.digest, decisions: [], conflicts: [], invalid: source.invalid, absentFromSource: [] };
  if (!source.ok) return { ...report, status: 422, reason: 'source invalide' };
  const { decisions, absentFromSource } = await classify(source.entries, await organizationRows(env.DB, organizationId));
  report.decisions = decisions.map(publicDecision);
  report.conflicts = decisions.filter((d) => d.action === 'conflict').map(publicDecision);
  report.absentFromSource = absentFromSource;
  if (report.conflicts.length) return { ...report, status: 409, reason: 'conflits' };
  if (dryRun) return { ...report, ok: true, status: 200 };
  const batchId = newImportBatchId();
  try {
    await env.DB.batch(importStatements(env.DB, organizationId, state.revision, batchId, source.digest, decisions));
  } catch (error) {
    // État ou ligne modifiés entre-temps, slug ou clé pris, publication incohérente : tout le lot est annulé.
    const conflict = new ConfigConflictError();
    conflict.report = { ...report, status: 409, reason: 'concurrence', detail: error?.name || 'Error' };
    throw conflict;
  }
  return { ...report, ok: true, status: 200, batchId, newStateRevision: state.revision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// §26. Audit (lecture seule)

const legacyPublic = (a) => ({ slug: a.slug, title: a.title, excerpt: a.excerpt, category: a.category, date: a.date, image: a.image || null });

// HTML du détail : moteur réel, exactement comme la page publique d'une actualité (functions/actualites/[slug].js).
export function renderNewsDetail(site, article, blocks) {
  return renderPage({ site, page: newsArticlePage(site, article, blocks === undefined ? {} : { blocks }), locale: site.locale, assetVersions: ASSET_VERSIONS, mode: 'static', base: '/' });
}

export async function auditLegacyNews(env, context) {
  const organizationId = organizationOf(context);
  await ensureSchema(env.DB);
  const state = await readStateRow(env.DB, organizationId);
  const site = await siteOf(env, organizationId);
  const categories = Object.keys(site?.news?.categories || {});
  const source = await prepareLegacySource(organizationId, categories);
  const gaps = [];
  const gap = (key, message) => gaps.push({ key, message });
  if (!site?.news) gap(null, 'configuration publiée du site sans actualités');
  for (const bad of source.invalid) gap(bad.key, `source invalide : ${bad.errors.join(', ')}`);
  if (!state.import_batch_id) gap(null, 'aucun import enregistré');
  if (source.digest !== state.legacy_digest) gap(null, 'digest de la source différent de celui de l’import');
  const rows = await organizationRows(env.DB, organizationId);
  const { decisions } = await classify(source.entries, rows);
  for (const d of decisions.filter((x) => x.action === 'conflict')) gap(d.key, `conflit : ${d.reason}`);
  const byKey = new Map(rows.filter((r) => r.legacy_source === LEGACY_SOURCE).map((r) => [r.legacy_key, r]));
  for (const entry of source.entries) {
    const row = byKey.get(entry.key);
    if (!row) {
      gap(entry.key, 'absent de la base');
      continue;
    }
    if (row.published_json === null || row.archived_at !== null) gap(entry.key, 'non publié ou archivé');
    if (row.slug !== entry.key) gap(entry.key, 'slug différent de la clé legacy');
    if (row.draft_json !== entry.json || row.published_json !== entry.json) gap(entry.key, 'contenu différent de la source');
    const checksum = await sha256Hex(row.draft_json);
    if (checksum !== row.import_checksum || checksum !== entry.checksum) gap(entry.key, 'empreinte différente');
    const p = entry.projections;
    if (row.published_title !== p.title || row.published_excerpt !== p.excerpt || row.published_category !== p.category || row.published_for_at !== p.date) {
      gap(entry.key, 'projections différentes');
    }
    if (!site?.news || row.published_json === null) continue;
    const published = await findPublishedArticle(env.DB, organizationId, entry.key);
    if (!published) {
      gap(entry.key, 'introuvable en lecture publique d1');
      continue;
    }
    if (JSON.stringify(publicArticleDto(site, legacyPublic(entry.legacy))) !== JSON.stringify(publicArticleDto(site, published.article))) gap(entry.key, 'DTO différent entre json et d1');
    let jsonHtml;
    let d1Html;
    try {
      jsonHtml = renderNewsDetail(site, entry.legacy);
      d1Html = renderNewsDetail(site, published.article, published.blocks);
    } catch (error) {
      gap(entry.key, `rendu impossible (${error?.name || 'Error'})`);
      continue;
    }
    if (jsonHtml !== d1Html) gap(entry.key, 'HTML du détail différent entre json et d1');
  }
  // Articles publiés sans équivalent legacy : ils deviendront publics à la bascule (affichés à la validation).
  const newWithoutLegacy = rows.filter((r) => r.legacy_source === null && r.published_json !== null && r.archived_at === null).map((r) => r.slug).sort();
  return {
    ok: gaps.length === 0,
    R: state.revision,
    A: state.articles_revision,
    batchId: state.import_batch_id,
    digest: source.digest,
    gaps,
    newWithoutLegacy,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// §27. Validation

function validateStatement(db, organizationId, revision, articlesRevision, batchId, digest) {
  return db
    .prepare(
      `UPDATE organization_news_state SET validated_at = datetime('now'), validated_articles_revision = articles_revision,
  revision = revision + 1, updated_at = datetime('now')
WHERE organization_id = ? AND revision = ? AND articles_revision = ? AND source = 'json' AND validated_at IS NULL
  AND import_batch_id = ? AND legacy_digest = ?`
    )
    .bind(organizationId, revision, articlesRevision, batchId, digest);
}

export async function validateLegacyNews(env, context, command) {
  const organizationId = organizationOf(context);
  const { expectedStateRevision } = commandOf(command, STATE_COMMAND_KEYS.validate, 'VALIDATE');
  await ensureSchema(env.DB);
  const state = await readStateRow(env.DB, organizationId);
  requireStateRevision(state, expectedStateRevision);
  if (phaseOf(state) !== 'json_open') throw new NewsStateConflictError('Validation possible seulement en source json non validée.');
  const audit = await auditLegacyNews(env, context);
  if (!audit.ok) return { ok: false, status: 409, reason: 'audit en échec', audit };
  if (audit.R !== state.revision || audit.A !== state.articles_revision) throw new ConfigConflictError();
  // Digest recalculé à partir de la source actuellement déployée.
  const categories = Object.keys((await siteOf(env, organizationId))?.news?.categories || {});
  const { digest, ok } = await prepareLegacySource(organizationId, categories);
  if (!ok) return { ok: false, status: 422, reason: 'source invalide', audit };
  await runSingle(validateStatement(env.DB, organizationId, audit.R, audit.A, audit.batchId, digest));
  return { ok: true, status: 200, audit, newStateRevision: audit.R + 1, newWithoutLegacy: audit.newWithoutLegacy };
}

// ---------------------------------------------------------------------------------------------------------------
// §16. INVALIDATE_VALIDATION

function invalidateStatement(db, organizationId, revision) {
  return db
    .prepare(
      `UPDATE organization_news_state SET validated_at = NULL, validated_articles_revision = NULL, revision = revision + 1, updated_at = datetime('now')
  WHERE organization_id = ? AND revision = ? AND source = 'json' AND validated_at IS NOT NULL`
    )
    .bind(organizationId, revision);
}

export async function invalidateNewsValidation(env, context, command) {
  const organizationId = organizationOf(context);
  const { expectedStateRevision } = commandOf(command, STATE_COMMAND_KEYS.invalidate, 'INVALIDATE_VALIDATION');
  await ensureSchema(env.DB);
  const state = await readStateRow(env.DB, organizationId);
  requireStateRevision(state, expectedStateRevision);
  await runSingle(invalidateStatement(env.DB, organizationId, state.revision));
  return { ok: true, newStateRevision: state.revision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// §28. Bascule json → d1 (préalables 4E.3 et gel de Sveltia : jamais appelée en 4E.1 hors tests)

function cutoverStatement(db, organizationId, revision, batchId, digest) {
  return db
    .prepare(
      `UPDATE organization_news_state SET source = 'd1', cutover_at = datetime('now'), revision = revision + 1, updated_at = datetime('now')
WHERE organization_id = ? AND revision = ? AND source = 'json' AND validated_at IS NOT NULL
  AND validated_articles_revision = articles_revision AND import_batch_id = ? AND legacy_digest = ?`
    )
    .bind(organizationId, revision, batchId, digest);
}

export async function cutoverNews(env, context, command) {
  const organizationId = organizationOf(context);
  const { expectedStateRevision } = commandOf(command, STATE_COMMAND_KEYS.cutover, 'CUTOVER');
  await ensureSchema(env.DB);
  const state = await readStateRow(env.DB, organizationId);
  requireStateRevision(state, expectedStateRevision);
  // Source déployée recalculée : elle doit être ENTIÈREMENT valide (sinon refus, aucune écriture) et son digest égal
  // à celui de l'import validé (sinon 0 ligne, 409 ; S4 en défense). Jamais de digest partiel comme preuve.
  const categories = Object.keys((await siteOf(env, organizationId))?.news?.categories || {});
  const source = await prepareLegacySource(organizationId, categories);
  if (source.ok !== true || typeof source.digest !== 'string') {
    throw new NewsStateConflictError('Bascule refusée : la source legacy déployée est invalide (nouvel import, audit et validation requis).');
  }
  if (source.digest !== state.legacy_digest) throw new NewsStateConflictError('Bascule refusée : la source legacy déployée a changé depuis la validation.');
  const digest = source.digest;
  await runSingle(cutoverStatement(env.DB, organizationId, state.revision, state.import_batch_id, digest));
  return { ok: true, newStateRevision: state.revision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// §29. Retour arrière d1 → json (fenêtre de 30 jours)

function rollbackStatement(db, organizationId, revision) {
  return db
    .prepare(
      `UPDATE organization_news_state SET source = 'json', validated_at = NULL, validated_articles_revision = NULL,
  revision = revision + 1, updated_at = datetime('now') WHERE organization_id = ? AND revision = ? AND source = 'd1'`
    )
    .bind(organizationId, revision);
}

export async function rollbackNews(env, context, command) {
  const organizationId = organizationOf(context);
  const { expectedStateRevision } = commandOf(command, STATE_COMMAND_KEYS.rollback, 'ROLLBACK');
  await ensureSchema(env.DB);
  const state = await readStateRow(env.DB, organizationId);
  requireStateRevision(state, expectedStateRevision);
  if (state.source !== 'd1') throw new NewsStateConflictError('Retour arrière possible seulement en source d1.');
  // Fenêtre : 0 ≤ maintenant − cutover_at ≤ 30 jours (bornes comprises), horloge du serveur uniquement.
  const delta = clock() - Date.parse(`${state.cutover_at.replace(' ', 'T')}Z`);
  if (!(Number.isFinite(delta) && delta >= 0 && delta <= ROLLBACK_WINDOW_DAYS * 86_400_000)) {
    throw new NewsStateConflictError('Retour arrière refusé : hors de la fenêtre de 30 jours suivant la bascule.');
  }
  // Articles créés ou modifiés dans le CRM depuis la bascule : invisibles en source json après le retour arrière.
  const { results: changed } = await env.DB
    .prepare('SELECT slug, updated_at FROM articles WHERE organization_id = ? AND updated_at >= ? ORDER BY updated_at DESC, slug')
    .bind(organizationId, state.cutover_at)
    .all();
  await runSingle(rollbackStatement(env.DB, organizationId, state.revision));
  return { ok: true, newStateRevision: state.revision + 1, changedSinceCutover: changed.map((r) => r.slug) };
}

// ---------------------------------------------------------------------------------------------------------------
// §28. Lecture publique, à chaque requête, sans cache mémoire de la source (branchée sur les routes en 4E.3) :
//   'd1'  → D1 uniquement ; toute erreur → 503 (NewsUnavailableError), JAMAIS le JSON ;
//   'json'→ legacyArticlesForOrganization ;
//   état illisible → 503, aucune source devinée.

async function publicSource(env, organizationId) {
  let state;
  try {
    await ensureSchema(env.DB);
    state = await env.DB.prepare('SELECT source FROM organization_news_state WHERE organization_id = ?').bind(organizationId).first();
  } catch {
    throw new NewsUnavailableError('Actualités : état illisible');
  }
  if (!state || (state.source !== 'json' && state.source !== 'd1')) throw new NewsUnavailableError('Actualités : état illisible');
  return state.source;
}

// Liste publique normalisée : [{ slug, title, excerpt, category, date, image }].
export async function readPublicNews(env, organizationId) {
  if (typeof organizationId !== 'string' || !organizationId) throw new NewsUnavailableError('Actualités : organisation inconnue');
  const source = await publicSource(env, organizationId);
  if (source === 'json') {
    const articles = legacyArticlesForOrganization(organizationId).filter((a) => a && typeof a === 'object' && typeof a.slug === 'string');
    return { source, articles: articles.map(legacyPublic) };
  }
  try {
    return { source, articles: await listPublishedArticles(env.DB, organizationId) };
  } catch {
    throw new NewsUnavailableError('Actualités : lecture D1 impossible');
  }
}

// Détail public : { source, article, blocks? } ou null. En source json, article historique (corps en `body`).
export async function findPublicNewsArticle(env, organizationId, slug) {
  if (typeof organizationId !== 'string' || !organizationId) throw new NewsUnavailableError('Actualités : organisation inconnue');
  const source = await publicSource(env, organizationId);
  if (source === 'json') {
    const article = legacyArticlesForOrganization(organizationId).find((a) => a && typeof a === 'object' && a.slug === slug) || null;
    return article ? { source, article } : null;
  }
  try {
    const found = await findPublishedArticle(env.DB, organizationId, slug);
    return found ? { source, ...found } : null;
  } catch {
    throw new NewsUnavailableError('Actualités : lecture D1 impossible');
  }
}
