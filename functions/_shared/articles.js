// Services Article des Actualités CRM (phase 4E.1, contrat 4E v3.1 §9 à §15). SANS interface : les routes admin
// viendront en 4E.2 ; aucune route publique ne lit la table articles en 4E.1 (la source publique reste le JSON).
//
// Règles communes (§9) :
// - l'organisation vient TOUJOURS du contexte serveur (session admin : isAuthed() → { organizationId }), jamais d'un
//   corps, d'une requête, d'un en-tête ni d'un identifiant d'article ;
// - identifiant d'article contrôlé AVANT toute requête : format invalide → 404, sans lecture de la base ;
// - lecture préalable limitée à l'organisation (WHERE organization_id = ? AND id = ?) : absent, y compris chez une
//   autre organisation → ArticleNotFoundError (404, jamais 409 : l'existence d'un article d'un autre club n'est pas
//   révélée) ; révision différente de expectedRevision → 409 ;
// - écriture en UNE instruction : WHERE organization_id = ? AND id = ? AND revision = ? [AND précondition], et
//   meta.changes doit valoir exactement 1 (sinon ConfigConflictError, 409). Les triggers G1 à G13 restent la défense
//   en base (verrou de validation compris).
// - chaque service construit ses instructions dans une seule fonction (*Statement) : un futur tenantWrite (R3)
//   s'insérera en tête du lot sans toucher à la logique (IC-4E.1, point 5).
import { ensureSchema } from './inscriptions-db.js';
import { ConfigConflictError } from './public-data.js';
import { loadPublishedSite } from './site-config.js';
import { NewsUnavailableError } from './news.js';
import { ArticleValidationError, isArticleId, isArticleSlug, markdownToAst, newArticleId, slugFromTitle, validateArticle } from './article-model.js';

export class ArticleNotFoundError extends Error {
  constructor() {
    super('Article introuvable.');
    this.name = 'ArticleNotFoundError';
    this.status = 404;
  }
}

export class SlugConflictError extends Error {
  constructor() {
    super('Ce slug est déjà utilisé par un autre article.');
    this.name = 'SlugConflictError';
    this.status = 409;
  }
}

// Précondition d'état non remplie (verrou de validation, article archivé, action impossible dans l'état courant).
export class NewsStateConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NewsStateConflictError';
    this.status = 409;
  }
}

export const HTTP_STATUS = (error) => {
  if (error?.status) return error.status;
  if (error instanceof ConfigConflictError) return 409;
  if (error instanceof NewsUnavailableError) return 503;
  return 500;
};

// Organisation du contexte serveur (session admin). Rien d'autre n'est accepté.
export function organizationOf(context) {
  const id = context?.organizationId;
  if (typeof id !== 'string' || !id) throw new Error('Actualités : organisation du contexte serveur requise');
  return id;
}

// Enveloppe d'une commande (DTO externe) : objet simple dont les clés appartiennent EXACTEMENT à la liste de la
// commande. Toute clé inconnue ou interdite (id client, organizationId, organization_id, tenantId, orgId…) donne
// ArticleValidationError (422) AVANT toute lecture ou écriture D1. L'organisation vient du contexte serveur, jamais de
// la commande ; les réglages internes (horloge des tests…) ne passent jamais par une commande.
export const COMMAND_KEYS = Object.freeze({
  create: Object.freeze(['expectedRevision', 'draft', 'slug']),
  save: Object.freeze(['id', 'expectedRevision', 'draft', 'slug']),
  publish: Object.freeze(['id', 'expectedRevision']),
  unpublish: Object.freeze(['id', 'expectedRevision']),
  archive: Object.freeze(['id', 'expectedRevision']),
  restore: Object.freeze(['id', 'expectedRevision']),
});
export function commandOf(command, allowed, name) {
  if (command === null || typeof command !== 'object' || Array.isArray(command) || Object.getPrototypeOf(command) !== Object.prototype) {
    throw new ArticleValidationError([`${name} : commande objet attendue`]);
  }
  const unknown = Reflect.ownKeys(command).filter((key) => typeof key !== 'string' || !allowed.includes(key));
  if (unknown.length) throw new ArticleValidationError(unknown.map((key) => `${name} : clé non autorisée « ${String(key)} »`));
  return command;
}

const requireRevision = (value, { create = false } = {}) => {
  if (!Number.isInteger(value) || value < 0) throw new ArticleValidationError(['expectedRevision : entier attendu']);
  if (create && value !== 0) throw new ConfigConflictError();
  return value;
};

