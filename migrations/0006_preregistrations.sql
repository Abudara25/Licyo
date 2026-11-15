-- Pré-inscriptions et liste d'attente (2026-11-15), reprises du CRM de Saint-Gratien FC.
-- Logique : src/lib/waitlist.ts ; actions : src/actions/preregistration.actions.ts. Migration additive.
--
-- registration_mode d'une catégorie :
--   open            inscriptions directes ; une fois la capacité atteinte, les familles rejoignent la liste d'attente
--   preregistration liste d'intérêt avant l'ouverture (ex. nouvelle catégorie) ; aucune inscription directe
--   closed          ni inscription ni liste
-- auto_invite : quand une place se libère, la tâche planifiée invite d'elle-même la personne suivante.

ALTER TABLE categories ADD COLUMN registration_mode TEXT NOT NULL DEFAULT 'open'
  CHECK (registration_mode IN ('open','preregistration','closed'));
ALTER TABLE categories ADD COLUMN auto_invite INTEGER NOT NULL DEFAULT 0 CHECK (auto_invite IN (0,1));

-- Une demande de place pour une personne dans une catégorie et une saison. Le rang suit l'ordre d'arrivée.
-- Le lien d'invitation n'est jamais stocké en clair : seule son empreinte SHA-256.
CREATE TABLE preregistrations (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  first_name TEXT NOT NULL CHECK (length(first_name) BETWEEN 1 AND 80),
  last_name TEXT NOT NULL CHECK (length(last_name) BETWEEN 1 AND 80),
  birth_date TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT 'X' CHECK (gender IN ('M','F','X')),
  contact_name TEXT NOT NULL CHECK (length(contact_name) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 6 AND 20),
  message TEXT CHECK (message IS NULL OR length(message) <= 1000),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','invited','registered','declined','expired','cancelled')),
  invite_token_hash TEXT UNIQUE,
  invited_at TEXT,
  invite_expires_at TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((status = 'invited') = (invite_token_hash IS NOT NULL AND invite_expires_at IS NOT NULL))
);
CREATE INDEX preregistrations_queue_idx ON preregistrations(club_id, category_id, season, status, created_at);
-- Une même personne ne s'inscrit qu'une fois par catégorie et par saison tant que sa demande est active.
CREATE UNIQUE INDEX preregistrations_active_uq ON preregistrations(category_id, season, email, lower(first_name), birth_date)
  WHERE status IN ('waiting','invited');
