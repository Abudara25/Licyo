// Configuration du site public (SiteConfig) en base D1 : BROUILLON et version PUBLIÉE, par organisation (phase 4D.2B).
//
//   brouillon  → lu et modifié par l'admin (readSiteConfig, saveDraftSiteConfig) ; jamais lu par le site public ;
//   publiée    → seule version lue par le site public (loadPublishedSite) ;
//   publier    → publishSiteConfig : valide le brouillon (validateSite, échec fermé) puis le recopie dans la version
//                publiée par UNE instruction UPDATE conditionnée à la révision validée : tout ou rien, et jamais une
//                version modifiée entre la validation et l'écriture. Le brouillon est conservé.
//
// Table site_configs (migration 11), une ligne par organisation. Toute requête filtre organization_id ; l'organisation
// vient toujours du serveur (domaine résolu ou session admin), jamais du navigateur, et une configuration dont
// organizationId ne correspond pas à la ligne n'est ni enregistrée, ni publiée, ni servie.
//
// Configuration de référence : celle versionnée dans le code (sites/), à partir de laquelle les pages statiques sont
// générées. Au premier accès d'une organisation qui en a une, elle devient le brouillon ET la version publiée
// (INSERT OR IGNORE : rien n'est jamais écrasé). Tant que la ligne n'a jamais été modifiée depuis l'admin
// (origin = 'reference'), elle suit la référence du code à chaque déploiement : le comportement de production reste
// celui d'avant cette phase. Dès le premier brouillon enregistré (origin = 'edited'), le code ne la touche plus.
// Une organisation sans configuration de référence ni ligne n'a PAS de site (null), jamais celui d'une autre.
// La première ligne d'une organisation pose, dans la même transaction, son marqueur d'initialisation
// (organizations.site_config_initialized_at, migration 12) : une ligne disparue ensuite lève SchemaIntegrityError au
// lieu d'être réamorcée depuis la référence (qui republierait l'ancienne configuration par-dessus les données perdues).
import { validateSite, checkLimits } from '../../renderer/validate.js';
import { siteForOrganization } from '../../sites/index.js';
import { ensureSchema } from './inscriptions-db.js';
import { SchemaIntegrityError } from './schema.js';
import { ConfigConflictError } from './public-data.js';

export { ConfigConflictError };

// Une ligne D1 ne dépasse pas 2 Mo et porte brouillon + version publiée : chaque document reste sous 900 Ko.
export const MAX_CONFIG_BYTES = 900_000;

export class SiteConfigValidationError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'SiteConfigValidationError';
    this.errors = errors;
  }
}

export class SiteConfigNotFoundError extends Error {
  constructor() {
    super('Aucune configuration de site pour cette organisation.');
    this.name = 'SiteConfigNotFoundError';
  }
}

function requireOrganization(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('Configuration du site : organisation requise');
}

// Document JSON canonique d'une configuration (même sérialisation partout : comparaisons déterministes).
function serialize(config, organizationId) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new SiteConfigValidationError('Configuration absente ou invalide.');
  if (config.organizationId !== organizationId) {
    throw new SiteConfigValidationError('La configuration n’appartient pas à cette organisation.');
  }
  try {
    checkLimits(config);
  } catch (error) {
    throw new SiteConfigValidationError(`Configuration refusée : ${error.message}`, [error.message]);
  }
  const json = JSON.stringify(config);
  if (new TextEncoder().encode(json).length > MAX_CONFIG_BYTES) throw new SiteConfigValidationError('Configuration trop volumineuse.');
  return json;
}

// Validation complète (celle du moteur de rendu) ; erreurs listées une par ligne.
function validate(config, organizationId) {
  const json = serialize(config, organizationId);
  try {
    validateSite(config);
  } catch (error) {
    const errors = String(error.message).split('\n- ').slice(1);
    throw new SiteConfigValidationError(error.message, errors.length ? errors : [error.message]);
  }
  return json;
}

// Référence du code : JSON canonique, ou null si l'organisation n'en a pas. Constante pour une version du code :
// sérialisée une fois par instance (comparée à chaque page servie).
const referenceJson = new Map();
export function referenceSiteJson(organizationId) {
  if (!referenceJson.has(organizationId)) {
    const site = siteForOrganization(organizationId);
    referenceJson.set(organizationId, site ? JSON.stringify(site) : null);
  }
  return referenceJson.get(organizationId);
}

