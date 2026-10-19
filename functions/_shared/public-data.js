// Données publiques administrables d'une organisation (phase 2, site ↔ CRM) : groupes, lieux, créneaux
// et tarifs, stockés en D1 (migrations 6 et 7).
//
// SOURCE DE VÉRITÉ : D1. Le KV n'est qu'une copie de compatibilité pour Sportville (retour arrière vers
// l'ancien code) et le HTML statique un secours de disponibilité pour Sportville SEULEMENT (D1 réellement
// en panne). D1 disponible + donnée absente = donnée réellement absente : on ne ressuscite jamais une ancienne
// valeur statique ou KV.
//
// Transition depuis le KV : les catégories et le tarif vivaient dans la configuration KV
// (settings-kv.js, clé categories_config). getCategoriesConfig/setCategoriesConfig passent désormais par
// ce module : lecture en D1, écriture en D1 puis (au mieux) dans le KV. Au premier accès d'une organisation,
// ses tables sont remplies depuis sa configuration KV (bootstrapPublicData), UNE seule fois : un marqueur
// (organizations.settings.publicDataInitialized) empêche tout ré-import, y compris si l'administrateur
// supprime ensuite tous ses groupes.
//
// Toutes les fonctions prennent l'organizationId, déterminé côté serveur.
import { ensureSchema } from './inscriptions-db.js';
import { DEMO_ORG_ID } from './schema.js';

// Tarif unique de la saison (le formulaire actuel n'a qu'un prix pour toutes les catégories).
export const SEASON_PRICE_SLUG = 'adhesion-saison';

function requireOrganization(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('Données publiques : organisation requise');
}

// Modification concurrente de la configuration des catégories (voir writeGroupsConfig).
export class ConfigConflictError extends Error {
  constructor() {
    super('Ces réglages ont été modifiés par quelqu’un d’autre pendant votre édition.');
    this.name = 'ConfigConflictError';
  }
}

// ---------------------------------------------------------------------------------------------
// Cache des données publiques : 60 s par instance du Worker (filet de sécurité), invalidé aussitôt par toute
// écriture faite depuis cette instance. LIMITE : Cloudflare exécute plusieurs instances (isolates) sans
// mémoire partagée ; l'invalidation ne vaut que pour l'instance qui traite la modification, les autres
// gardent leur copie au plus CACHE_TTL_MS. Une modification est donc visible partout en moins d'une minute,
// et immédiatement pour l'administrateur si sa requête suivante tombe sur la même instance.
export const CACHE_TTL_MS = 60_000;
const cache = new Map();

// prepare : appelé avant la lecture quand le cache est vide (import initial des données d'une organisation).
export async function getCachedPublicData(env, organizationId, prepare) {
  const hit = cache.get(organizationId);
  if (hit && hit.expires > Date.now() && hit.db === env.DB) return hit.data;
  if (prepare) await prepare();
  const data = await getPublicData(env, organizationId);
  cache.set(organizationId, { data, expires: Date.now() + CACHE_TTL_MS, db: env.DB });
  return data;
}
// Invalide uniquement l'organisation modifiée : le cache des autres reste intact.
export const invalidatePublicData = (organizationId) => void cache.delete(organizationId);
export const clearPublicDataCache = () => cache.clear();

// ---------------------------------------------------------------------------------------------
// Marqueur et version, dans organizations.settings (JSON) : aucune table ni colonne de plus.
const INITIALIZED = "COALESCE(json_extract(settings, '$.publicDataInitialized'), 0) = 1";
const VERSION = "COALESCE(json_extract(settings, '$.publicDataVersion'), 0)";
const NOT_INITIALIZED_FOR = '(SELECT NOT (' + INITIALIZED + ') FROM organizations WHERE id = ?)';

async function readOrganizationState(env, organizationId) {
  const row = await env.DB.prepare(`SELECT ${VERSION} AS version, (${INITIALIZED}) AS initialized FROM organizations WHERE id = ?`).bind(organizationId).first();
  return { version: row?.version ?? 0, initialized: Boolean(row?.initialized) };
}

// Groupe (ligne D1) → catégorie au format historique utilisé partout (formulaire, admin, e-mails).
const toCategory = (g) => ({
  id: g.slug,
  label: g.name,
  anneeMin: g.birth_year_min,
  anneeMax: g.birth_year_max,
  helloAssoUrl: g.payment_url || '',
  helloAssoWidgetUrl: g.payment_widget_url || '',
  active: Boolean(g.is_active),
});

