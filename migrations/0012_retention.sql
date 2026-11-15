-- Conservation des données personnelles (RGPD), 2026-11-15. Migration additive.
--
-- clubs.retention_policy : durées choisies par le club, bornées par src/lib/retention.ts. Désactivée par défaut :
-- rien n'est effacé tant que le président ne l'a pas activée en voyant ce qui serait concerné.
-- anonymized_at : une saison ancienne est anonymisée (noms, coordonnées, signature) au lieu d'être supprimée, pour
-- garder les montants réglés et les statistiques par saison.
-- retention_runs : journal par club de chaque passage (nombres seulement, aucune donnée personnelle).

ALTER TABLE clubs ADD COLUMN retention_policy TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(retention_policy) AND json_type(retention_policy) = 'object');

ALTER TABLE members ADD COLUMN anonymized_at TEXT;
ALTER TABLE family_registrations ADD COLUMN anonymized_at TEXT;

CREATE INDEX members_retention_idx ON members(club_id, season) WHERE anonymized_at IS NULL;
CREATE INDEX family_registrations_retention_idx ON family_registrations(club_id, season) WHERE anonymized_at IS NULL;

CREATE TABLE retention_runs (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('auto','manual')),
  detail TEXT NOT NULL CHECK (json_valid(detail)),
  ran_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX retention_runs_club_idx ON retention_runs(club_id, ran_at DESC);
