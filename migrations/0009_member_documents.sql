-- Pièces configurables par club (2026-11-15) : pièces autres que la photo, l'identité et le certificat médical
-- (colonnes historiques de members). Catalogue et règles : src/config/registration-documents.ts.
-- Migration additive. Les fichiers sont dans le stockage R2 privé (members/<saison>) ; supprimer une inscription
-- supprime ses lignes ici (les fichiers R2 sont effacés par le code qui supprime : purge RGPD).

CREATE TABLE member_documents (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  doc_key TEXT NOT NULL CHECK (length(doc_key) BETWEEN 1 AND 40),
  storage_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (member_id, doc_key)
);
CREATE INDEX member_documents_club_idx ON member_documents(club_id, member_id);
