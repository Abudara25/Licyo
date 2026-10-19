// Primitives de contrôle du schéma, SANS dépendance : importées par schema.js et par news-schema.js (migration 13),
// ce qui évite le cycle schema.js ↔ news-schema.js (un import direct de news-schema.js levait une ReferenceError).

// Définition SQL comparable : espaces normalisés, parenthèses collées, minuscules.
export const normalizeSql = (sql) => String(sql || '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim().toLowerCase();

// Schéma ou données en base incohérents avec les migrations : échec fermé, rien n'est modifié.
export class SchemaIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SchemaIntegrityError';
  }
}