const ARTICLE_COLUMNS = `id, slug, revision, draft_json, published_json, published_revision, published_title, published_excerpt,
  published_category, published_for_at, first_published_at, last_published_at, unpublished_at, archived_at, legacy_source,
  legacy_key, import_checksum, import_batch_id, created_at, updated_at`;

async function readArticleRow(db, organizationId, id) {
  return db.prepare(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE organization_id = ? AND id = ?`).bind(organizationId, id).first();
}

// Verrou de validation (§1) : source 'json' et validation posée → aucune mutation d'article.
export async function readNewsLock(db, organizationId) {
  const state = await db.prepare('SELECT source, validated_at FROM organization_news_state WHERE organization_id = ?').bind(organizationId).first();
  if (!state) throw new NewsUnavailableError('Actualités : état de l’organisation illisible');
  return state.source === 'json' && state.validated_at !== null;
}

// Catégories PUBLIÉES de l'organisation (configuration du site publiée) ; aucune si elle n'a pas de site publié.
export async function publishedCategories(env, organizationId) {
  const published = await loadPublishedSite(env, organizationId);
  return Object.keys(published?.config?.news?.categories || {});
}

function mapWriteError(error) {
  const message = String(error?.message || '');
  if (/UNIQUE constraint failed: articles\.organization_id, articles\.slug/.test(message)) return new SlugConflictError();
  if (message.includes('état validé figé')) return new NewsStateConflictError('Actualités figées par la validation : invalider la validation d’abord.');
  return error;
}

async function runSingle(statement) {
  let result;
  try {
    result = await statement.run();
  } catch (error) {
    throw mapWriteError(error);
  }
  if (result?.meta?.changes !== 1) throw new ConfigConflictError();
  return result;
}

// Lecture préalable commune : format, organisation, existence, révision, verrou.
async function prepareMutation(env, context, id, expectedRevision) {
  const organizationId = organizationOf(context);
  if (!isArticleId(id)) throw new ArticleNotFoundError(); // avant toute requête D1
  requireRevision(expectedRevision);
  await ensureSchema(env.DB);
  const row = await readArticleRow(env.DB, organizationId, id);
  if (!row) throw new ArticleNotFoundError();
  if (row.revision !== expectedRevision) throw new ConfigConflictError();
  if (await readNewsLock(env.DB, organizationId)) throw new NewsStateConflictError('Actualités figées par la validation : invalider la validation d’abord.');
  return { organizationId, row };
}

const existingOf = (row) => ({ draft: JSON.parse(row.draft_json), slug: row.slug, firstPublishedAt: row.first_published_at });

// ---------------------------------------------------------------------------------------------------------------
// §10. CREATE

function createStatement(db, organizationId, id, slug, json) {
  return db.prepare('INSERT INTO articles (id, organization_id, slug, draft_json) VALUES (?, ?, ?, ?)').bind(id, organizationId, slug, json);
}

export async function createArticle(env, context, command) {
  const organizationId = organizationOf(context);
  const { expectedRevision, draft, slug } = commandOf(command, COMMAND_KEYS.create, 'CREATE');
  requireRevision(expectedRevision, { create: true });
  await ensureSchema(env.DB);
  if (await readNewsLock(env.DB, organizationId)) throw new NewsStateConflictError('Actualités figées par la validation : invalider la validation d’abord.');
  const categories = await publishedCategories(env, organizationId);
  const wanted = slug === undefined || slug === null || slug === '' ? slugFromTitle(draft?.title) : slug;
  const valid = validateArticle(draft, { mode: 'draft', categories, slug: wanted, existing: null });
  // Identifiant généré par le serveur ; une collision (128 bits, 122 aléatoires) est retentée, jamais reprise d'une entrée.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newArticleId();
    try {
      await runSingle(createStatement(env.DB, organizationId, id, valid.slug, valid.json));
      return { id, revision: 1, slug: valid.slug };
    } catch (error) {
      if (/UNIQUE constraint failed: articles\.id/.test(String(error?.message))) continue;
      throw error;
    }
  }
  throw new ConfigConflictError();
}

// ---------------------------------------------------------------------------------------------------------------
// §11. SAVE (jamais de publication implicite : tuple publié et historique inchangés, G5)

function saveStatement(db, organizationId, id, revision, json, slug) {
  return db
    .prepare(
      `UPDATE articles SET draft_json = ?, slug = ?, revision = revision + 1, updated_at = datetime('now')
  WHERE organization_id = ? AND id = ? AND revision = ? AND archived_at IS NULL AND (first_published_at IS NULL OR slug = ?)`
    )
    .bind(json, slug, organizationId, id, revision, slug);
}

export async function saveArticle(env, context, command) {
  organizationOf(context);
  const { id, expectedRevision, draft, slug } = commandOf(command, COMMAND_KEYS.save, 'SAVE');
  const { organizationId, row } = await prepareMutation(env, context, id, expectedRevision);
  if (row.archived_at !== null) throw new NewsStateConflictError('Article archivé : le restaurer d’abord.');
  const categories = await publishedCategories(env, organizationId);
  const valid = validateArticle(draft, { mode: 'draft', categories, slug: slug ?? row.slug, existing: existingOf(row) });
  await runSingle(saveStatement(env.DB, organizationId, id, expectedRevision, valid.json, valid.slug));
  return { id, revision: expectedRevision + 1, slug: valid.slug };
}

// ---------------------------------------------------------------------------------------------------------------
// §12. PUBLISH : valide EXACTEMENT le draft_json lu ; l'UPDATE exige ce même draft_json (brouillon modifié entre la
// validation et l'écriture → 0 ligne → 409).

function publishStatement(db, organizationId, id, revision, draftJson) {
  return db
    .prepare(
      `UPDATE articles SET published_json = draft_json, published_revision = revision + 1,
    published_title = json_extract(draft_json, '$.title'), published_excerpt = json_extract(draft_json, '$.excerpt'),
    published_category = json_extract(draft_json, '$.category'), published_for_at = json_extract(draft_json, '$.date'),
    first_published_at = COALESCE(first_published_at, datetime('now')), last_published_at = datetime('now'),
    revision = revision + 1, updated_at = datetime('now')
  WHERE organization_id = ? AND id = ? AND revision = ? AND draft_json = ? AND archived_at IS NULL`
    )
    .bind(organizationId, id, revision, draftJson);
}

export async function publishArticle(env, context, command) {
  organizationOf(context);
  const { id, expectedRevision } = commandOf(command, COMMAND_KEYS.publish, 'PUBLISH');
  const { organizationId, row } = await prepareMutation(env, context, id, expectedRevision);
  if (row.archived_at !== null) throw new NewsStateConflictError('Article archivé : le restaurer d’abord.');
  const categories = await publishedCategories(env, organizationId);
  const existing = existingOf(row);
  const valid = validateArticle(existing.draft, { mode: 'publish', categories, slug: row.slug, existing });
  // Le brouillon stocké doit être exactement sa forme canonique : c'est lui qui est copié par SQL.
  if (valid.json !== row.draft_json) throw new ArticleValidationError(['brouillon enregistré non canonique : l’enregistrer à nouveau']);
  await runSingle(publishStatement(env.DB, organizationId, id, expectedRevision, row.draft_json));
  return { id, revision: expectedRevision + 1, publishedRevision: expectedRevision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// §13. UNPUBLISH

function unpublishStatement(db, organizationId, id, revision) {
  return db
    .prepare(
      `UPDATE articles SET published_json = NULL, published_revision = NULL, published_title = NULL, published_excerpt = NULL,
    published_category = NULL, published_for_at = NULL, unpublished_at = datetime('now'), revision = revision + 1, updated_at = datetime('now')
  WHERE organization_id = ? AND id = ? AND revision = ? AND published_json IS NOT NULL AND archived_at IS NULL`
    )
    .bind(organizationId, id, revision);
}

export async function unpublishArticle(env, context, command) {
  organizationOf(context);
  const { id, expectedRevision } = commandOf(command, COMMAND_KEYS.unpublish, 'UNPUBLISH');
  const { organizationId, row } = await prepareMutation(env, context, id, expectedRevision);
  if (row.published_json === null || row.archived_at !== null) throw new NewsStateConflictError('Article non publié.');
  await runSingle(unpublishStatement(env.DB, organizationId, id, expectedRevision));
  return { id, revision: expectedRevision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// §14. ARCHIVE (dépublication et archivage dans la même instruction)

function archiveStatement(db, organizationId, id, revision) {
  return db
    .prepare(
      `UPDATE articles SET published_json = NULL, published_revision = NULL, published_title = NULL, published_excerpt = NULL,
    published_category = NULL, published_for_at = NULL,
    unpublished_at = CASE WHEN published_json IS NOT NULL THEN datetime('now') ELSE unpublished_at END,
    archived_at = datetime('now'), revision = revision + 1, updated_at = datetime('now')
  WHERE organization_id = ? AND id = ? AND revision = ? AND archived_at IS NULL`
    )
    .bind(organizationId, id, revision);
}

export async function archiveArticle(env, context, command) {
  organizationOf(context);
  const { id, expectedRevision } = commandOf(command, COMMAND_KEYS.archive, 'ARCHIVE');
  const { organizationId, row } = await prepareMutation(env, context, id, expectedRevision);
  if (row.archived_at !== null) throw new NewsStateConflictError('Article déjà archivé.');
  await runSingle(archiveStatement(env.DB, organizationId, id, expectedRevision));
  return { id, revision: expectedRevision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// §15. RESTORE

function restoreStatement(db, organizationId, id, revision) {
  return db
    .prepare(
      `UPDATE articles SET archived_at = NULL, revision = revision + 1, updated_at = datetime('now')
  WHERE organization_id = ? AND id = ? AND revision = ? AND archived_at IS NOT NULL`
    )
    .bind(organizationId, id, revision);
}

export async function restoreArticle(env, context, command) {
  organizationOf(context);
  const { id, expectedRevision } = commandOf(command, COMMAND_KEYS.restore, 'RESTORE');
  const { organizationId, row } = await prepareMutation(env, context, id, expectedRevision);
  if (row.archived_at === null) throw new NewsStateConflictError('Article non archivé.');
  await runSingle(restoreStatement(env.DB, organizationId, id, expectedRevision));
  return { id, revision: expectedRevision + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// Lectures admin (organisation de la session ; états et indicateurs DÉRIVÉS, jamais stockés, §1).

function adminView(row) {
  const published = row.published_json !== null && row.archived_at === null;
  return {
    id: row.id,
    slug: row.slug,
    revision: row.revision,
    state: row.archived_at !== null ? 'archived' : published ? 'published' : 'draft',
    draft: JSON.parse(row.draft_json),
    publishedRevision: row.published_revision,
    hasUnpublishedChanges: row.published_json !== null && row.draft_json !== row.published_json,
    everPublished: row.first_published_at !== null,
    slugLocked: row.first_published_at !== null,
    firstPublishedAt: row.first_published_at,
    lastPublishedAt: row.last_published_at,
    unpublishedAt: row.unpublished_at,
    archivedAt: row.archived_at,
    legacyKey: row.legacy_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getArticle(env, context, id) {
  const organizationId = organizationOf(context);
  if (!isArticleId(id)) throw new ArticleNotFoundError();
  await ensureSchema(env.DB);
  const row = await readArticleRow(env.DB, organizationId, id);
  if (!row) throw new ArticleNotFoundError();
  return adminView(row);
}

export async function listArticles(env, context) {
  const organizationId = organizationOf(context);
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare(`SELECT ${ARTICLE_COLUMNS} FROM articles WHERE organization_id = ? ORDER BY updated_at DESC, id`).bind(organizationId).all();
  return results.map(adminView);
}

// ---------------------------------------------------------------------------------------------------------------
// Lectures publiques en source d1 (utilisées par news-state.js, branchées sur les routes en 4E.3) : UNIQUEMENT la
// version publiée et ses projections, jamais draft_json (I17). Ordre public total (§3) :
// published_for_at DESC, first_published_at DESC, slug ASC.

export async function listPublishedArticles(db, organizationId) {
  const { results } = await db
    .prepare(
      `SELECT slug, published_title, published_excerpt, published_category, published_for_at,
         json_extract(published_json, '$.legacyImage') AS legacy_image
       FROM articles WHERE organization_id = ? AND published_json IS NOT NULL AND archived_at IS NULL
       ORDER BY published_for_at DESC, first_published_at DESC, slug ASC`
    )
    .bind(organizationId)
    .all();
  return results.map((r) => ({
    slug: r.slug,
    title: r.published_title,
    excerpt: r.published_excerpt,
    category: r.published_category,
    date: r.published_for_at,
    image: r.legacy_image || null,
  }));
}

// Article publié d'une organisation par slug, avec son corps en AST v1 (même chaîne que l'aperçu et la publication).
export async function findPublishedArticle(db, organizationId, slug) {
  if (!isArticleSlug(slug)) return null;
  const row = await db
    .prepare('SELECT slug, published_json FROM articles WHERE organization_id = ? AND slug = ? AND published_json IS NOT NULL AND archived_at IS NULL')
    .bind(organizationId, slug)
    .first();
  if (!row) return null;
  const published = JSON.parse(row.published_json);
  return {
    article: {
      slug: row.slug,
      title: published.title,
      excerpt: published.excerpt,
      category: published.category,
      date: published.date,
      image: published.legacyImage || null,
    },
    blocks: markdownToAst(published.content),
  };
}
