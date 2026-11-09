-- =============================================================================
-- Licyo sur Cloudflare D1 (SQLite) : schéma complet.
-- Traduction de supabase/migrations/0001 à 0005 (historique Postgres).
--
-- Conventions SQLite :
--   - identifiants UUID texte, générés par l'application (défaut SQL en secours) ;
--   - dates ISO 8601 UTC en TEXT ;
--   - booléens en INTEGER 0/1 ;
--   - tableaux et objets en JSON texte (convertis par src/lib/db/schema.ts) ;
--   - montants en REAL euros comme l'historique (dette : passer en centimes).
-- Pas de RLS en SQLite : les règles d'accès sont dans src/lib/db/policies.ts et
-- s'appliquent à chaque requête de la couche de données.
-- Les clés « même club » (ancien FOREIGN KEY (club_id, x_id)) sont des triggers.
-- Retour arrière : base neuve uniquement.
-- =============================================================================

-- 0. COMPTES ---------------------------------------------------------------------
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  email_confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sign_in_at TEXT
);

-- Sessions : seule l'empreinte SHA-256 du jeton est stockée.
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);

-- Liens de connexion à usage unique (empreinte uniquement, durée courte).
CREATE TABLE auth_login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  create_user INTEGER NOT NULL DEFAULT 0 CHECK (create_user IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX auth_login_tokens_email_idx ON auth_login_tokens(email, created_at);

-- Limitation des demandes (connexion, formulaires publics) par clé et fenêtre.
CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  window_start TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (bucket, window_start)
);

