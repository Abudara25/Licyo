// Pré-inscriptions (liste d'intérêt) d'un groupe qui n'ouvrira qu'avec assez d'enfants (2026-10-08 : U10, nés en
// 2017, 15 places). VOLONTAIREMENT SÉPARÉES de la table `inscriptions` : ni paiement, ni dossier, ni relance, ni CRM,
// aucune incidence sur les compteurs « à compléter ». Formulaire public : /pre-inscription-u10
// (functions/api/preinscriptions.js) ; suivi : /admin/preinscriptions.
//
// Table hors séquence de migrations (règle ADR-012, comme site_events et rate_limits) : créée par ce module, additive,
// organization_id NOT NULL. Réglages (ouvert/fermé, plafond, libellé, années) dans le KV de l'organisation
// (settings-kv.js, clé « preinscription_config »).
import { readSetting, writeSetting, getCategoriesConfig } from './settings-kv.js';
import { oncePerBinding } from './once-per-binding.js';
import { ageRangesFrom } from './inscriptions-db.js';
import { DEMO_ORG_ID } from './schema.js';

export const PREINSCRIPTIONS_TABLE = `CREATE TABLE IF NOT EXISTS preinscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        groupe TEXT NOT NULL,
        enfant_prenom TEXT NOT NULL,
        enfant_nom TEXT NOT NULL,
        naissance TEXT NOT NULL,
        ville_naissance TEXT,
        pays_naissance TEXT,
        parent_prenom TEXT NOT NULL,
        parent_nom TEXT NOT NULL,
        email TEXT NOT NULL,
        telephone TEXT NOT NULL,
        parent2_prenom TEXT,
        parent2_nom TEXT,
        parent2_email TEXT,
        parent2_telephone TEXT,
        taille_maillot TEXT,
        commentaire TEXT,
        dedup_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`;
const PREINSCRIPTIONS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_preinscriptions_org_groupe ON preinscriptions (organization_id, groupe, id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_preinscriptions_org_dedup ON preinscriptions (organization_id, groupe, dedup_key)',
];

// Colonnes ajoutées après la première mise en ligne (2026-10-08 : lieu de naissance, comme le formulaire
// d'inscription) : ajout additif, NULL pour les pré-inscriptions déjà enregistrées, qui restent consultables et
// complétables depuis /admin/preinscriptions.
// Puis second responsable légal facultatif (2026-10-08, comme le formulaire d'inscription).
// Puis taille de tenue (2026-10-08, comme l'inscription ; NULL pour les plus anciennes, complétable dans l'admin).
// Puis code postal de naissance (2026-11-10, comme l'inscription : oublié ici, les fiches transférées l'avaient vide).
const ADDED_COLUMNS = ['ville_naissance TEXT', 'pays_naissance TEXT', 'cp_naissance TEXT', 'parent2_prenom TEXT', 'parent2_nom TEXT', 'parent2_email TEXT', 'parent2_telephone TEXT', 'taille_maillot TEXT', 'invited_at TEXT',
  // Délai pour finaliser l'inscription après une invitation (2026-11-04) : échéance, rappel envoyé, place libérée
  // (délai dépassé, la ligne reste : jamais supprimée), adhésion finalisée (formulaire + dossier + paiement).
  'invite_deadline_at TEXT', 'invite_reminded_at TEXT', 'expired_at TEXT', 'completed_at TEXT',
  // Fiche d'inscription créée par le club depuis cette pré-inscription (2026-11-09, preinscription-transfer.js). La
  // ligne reste, et compte toujours dans les places du groupe (« 7 / 15 » ne change pas après un transfert).
  'inscription_id INTEGER'];

async function preparePreinscriptions(db) {
  await db.batch([db.prepare(PREINSCRIPTIONS_TABLE), ...PREINSCRIPTIONS_INDEXES.map((sql) => db.prepare(sql))]);
  const present = new Set((await db.prepare('PRAGMA table_info(preinscriptions)').all()).results.map((c) => c.name));
  const missing = ADDED_COLUMNS.filter((definition) => !present.has(definition.split(' ')[0]));
  if (!missing.length) return;
  try {
    await db.batch(missing.map((definition) => db.prepare(`ALTER TABLE preinscriptions ADD COLUMN ${definition}`)));
  } catch (error) {
    // Ajout concurrent par une autre instance : seule une colonne toujours absente est une vraie erreur.
    const after = new Set((await db.prepare('PRAGMA table_info(preinscriptions)').all()).results.map((c) => c.name));
    if (missing.some((definition) => !after.has(definition.split(' ')[0]))) throw error;
  }
}

