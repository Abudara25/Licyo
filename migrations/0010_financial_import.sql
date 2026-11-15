-- Import financier générique (2026-11-15) : HelloAsso, relevé bancaire, SumUp, Stripe, tableur maison…
-- Logique : src/lib/financial-import.ts (lecture, normalisation, rapprochement). Migration additive.
--
-- financial_imports      : un fichier importé (qui, quand, quelle source, combien de lignes)
-- financial_transactions : une opération du fichier. Rien n'est crédité automatiquement : le trésorier rattache
--                          l'opération à une famille, ce qui crée l'encaissement (payment_installments).
-- dedup_key unique par club : réimporter le même fichier (ou un export qui recoupe le précédent) n'ajoute rien.

CREATE TABLE financial_imports (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('helloasso','bank','sumup','stripe','other')),
  file_name TEXT CHECK (file_name IS NULL OR length(file_name) <= 200),
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX financial_imports_club_idx ON financial_imports(club_id, created_at DESC);

CREATE TABLE financial_transactions (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  import_id TEXT REFERENCES financial_imports(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('helloasso','bank','sumup','stripe','other')),
  dedup_key TEXT NOT NULL CHECK (length(dedup_key) BETWEEN 1 AND 300),
  external_ref TEXT CHECK (external_ref IS NULL OR length(external_ref) <= 120),
  occurred_on TEXT NOT NULL CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  payer_name TEXT CHECK (payer_name IS NULL OR length(payer_name) <= 160),
  payer_email TEXT CHECK (payer_email IS NULL OR length(payer_email) <= 254),
  label TEXT CHECK (label IS NULL OR length(label) <= 300),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('card','check','cash','transfer','pass_sport','caf','other_aid')),
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  family_id TEXT REFERENCES family_registrations(id) ON DELETE SET NULL,
  installment_id TEXT REFERENCES payment_installments(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (club_id, dedup_key),
  CHECK ((status = 'matched') = (family_id IS NOT NULL AND installment_id IS NOT NULL))
);
CREATE INDEX financial_transactions_club_idx ON financial_transactions(club_id, status, occurred_on DESC);

-- Origine d'un encaissement (saisie manuelle si NULL) : pour savoir d'où vient chaque règlement.
ALTER TABLE payment_installments ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('helloasso','bank','sumup','stripe','other'));