-- 1. OFFRES -----------------------------------------------------------------------
CREATE TABLE membership_tiers (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40 AND id NOT GLOB '*[^a-z0-9-]*'),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  min_members INTEGER NOT NULL CHECK (min_members >= 0),
  max_members INTEGER CHECK (max_members IS NULL OR max_members >= min_members),
  monthly_cents INTEGER CHECK (monthly_cents IS NULL OR monthly_cents >= 0),
  stripe_price_id TEXT CHECK (stripe_price_id IS NULL OR (stripe_price_id GLOB 'price_*' AND substr(stripe_price_id, 7) NOT GLOB '*[^A-Za-z0-9]*')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
INSERT INTO membership_tiers (id, name, min_members, max_members) VALUES
  ('essentiel','Essentiel',0,100),('collectif','Collectif',101,300),('elan','Élan',301,700),('sur-mesure','Sur mesure',701,NULL);

-- 2. CLUBS ------------------------------------------------------------------------
CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 50 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT GLOB '-*' AND slug NOT GLOB '*-'),
  custom_domain TEXT UNIQUE CHECK (custom_domain IS NULL OR (custom_domain GLOB '*.[a-z][a-z]*' AND custom_domain NOT GLOB '*[^a-z0-9.-]*')),
  sport_type TEXT NOT NULL DEFAULT 'football',
  theme_preset TEXT NOT NULL DEFAULT 'stadium',
  primary_color TEXT NOT NULL DEFAULT '#1E40AF' CHECK (length(primary_color) = 7 AND substr(primary_color, 1, 1) = '#' AND lower(substr(primary_color, 2)) NOT GLOB '*[^0-9a-f]*'),
  secondary_color TEXT NOT NULL DEFAULT '#FBBF24' CHECK (length(secondary_color) = 7 AND substr(secondary_color, 1, 1) = '#' AND lower(substr(secondary_color, 2)) NOT GLOB '*[^0-9a-f]*'),
  logo_url TEXT,
  hero_image_url TEXT,
  club_history_text TEXT,
  president_word_text TEXT,
  president_name TEXT,
  president_signature_url TEXT,
  rna_number TEXT,
  siret_number TEXT,
  federation_name TEXT,
  affiliation_number TEXT,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  nearby_cities TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(nearby_cities) AND json_type(nearby_cities) = 'array'),
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  social_links TEXT NOT NULL DEFAULT '{"facebook":"","instagram":"","whatsapp":""}' CHECK (json_valid(social_links)),
  sibling_discount_rules TEXT NOT NULL DEFAULT '{"enabled":true,"second_member_discount":20,"third_member_discount":40,"discount_type":"fixed_euros"}' CHECK (json_valid(sibling_discount_rules)),
  accepts_pass_sport INTEGER NOT NULL DEFAULT 1 CHECK (accepts_pass_sport IN (0,1)),
  pass_sport_amount REAL NOT NULL DEFAULT 50 CHECK (pass_sport_amount >= 0),
  accepts_caf_aids INTEGER NOT NULL DEFAULT 1 CHECK (accepts_caf_aids IN (0,1)),
  accepts_installments INTEGER NOT NULL DEFAULT 1 CHECK (accepts_installments IN (0,1)),
  pass_stripe_fees_to_parents INTEGER NOT NULL DEFAULT 0 CHECK (pass_stripe_fees_to_parents IN (0,1)),
  enabled_modules TEXT NOT NULL DEFAULT '{"vitrine":true,"inscriptions":true,"trials":true,"payments":true,"boutique":true,"attendance":true,"sponsors":true,"social_generator":true}' CHECK (json_valid(enabled_modules)),
  email_provider TEXT NOT NULL DEFAULT 'platform' CHECK (email_provider IN ('platform','gmail','smtp')),
  email_sender_address TEXT,
  status TEXT NOT NULL DEFAULT 'demo' CHECK (status IN ('demo','active','suspended','archived')),
  demo_expires_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+14 days')),
  subscription_plan TEXT NOT NULL DEFAULT 'integral' CHECK (subscription_plan IN ('vitrine','integral')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_connect_account_id TEXT,
  stripe_connect_onboarded INTEGER NOT NULL DEFAULT 0 CHECK (stripe_connect_onboarded IN (0,1)),
  current_season TEXT NOT NULL DEFAULT '2026-2027' CHECK (current_season GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'),
  declared_member_count INTEGER NOT NULL DEFAULT 0 CHECK (declared_member_count BETWEEN 0 AND 1000000),
  membership_tier_id TEXT REFERENCES membership_tiers(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Projection publique : ni facturation, ni signature, ni réglages d'envoi.
CREATE VIEW public_clubs AS
SELECT id, name, slug, custom_domain, sport_type, theme_preset, primary_color, secondary_color, logo_url, hero_image_url,
  club_history_text, president_word_text, president_name, NULL AS president_signature_url, rna_number, siret_number,
  federation_name, affiliation_number, city, postal_code, nearby_cities, contact_email, contact_phone, social_links,
  sibling_discount_rules, accepts_pass_sport, pass_sport_amount, accepts_caf_aids, accepts_installments,
  pass_stripe_fees_to_parents, enabled_modules, 'platform' AS email_provider, NULL AS email_sender_address, status,
  demo_expires_at, 'integral' AS subscription_plan, NULL AS stripe_customer_id, NULL AS stripe_subscription_id,
  NULL AS stripe_connect_account_id, stripe_connect_onboarded, current_season, created_at,
  0 AS declared_member_count, NULL AS membership_tier_id
FROM clubs
WHERE status = 'active' OR (status = 'demo' AND (demo_expires_at IS NULL OR demo_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')));

-- Identifiants d'envoi chiffrés (AES-256-GCM) : jamais lisibles hors service.
CREATE TABLE club_mail_credentials (
  club_id TEXT PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  google_refresh_token_enc TEXT,
  google_account_email TEXT,
  smtp_settings_enc TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 3. EQUIPE -----------------------------------------------------------------------
CREATE TABLE staff_members (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  club_id TEXT REFERENCES clubs(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin','president','secretary','treasurer','coach')),
  assigned_category_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_category_ids) AND json_type(assigned_category_ids) = 'array'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK ((role = 'super_admin') = (club_id IS NULL))
);
-- SQLite traite NULL comme distinct : cet index couvre les rôles de club, le suivant le rôle plateforme.
CREATE UNIQUE INDEX staff_members_user_club_uq ON staff_members(user_id, club_id);
CREATE UNIQUE INDEX staff_members_user_platform_uq ON staff_members(user_id) WHERE club_id IS NULL;
CREATE INDEX staff_members_club_idx ON staff_members(club_id);

-- 4. INFRASTRUCTURES, CATEGORIES, CRENEAUX, BOUTIQUE ---------------------------------
CREATE TABLE facilities (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  google_maps_url TEXT
);
CREATE INDEX facilities_club_idx ON facilities(club_id);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  min_birth_year INTEGER NOT NULL,
  max_birth_year INTEGER NOT NULL,
  gender_filter TEXT NOT NULL DEFAULT 'mixed' CHECK (gender_filter IN ('mixed','M','F')),
  annual_price REAL NOT NULL CHECK (annual_price >= 0),
  max_capacity INTEGER NOT NULL DEFAULT 35 CHECK (max_capacity > 0),
  medical_requirement TEXT NOT NULL DEFAULT 'health_questionnaire'
    CHECK (medical_requirement IN ('health_questionnaire','medical_cert_standard','medical_cert_competition')),
  coach_name TEXT,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  CHECK (min_birth_year <= max_birth_year)
);
CREATE INDEX categories_club_idx ON categories(club_id, display_order);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  facility_id TEXT REFERENCES facilities(id) ON DELETE SET NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]*'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]*'),
  CHECK (start_time < end_time)
);
CREATE INDEX schedules_club_idx ON schedules(club_id, day_of_week, start_time);
CREATE INDEX schedules_category_idx ON schedules(category_id);

CREATE TABLE club_products (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL CHECK (price >= 0),
  available_sizes TEXT NOT NULL DEFAULT '["6 ans","8 ans","10 ans","12 ans","S","M","L"]' CHECK (json_valid(available_sizes)),
  photo_url TEXT
);
CREATE INDEX club_products_club_idx ON club_products(club_id);

-- 5. DOSSIERS, ECHEANCES, MEMBRES ---------------------------------------------------
CREATE TABLE family_registrations (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  season TEXT NOT NULL,
  is_adult_self_registration INTEGER NOT NULL DEFAULT 0 CHECK (is_adult_self_registration IN (0,1)),
  payer_first_name TEXT NOT NULL,
  payer_last_name TEXT NOT NULL,
  payer_email TEXT NOT NULL,
  payer_phone TEXT NOT NULL,
  emergency_contact_name TEXT NOT NULL,
  emergency_contact_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  licenses_subtotal REAL NOT NULL DEFAULT 0,
  products_subtotal REAL NOT NULL DEFAULT 0,
  sibling_discount_amount REAL NOT NULL DEFAULT 0,
  aids_deduction_amount REAL NOT NULL DEFAULT 0,
  stripe_fee_added REAL NOT NULL DEFAULT 0,
  final_total_amount REAL NOT NULL DEFAULT 0 CHECK (final_total_amount >= 0),
  amount_paid REAL NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','partial','paid','refunded')),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('card','check','cash','transfer','pass_sport','mixed')),
  stripe_checkout_session_id TEXT UNIQUE,
  invoice_number TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (club_id, invoice_number)
);
CREATE INDEX family_registrations_club_idx ON family_registrations(club_id, season, created_at DESC);
CREATE INDEX family_registrations_email_idx ON family_registrations(lower(payer_email));

CREATE TABLE payment_installments (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES family_registrations(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('card','check','cash','transfer','pass_sport','caf','other_aid')),
  check_number TEXT,
  scheduled_deposit_date TEXT NOT NULL DEFAULT (date('now')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deposited','cashed','rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX payment_installments_club_idx ON payment_installments(club_id, scheduled_deposit_date);
CREATE INDEX payment_installments_family_idx ON payment_installments(family_id);

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  family_id TEXT REFERENCES family_registrations(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  season TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  is_minor INTEGER NOT NULL DEFAULT 1 CHECK (is_minor IN (0,1)),
  gender TEXT NOT NULL DEFAULT 'M' CHECK (gender IN ('M','F','X')),
  photo_storage_path TEXT,
  medical_doc_storage_path TEXT,
  id_doc_storage_path TEXT,
  health_questionnaire_passed INTEGER NOT NULL DEFAULT 0 CHECK (health_questionnaire_passed IN (0,1)),
  pass_sport_code TEXT,
  pass_sport_verified INTEGER NOT NULL DEFAULT 0 CHECK (pass_sport_verified IN (0,1)),
  consent_image_rights INTEGER NOT NULL DEFAULT 0 CHECK (consent_image_rights IN (0,1)),
  consent_emergency_medical INTEGER NOT NULL DEFAULT 1 CHECK (consent_emergency_medical IN (0,1)),
  consent_autonomous_exit INTEGER NOT NULL DEFAULT 0 CHECK (consent_autonomous_exit IN (0,1)),
  signature_data_url TEXT,
  registration_type TEXT NOT NULL DEFAULT 'full' CHECK (registration_type IN ('full','trial','renewal','import')),
  dossier_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (dossier_status IN ('pending_review','needs_correction','validated','rejected','trial_requested','trial_done')),
  rejection_reason TEXT,
  magic_action_token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX members_club_idx ON members(club_id, season, dossier_status);
CREATE INDEX members_family_idx ON members(family_id);
CREATE INDEX members_category_idx ON members(category_id);

-- Vue de la feuille d'appel : le filtre par entraîneur est appliqué par policies.ts.
CREATE VIEW coach_roster AS
SELECT id, club_id, family_id, category_id, season, first_name, last_name, is_minor, consent_autonomous_exit, dossier_status
FROM members;

CREATE VIEW coach_contacts AS
SELECT id, club_id, season, emergency_contact_name, emergency_contact_phone
FROM family_registrations;

CREATE TABLE member_product_orders (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES club_products(id) ON DELETE CASCADE,
  selected_size TEXT NOT NULL,
  price_at_order REAL NOT NULL CHECK (price_at_order >= 0),
  delivery_status TEXT NOT NULL DEFAULT 'to_order' CHECK (delivery_status IN ('to_order','ordered','received','delivered')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX member_product_orders_club_idx ON member_product_orders(club_id, delivery_status);

CREATE TABLE attendances (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  schedule_id TEXT NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL DEFAULT (date('now')),
  is_present INTEGER NOT NULL DEFAULT 1 CHECK (is_present IN (0,1)),
  UNIQUE (schedule_id, member_id, session_date)
);
CREATE INDEX attendances_club_idx ON attendances(club_id, session_date);

-- 6. EVENEMENTS ---------------------------------------------------------------------
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('competition','tournament','training_camp','club_event','meeting')),
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,
  location_text TEXT,
  is_home INTEGER NOT NULL DEFAULT 1 CHECK (is_home IN (0,1)),
  score_club INTEGER,
  score_opponent INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX events_club_idx ON events(club_id, event_date);

CREATE TABLE event_convocations (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  response_status TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending','present','absent')),
  response_token TEXT NOT NULL UNIQUE,
  UNIQUE (event_id, member_id)
);
CREATE INDEX event_convocations_club_idx ON event_convocations(club_id);

-- 7. CONTENUS -----------------------------------------------------------------------
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL CHECK (length(slug) BETWEEN 1 AND 100 AND slug NOT GLOB '*[^a-z0-9-]*'),
  content TEXT NOT NULL,
  cover_image_url TEXT,
  is_published INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1)),
  published_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (club_id, slug)
);
CREATE INDEX posts_club_idx ON posts(club_id, published_at DESC);

CREATE TABLE sponsors (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  logo_url TEXT NOT NULL,
  website_url TEXT,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sponsors_club_idx ON sponsors(club_id, display_order);

CREATE TABLE sponsor_leads (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  estimated_budget TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','won','lost')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX sponsor_leads_club_idx ON sponsor_leads(club_id, created_at DESC);

CREATE TABLE anonymous_page_views (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  view_month TEXT NOT NULL CHECK (view_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  page_path TEXT NOT NULL CHECK (length(page_path) <= 200),
  views_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (club_id, view_month, page_path)
);

CREATE TABLE club_requests (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('private_lesson','contact')),
  first_name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX club_requests_club_idx ON club_requests(club_id, created_at DESC);

CREATE TABLE club_gallery (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  image_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (club_id, id)
);
CREATE INDEX club_gallery_club_idx ON club_gallery(club_id, created_at DESC);

CREATE TABLE club_site_settings (
  club_id TEXT PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  sections TEXT NOT NULL DEFAULT '["hero","numbers","practice","story","events","news","sponsors"]'
    CHECK (json_valid(sections) AND json_type(sections) = 'array' AND json_array_length(sections) BETWEEN 1 AND 7)
);

CREATE TABLE club_site_media (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  section TEXT NOT NULL CHECK (section IN ('hero','practice','story','events','news')),
  stock_id TEXT CHECK (stock_id IS NULL OR (length(stock_id) BETWEEN 1 AND 12 AND stock_id NOT GLOB '*[^0-9]*')),
  photo_id TEXT,
  PRIMARY KEY (club_id, section),
  CHECK ((stock_id IS NULL) + (photo_id IS NULL) = 1),
  FOREIGN KEY (club_id, photo_id) REFERENCES club_gallery(club_id, id) ON DELETE CASCADE
);

-- 8. ESPACE FAMILLE ------------------------------------------------------------------
CREATE TABLE family_access (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  family_id TEXT NOT NULL REFERENCES family_registrations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (family_id, user_id)
);
CREATE INDEX family_access_user_idx ON family_access(user_id, club_id);

-- 9. PLATEFORME ----------------------------------------------------------------------
CREATE TABLE saas_prospects (
  id TEXT PRIMARY KEY,
  club_name TEXT NOT NULL,
  sport_type TEXT NOT NULL,
  city TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead','contacted','demo','quote_sent','won','lost')),
  demo_club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  quote_number TEXT,
  member_count INTEGER NOT NULL DEFAULT 0 CHECK (member_count BETWEEN 0 AND 1000000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE platform_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL,
  actor_id TEXT REFERENCES auth_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  object_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_events_club_idx ON audit_events(club_id, created_at DESC);

-- =============================================================================
-- COHERENCE « MEME CLUB » : une ligne ne référence jamais l'objet d'un autre club.
-- =============================================================================
CREATE TRIGGER members_tenant_ins BEFORE INSERT ON members
WHEN (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM family_registrations WHERE id = NEW.family_id AND club_id = NEW.club_id))
  OR (NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND club_id = NEW.club_id))
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER members_tenant_upd BEFORE UPDATE OF club_id, family_id, category_id ON members
WHEN (NEW.family_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM family_registrations WHERE id = NEW.family_id AND club_id = NEW.club_id))
  OR (NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND club_id = NEW.club_id))
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER schedules_tenant_ins BEFORE INSERT ON schedules
WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND club_id = NEW.club_id)
  OR (NEW.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM facilities WHERE id = NEW.facility_id AND club_id = NEW.club_id))
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER schedules_tenant_upd BEFORE UPDATE OF club_id, category_id, facility_id ON schedules
WHEN NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND club_id = NEW.club_id)
  OR (NEW.facility_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM facilities WHERE id = NEW.facility_id AND club_id = NEW.club_id))
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER installments_tenant_ins BEFORE INSERT ON payment_installments
WHEN NOT EXISTS (SELECT 1 FROM family_registrations WHERE id = NEW.family_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER installments_tenant_upd BEFORE UPDATE OF club_id, family_id ON payment_installments
WHEN NOT EXISTS (SELECT 1 FROM family_registrations WHERE id = NEW.family_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER attendances_tenant_ins BEFORE INSERT ON attendances
WHEN NOT EXISTS (SELECT 1 FROM schedules WHERE id = NEW.schedule_id AND club_id = NEW.club_id)
  OR NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER attendances_tenant_upd BEFORE UPDATE OF club_id, schedule_id, member_id ON attendances
WHEN NOT EXISTS (SELECT 1 FROM schedules WHERE id = NEW.schedule_id AND club_id = NEW.club_id)
  OR NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER events_tenant_ins BEFORE INSERT ON events
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER events_tenant_upd BEFORE UPDATE OF club_id, category_id ON events
WHEN NEW.category_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER convocations_tenant_ins BEFORE INSERT ON event_convocations
WHEN NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND club_id = NEW.club_id)
  OR NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER convocations_tenant_upd BEFORE UPDATE OF club_id, event_id, member_id ON event_convocations
WHEN NOT EXISTS (SELECT 1 FROM events WHERE id = NEW.event_id AND club_id = NEW.club_id)
  OR NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER orders_tenant_ins BEFORE INSERT ON member_product_orders
WHEN NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND club_id = NEW.club_id)
  OR NOT EXISTS (SELECT 1 FROM club_products WHERE id = NEW.product_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
CREATE TRIGGER orders_tenant_upd BEFORE UPDATE OF club_id, member_id, product_id ON member_product_orders
WHEN NOT EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND club_id = NEW.club_id)
  OR NOT EXISTS (SELECT 1 FROM club_products WHERE id = NEW.product_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;

CREATE TRIGGER family_access_tenant_ins BEFORE INSERT ON family_access
WHEN NOT EXISTS (SELECT 1 FROM family_registrations WHERE id = NEW.family_id AND club_id = NEW.club_id)
BEGIN SELECT RAISE(ABORT, 'tenant_mismatch'); END;
