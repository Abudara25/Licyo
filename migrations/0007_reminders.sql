-- Relances automatiques des dossiers incomplets (2026-11-15), reprises du CRM de Saint-Gratien FC.
-- Logique : src/lib/reminders.ts (tâche planifiée « relances »). Migration additive.
--
-- clubs.reminder_policy : réglages du club (désactivé par défaut : aucune relance n'est envoyée sans accord du club).
-- reminder_log : une ligne par relance envoyée ; l'unicité (cible, type, étape) garantit qu'une même relance
-- n'est jamais envoyée deux fois, même si la tâche est rejouée.

ALTER TABLE clubs ADD COLUMN reminder_policy TEXT NOT NULL DEFAULT '{}'
  CHECK (json_valid(reminder_policy) AND json_type(reminder_policy) = 'object');

CREATE TABLE reminder_log (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('member','family')),
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('documents','correction','payment')),
  step INTEGER NOT NULL CHECK (step BETWEEN 1 AND 5),
  recipient TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (target_id, kind, step)
);
CREATE INDEX reminder_log_club_idx ON reminder_log(club_id, sent_at DESC);