// { categories, prix, version } lus en D1, ou null si l'organisation n'a encore rien importé (ni groupe, ni
// marqueur). Organisation déjà initialisée mais sans groupe : liste vide (suppression volontaire respectée).
export async function readGroupsConfig(env, organizationId) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const [{ results: groups }, price, state] = await Promise.all([
    env.DB.prepare('SELECT * FROM groups WHERE organization_id = ? ORDER BY sort_order, id').bind(organizationId).all(),
    env.DB.prepare('SELECT amount_cents FROM prices WHERE organization_id = ? AND slug = ?').bind(organizationId, SEASON_PRICE_SLUG).first(),
    readOrganizationState(env, organizationId),
  ]);
  const prix = price ? price.amount_cents / 100 : null;
  if (!groups.length) return state.initialized ? { categories: [], prix, version: state.version } : null;
  // Base historique (phase 2 déjà en production) : des groupes existent sans marqueur, on le pose une fois.
  if (!state.initialized) {
    await env.DB.prepare("UPDATE organizations SET settings = json_set(COALESCE(NULLIF(settings, ''), '{}'), '$.publicDataInitialized', 1) WHERE id = ?").bind(organizationId).run();
  }
  return { categories: groups.map(toCategory), prix, version: state.version };
}

// Remplace les groupes et le tarif de la saison de l'organisation par ceux de la configuration (même
// format que le KV). Une seule transaction : groupes ajoutés, modifiés (par slug) ou supprimés, ordre
// conservé. Les créneaux et lieux ne sont pas touchés (édités à part). Les inscriptions ne sont jamais
// touchées : elles gardent leur libellé de catégorie, quoi qu'il arrive au groupe.
//
// Concurrence : expectedVersion (lue avec la configuration affichée) doit être encore celle de la base ;
// sinon rien n'est écrit et ConfigConflictError est levée (l'administrateur recharge et refait sa
// modification, au lieu d'écraser en silence celle d'un autre). Sans expectedVersion, pas de contrôle.
export async function writeGroupsConfig(env, organizationId, { categories = [], prix = null }, { expectedVersion } = {}) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const checked = Number.isInteger(expectedVersion);
  // Vraie tant que la version n'a pas bougé (ou si aucun contrôle demandé) ; évaluée avant le passage de version.
  const guard = `(? = 0 OR (SELECT ${VERSION} FROM organizations WHERE id = ?) = ?)`;
  const guardArgs = [checked ? 1 : 0, organizationId, checked ? expectedVersion : 0];
  const slugs = categories.map((c) => String(c.id));
  const statements = categories.map((c, index) =>
    env.DB.prepare(
      `INSERT INTO groups (organization_id, slug, name, birth_year_min, birth_year_max, is_active, sort_order, payment_url, payment_widget_url)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${guard}
       ON CONFLICT (organization_id, slug) DO UPDATE SET
         name = excluded.name, birth_year_min = excluded.birth_year_min, birth_year_max = excluded.birth_year_max,
         is_active = excluded.is_active, sort_order = excluded.sort_order, payment_url = excluded.payment_url,
         payment_widget_url = excluded.payment_widget_url, updated_at = datetime('now')`
    ).bind(
      organizationId,
      String(c.id),
      String(c.label),
      Number.isInteger(c.anneeMin) ? c.anneeMin : null,
      Number.isInteger(c.anneeMax) ? c.anneeMax : null,
      c.active === false ? 0 : 1,
      index,
      c.helloAssoUrl || null,
      c.helloAssoWidgetUrl || null,
      ...guardArgs
    )
  );
  statements.push(
    slugs.length
      ? env.DB.prepare(`DELETE FROM groups WHERE organization_id = ? AND slug NOT IN (${slugs.map(() => '?').join(', ')}) AND ${guard}`).bind(organizationId, ...slugs, ...guardArgs)
      : env.DB.prepare(`DELETE FROM groups WHERE organization_id = ? AND ${guard}`).bind(organizationId, ...guardArgs)
  );
  if (Number.isFinite(Number(prix)) && prix !== null && prix !== '') {
    statements.push(
      env.DB.prepare(
        `INSERT INTO prices (organization_id, slug, label, amount_cents) SELECT ?, ?, 'Adhésion (saison)', ? WHERE ${guard}
         ON CONFLICT (organization_id, slug) DO UPDATE SET amount_cents = excluded.amount_cents, updated_at = datetime('now')`
      ).bind(organizationId, SEASON_PRICE_SLUG, Math.round(Number(prix) * 100), ...guardArgs)
    );
  }
  // Dernier : passage de version + marqueur d'initialisation. Il ne s'applique que si le contrôle est passé ;
  // son nombre de lignes modifiées dit si toute la transaction a été appliquée.
  statements.push(
    env.DB.prepare(
      `UPDATE organizations SET settings = json_set(COALESCE(NULLIF(settings, ''), '{}'), '$.publicDataInitialized', 1, '$.publicDataVersion', ${VERSION} + 1)
       WHERE id = ? AND ${guard}`
    ).bind(organizationId, ...guardArgs)
  );
  const results = await env.DB.batch(statements);
  invalidatePublicData(organizationId);
  if (!results[results.length - 1].meta.changes) throw new ConfigConflictError();
}

