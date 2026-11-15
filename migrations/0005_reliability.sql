-- Socle de fiabilité (2026-11-15) : journal des e-mails par club et historique des tâches planifiées.
-- Migration additive (deux tables neuves). Conservation : email_log purgé après 13 mois par la tâche planifiée
-- « purge » (src/lib/scheduled.ts) ; scheduled_runs après 90 jours.

-- Un e-mail envoyé (ou tenté) au nom d'un club. Sert à répondre à « je n'ai rien reçu » et à prouver un envoi.
-- Le contenu n'est pas conservé : seulement le type, l'objet, le destinataire et le résultat.
CREATE TABLE email_log (
  id TEXT PRIMARY KEY,
  club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  recipient TEXT NOT NULL CHECK (length(recipient) BETWEEN 3 AND 254),
  subject TEXT NOT NULL CHECK (length(subject) <= 200),
  provider TEXT NOT NULL CHECK (provider IN ('gmail','platform','log','none')),
  status TEXT NOT NULL CHECK (status IN ('sent','logged','failed')),
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX email_log_club_idx ON email_log(club_id, created_at DESC);
CREATE INDEX email_log_created_idx ON email_log(created_at);

-- Une exécution de tâche planifiée. Le couple (task, slot) est unique : deux déclenchements simultanés du même
-- créneau (reprise, double appel) ne lancent la tâche qu'une fois.
CREATE TABLE scheduled_runs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL CHECK (length(task) BETWEEN 1 AND 40),
  slot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT,
  UNIQUE (task, slot)
);
CREATE INDEX scheduled_runs_started_idx ON scheduled_runs(started_at);
