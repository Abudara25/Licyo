-- Formulaire d'inscription modulable (2026-11-15) : réglages par club et réponses par adhérent.
-- Catalogue et validation : src/config/registration-fields.ts. Migration additive : deux colonnes ajoutées avec
-- une valeur par défaut neutre ('{}' = réglages proposés par défaut, aucune réponse), la vue publique recréée
-- à l'identique plus registration_form (réglages non sensibles, nécessaires au tunnel public).

ALTER TABLE clubs ADD COLUMN registration_form TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(registration_form) AND json_type(registration_form) = 'object');
ALTER TABLE members ADD COLUMN extra_fields TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_fields) AND json_type(extra_fields) = 'object');

DROP VIEW public_clubs;
CREATE VIEW public_clubs AS
SELECT id, name, slug, custom_domain, sport_type, theme_preset, primary_color, secondary_color, logo_url, hero_image_url,
  club_history_text, president_word_text, president_name, NULL AS president_signature_url, rna_number, siret_number,
  federation_name, affiliation_number, city, postal_code, nearby_cities, contact_email, contact_phone, social_links,
  sibling_discount_rules, accepts_pass_sport, pass_sport_amount, accepts_caf_aids, accepts_installments,
  pass_stripe_fees_to_parents, enabled_modules, 'platform' AS email_provider, NULL AS email_sender_address, status,
  demo_expires_at, 'integral' AS subscription_plan, NULL AS stripe_customer_id, NULL AS stripe_subscription_id,
  NULL AS stripe_connect_account_id, stripe_connect_onboarded, current_season, created_at,
  0 AS declared_member_count, NULL AS membership_tier_id, registration_form
FROM clubs
WHERE status = 'active' OR (status = 'demo' AND (demo_expires_at IS NULL OR demo_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')));
