-- Newsletter aux familles (2026-11-15), reprise du CRM de Saint-Gratien FC. Logique : src/lib/newsletter.ts.
-- Migration additive.
--
-- newsletters             : un message (brouillon, programmé, en cours d'envoi, envoyé, annulé)
-- newsletter_deliveries   : une ligne par adresse destinataire ; unique (message, adresse) : jamais deux envois.
--                           Le lien de désinscription porte un jeton aléatoire dont seule l'empreinte est stockée.
-- newsletter_unsubscribes : registre des adresses désinscrites, par club, respecté à chaque envoi.

CREATE TABLE newsletters (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 150),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  audience TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(audience) AND json_type(audience) = 'object'),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','sending','sent','cancelled')),
  send_at TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (status = 'draft' OR status = 'cancelled' OR send_at IS NOT NULL)
);
CREATE INDEX newsletters_club_idx ON newsletters(club_id, created_at DESC);
CREATE INDEX newsletters_due_idx ON newsletters(status, send_at);

CREATE TABLE newsletter_deliveries (
  id TEXT PRIMARY KEY,
  newsletter_id TEXT NOT NULL REFERENCES newsletters(id) ON DELETE CASCADE,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  unsubscribe_token_hash TEXT NOT NULL UNIQUE,
  error TEXT CHECK (error IS NULL OR length(error) <= 300),
  sent_at TEXT,
  UNIQUE (newsletter_id, email)
);
CREATE INDEX newsletter_deliveries_queue_idx ON newsletter_deliveries(newsletter_id, status);

CREATE TABLE newsletter_unsubscribes (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (club_id, email)
);