const SELECT_ROW =
  'SELECT organization_id, origin, draft_json, draft_revision, draft_updated_at, published_json, published_revision, published_at FROM site_configs WHERE organization_id = ?';

const readRow = (env, organizationId) => env.DB.prepare(SELECT_ROW).bind(organizationId).first();

// Marqueur d'initialisation (migration 12), posé dans la même transaction que la première ligne de l'organisation et
// jamais retiré : distingue « jamais initialisée » de « ligne disparue ». Conditionné à l'existence de la ligne.
const markInitialized = (env, organizationId) =>
  env.DB.prepare(
    `UPDATE organizations SET site_config_initialized_at = COALESCE(site_config_initialized_at, datetime('now'))
     WHERE id = ? AND EXISTS (SELECT 1 FROM site_configs WHERE organization_id = ?)`
  ).bind(organizationId, organizationId);

// Ligne absente : premier accès légitime (null) ou ligne perdue après initialisation (SchemaIntegrityError, échec
// fermé : ni recréation, ni réamorçage, ni republication de la référence du code). Une ligne créée entre-temps par un
// premier accès concurrent (marqueur posé dans la même transaction) est renvoyée.
async function missingRow(env, organizationId) {
  const org = await env.DB.prepare('SELECT site_config_initialized_at AS initialized FROM organizations WHERE id = ?').bind(organizationId).first();
  if (!org?.initialized) return null;
  const row = await readRow(env, organizationId);
  if (row) return row;
  throw new SchemaIntegrityError(
    `Configuration du site introuvable pour ${organizationId} alors que l'organisation a déjà été initialisée ` +
      `(${org.initialized}) : rien n'a été recréé ni republié. Restaurer la ligne site_configs depuis une sauvegarde.`
  );
}