// Lieu et créneau réels de Sportville (CLAUDE.md : un seul créneau cette saison, le jeudi de 17 h à
// 18 h, partagé par toutes les catégories, au stade Stade municipal). Une autre organisation part de zéro.
const DEMO_VENUE = {
  name: 'Stade municipal',
  address: "1 rue du Stade, 00000 Sportville",
  mapsUrl: 'https://www.google.com/maps/search/?api=1&query=Stade+municipal+1+rue+du+Stade+00000+Sportville',
};

// Premier accès : groupes, tarif et (Sportville) lieu/créneau importés depuis la configuration KV de
// l'organisation. Idempotent et sûr sous concurrence : tout tient dans UNE transaction dont chaque
// instruction ne s'applique que si le marqueur d'initialisation n'est pas encore posé, et dont la
// dernière le pose. Une seconde initialisation simultanée ne trouve plus rien à faire ; elle n'écrase
// jamais une modification de l'administrateur.
export async function bootstrapPublicData(env, organizationId, { categories = [], prix = null } = {}) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const notInitialized = NOT_INITIALIZED_FOR;
  const statements = categories.map((c, index) =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO groups (organization_id, slug, name, birth_year_min, birth_year_max, is_active, sort_order, payment_url, payment_widget_url)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${notInitialized}`
    ).bind(
      organizationId,
      String(c.id),
      String(c.label),
      Number.isInteger(c.anneeMin) ? c.anneeMin : null,
      Number.isInteger(c.anneeMax) ? c.anneeMax : null,
      c.active === false ? 0 : 1,
      index,
      c.helloAssoUrl || null,
      c.helloAssoWidgetUrl || null,
      organizationId
    )
  );
  if (Number.isFinite(Number(prix)) && prix !== null && prix !== '') {
    statements.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO prices (organization_id, slug, label, amount_cents) SELECT ?, ?, 'Adhésion (saison)', ? WHERE ${notInitialized}`
      ).bind(organizationId, SEASON_PRICE_SLUG, Math.round(Number(prix) * 100), organizationId)
    );
  }
  if (organizationId === DEMO_ORG_ID) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO locations (organization_id, name, address, maps_url)
         SELECT ?1, ?2, ?3, ?4 WHERE ${'(SELECT NOT (' + INITIALIZED + ') FROM organizations WHERE id = ?1)'}
           AND NOT EXISTS (SELECT 1 FROM locations WHERE organization_id = ?1)
           AND NOT EXISTS (SELECT 1 FROM group_schedules WHERE organization_id = ?1)`
      ).bind(organizationId, DEMO_VENUE.name, DEMO_VENUE.address, DEMO_VENUE.mapsUrl),
      env.DB.prepare(
        `INSERT OR IGNORE INTO group_schedules (organization_id, group_id, location_id, weekday, start_time, end_time)
         SELECT ?1, NULL, (SELECT MIN(id) FROM locations WHERE organization_id = ?1), 4, '17:00', '18:00'
         WHERE ${'(SELECT NOT (' + INITIALIZED + ') FROM organizations WHERE id = ?1)'}
           AND NOT EXISTS (SELECT 1 FROM group_schedules WHERE organization_id = ?1)`
      ).bind(organizationId)
    );
  }
  statements.push(
    env.DB.prepare("UPDATE organizations SET settings = json_set(COALESCE(NULLIF(settings, ''), '{}'), '$.publicDataInitialized', 1) WHERE id = ?").bind(organizationId)
  );
  await env.DB.batch(statements);
  invalidatePublicData(organizationId);
}

const WEEKDAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const weekdayLabel = (n) => WEEKDAYS[n] || '';

// Données publiques d'une organisation (groupes actifs et publics, créneaux publics, lieux, tarifs
// publics) : ce que le site peut afficher. Aucune donnée personnelle. Un créneau propre à un groupe
// inactif ou non public n'est pas publié non plus.
export async function getPublicData(env, organizationId) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const [groups, schedules, locations, prices] = await Promise.all([
    env.DB.prepare('SELECT id, slug, name, description, birth_year_min, birth_year_max FROM groups WHERE organization_id = ? AND is_active = 1 AND is_public = 1 ORDER BY sort_order, id')
      .bind(organizationId)
      .all(),
    env.DB.prepare(
      `SELECT id, group_id, location_id, weekday, start_time, end_time FROM group_schedules
       WHERE organization_id = ? AND is_public = 1
         AND (group_id IS NULL OR group_id IN (SELECT id FROM groups WHERE organization_id = ? AND is_active = 1 AND is_public = 1))
       ORDER BY weekday, start_time, sort_order, id`
    )
      .bind(organizationId, organizationId)
      .all(),
    env.DB.prepare('SELECT id, name, address, maps_url FROM locations WHERE organization_id = ? ORDER BY id').bind(organizationId).all(),
    env.DB.prepare('SELECT slug, label, amount_cents, currency, group_id FROM prices WHERE organization_id = ? AND is_public = 1 ORDER BY sort_order, id')
      .bind(organizationId)
      .all(),
  ]);
  return {
    groups: groups.results,
    schedules: schedules.results.map((s) => ({ ...s, weekday_label: weekdayLabel(s.weekday) })),
    locations: locations.results,
    prices: prices.results,
  };
}

// URL de carte fournie (maps_url) : acceptée seulement en https vers un service de cartes connu. Sinon null
// (l'appelant reconstruit alors l'URL depuis l'adresse). Jamais de schéma javascript:, data: ou autre.
const MAPS_HOSTS = new Set(['www.google.com', 'google.com', 'maps.google.com', 'maps.app.goo.gl', 'www.openstreetmap.org']);
export function safeMapsUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password || !MAPS_HOSTS.has(url.hostname)) return null;
    if (url.hostname.endsWith('google.com') && !url.pathname.startsWith('/maps')) return null;
    return String(value);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Édition depuis l'admin (/admin/categories) : lieux et créneaux. Toute référence (lieu, groupe) est
// vérifiée dans l'organisation de la session : un identifiant d'une autre organisation est refusé.

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Tout (y compris groupes inactifs et éléments non publics) pour l'écran d'administration.
export async function getAdminPublicData(env, organizationId) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const [groups, schedules, locations] = await Promise.all([
    env.DB.prepare('SELECT id, slug, name, is_active FROM groups WHERE organization_id = ? ORDER BY sort_order, id').bind(organizationId).all(),
    env.DB.prepare('SELECT * FROM group_schedules WHERE organization_id = ? ORDER BY weekday, start_time, sort_order, id').bind(organizationId).all(),
    env.DB.prepare('SELECT * FROM locations WHERE organization_id = ? ORDER BY id').bind(organizationId).all(),
  ]);
  return { groups: groups.results, schedules: schedules.results, locations: locations.results };
}

// { error } si invalide, sinon { value } nettoyé.
export function parseLocation(input) {
  const name = String(input.name || '').trim().slice(0, 80);
  const address = String(input.address || '').trim().slice(0, 200);
  if (!name) return { error: 'Le nom du lieu est obligatoire.' };
  return { value: { name, address: address || null } };
}

// Lien « Ouvrir dans Google Maps » construit depuis le nom et l'adresse (jamais de saisie libre d'URL).
export const buildMapsUrl = (name, address) =>
  address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}` : null;

