// Instantanés STRUCTURE + DONNÉES d'une base SQLite (copie locale de D1), pour prouver qu'une migration ne touche à
// aucun objet préexistant (T2 du contrat 4E v3.1). Lecture seule. Utilisé par scripts/verify-d1-copy.mjs et par les
// tests. Aucune valeur n'est affichée : seules des empreintes SHA-256 et des comptages sortent de ce module.
//
// Structure, pour chaque objet de sqlite_master (tables, index, triggers, vues) : type, table, SQL normalisé ; pour
// chaque table : PRAGMA table_xinfo (cid, name, type, notnull, dflt_value, pk, hidden), foreign_key_list (toutes les
// colonnes), index_list (nom, unique, origine, partiel), puis index_info et index_xinfo de chaque index.
// Données : pour chaque table, nombre de lignes et empreinte canonique de toutes les colonnes, dans l'ordre du rowid.
import { createHash } from 'node:crypto';
import { NEWS_TRIGGERS, ARTICLES_INDEXES } from '../functions/_shared/news-schema.js';
import { normalizeSql } from '../functions/_shared/schema-utils.js';

const sha256 = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = (rows) => rows.map((row) => ({ ...row }));
const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;

// Objets créés par la migration 13, et eux seuls (liste exacte du contrat §2 à §6).
export const MIGRATION_13_OBJECTS = Object.freeze(
  new Set([
    'table:articles',
    'table:organization_news_state',
    ...ARTICLES_INDEXES.map(([name]) => `index:${name}`),
    'index:sqlite_autoindex_articles_1',
    'index:sqlite_autoindex_articles_2',
    'index:sqlite_autoindex_articles_3',
    'index:sqlite_autoindex_organization_news_state_1',
    ...NEWS_TRIGGERS.map(([name]) => `trigger:${name}`),
  ])
);

// sqlite : DatabaseSync (node:sqlite). Tables internes sqlite_sequence / sqlite_stat* incluses dans les données
// seulement si présentes des deux côtés (sqlite_sequence change à chaque INSERT AUTOINCREMENT, jamais ici).
export function structureSnapshot(sqlite) {
  const objects = sqlite.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_stat%' ORDER BY type, name").all();
  const snapshot = {};
  for (const o of objects) {
    const entry = { type: o.type, table: o.tbl_name, sql: o.sql === null ? null : normalizeSql(o.sql) };
    if (o.type === 'table') {
      entry.columns = plain(sqlite.prepare(`PRAGMA table_xinfo(${quote(o.name)})`).all());
      entry.foreignKeys = plain(sqlite.prepare(`PRAGMA foreign_key_list(${quote(o.name)})`).all());
      entry.indexes = plain(sqlite.prepare(`PRAGMA index_list(${quote(o.name)})`).all())
        .map(({ name, unique, origin, partial }) => ({ name, unique, origin, partial }))
        .sort((a, b) => (a.name < b.name ? -1 : 1));
    }
    if (o.type === 'index') {
      entry.info = plain(sqlite.prepare(`PRAGMA index_info(${quote(o.name)})`).all());
      entry.xinfo = plain(sqlite.prepare(`PRAGMA index_xinfo(${quote(o.name)})`).all());
    }
    snapshot[`${o.type}:${o.name}`] = entry;
  }
  return snapshot;
}

export function dataSnapshot(sqlite, { exclude = [] } = {}) {
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((t) => t.name);
  const snapshot = {};
  for (const table of tables.filter((t) => !exclude.includes(t))) {
    const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map((c) => c.name);
    const rows = sqlite.prepare(`SELECT ${columns.map(quote).join(', ')} FROM ${quote(table)} ORDER BY rowid`).all().map((row) => columns.map((c) => row[c]));
    snapshot[table] = { rows: rows.length, digest: sha256([columns, rows]) };
  }
  return snapshot;
}

// Écarts (liste vide : conforme). Tout objet préexistant doit être strictement identique ; les objets nouveaux doivent
// être EXACTEMENT ceux de `allowed` ; les données des tables préexistantes (hors `mutableTables`) doivent être identiques.
export function compareSnapshots(before, after, { allowed = MIGRATION_13_OBJECTS, mutableTables = ['schema_migrations'] } = {}) {
  const problems = [];
  for (const [key, entry] of Object.entries(before.structure)) {
    if (!(key in after.structure)) problems.push(`objet disparu : ${key}`);
    else if (JSON.stringify(after.structure[key]) !== JSON.stringify(entry)) problems.push(`objet modifié : ${key}`);
  }
  const created = Object.keys(after.structure).filter((key) => !(key in before.structure)).sort();
  const expected = [...allowed].sort();
  for (const key of created) if (!allowed.has(key)) problems.push(`objet nouveau hors migration : ${key}`);
  for (const key of expected) if (!created.includes(key)) problems.push(`objet de la migration absent : ${key}`);
  for (const [table, entry] of Object.entries(before.data)) {
    if (mutableTables.includes(table)) continue;
    const now = after.data[table];
    if (!now) problems.push(`table disparue : ${table}`);
    else if (now.rows !== entry.rows || now.digest !== entry.digest) problems.push(`données modifiées : ${table}`);
  }
  return problems;
}

export const snapshot = (sqlite) => ({ structure: structureSnapshot(sqlite), data: dataSnapshot(sqlite) });
