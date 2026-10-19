// Migration 13 (phase 4E.1, Actualités CRM) et contrôle de ses invariants au démarrage.
//
// Le SQL de ce fichier est TEXTUELLEMENT celui du contrat 4E v3.1 (§2 à §6). La même constante sert à créer
// (migration 13) et à contrôler (checkNewsSchema, appelé par repairSchemaInvariants) : une base dont une définition
// diffère, même d'une seule condition (par exemple la CHECK des projections en forme `=` de la v3 au lieu de `IS`),
// est refusée. Ne jamais modifier une définition déjà déployée : ajouter une migration.
//
// Règles du contrôle (§8) :
//   1. table absente → SchemaIntegrityError, jamais recréée ;
//   2. structure (PRAGMA table_info / foreign_key_list / index_list / index_info, définition complète) différente →
//      SchemaIntegrityError, sans aucune modification ;
//   3. données incohérentes (contrôles en lecture seule, négation EXACTE de la CHECK, toujours 0 ou 1, jamais NULL)
//      → SchemaIntegrityError : aucune ligne n'est réparée ;
//   4. index nommé ou trigger absent → recréé seulement si 2 et 3 sont conformes (et, pour l'index unique, sans
//      doublon), dans la transaction de repairSchemaInvariants ; présent avec une autre définition → erreur ;
//   5. rien d'autre n'est jamais réparé.
import { SchemaIntegrityError, normalizeSql } from './schema-utils.js';

export const NEWS_MIGRATION_VERSION = 13;

// ---------------------------------------------------------------------------------------------------------------
// §2. CREATE TABLE articles