export async function saveLocation(env, organizationId, id, input) {
  requireOrganization(organizationId);
  const parsed = parseLocation(input);
  if (parsed.error) return parsed;
  const { name, address } = parsed.value;
  const mapsUrl = buildMapsUrl(name, address);
  await ensureSchema(env.DB);
  try {
    if (id) {
      const { meta } = await env.DB.prepare(
        "UPDATE locations SET name = ?, address = ?, maps_url = ?, updated_at = datetime('now') WHERE organization_id = ? AND id = ?"
      )
        .bind(name, address, mapsUrl, organizationId, id)
        .run();
      return meta.changes ? {} : { error: 'Lieu introuvable.' };
    }
    await env.DB.prepare('INSERT INTO locations (organization_id, name, address, maps_url) VALUES (?, ?, ?, ?)').bind(organizationId, name, address, mapsUrl).run();
    return {};
  } finally {
    invalidatePublicData(organizationId);
  }
}

export async function deleteLocation(env, organizationId, id) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  // Les créneaux de ce lieu gardent leur horaire, sans lieu (ON DELETE SET NULL, fait explicitement).
  // Un créneau qui deviendrait strictement identique à un autre (même groupe, jour et heures, sans lieu ou
  // avec ce même lieu) est un doublon exact : il est retiré, l'information reste portée par l'autre.
  const same = `IFNULL(o.group_id, 0) = IFNULL(s.group_id, 0) AND o.weekday = s.weekday AND o.start_time = s.start_time AND o.end_time = s.end_time`;
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM group_schedules AS s WHERE s.organization_id = ? AND s.location_id = ? AND EXISTS (
         SELECT 1 FROM group_schedules o WHERE o.organization_id = ? AND o.id <> s.id AND ${same}
           AND (o.location_id IS NULL OR (o.location_id = s.location_id AND o.id < s.id)))`
    ).bind(organizationId, id, organizationId),
    env.DB.prepare('UPDATE group_schedules SET location_id = NULL WHERE organization_id = ? AND location_id = ?').bind(organizationId, id),
    env.DB.prepare('DELETE FROM locations WHERE organization_id = ? AND id = ?').bind(organizationId, id),
  ]);
  invalidatePublicData(organizationId);
  return {};
}

export function parseSchedule(input) {
  const weekday = Number(input.weekday);
  const start = String(input.start || '').trim();
  const end = String(input.end || '').trim();
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return { error: 'Jour invalide.' };
  if (!TIME_RE.test(start) || !TIME_RE.test(end)) return { error: 'Heures invalides (format HH:MM).' };
  if (start >= end) return { error: 'L’heure de fin doit être après l’heure de début.' };
  const locationId = input.locationId ? Number(input.locationId) : null;
  const groupId = input.groupId ? Number(input.groupId) : null;
  if ((locationId !== null && !Number.isInteger(locationId)) || (groupId !== null && !Number.isInteger(groupId))) return { error: 'Référence invalide.' };
  return { value: { weekday, start, end, locationId, groupId } };
}

// Le lieu et le groupe choisis doivent appartenir à l'organisation.
async function referencesBelongTo(env, organizationId, { locationId, groupId }) {
  if (locationId && !(await env.DB.prepare('SELECT 1 FROM locations WHERE organization_id = ? AND id = ?').bind(organizationId, locationId).first())) return false;
  if (groupId && !(await env.DB.prepare('SELECT 1 FROM groups WHERE organization_id = ? AND id = ?').bind(organizationId, groupId).first())) return false;
  return true;
}

export async function saveSchedule(env, organizationId, id, input) {
  requireOrganization(organizationId);
  const parsed = parseSchedule(input);
  if (parsed.error) return parsed;
  await ensureSchema(env.DB);
  const v = parsed.value;
  if (!(await referencesBelongTo(env, organizationId, v))) return { error: 'Lieu ou groupe introuvable.' };
  try {
    if (id) {
      const { meta } = await env.DB.prepare(
        `UPDATE group_schedules SET weekday = ?, start_time = ?, end_time = ?, location_id = ?, group_id = ?, updated_at = datetime('now')
         WHERE organization_id = ? AND id = ?`
      )
        .bind(v.weekday, v.start, v.end, v.locationId, v.groupId, organizationId, id)
        .run();
      return meta.changes ? {} : { error: 'Créneau introuvable.' };
    }
    await env.DB.prepare(
      'INSERT INTO group_schedules (organization_id, group_id, location_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(organizationId, v.groupId, v.locationId, v.weekday, v.start, v.end)
      .run();
    return {};
  } catch (error) {
    if (/UNIQUE/i.test(error?.message)) return { error: 'Ce créneau existe déjà (même groupe, lieu, jour et heures).' };
    throw error;
  } finally {
    invalidatePublicData(organizationId);
  }
}

export async function deleteSchedule(env, organizationId, id) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  await env.DB.prepare('DELETE FROM group_schedules WHERE organization_id = ? AND id = ?').bind(organizationId, id).run();
  invalidatePublicData(organizationId);
  return {};
}
