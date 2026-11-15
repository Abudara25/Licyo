-- Autorisation parentale signée en ligne (2026-11-15), apport du CRM d'ASC Muay Thai. Migration additive.
-- Copie figée de ce qui a été signé pour un adhérent mineur (src/config/parental-authorization.ts) :
-- {"text", "signerName", "signerQuality", "signedAt", "templateHash"}. La signature elle-même reste dans
-- members.signature_data_url. Effacée à l'anonymisation (conservation RGPD, src/lib/retention.ts).
ALTER TABLE members ADD COLUMN parental_authorization TEXT
  CHECK (parental_authorization IS NULL OR (json_valid(parental_authorization) AND json_type(parental_authorization) = 'object'));
