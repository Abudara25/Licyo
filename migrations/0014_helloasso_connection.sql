-- Connexion directe à l'API HelloAsso (2026-11-15). Migration additive.
-- Une connexion par club. Le secret API est chiffré (AES-256-GCM, src/lib/utils/crypto.ts) ; la table n'est lue et
-- écrite que par le serveur (service), jamais par un client utilisateur (policies.ts : aucune règle d'accès).
-- last_counts : nombres du dernier passage, sans donnée personnelle.
CREATE TABLE club_integrations (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('helloasso')),
  account_ref TEXT NOT NULL CHECK (length(account_ref) BETWEEN 1 AND 120),
  client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 200),
  client_secret_enc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','error')),
  last_sync_at TEXT,
  last_error TEXT CHECK (last_error IS NULL OR length(last_error) <= 300),
  last_counts TEXT CHECK (last_counts IS NULL OR json_valid(last_counts)),
  connected_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (club_id, provider)
);