export const ARTICLES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY NOT NULL
    CHECK (typeof(id) = 'text' AND length(id) = 36 AND substr(id, 1, 4) = 'art_' AND substr(id, 5) NOT GLOB '*[^0-9a-f]*'),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  slug TEXT NOT NULL
    CHECK (typeof(slug) = 'text' AND length(slug) BETWEEN 1 AND 100 AND slug NOT GLOB '*[^a-z0-9-]*'
           AND slug NOT GLOB '-*' AND slug NOT GLOB '*-' AND slug NOT GLOB '*--*'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  draft_json TEXT NOT NULL
    CHECK (typeof(draft_json) = 'text' AND json_valid(draft_json) AND json_type(draft_json) = 'object'
           AND length(CAST(draft_json AS BLOB)) <= 204800),
  published_json TEXT
    CHECK (published_json IS NULL OR (typeof(published_json) = 'text' AND json_valid(published_json)
           AND json_type(published_json) = 'object' AND length(CAST(published_json AS BLOB)) <= 204800)),
  published_revision INTEGER
    CHECK (published_revision IS NULL OR (typeof(published_revision) = 'integer' AND published_revision >= 1)),
  published_title TEXT CHECK (published_title IS NULL OR (typeof(published_title) = 'text' AND length(published_title) BETWEEN 1 AND 200)),
  published_excerpt TEXT CHECK (published_excerpt IS NULL OR (typeof(published_excerpt) = 'text' AND length(published_excerpt) BETWEEN 1 AND 500)),
  published_category TEXT
    CHECK (published_category IS NULL OR (typeof(published_category) = 'text' AND length(published_category) BETWEEN 1 AND 40
           AND published_category NOT GLOB '*[^a-z0-9-]*')),
  published_for_at TEXT CHECK (published_for_at IS NULL OR (typeof(published_for_at) = 'text' AND date(published_for_at) IS published_for_at)),
  first_published_at TEXT CHECK (first_published_at IS NULL OR datetime(first_published_at) IS first_published_at),
  last_published_at TEXT CHECK (last_published_at IS NULL OR datetime(last_published_at) IS last_published_at),
  unpublished_at TEXT CHECK (unpublished_at IS NULL OR datetime(unpublished_at) IS unpublished_at),
  archived_at TEXT CHECK (archived_at IS NULL OR datetime(archived_at) IS archived_at),
  legacy_source TEXT CHECK (legacy_source IS NULL OR legacy_source = 'content/articles.json'),
  legacy_key TEXT
    CHECK (legacy_key IS NULL OR (typeof(legacy_key) = 'text' AND length(legacy_key) BETWEEN 1 AND 100
           AND legacy_key NOT GLOB '*[^a-z0-9-]*')),
  import_checksum TEXT
    CHECK (import_checksum IS NULL OR (typeof(import_checksum) = 'text' AND length(import_checksum) = 64
           AND import_checksum NOT GLOB '*[^0-9a-f]*')),
  import_batch_id TEXT
    CHECK (import_batch_id IS NULL OR (typeof(import_batch_id) = 'text' AND length(import_batch_id) = 36
           AND substr(import_batch_id, 1, 4) = 'imp_' AND substr(import_batch_id, 5) NOT GLOB '*[^0-9a-f]*')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(created_at) IS created_at),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(updated_at) IS updated_at),
  CHECK ((published_json IS NULL) = (published_revision IS NULL)
     AND (published_json IS NULL) = (published_title IS NULL)
     AND (published_json IS NULL) = (published_excerpt IS NULL)
     AND (published_json IS NULL) = (published_category IS NULL)
     AND (published_json IS NULL) = (published_for_at IS NULL)),
  CHECK (published_json IS NULL OR (
         json_type(published_json, '$.title') IS 'text'
     AND published_title IS json_extract(published_json, '$.title')
     AND json_type(published_json, '$.excerpt') IS 'text'
     AND published_excerpt IS json_extract(published_json, '$.excerpt')
     AND json_type(published_json, '$.category') IS 'text'
     AND published_category IS json_extract(published_json, '$.category')
     AND json_type(published_json, '$.date') IS 'text'
     AND published_for_at IS json_extract(published_json, '$.date'))),
  CHECK (published_revision IS NULL OR published_revision <= revision),
  CHECK ((first_published_at IS NULL) = (last_published_at IS NULL)),
  CHECK (first_published_at IS NULL OR first_published_at <= last_published_at),
  CHECK (published_json IS NULL OR first_published_at IS NOT NULL),
  CHECK (unpublished_at IS NULL OR first_published_at IS NOT NULL),
  CHECK (first_published_at IS NULL OR published_json IS NOT NULL OR unpublished_at IS NOT NULL),
  CHECK (legacy_source IS NULL OR first_published_at IS NOT NULL),
  CHECK (archived_at IS NULL OR published_json IS NULL),
  CHECK ((legacy_source IS NULL) = (legacy_key IS NULL)
     AND (legacy_source IS NULL) = (import_checksum IS NULL)
     AND (legacy_source IS NULL) = (import_batch_id IS NULL)),
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, id)
)`;

// ---------------------------------------------------------------------------------------------------------------
// §3. Index de articles : [nom, définition]

export const ARTICLES_INDEXES = [
  ['idx_articles_org_legacy', `CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_org_legacy
  ON articles (organization_id, legacy_source, legacy_key) WHERE legacy_source IS NOT NULL`],
  ['idx_articles_org_public', `CREATE INDEX IF NOT EXISTS idx_articles_org_public
  ON articles (organization_id, published_for_at DESC, first_published_at DESC, slug)
  WHERE published_json IS NOT NULL AND archived_at IS NULL`],
  ['idx_articles_org_updated', `CREATE INDEX IF NOT EXISTS idx_articles_org_updated ON articles (organization_id, updated_at DESC)`],
];

// ---------------------------------------------------------------------------------------------------------------
// §5. CREATE TABLE organization_news_state

export const NEWS_STATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS organization_news_state (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organizations(id),
  source TEXT NOT NULL DEFAULT 'json' CHECK (source IN ('json', 'd1')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(revision) = 'integer' AND revision >= 1),
  articles_revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(articles_revision) = 'integer' AND articles_revision >= 0),
  import_batch_id TEXT
    CHECK (import_batch_id IS NULL OR (typeof(import_batch_id) = 'text' AND length(import_batch_id) = 36
           AND substr(import_batch_id, 1, 4) = 'imp_' AND substr(import_batch_id, 5) NOT GLOB '*[^0-9a-f]*')),
  legacy_digest TEXT
    CHECK (legacy_digest IS NULL OR (typeof(legacy_digest) = 'text' AND length(legacy_digest) = 64
           AND legacy_digest NOT GLOB '*[^0-9a-f]*')),
  imported_at TEXT CHECK (imported_at IS NULL OR datetime(imported_at) IS imported_at),
  validated_at TEXT CHECK (validated_at IS NULL OR datetime(validated_at) IS validated_at),
  validated_articles_revision INTEGER
    CHECK (validated_articles_revision IS NULL OR (typeof(validated_articles_revision) = 'integer' AND validated_articles_revision >= 0)),
  cutover_at TEXT CHECK (cutover_at IS NULL OR datetime(cutover_at) IS cutover_at),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')) CHECK (datetime(updated_at) IS updated_at),
  CHECK ((import_batch_id IS NULL) = (legacy_digest IS NULL) AND (import_batch_id IS NULL) = (imported_at IS NULL)),
  CHECK ((validated_at IS NULL) = (validated_articles_revision IS NULL)),
  CHECK (validated_at IS NULL OR imported_at IS NOT NULL),
  CHECK (validated_articles_revision IS NULL OR validated_articles_revision <= articles_revision),
  CHECK (source = 'json' OR (validated_at IS NOT NULL AND cutover_at IS NOT NULL))
)`;

export const NEWS_STATE_BACKFILL_SQL = `/* toutes-organisations */ INSERT OR IGNORE INTO organization_news_state (organization_id) SELECT id FROM organizations`;