const ready = oncePerBinding();
export function ensurePreinscriptionsTable(db) {
  return ready(db, () => preparePreinscriptions(db));
}

// Lieu de naissance : mêmes règles que le formulaire d'inscription (functions/api/inscriptions.js et
// functions/depot/[token]/naissance.js) : texte libre (naissance à l'étranger acceptée), 1 à 100 caractères, sans
// caractère de contrôle.
export const MAX_BIRTHPLACE_LENGTH = 100;
export function cleanBirthPlace(value) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text || text.length > MAX_BIRTHPLACE_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

// Code postal de naissance : 5 chiffres pour une naissance en France, rien sinon. Renvoie '' (vide ou né à
// l'étranger : rien à stocker), le code, ou null s'il est invalide.
export function cleanBirthPostcode(value, pays) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!['', 'france', 'fr'].includes(String(pays || '').trim().toLowerCase())) return '';
  if (!text) return '';
  return /^\d{5}$/.test(text) ? text : null;
}

export const MAX_CAPACITY = 60;
// Délai laissé à une famille invitée pour finaliser l'inscription (formulaire, dossier signé, première cotisation).
export const INVITE_DAYS = { min: 3, max: 30, default: 7 };
const CONFIG_KEY = 'preinscription_config';

// Valeur par défaut de Demoville seulement ; une autre organisation n'a aucune pré-inscription tant qu'elle
// n'en a pas configuré (jamais les valeurs d'une autre organisation).
const DEMO_DEFAULT = Object.freeze({ open: true, groupe: 'U10', label: 'U10', anneeMin: 2017, anneeMax: 2017, capacity: 15 });

export function normalizeConfig(value) {
  if (!value || typeof value !== 'object') return null;
  const year = (v) => (Number.isInteger(v) && v >= 2000 && v <= 2100 ? v : null);
  const anneeMin = year(value.anneeMin);
  const anneeMax = year(value.anneeMax);
  const capacity = Number.isInteger(value.capacity) && value.capacity >= 1 && value.capacity <= MAX_CAPACITY ? value.capacity : null;
  const groupe = typeof value.groupe === 'string' && /^[A-Za-z0-9 -]{1,20}$/.test(value.groupe) ? value.groupe : null;
  const label = typeof value.label === 'string' && value.label.trim() && value.label.length <= 40 ? value.label.trim() : null;
  if (!anneeMin || !anneeMax || anneeMin > anneeMax || !capacity || !groupe || !label) return null;
  // openedAt : date à laquelle le groupe est devenu une vraie catégorie (preinscription-opening.js).
  const iso = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v : null);
  const openedAt = iso(value.openedAt);
  // Que faire quand les places sont prises (2026-11-04) : autoCategory = créer (ou réactiver) la catégorie
  // d'inscription et inviter les familles (nouveau groupe d'un jeune club) ; sinon « salle d'attente » : le club est
  // prévenu (fullNotifiedAt, une fois) et invite lui-même les familles quand des places se libèrent dans une catégorie
  // existante. Absent (réglages antérieurs) = création automatique, comportement d'origine.
  const autoCategory = value.autoCategory !== false;
  const fullNotifiedAt = autoCategory ? null : iso(value.fullNotifiedAt);
  const inviteDays = Number.isInteger(value.inviteDays) && value.inviteDays >= INVITE_DAYS.min && value.inviteDays <= INVITE_DAYS.max ? value.inviteDays : INVITE_DAYS.default;
  return { open: value.open === true, groupe, label, anneeMin, anneeMax, capacity, openedAt, autoCategory, fullNotifiedAt, inviteDays };
}

