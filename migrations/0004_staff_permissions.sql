-- Droits personnalisés par personne (2026-11-15). Le rôle pré-coche des droits ; l'administrateur du club les ajuste.
-- NULL = droits par défaut du rôle (comptes existants inchangés) ; sinon la liste exacte des droits accordés.
-- Catalogue et explications : src/lib/permissions.ts (ALL_GRANTS, GRANT_INFO). Migration additive.

ALTER TABLE staff_members ADD COLUMN permissions TEXT
  CHECK (permissions IS NULL OR (json_valid(permissions) AND json_type(permissions) = 'array'));