// ---------------------------------------------------------------------------------------------------------------
// §4 et §6. Les 30 triggers : [nom, table, définition], dans l'ordre du contrat (18 sur articles, 12 sur l'état ou
// organizations). Chaque définition est créée seule (les commentaires G1… du contrat sont repris au-dessus).

export const NEWS_TRIGGERS = [
  // G1. Deux formes d'insertion seulement : A (brouillon normal) ou B (import legacy publié).
  ['articles_insert_forms', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_insert_forms BEFORE INSERT ON articles
WHEN NOT (
  NEW.revision IS 1 AND NEW.created_at IS datetime('now') AND NEW.updated_at IS datetime('now')
  AND NEW.unpublished_at IS NULL AND NEW.archived_at IS NULL
  AND (
    (NEW.published_json IS NULL AND NEW.first_published_at IS NULL AND NEW.legacy_source IS NULL)
    OR
    (NEW.legacy_source IS NOT NULL AND NEW.published_json IS NEW.draft_json AND NEW.published_revision IS 1
     AND NEW.first_published_at IS datetime('now') AND NEW.last_published_at IS datetime('now'))
  )
)
BEGIN SELECT RAISE(ABORT, 'articles : insertion hors des formes autorisées'); END`],
  // G2. Identité, révision, horodatage de modification.
  ['articles_update_identity', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_identity BEFORE UPDATE ON articles
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.created_at IS NOT OLD.created_at
  OR NEW.revision IS NOT OLD.revision + 1 OR NEW.updated_at IS NOT datetime('now')
BEGIN SELECT RAISE(ABORT, 'articles : identité, révision ou date de modification invalides'); END`],
  // G3. Slug figé dès la première publication.
  ['articles_update_slug', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_slug BEFORE UPDATE OF slug ON articles
WHEN OLD.first_published_at IS NOT NULL AND NEW.slug IS NOT OLD.slug
BEGIN SELECT RAISE(ABORT, 'articles : slug figé après la première publication'); END`],
  // G4. Tuple legacy : jamais ajouté après coup ; source et clé immuables ; checksum et lot ne changent que lors
  //     d'une republication d'import, détectée par le changement de published_revision.
  ['articles_update_legacy', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_legacy BEFORE UPDATE ON articles
WHEN (OLD.legacy_source IS NULL AND NEW.legacy_source IS NOT NULL)
  OR (OLD.legacy_source IS NOT NULL AND (NEW.legacy_source IS NOT OLD.legacy_source OR NEW.legacy_key IS NOT OLD.legacy_key))
  OR (NEW.import_checksum IS NOT OLD.import_checksum AND NEW.import_batch_id IS OLD.import_batch_id)
  OR ((NEW.import_checksum IS NOT OLD.import_checksum OR NEW.import_batch_id IS NOT OLD.import_batch_id)
      AND NOT (NEW.published_json IS NOT NULL AND NEW.published_revision IS NEW.revision
               AND NEW.published_revision IS NOT OLD.published_revision))
BEGIN SELECT RAISE(ABORT, 'articles : champs d''import immuables hors republication d''import'); END`],
  // G5. Aucun changement de publication : tuple et historique inchangés (SAVE, RESTORE, ARCHIVE d'un brouillon).
  ['articles_update_no_publication', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_no_publication BEFORE UPDATE ON articles
WHEN ((OLD.published_json IS NULL AND NEW.published_json IS NULL)
      OR (NEW.published_json IS NOT NULL
          AND NEW.published_json IS OLD.published_json AND NEW.published_revision IS OLD.published_revision
          AND NEW.published_title IS OLD.published_title AND NEW.published_excerpt IS OLD.published_excerpt
          AND NEW.published_category IS OLD.published_category AND NEW.published_for_at IS OLD.published_for_at
          AND NEW.last_published_at IS OLD.last_published_at))
  AND (NEW.first_published_at IS NOT OLD.first_published_at OR NEW.last_published_at IS NOT OLD.last_published_at
       OR NEW.unpublished_at IS NOT OLD.unpublished_at)
BEGIN SELECT RAISE(ABORT, 'articles : historique de publication modifié sans publication'); END`],
  // G6. Publication : copie exacte du brouillon, published_revision = nouvelle révision, dates système du moment.
  ['articles_update_publish', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_publish BEFORE UPDATE ON articles
WHEN NEW.published_json IS NOT NULL
  AND NOT (NEW.published_json IS OLD.published_json AND NEW.published_revision IS OLD.published_revision
           AND NEW.published_title IS OLD.published_title AND NEW.published_excerpt IS OLD.published_excerpt
           AND NEW.published_category IS OLD.published_category AND NEW.published_for_at IS OLD.published_for_at
           AND NEW.last_published_at IS OLD.last_published_at)
  AND NOT (NEW.published_json IS NEW.draft_json AND NEW.published_revision IS NEW.revision
           AND NEW.last_published_at IS datetime('now')
           AND NEW.first_published_at IS COALESCE(OLD.first_published_at, datetime('now'))
           AND NEW.unpublished_at IS OLD.unpublished_at
           AND OLD.archived_at IS NULL AND NEW.archived_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'articles : publication invalide'); END`],
  // G7. Dépublication (publiée → non publiée) : unpublished_at = maintenant ; first/last inchangés.
  ['articles_update_unpublish', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_unpublish BEFORE UPDATE ON articles
WHEN OLD.published_json IS NOT NULL AND NEW.published_json IS NULL
  AND (NEW.unpublished_at IS NOT datetime('now') OR NEW.first_published_at IS NOT OLD.first_published_at
       OR NEW.last_published_at IS NOT OLD.last_published_at)
BEGIN SELECT RAISE(ABORT, 'articles : dépublication invalide'); END`],
  // G8. Archivage : archived_at = maintenant, brouillon et slug inchangés.
  ['articles_update_archive', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_archive BEFORE UPDATE ON articles
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
  AND (NEW.archived_at IS NOT datetime('now') OR NEW.draft_json IS NOT OLD.draft_json OR NEW.slug IS NOT OLD.slug)
BEGIN SELECT RAISE(ABORT, 'articles : archivage invalide'); END`],
  // G9. Article archivé : seule transition possible, la restauration, sans autre changement.
  ['articles_update_archived', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_update_archived BEFORE UPDATE ON articles
WHEN OLD.archived_at IS NOT NULL
  AND (NEW.archived_at IS NOT NULL OR NEW.draft_json IS NOT OLD.draft_json OR NEW.slug IS NOT OLD.slug OR NEW.published_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'articles : article archivé non modifiable (restaurer d''abord)'); END`],
  // G10. Verrou de validation : aucune mutation tant que la source est 'json' et la validation posée.
  ['articles_lock_insert', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_lock_insert BEFORE INSERT ON articles
WHEN EXISTS (SELECT 1 FROM organization_news_state s WHERE s.organization_id = NEW.organization_id AND s.source = 'json' AND s.validated_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'articles : état validé figé (invalider la validation d''abord)'); END`],
  ['articles_lock_update', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_lock_update BEFORE UPDATE ON articles
WHEN EXISTS (SELECT 1 FROM organization_news_state s WHERE s.organization_id = OLD.organization_id AND s.source = 'json' AND s.validated_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'articles : état validé figé (invalider la validation d''abord)'); END`],
  ['articles_lock_delete', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_lock_delete BEFORE DELETE ON articles
WHEN EXISTS (SELECT 1 FROM organization_news_state s WHERE s.organization_id = OLD.organization_id AND s.source = 'json' AND s.validated_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'articles : état validé figé (invalider la validation d''abord)'); END`],
  // G11. Écriture d'import : seulement en source 'json', non validée, pour le lot courant de l'organisation.
  ['articles_import_insert', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_import_insert BEFORE INSERT ON articles
WHEN NEW.legacy_source IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM organization_news_state s WHERE s.organization_id = NEW.organization_id AND s.source = 'json'
    AND s.validated_at IS NULL AND s.import_batch_id IS NEW.import_batch_id)
BEGIN SELECT RAISE(ABORT, 'articles : import hors lot courant ou hors source json'); END`],
  ['articles_import_update', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_import_update BEFORE UPDATE ON articles
WHEN NEW.import_batch_id IS NOT OLD.import_batch_id AND NOT EXISTS (
  SELECT 1 FROM organization_news_state s WHERE s.organization_id = NEW.organization_id AND s.source = 'json'
    AND s.validated_at IS NULL AND s.import_batch_id IS NEW.import_batch_id)
BEGIN SELECT RAISE(ABORT, 'articles : import hors lot courant ou hors source json'); END`],
  // G12. Suppression : seulement un article archivé.
  ['articles_delete_archived', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_delete_archived BEFORE DELETE ON articles
WHEN OLD.archived_at IS NULL
BEGIN SELECT RAISE(ABORT, 'articles : suppression d''un article non archivé'); END`],
  // G13. Compteur de contenu de l'organisation (lu par la validation et la bascule).
  ['articles_count_insert', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_count_insert AFTER INSERT ON articles
BEGIN UPDATE organization_news_state SET articles_revision = articles_revision + 1 WHERE organization_id = NEW.organization_id; END`],
  ['articles_count_update', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_count_update AFTER UPDATE ON articles
BEGIN UPDATE organization_news_state SET articles_revision = articles_revision + 1 WHERE organization_id = NEW.organization_id; END`],
  ['articles_count_delete', 'articles', `CREATE TRIGGER IF NOT EXISTS articles_count_delete AFTER DELETE ON articles
BEGIN UPDATE organization_news_state SET articles_revision = articles_revision + 1 WHERE organization_id = OLD.organization_id; END`],

  // §6. État de l'organisation.
  ['organizations_news_state_insert', 'organizations', `CREATE TRIGGER IF NOT EXISTS organizations_news_state_insert AFTER INSERT ON organizations
BEGIN INSERT OR IGNORE INTO organization_news_state (organization_id) VALUES (NEW.id); END`],
  ['news_state_insert_form', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_insert_form BEFORE INSERT ON organization_news_state
WHEN NOT (NEW.source = 'json' AND NEW.revision IS 1 AND NEW.articles_revision IS 0 AND NEW.import_batch_id IS NULL
          AND NEW.validated_at IS NULL AND NEW.cutover_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : création invalide'); END`],
  ['news_state_delete', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_delete BEFORE DELETE ON organization_news_state
BEGIN SELECT RAISE(ABORT, 'organization_news_state : suppression interdite'); END`],
  // S1. Deux sortes de mise à jour : action (révision + 1, compteur inchangé, updated_at = maintenant) ou incrément du
  //     compteur par G13 (tout le reste identique).
  ['news_state_update_kind', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_update_kind BEFORE UPDATE ON organization_news_state
WHEN NEW.organization_id IS NOT OLD.organization_id
  OR NOT (
    (NEW.revision IS OLD.revision + 1 AND NEW.articles_revision IS OLD.articles_revision AND NEW.updated_at IS datetime('now'))
    OR
    (NEW.revision IS OLD.revision AND NEW.articles_revision IS OLD.articles_revision + 1 AND NEW.updated_at IS OLD.updated_at
     AND NEW.source IS OLD.source AND NEW.import_batch_id IS OLD.import_batch_id AND NEW.legacy_digest IS OLD.legacy_digest
     AND NEW.imported_at IS OLD.imported_at AND NEW.validated_at IS OLD.validated_at
     AND NEW.validated_articles_revision IS OLD.validated_articles_revision AND NEW.cutover_at IS OLD.cutover_at)
  )
BEGIN SELECT RAISE(ABORT, 'organization_news_state : mise à jour invalide'); END`],
  // S2. Nouveau lot d'import : seulement en source 'json' non validée ; digest et date d'import liés au lot.
  ['news_state_import', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_import BEFORE UPDATE ON organization_news_state
WHEN ((NEW.legacy_digest IS NOT OLD.legacy_digest OR NEW.imported_at IS NOT OLD.imported_at)
       AND NEW.import_batch_id IS OLD.import_batch_id)
  OR (NEW.import_batch_id IS NOT OLD.import_batch_id
      AND (OLD.source IS NOT 'json' OR NEW.source IS NOT 'json' OR OLD.validated_at IS NOT NULL OR NEW.validated_at IS NOT NULL
           OR NEW.import_batch_id IS NULL OR NEW.imported_at IS NOT datetime('now')))
BEGIN SELECT RAISE(ABORT, 'organization_news_state : import hors source json non validée'); END`],
  // S3. Validation : pose validated_at = maintenant et le compteur audité, en source 'json', sur le lot courant.
  ['news_state_validate', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_validate BEFORE UPDATE ON organization_news_state
WHEN OLD.validated_at IS NULL AND NEW.validated_at IS NOT NULL
  AND (NEW.source IS NOT 'json' OR NEW.validated_at IS NOT datetime('now') OR NEW.validated_articles_revision IS NOT OLD.articles_revision
       OR NEW.import_batch_id IS NOT OLD.import_batch_id OR NEW.legacy_digest IS NOT OLD.legacy_digest)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : validation invalide'); END`],
  // S4. Bascule json → d1 : état validé inchangé depuis l'audit (compteur), cutover_at = maintenant.
  ['news_state_cutover', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_cutover BEFORE UPDATE ON organization_news_state
WHEN OLD.source = 'json' AND NEW.source = 'd1'
  AND (OLD.validated_at IS NULL OR NEW.validated_at IS NOT OLD.validated_at
       OR OLD.validated_articles_revision IS NOT OLD.articles_revision
       OR NEW.validated_articles_revision IS NOT OLD.validated_articles_revision
       OR NEW.cutover_at IS NOT datetime('now') OR NEW.import_batch_id IS NOT OLD.import_batch_id
       OR NEW.legacy_digest IS NOT OLD.legacy_digest)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : bascule invalide'); END`],
  // S5. Retour arrière d1 → json : la validation est effacée.
  ['news_state_rollback', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_rollback BEFORE UPDATE ON organization_news_state
WHEN OLD.source = 'd1' AND NEW.source = 'json'
  AND (NEW.validated_at IS NOT NULL OR NEW.cutover_at IS NOT OLD.cutover_at OR NEW.import_batch_id IS NOT OLD.import_batch_id)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : retour arrière invalide'); END`],
  // S6. Invalidation / effacement de la validation hors retour arrière : seulement en source 'json'.
  ['news_state_invalidate', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_invalidate BEFORE UPDATE ON organization_news_state
WHEN OLD.validated_at IS NOT NULL AND NEW.validated_at IS NULL AND NOT (OLD.source = 'd1' AND NEW.source = 'json')
  AND (OLD.source IS NOT 'json' OR NEW.source IS NOT 'json' OR NEW.import_batch_id IS NOT OLD.import_batch_id)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : invalidation invalide'); END`],
  // S7. En source d1 : la validation, le lot et la date de bascule sont figés (seul le retour arrière les touche).
  ['news_state_d1_frozen', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_d1_frozen BEFORE UPDATE ON organization_news_state
WHEN OLD.source = 'd1' AND NEW.source = 'd1'
  AND (NEW.validated_at IS NOT OLD.validated_at OR NEW.validated_articles_revision IS NOT OLD.validated_articles_revision
       OR NEW.import_batch_id IS NOT OLD.import_batch_id OR NEW.legacy_digest IS NOT OLD.legacy_digest
       OR NEW.imported_at IS NOT OLD.imported_at OR NEW.cutover_at IS NOT OLD.cutover_at)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : état basculé figé'); END`],
  // S8. cutover_at ne change que lors de la bascule json → d1.
  ['news_state_cutover_at', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_cutover_at BEFORE UPDATE ON organization_news_state
WHEN NEW.cutover_at IS NOT OLD.cutover_at AND NOT (OLD.source = 'json' AND NEW.source = 'd1')
BEGIN SELECT RAISE(ABORT, 'organization_news_state : date de bascule modifiée hors bascule'); END`],
  // S9. Une validation posée ne se modifie pas (l'invalider d'abord).
  ['news_state_validated_frozen', 'organization_news_state', `CREATE TRIGGER IF NOT EXISTS news_state_validated_frozen BEFORE UPDATE ON organization_news_state
WHEN OLD.validated_at IS NOT NULL AND NEW.validated_at IS NOT NULL
  AND (NEW.validated_at IS NOT OLD.validated_at OR NEW.validated_articles_revision IS NOT OLD.validated_articles_revision)
BEGIN SELECT RAISE(ABORT, 'organization_news_state : validation figée'); END`],
];

// Ordre de la migration 13, en une seule transaction db.batch (§6) : articles, ses 3 index, organization_news_state,
// une ligne 'json' par organisation, les 30 triggers ; applyMigrations ajoute l'INSERT INTO schema_migrations.
// Aucun import, aucun contenu issu du code.
export function newsMigrationStatements(db) {
  return [
    db.prepare(ARTICLES_TABLE_SQL),
    ...ARTICLES_INDEXES.map(([, sql]) => db.prepare(sql)),
    db.prepare(NEWS_STATE_TABLE_SQL),
    db.prepare(NEWS_STATE_BACKFILL_SQL),
    ...NEWS_TRIGGERS.map(([, , sql]) => db.prepare(sql)),
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// §8. Contrôle au démarrage (seulement si la migration 13 est enregistrée).

// [nom, type, NOT NULL, valeur par défaut, rang dans la clé primaire]
export const ARTICLES_COLUMNS = [
  ['id', 'TEXT', 1, null, 1],
  ['organization_id', 'TEXT', 1, null, 0],
  ['slug', 'TEXT', 1, null, 0],
  ['revision', 'INTEGER', 1, '1', 0],
  ['draft_json', 'TEXT', 1, null, 0],
  ['published_json', 'TEXT', 0, null, 0],
  ['published_revision', 'INTEGER', 0, null, 0],
  ['published_title', 'TEXT', 0, null, 0],
  ['published_excerpt', 'TEXT', 0, null, 0],
  ['published_category', 'TEXT', 0, null, 0],
  ['published_for_at', 'TEXT', 0, null, 0],
  ['first_published_at', 'TEXT', 0, null, 0],
  ['last_published_at', 'TEXT', 0, null, 0],
  ['unpublished_at', 'TEXT', 0, null, 0],
  ['archived_at', 'TEXT', 0, null, 0],
  ['legacy_source', 'TEXT', 0, null, 0],
  ['legacy_key', 'TEXT', 0, null, 0],
  ['import_checksum', 'TEXT', 0, null, 0],
  ['import_batch_id', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, "datetime('now')", 0],
  ['updated_at', 'TEXT', 1, "datetime('now')", 0],
];
export const NEWS_STATE_COLUMNS = [
  ['organization_id', 'TEXT', 1, null, 1],
  ['source', 'TEXT', 1, "'json'", 0],
  ['revision', 'INTEGER', 1, '1', 0],
  ['articles_revision', 'INTEGER', 1, '0', 0],
  ['import_batch_id', 'TEXT', 0, null, 0],
  ['legacy_digest', 'TEXT', 0, null, 0],
  ['imported_at', 'TEXT', 0, null, 0],
  ['validated_at', 'TEXT', 0, null, 0],
  ['validated_articles_revision', 'INTEGER', 0, null, 0],
  ['cutover_at', 'TEXT', 0, null, 0],
  ['updated_at', 'TEXT', 1, "datetime('now')", 0],
];
const FOREIGN_KEYS = [{ table: 'organizations', from: 'organization_id', to: 'id', on_update: 'NO ACTION', on_delete: 'NO ACTION', match: 'NONE' }];
// Index automatiques attendus : [origine, colonnes], triés par nom d'index.
const AUTO_INDEXES = {
  articles: [
    ['sqlite_autoindex_articles_1', 'pk', ['id']],
    ['sqlite_autoindex_articles_2', 'u', ['organization_id', 'slug']],
    ['sqlite_autoindex_articles_3', 'u', ['organization_id', 'id']],
  ],
  organization_news_state: [['sqlite_autoindex_organization_news_state_1', 'pk', ['organization_id']]],
};
const TABLES = [
  ['articles', ARTICLES_TABLE_SQL, ARTICLES_COLUMNS],
  ['organization_news_state', NEWS_STATE_TABLE_SQL, NEWS_STATE_COLUMNS],
];

// Définition stockée par SQLite (sqlite_master.sql) : « IF NOT EXISTS » retiré, commentaire de tête absent.
const storedForm = (sql) => normalizeSql(sql.replace(/^\/\*[^*]*\*\/\s*/, '').replace(/\bIF NOT EXISTS\s+/i, ''));

// Contrôles de données du §8 (lecture seule) : chaque requête doit renvoyer 0.
export const NEWS_DATA_CHECKS = [
  ['organisation sans ligne d’état', `SELECT COUNT(*) AS n FROM organizations o /* toutes-organisations */ LEFT JOIN organization_news_state s ON s.organization_id = o.id WHERE s.organization_id IS NULL`],
  ['articles incohérents', `SELECT COUNT(*) AS n FROM articles /* toutes-organisations */ WHERE typeof(revision) <> 'integer'
  OR (published_revision IS NOT NULL AND typeof(published_revision) <> 'integer')
  OR (published_json IS NOT NULL AND NOT (
        json_type(published_json, '$.title') IS 'text' AND published_title IS json_extract(published_json, '$.title')
    AND json_type(published_json, '$.excerpt') IS 'text' AND published_excerpt IS json_extract(published_json, '$.excerpt')
    AND json_type(published_json, '$.category') IS 'text' AND published_category IS json_extract(published_json, '$.category')
    AND json_type(published_json, '$.date') IS 'text' AND published_for_at IS json_extract(published_json, '$.date')))
  OR NOT ((published_json IS NULL) = (published_revision IS NULL) AND (published_json IS NULL) = (published_title IS NULL)
          AND (published_json IS NULL) = (published_excerpt IS NULL) AND (published_json IS NULL) = (published_category IS NULL)
          AND (published_json IS NULL) = (published_for_at IS NULL))
  OR (published_revision IS NOT NULL AND published_revision > revision)
  OR (first_published_at IS NULL) <> (last_published_at IS NULL)
  OR (first_published_at IS NULL AND (published_json IS NOT NULL OR unpublished_at IS NOT NULL))
  OR (first_published_at IS NOT NULL AND published_json IS NULL AND unpublished_at IS NULL)
  OR (archived_at IS NOT NULL AND published_json IS NOT NULL)`],
  ['états incohérents', `SELECT COUNT(*) AS n FROM organization_news_state /* toutes-organisations */ WHERE typeof(revision) <> 'integer' OR typeof(articles_revision) <> 'integer'
  OR (source = 'd1' AND (validated_at IS NULL OR cutover_at IS NULL))
  OR (validated_articles_revision IS NOT NULL AND validated_articles_revision > articles_revision)`],
];

async function tableExists(db, name) {
  return Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());
}

// Écarts de structure d'une table (liste vide : conforme).
export async function newsTableStructureProblems(db, table) {
  const [, definition, expected] = TABLES.find(([name]) => name === table);
  const problems = [];
  const { results: columns } = await db.prepare(`PRAGMA table_info(${table})`).all();
  const actual = columns.map((c) => [c.name, String(c.type).toUpperCase(), c.notnull, c.dflt_value, c.pk]);
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
    if (JSON.stringify(expected[i]) !== JSON.stringify(actual[i])) {
      problems.push(`colonne ${i + 1} : attendu ${expected[i] ? expected[i].join(' ') : '(aucune)'}, trouvé ${actual[i] ? actual[i].join(' ') : '(aucune)'}`);
    }
  }
  const { results: keys } = await db.prepare(`PRAGMA foreign_key_list(${table})`).all();
  const foreign = keys.map(({ table: t, from, to, on_update, on_delete, match }) => ({ table: t, from, to, on_update, on_delete, match }));
  if (JSON.stringify(foreign) !== JSON.stringify(FOREIGN_KEYS)) problems.push('clé étrangère organization_id → organizations(id) absente ou différente');
  const { results: indexes } = await db.prepare(`PRAGMA index_list(${table})`).all();
  const autos = indexes.filter((i) => i.origin === 'pk' || i.origin === 'u').sort((a, b) => (a.name < b.name ? -1 : 1));
  const autoShape = [];
  for (const index of autos) {
    const { results: info } = await db.prepare(`PRAGMA index_info("${index.name.replace(/"/g, '""')}")`).all();
    autoShape.push([index.name, index.origin, info.map((c) => c.name)]);
  }
  if (JSON.stringify(autoShape) !== JSON.stringify(AUTO_INDEXES[table])) problems.push('index automatiques (clé primaire, unicités) différents');
  const { sql } = (await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first()) || {};
  if (normalizeSql(sql) !== storedForm(definition)) problems.push('définition (contraintes CHECK comprises) différente de la migration 13');
  return problems;
}

// Renvoie les instructions de recréation (index nommés, triggers absents) ; lève SchemaIntegrityError sinon.
export async function checkNewsSchema(db) {
  // 1. Tables.
  for (const [table] of TABLES) {
    if (!(await tableExists(db, table))) {
      throw new SchemaIntegrityError(
        `Schéma incohérent : la migration 13 est enregistrée mais la table ${table} a disparu. Rien n’a été recréé : ` +
          'restaurer la table depuis une sauvegarde.'
      );
    }
  }
  // 2. Structure exacte.
  for (const [table] of TABLES) {
    const problems = await newsTableStructureProblems(db, table);
    if (problems.length) {
      throw new SchemaIntegrityError(`Schéma incohérent : table ${table} altérée (${problems.join(' ; ')}). Rien n’a été modifié ni supprimé.`);
    }
  }
  // Index et triggers inconnus sur les deux tables : refusés (structure exacte).
  const known = new Set([...ARTICLES_INDEXES.map(([n]) => n), ...NEWS_TRIGGERS.map(([n]) => n), ...Object.values(AUTO_INDEXES).flat().map(([n]) => n)]);
  const { results: attached } = await db
    .prepare("SELECT type, name FROM sqlite_master WHERE type IN ('index', 'trigger') AND tbl_name IN ('articles', 'organization_news_state')")
    .all();
  const unknown = attached.filter((o) => !known.has(o.name));
  if (unknown.length) {
    throw new SchemaIntegrityError(`Schéma incohérent : objet inattendu sur les tables des actualités (${unknown.map((o) => `${o.type} ${o.name}`).join(', ')}). Rien n’a été modifié.`);
  }
  // 3. Données (lecture seule ; aucune réparation de ligne).
  for (const [what, sql] of NEWS_DATA_CHECKS) {
    const { n } = await db.prepare(sql).first();
    if (n) throw new SchemaIntegrityError(`Données incohérentes (${what}) : ${n} ligne(s). Rien n’a été modifié.`);
  }
  for (const [table] of TABLES) {
    const { results } = await db.prepare(`PRAGMA foreign_key_check(${table})`).all();
    if (results.length) throw new SchemaIntegrityError(`Données incohérentes : ${results.length} ligne(s) de ${table} sans organisation existante. Rien n’a été modifié.`);
  }
  // 4. Index nommés et triggers : absents → recréés (même transaction) ; différents → erreur.
  const repairs = [];
  const objects = [
    ...ARTICLES_INDEXES.map(([name, sql]) => ['index', name, sql]),
    ...NEWS_TRIGGERS.map(([name, , sql]) => ['trigger', name, sql]),
  ];
  for (const [type, name, sql] of objects) {
    const existing = await db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').bind(type, name).first();
    if (!existing) {
      if (name === 'idx_articles_org_legacy') {
        const { n } = await db
          .prepare(
            `SELECT COUNT(*) AS n FROM (SELECT 1 FROM articles /* toutes-organisations */ WHERE legacy_source IS NOT NULL
             GROUP BY organization_id, legacy_source, legacy_key HAVING COUNT(*) > 1)`
          )
          .first();
        if (n) throw new SchemaIntegrityError('Schéma incohérent : doublons (organisation, source, clé legacy) et index unique absent. Rien n’a été supprimé.');
      }
      repairs.push(db.prepare(sql));
    } else if (normalizeSql(existing.sql) !== storedForm(sql)) {
      throw new SchemaIntegrityError(`Schéma incohérent : ${type === 'index' ? 'index' : 'garde-fou'} ${name} différent de la migration 13. Rien n’a été modifié.`);
    }
  }
  return repairs;
}