// Ligne de l'organisation, créée depuis la référence du code au premier accès, et alignée sur cette référence tant
// qu'elle n'a jamais été modifiée depuis l'admin. null : aucune configuration (ni ligne, ni référence).
async function ensureRow(env, organizationId) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  let row = await readRow(env, organizationId);
  const reference = referenceSiteJson(organizationId);
  if (!row) {
    const existing = await missingRow(env, organizationId);
    if (existing) return existing;
    if (!reference) return null;
    validate(JSON.parse(reference), organizationId); // référence invalide : rien n'est écrit (échec fermé)
    // INSERT OR IGNORE : deux premiers accès simultanés n'en créent qu'une ; une ligne existante n'est jamais écrasée.
    // Marqueur posé dans la même transaction.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO site_configs (organization_id, origin, draft_json, draft_revision, published_json, published_revision, published_at)
         VALUES (?, 'reference', ?, 1, ?, 1, datetime('now'))`
      ).bind(organizationId, reference, reference),
      markInitialized(env, organizationId),
    ]);
    return readRow(env, organizationId);
  }
  if (reference && row.origin === 'reference' && (row.draft_json !== reference || row.published_json !== reference)) {
    validate(JSON.parse(reference), organizationId);
    // Conditionné à l'état lu : une modification concurrente (brouillon enregistré entre-temps) l'emporte.
    const { meta } = await env.DB.prepare(
      `UPDATE site_configs SET draft_json = ?, published_json = ?, draft_revision = draft_revision + 1, published_revision = draft_revision + 1,
         draft_updated_at = datetime('now'), published_at = datetime('now'), updated_at = datetime('now')
       WHERE organization_id = ? AND origin = 'reference' AND draft_revision = ?`
    )
      .bind(reference, reference, organizationId, row.draft_revision)
      .run();
    if (meta.changes) invalidatePublishedSite(organizationId);
    row = await readRow(env, organizationId);
  }
  return row;
}

const describe = (row) => ({
  origin: row.origin,
  draftRevision: row.draft_revision,
  draftUpdatedAt: row.draft_updated_at,
  publishedRevision: row.published_revision ?? null,
  publishedAt: row.published_at ?? null,
  hasUnpublishedChanges: row.draft_json !== row.published_json,
});

// Lecture côté admin : le BROUILLON par défaut ; stage 'published' pour la version en ligne.
// { config, ...état } ou null si l'organisation n'a aucune configuration.
export async function readSiteConfig(env, organizationId, { stage = 'draft' } = {}) {
  if (stage !== 'draft' && stage !== 'published') throw new Error(`Étape inconnue : ${stage}`);
  const row = await ensureRow(env, organizationId);
  if (!row) return null;
  const json = stage === 'draft' ? row.draft_json : row.published_json;
  return { stage, config: json === null ? null : JSON.parse(json), ...describe(row) };
}

// Enregistre le brouillon (jamais la version publiée). expectedRevision : révision lue par l'admin ; si le brouillon
// a changé depuis, rien n'est écrit (ConfigConflictError). Le brouillon peut être incomplet : seules la forme JSON,
// les bornes et l'organisation sont contrôlées ici ; la validation complète se fait à la publication.
export async function saveDraftSiteConfig(env, organizationId, config, { expectedRevision } = {}) {
  requireOrganization(organizationId);
  if (!Number.isInteger(expectedRevision)) throw new Error('Configuration du site : révision attendue requise');
  const json = serialize(config, organizationId);
  const row = await ensureRow(env, organizationId);
  if (!row) {
    // Première configuration d'une organisation sans référence : créée non publiée.
    if (expectedRevision !== 0) throw new ConfigConflictError();
    const [inserted] = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO site_configs (organization_id, origin, draft_json, draft_revision) VALUES (?, 'edited', ?, 1)").bind(
        organizationId,
        json
      ),
      markInitialized(env, organizationId),
    ]);
    if (!inserted.meta.changes) throw new ConfigConflictError();
  } else {
    const { meta } = await env.DB.prepare(
      `UPDATE site_configs SET draft_json = ?, draft_revision = draft_revision + 1, origin = 'edited',
         draft_updated_at = datetime('now'), updated_at = datetime('now')
       WHERE organization_id = ? AND draft_revision = ?`
    )
      .bind(json, organizationId, expectedRevision)
      .run();
    if (!meta.changes) throw new ConfigConflictError();
  }
  return readSiteConfig(env, organizationId);
}

// Publie le brouillon de l'organisation. Validation complète d'abord (SiteConfigValidationError : rien n'est écrit),
// puis une seule instruction qui recopie EXACTEMENT le brouillon validé (même révision) dans la version publiée.
// expectedRevision (facultatif) : la révision que l'admin a relue ; sinon celle lue ici.
export async function publishSiteConfig(env, organizationId, { expectedRevision } = {}) {
  const row = await ensureRow(env, organizationId);
  if (!row) throw new SiteConfigNotFoundError();
  if (expectedRevision !== undefined && expectedRevision !== row.draft_revision) throw new ConfigConflictError();
  validate(JSON.parse(row.draft_json), organizationId);
  const { meta } = await env.DB.prepare(
    `UPDATE site_configs SET published_json = draft_json, published_revision = draft_revision,
       published_at = datetime('now'), updated_at = datetime('now')
     WHERE organization_id = ? AND draft_revision = ? AND draft_json = ?`
  )
    .bind(organizationId, row.draft_revision, row.draft_json)
    .run();
  if (!meta.changes) throw new ConfigConflictError();
  // Visible du site public seulement maintenant, après l'écriture réussie.
  invalidatePublishedSite(organizationId);
  return readSiteConfig(env, organizationId);
}

// ---------------------------------------------------------------------------------------------
// Lecture publique : version PUBLIÉE uniquement. Cache de 60 s par instance du Worker (même limite que les données
// publiques : les autres instances voient une publication en moins d'une minute), invalidé par une publication ou
// un alignement sur la référence faits depuis cette instance.
export const PUBLISHED_CACHE_TTL_MS = 60_000;
const cache = new Map();
export const invalidatePublishedSite = (organizationId) => void cache.delete(organizationId);
export const clearPublishedSiteCache = () => cache.clear();

// { config, json, revision } ou null (aucune version publiée). Erreur D1 : remontée à l'appelant, qui applique son
// propre secours. Une version publiée d'une autre organisation n'est jamais servie (échec fermé, journalisé).
export async function loadPublishedSite(env, organizationId) {
  requireOrganization(organizationId);
  const hit = cache.get(organizationId);
  if (hit && hit.expires > Date.now() && hit.db === env.DB) return hit.value;
  const row = await ensureRow(env, organizationId);
  let value = null;
  if (row?.published_json) {
    const config = JSON.parse(row.published_json);
    if (config?.organizationId === organizationId) {
      value = { config, json: row.published_json, revision: row.published_revision };
    } else {
      console.warn(`Configuration publiée ignorée : organisation inattendue pour ${organizationId}`);
    }
  }
  cache.set(organizationId, { value, expires: Date.now() + PUBLISHED_CACHE_TTL_MS, db: env.DB });
  return value;
}