// Ancien réglage à groupe unique (2026-10-08) : lu tant que la liste des groupes n'a jamais été enregistrée.
async function legacyConfig(env, organizationId) {
  let stored = null;
  try {
    const raw = await readSetting(env, organizationId, CONFIG_KEY);
    stored = raw ? normalizeConfig(JSON.parse(raw)) : null;
  } catch {
    stored = null;
  }
  if (stored) return stored;
  return organizationId === DEMO_ORG_ID ? { ...DEMO_DEFAULT } : null;
}

// Plusieurs groupes en pré-inscription (2026-11-04) : liste dans le KV (clé « preinscription_groups »). Chaque groupe
// a sa clé `groupe` (stockée dans chaque ligne de `preinscriptions`, jamais modifiée après création), son nom, ses
// années, ses places, son ouverture. Les années de deux groupes ne se recouvrent jamais : l'année de naissance désigne
// un seul groupe. Absente : l'ancien réglage unique (U10) devient le premier groupe, rien n'est perdu. Une liste
// vide enregistrée = aucun groupe (la valeur par défaut n'est pas ressuscitée).
const GROUPS_KEY = 'preinscription_groups';
// 40 au plus (2026-11-13) : l'admin est pensée pour beaucoup de groupes (actions d'abord, sélecteur avec recherche).
export const MAX_GROUPS = 40;

const overlap = (a, b) => a.anneeMin <= b.anneeMax && a.anneeMax >= b.anneeMin;

export function validateGroups(list) {
  if (!Array.isArray(list) || list.length > MAX_GROUPS) return null;
  const clean = list.map(normalizeConfig);
  if (clean.some((g) => !g)) return null;
  const keys = new Set(clean.map((g) => g.groupe));
  if (keys.size !== clean.length) return null;
  for (let i = 0; i < clean.length; i += 1) for (let j = i + 1; j < clean.length; j += 1) if (overlap(clean[i], clean[j])) return null;
  return clean;
}

export async function getPreinscriptionGroups(env, organizationId) {
  try {
    const raw = await readSetting(env, organizationId, GROUPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(normalizeConfig).filter(Boolean);
    }
  } catch {
    // Lecture impossible : ancien réglage, comme avant.
  }
  const legacy = await legacyConfig(env, organizationId);
  return legacy ? [legacy] : [];
}

export async function setPreinscriptionGroups(env, organizationId, groups) {
  const clean = validateGroups(groups);
  if (!clean) throw new Error('Groupes de pré-inscription invalides');
  await writeSetting(env, organizationId, GROUPS_KEY, JSON.stringify(clean));
  // Copie du premier groupe dans l'ancien réglage : un retour à l'ancien code retrouve le groupe principal.
  if (clean[0]) await writeSetting(env, organizationId, CONFIG_KEY, JSON.stringify(clean[0])).catch(() => {});
  return clean;
}

export const groupForYear = (groups, year) => groups.find((g) => year >= g.anneeMin && year <= g.anneeMax) || null;

// Clé d'un nouveau groupe, tirée de son nom (« U11 », « U12 - U13 » → « U12-U13 »), unique dans l'organisation.
export function newGroupKey(label, groups) {
  const base = String(label || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'GROUPE';
  const used = new Set(groups.map((g) => g.groupe));
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
  return key;
}

// Compatibilité : un groupe précis (clé), sinon le premier.
export async function getPreinscriptionConfig(env, organizationId, groupe = null) {
  const groups = await getPreinscriptionGroups(env, organizationId);
  return (groupe ? groups.find((g) => g.groupe === groupe) : groups[0]) || null;
}

// Remplace le groupe de même clé (ou l'ajoute) dans la liste.
export async function setPreinscriptionConfig(env, organizationId, config) {
  const clean = normalizeConfig(config);
  if (!clean) throw new Error('Réglages de pré-inscription invalides');
  const groups = await getPreinscriptionGroups(env, organizationId);
  const next = groups.some((g) => g.groupe === clean.groupe) ? groups.map((g) => (g.groupe === clean.groupe ? clean : g)) : [...groups, clean];
  await setPreinscriptionGroups(env, organizationId, next);
  return clean;
}

// Clé anti-doublon : même enfant (prénom, nom, naissance) dans le même groupe, quelle que soit l'adresse e-mail.
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
export const preinscriptionDedupKey = ({ enfantPrenom, enfantNom, naissance }) => `${normalize(enfantPrenom)}|${normalize(enfantNom)}|${naissance}`;

// Même enfant dans les deux listes (même prénom, nom et date de naissance, accents et casse ignorés) : une famille qui
// pré-inscrit un enfant déjà inscrit au club, ou l'inverse (constaté en production le 2026-10-08).
const childKey = (prenom, nom, naissance) => preinscriptionDedupKey({ enfantPrenom: prenom, enfantNom: nom, naissance });

// Inscription ACTIVE (hors corbeille) du même enfant : { id, categorie } ou null.
export async function findActiveInscriptionForChild(db, organizationId, { enfantPrenom, enfantNom, naissance }) {
  const { results } = await db
    .prepare('SELECT id, enfant_prenom, enfant_nom, naissance, categorie FROM inscriptions WHERE organization_id = ? AND naissance = ? AND archived_at IS NULL ORDER BY id')
    .bind(organizationId, naissance)
    .all();
  const key = childKey(enfantPrenom, enfantNom, naissance);
  return results.find((r) => childKey(r.enfant_prenom, r.enfant_nom, r.naissance) === key) || null;
}

// Pré-inscription du même enfant dans le groupe (ou dans n'importe quel groupe si groupe = null) : la ligne ou null.
export async function findPreinscriptionForChild(db, organizationId, groupe, { enfantPrenom, enfantNom, naissance }) {
  const key = childKey(enfantPrenom, enfantNom, naissance);
  const statement = groupe
    ? db.prepare('SELECT * FROM preinscriptions WHERE organization_id = ? AND groupe = ? AND dedup_key = ?').bind(organizationId, groupe, key)
    : db.prepare('SELECT * FROM preinscriptions WHERE organization_id = ? AND dedup_key = ? ORDER BY id LIMIT 1').bind(organizationId, key);
  return (await statement.first()) || null;
}

// Nombre de pré-inscrits par groupe : { [groupe]: n }.
export async function countByGroup(db, organizationId) {
  const { results } = await db.prepare('SELECT groupe, COUNT(*) AS n FROM preinscriptions WHERE organization_id = ? AND expired_at IS NULL GROUP BY groupe').bind(organizationId).all();
  return Object.fromEntries(results.map((r) => [r.groupe, r.n]));
}

// Toutes les pré-inscriptions de l'organisation (tous groupes), par groupe puis ordre d'arrivée.
export async function listAllPreinscriptions(db, organizationId) {
  const { results } = await db.prepare('SELECT * FROM preinscriptions WHERE organization_id = ? ORDER BY groupe, id').bind(organizationId).all();
  return results;
}

// Places occupées : une famille dont le délai d'inscription est dépassé (expired_at) a libéré la sienne.
export async function countPreinscriptions(db, organizationId, groupe) {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM preinscriptions WHERE organization_id = ? AND groupe = ? AND expired_at IS NULL').bind(organizationId, groupe).first();
  return row?.n || 0;
}

// Écriture atomique : le plafond et l'anti-doublon sont vérifiés DANS l'instruction d'insertion, même si deux
// familles envoient le formulaire au même instant pour la dernière place. Résultat : 'ok' | 'full' | 'duplicate'.
export async function insertPreinscription(db, organizationId, config, data) {
  const dedupKey = preinscriptionDedupKey(data);
  let result;
  try {
    result = await db
      .prepare(
        `INSERT INTO preinscriptions
          (organization_id, groupe, enfant_prenom, enfant_nom, naissance, ville_naissance, pays_naissance, cp_naissance, parent_prenom, parent_nom, email, telephone,
           parent2_prenom, parent2_nom, parent2_email, parent2_telephone, taille_maillot, commentaire, dedup_key)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE (SELECT COUNT(*) FROM preinscriptions WHERE organization_id = ? AND groupe = ? AND expired_at IS NULL) < ?
           AND NOT EXISTS (SELECT 1 FROM preinscriptions WHERE organization_id = ? AND groupe = ? AND dedup_key = ?)`
      )
      .bind(
        organizationId,
        config.groupe,
        data.enfantPrenom,
        data.enfantNom,
        data.naissance,
        data.villeNaissance,
        data.paysNaissance,
        data.cpNaissance || null,
        data.parentPrenom,
        data.parentNom,
        data.email,
        data.telephone,
        data.parent2Prenom || null,
        data.parent2Nom || null,
        data.parent2Email || null,
        data.parent2Telephone || null,
        data.tailleMaillot || null,
        data.commentaire || null,
        dedupKey,
        organizationId,
        config.groupe,
        config.capacity,
        organizationId,
        config.groupe,
        dedupKey
      )
      .run();
  } catch (error) {
    // Index unique : un doublon parallèle passé entre les deux lectures.
    if (/UNIQUE/i.test(String(error?.message))) return { status: 'duplicate' };
    throw error;
  }
  if (result.meta.changes === 1) return { status: 'ok', id: result.meta.last_row_id };
  const duplicate = await db
    .prepare('SELECT 1 AS x FROM preinscriptions WHERE organization_id = ? AND groupe = ? AND dedup_key = ?')
    .bind(organizationId, config.groupe, dedupKey)
    .first();
  return { status: duplicate ? 'duplicate' : 'full' };
}

export async function listPreinscriptions(db, organizationId, groupe) {
  const { results } = await db
    .prepare('SELECT * FROM preinscriptions WHERE organization_id = ? AND groupe = ? ORDER BY id')
    .bind(organizationId, groupe)
    .all();
  return results;
}

// Compléter ou corriger la taille de tenue (pré-inscriptions antérieures au champ, changement de taille).
export async function updatePreinscriptionSize(db, organizationId, id, tailleMaillot) {
  const result = await db.prepare('UPDATE preinscriptions SET taille_maillot = ? WHERE organization_id = ? AND id = ?').bind(tailleMaillot, organizationId, id).run();
  return result.meta.changes === 1;
}

// Compléter ou corriger le lieu de naissance (pré-inscriptions antérieures au champ, faute de frappe).
export async function updatePreinscriptionBirthPlace(db, organizationId, id, { villeNaissance, paysNaissance, cpNaissance = null }) {
  const result = await db
    .prepare('UPDATE preinscriptions SET ville_naissance = ?, pays_naissance = ?, cp_naissance = ? WHERE organization_id = ? AND id = ?')
    .bind(villeNaissance, paysNaissance, cpNaissance || null, organizationId, id)
    .run();
  return result.meta.changes === 1;
}

export async function deletePreinscription(db, organizationId, id) {
  const result = await db.prepare('DELETE FROM preinscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, id).run();
  return result.meta.changes === 1;
}

// Contexte des catégories d'âge de l'admin (ageGroup) : saison + tranches des catégories et du groupe en
// pré-inscription. categoriesConfig : réglages déjà lus, pour éviter une seconde lecture.
export async function loadAgeContext(env, organizationId, categoriesConfig = null) {
  const config = categoriesConfig || (await getCategoriesConfig(env, organizationId));
  const groups = await getPreinscriptionGroups(env, organizationId).catch(() => []);
  return { saison: config.saison, ranges: ageRangesFrom(config.categories || [], groups) };
}

// État public (formulaire et compteur) : jamais de nom ni de donnée personnelle.
// opened : groupe devenu une catégorie (openedAt), ou catégorie d'inscription active qui couvre ses années alors
// qu'il est en mode « catégorie automatique » (categoryActive, posé par l'API : le club a ouvert la catégorie à la
// main ou par un transfert, 2026-11-10). Une liste d'attente (autoCategory = false) n'est jamais concernée.
export function isGroupOpened(config) {
  return Boolean(config?.openedAt || (config?.categoryActive && config.autoCategory !== false));
}

export function publicState(config, count) {
  if (!config) return { available: false };
  const remaining = Math.max(0, config.capacity - count);
  const opened = isGroupOpened(config);
  return {
    available: true,
    groupe: config.groupe,
    open: config.open && remaining > 0 && !opened,
    closed: !config.open && !opened,
    opened,
    full: remaining === 0,
    label: config.label,
    anneeMin: config.anneeMin,
    anneeMax: config.anneeMax,
    capacity: config.capacity,
    count: Math.min(count, config.capacity),
    remaining,
  };
}
