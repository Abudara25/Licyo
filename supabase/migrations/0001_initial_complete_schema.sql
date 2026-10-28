-- =============================================================================
-- Licyo : schéma initial complet (tables, index, fonctions, RLS, stockage)
-- Retour arrière : base neuve uniquement (DROP SCHEMA public CASCADE puis recréation).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. CLUBS (TENANTS) ----------------------------------------------------------
-- Les secrets d'envoi d'e-mail ne sont PAS ici (table lisible publiquement) :
-- voir club_mail_credentials.
CREATE TABLE public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  slug TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'),
  custom_domain TEXT UNIQUE CHECK (custom_domain IS NULL OR custom_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  sport_type TEXT NOT NULL DEFAULT 'football',
  theme_preset TEXT NOT NULL DEFAULT 'stadium',
  primary_color TEXT NOT NULL DEFAULT '#1E40AF' CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color TEXT NOT NULL DEFAULT '#FBBF24' CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
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
  nearby_cities TEXT[] NOT NULL DEFAULT '{}',
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  social_links JSONB NOT NULL DEFAULT '{"facebook": "", "instagram": "", "whatsapp": ""}',
  sibling_discount_rules JSONB NOT NULL DEFAULT '{"enabled": true, "second_member_discount": 20, "third_member_discount": 40, "discount_type": "fixed_euros"}',
  accepts_pass_sport BOOLEAN NOT NULL DEFAULT true,
  pass_sport_amount NUMERIC(10,2) NOT NULL DEFAULT 50.00 CHECK (pass_sport_amount >= 0),
  accepts_caf_aids BOOLEAN NOT NULL DEFAULT true,
  accepts_installments BOOLEAN NOT NULL DEFAULT true,
  pass_stripe_fees_to_parents BOOLEAN NOT NULL DEFAULT true,
  enabled_modules JSONB NOT NULL DEFAULT '{"vitrine": true, "inscriptions": true, "trials": true, "payments": true, "boutique": true, "attendance": true, "sponsors": true, "social_generator": true}',
  email_provider TEXT NOT NULL DEFAULT 'platform' CHECK (email_provider IN ('platform', 'gmail', 'smtp')),
  email_sender_address TEXT,
  status TEXT NOT NULL DEFAULT 'demo' CHECK (status IN ('demo', 'active', 'suspended', 'archived')),
  demo_expires_at TIMESTAMPTZ DEFAULT (now() + interval '14 days'),
  subscription_plan TEXT NOT NULL DEFAULT 'integral' CHECK (subscription_plan IN ('vitrine', 'integral')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_connect_account_id TEXT,
  stripe_connect_onboarded BOOLEAN NOT NULL DEFAULT false,
  current_season TEXT NOT NULL DEFAULT '2026-2027' CHECK (current_season ~ '^\d{4}-\d{4}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identifiants d'envoi d'e-mail, chiffrés côté application (AES-256-GCM).
-- RLS activée SANS politique : accessible uniquement au service role.
CREATE TABLE public.club_mail_credentials (
  club_id UUID PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  google_refresh_token_enc TEXT,
  google_account_email TEXT,
  smtp_settings_enc TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. STAFF ------------------------------------------------------------------------
CREATE TABLE public.staff_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'president', 'secretary', 'treasurer', 'coach')),
  assigned_category_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un super_admin n'est rattaché à aucun club, un membre de club l'est toujours.
  CHECK ((role = 'super_admin') = (club_id IS NULL)),
  -- NULLS NOT DISTINCT : un seul rôle super_admin (club_id NULL) par utilisateur.
  UNIQUE NULLS NOT DISTINCT (user_id, club_id)
);
CREATE INDEX staff_members_user_idx ON public.staff_members(user_id);
CREATE INDEX staff_members_club_idx ON public.staff_members(club_id);

-- 3. INFRASTRUCTURES ----------------------------------------------------------------
CREATE TABLE public.facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  google_maps_url TEXT
);
CREATE INDEX facilities_club_idx ON public.facilities(club_id);

-- 4. CATEGORIES -------------------------------------------------------------------
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  min_birth_year INT NOT NULL,
  max_birth_year INT NOT NULL,
  gender_filter TEXT NOT NULL DEFAULT 'mixed' CHECK (gender_filter IN ('mixed', 'M', 'F')),
  annual_price NUMERIC(10,2) NOT NULL CHECK (annual_price >= 0),
  max_capacity INT NOT NULL DEFAULT 35 CHECK (max_capacity > 0),
  medical_requirement TEXT NOT NULL DEFAULT 'health_questionnaire'
    CHECK (medical_requirement IN ('health_questionnaire', 'medical_cert_standard', 'medical_cert_competition')),
  coach_name TEXT,
  description TEXT,
  display_order INT NOT NULL DEFAULT 0,
  CHECK (min_birth_year <= max_birth_year)
);
CREATE INDEX categories_club_idx ON public.categories(club_id, display_order);

-- 5. CRENEAUX ---------------------------------------------------------------------
CREATE TABLE public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
  facility_id UUID REFERENCES public.facilities(id) ON DELETE SET NULL,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1 = lundi (ISO)
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (start_time < end_time)
);
CREATE INDEX schedules_club_idx ON public.schedules(club_id, day_of_week, start_time);
CREATE INDEX schedules_category_idx ON public.schedules(category_id);

-- 6. BOUTIQUE ---------------------------------------------------------------------
CREATE TABLE public.club_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  available_sizes TEXT[] NOT NULL DEFAULT '{"6 ans", "8 ans", "10 ans", "12 ans", "S", "M", "L"}',
  photo_url TEXT
);
CREATE INDEX club_products_club_idx ON public.club_products(club_id);

-- 7. DOSSIERS FAMILLES ------------------------------------------------------------
CREATE TABLE public.family_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  season TEXT NOT NULL,
  is_adult_self_registration BOOLEAN NOT NULL DEFAULT false,
  payer_first_name TEXT NOT NULL,
  payer_last_name TEXT NOT NULL,
  payer_email TEXT NOT NULL,
  payer_phone TEXT NOT NULL,
  emergency_contact_name TEXT NOT NULL,
  emergency_contact_phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  licenses_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  products_subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  sibling_discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  aids_deduction_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  stripe_fee_added NUMERIC(10,2) NOT NULL DEFAULT 0,
  final_total_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (final_total_amount >= 0),
  amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid', 'refunded')),
  payment_method TEXT CHECK (payment_method IS NULL OR payment_method IN ('card', 'check', 'cash', 'transfer', 'pass_sport', 'mixed')),
  stripe_checkout_session_id TEXT UNIQUE,
  invoice_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, invoice_number)
);
CREATE INDEX family_registrations_club_idx ON public.family_registrations(club_id, season, created_at DESC);

-- 8. ECHEANCIER (CHEQUES DIFFERES, ESPECES, VIREMENTS) -----------------------------
CREATE TABLE public.payment_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  family_id UUID REFERENCES public.family_registrations(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('card', 'check', 'cash', 'transfer', 'pass_sport', 'caf', 'other_aid')),
  check_number TEXT,
  scheduled_deposit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'deposited', 'cashed', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_installments_club_idx ON public.payment_installments(club_id, scheduled_deposit_date);
CREATE INDEX payment_installments_family_idx ON public.payment_installments(family_id);

-- 9. MEMBRES ----------------------------------------------------------------------
CREATE TABLE public.members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  family_id UUID REFERENCES public.family_registrations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  season TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  birth_date DATE NOT NULL,
  is_minor BOOLEAN NOT NULL DEFAULT true,
  gender TEXT NOT NULL DEFAULT 'M' CHECK (gender IN ('M', 'F', 'X')),
  photo_storage_path TEXT,
  medical_doc_storage_path TEXT,
  id_doc_storage_path TEXT,
  health_questionnaire_passed BOOLEAN NOT NULL DEFAULT false,
  pass_sport_code TEXT,
  pass_sport_verified BOOLEAN NOT NULL DEFAULT false,
  consent_image_rights BOOLEAN NOT NULL DEFAULT false,
  consent_emergency_medical BOOLEAN NOT NULL DEFAULT true,
  consent_autonomous_exit BOOLEAN NOT NULL DEFAULT false,
  signature_data_url TEXT,
  registration_type TEXT NOT NULL DEFAULT 'full' CHECK (registration_type IN ('full', 'trial', 'renewal', 'import')),
  dossier_status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (dossier_status IN ('pending_review', 'needs_correction', 'validated', 'rejected', 'trial_requested', 'trial_done')),
  rejection_reason TEXT,
  magic_action_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX members_club_idx ON public.members(club_id, season, dossier_status);
CREATE INDEX members_family_idx ON public.members(family_id);
CREATE INDEX members_category_idx ON public.members(category_id);

-- 10. COMMANDES D'EQUIPEMENTS -------------------------------------------------------
CREATE TABLE public.member_product_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES public.members(id) ON DELETE CASCADE NOT NULL,
  product_id UUID REFERENCES public.club_products(id) ON DELETE CASCADE NOT NULL,
  selected_size TEXT NOT NULL,
  price_at_order NUMERIC(10,2) NOT NULL CHECK (price_at_order >= 0),
  delivery_status TEXT NOT NULL DEFAULT 'to_order' CHECK (delivery_status IN ('to_order', 'ordered', 'received', 'delivered')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX member_product_orders_club_idx ON public.member_product_orders(club_id, delivery_status);

-- 11. FEUILLES D'APPEL --------------------------------------------------------------
CREATE TABLE public.attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  schedule_id UUID REFERENCES public.schedules(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES public.members(id) ON DELETE CASCADE NOT NULL,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  is_present BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (schedule_id, member_id, session_date)
);
CREATE INDEX attendances_club_idx ON public.attendances(club_id, session_date);

-- 12. EVENEMENTS ------------------------------------------------------------------
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('competition', 'tournament', 'training_camp', 'club_event', 'meeting')),
  title TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  location_text TEXT,
  is_home BOOLEAN NOT NULL DEFAULT true,
  score_club INT,
  score_opponent INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_club_idx ON public.events(club_id, event_date);

CREATE TABLE public.event_convocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE CASCADE NOT NULL,
  member_id UUID REFERENCES public.members(id) ON DELETE CASCADE NOT NULL,
  response_status TEXT NOT NULL DEFAULT 'pending' CHECK (response_status IN ('pending', 'present', 'absent')),
  response_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  UNIQUE (event_id, member_id)
);
CREATE INDEX event_convocations_club_idx ON public.event_convocations(club_id);

-- 13. ACTUALITES ------------------------------------------------------------------
CREATE TABLE public.posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL CHECK (slug ~ '^[a-z0-9-]{1,100}$'),
  content TEXT NOT NULL,
  cover_image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (club_id, slug)
);
CREATE INDEX posts_club_idx ON public.posts(club_id, published_at DESC);

-- 14. PARTENAIRES -----------------------------------------------------------------
CREATE TABLE public.sponsors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  company_name TEXT NOT NULL,
  logo_url TEXT NOT NULL,
  website_url TEXT,
  description TEXT,
  display_order INT NOT NULL DEFAULT 0
);
CREATE INDEX sponsors_club_idx ON public.sponsors(club_id, display_order);

CREATE TABLE public.sponsor_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  estimated_budget TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'won', 'lost')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sponsor_leads_club_idx ON public.sponsor_leads(club_id, created_at DESC);

-- 15. AUDIENCE ANONYME SANS COOKIE --------------------------------------------------
CREATE TABLE public.anonymous_page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID REFERENCES public.clubs(id) ON DELETE CASCADE NOT NULL,
  view_month TEXT NOT NULL CHECK (view_month ~ '^\d{4}-\d{2}$'),
  page_path TEXT NOT NULL CHECK (char_length(page_path) <= 200),
  views_count INT NOT NULL DEFAULT 1,
  UNIQUE (club_id, view_month, page_path)
);

-- 16. SUPER-ADMIN (CRM & ANNONCES) --------------------------------------------------
CREATE TABLE public.saas_prospects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_name TEXT NOT NULL,
  sport_type TEXT NOT NULL,
  city TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  stage TEXT NOT NULL DEFAULT 'lead' CHECK (stage IN ('lead', 'contacted', 'demo', 'quote_sent', 'won', 'lost')),
  demo_club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  quote_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- FONCTIONS HELPER RLS (SECURITY DEFINER = pas de récursion sur staff_members)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_members WHERE user_id = auth.uid() AND role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public.get_my_club_ids() RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT club_id FROM public.staff_members WHERE user_id = auth.uid() AND club_id IS NOT NULL;
$$;

-- Vrai si l'utilisateur a l'un des rôles donnés dans ce club (ou est super_admin).
CREATE OR REPLACE FUNCTION public.has_club_role(target_club UUID, allowed_roles TEXT[]) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_super_admin() OR EXISTS (
    SELECT 1 FROM public.staff_members
    WHERE user_id = auth.uid() AND club_id = target_club AND role = ANY(allowed_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_club_staff(target_club UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_club_role(target_club, ARRAY['president', 'secretary', 'treasurer', 'coach']);
$$;

CREATE OR REPLACE FUNCTION public.is_club_manager(target_club UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_club_role(target_club, ARRAY['president', 'secretary', 'treasurer']);
$$;

-- Un site est public tant que le club est actif, ou en démo non expirée.
CREATE OR REPLACE FUNCTION public.is_public_club(target_club UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clubs
    WHERE id = target_club
      AND (status = 'active' OR (status = 'demo' AND (demo_expires_at IS NULL OR demo_expires_at > now())))
  );
$$;

-- Compteur d'audience : seul point d'écriture anonyme, borné et sans donnée personnelle.
CREATE OR REPLACE FUNCTION public.increment_page_view(target_club UUID, path TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_public_club(target_club) THEN RETURN; END IF;
  INSERT INTO public.anonymous_page_views (club_id, view_month, page_path)
  VALUES (target_club, to_char(now(), 'YYYY-MM'), left(coalesce(path, '/'), 200))
  ON CONFLICT (club_id, view_month, page_path)
  DO UPDATE SET views_count = public.anonymous_page_views.views_count + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_page_view(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_page_view(UUID, TEXT) TO anon, authenticated;

-- =============================================================================
-- ACTIVATION RLS
-- =============================================================================
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_mail_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_product_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_convocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsor_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anonymous_page_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- POLITIQUES
-- Les formulaires publics (inscription, essai, partenaires) n'ont AUCUN droit
-- d'insertion anonyme : ils passent par des Server Actions qui valident et
-- recalculent côté serveur avant d'écrire avec le service role.
-- =============================================================================

-- clubs
CREATE POLICY clubs_public_read ON public.clubs FOR SELECT
  USING (public.is_public_club(id));
CREATE POLICY clubs_staff_read ON public.clubs FOR SELECT TO authenticated
  USING (public.is_club_staff(id));
CREATE POLICY clubs_manager_update ON public.clubs FOR UPDATE TO authenticated
  USING (public.is_club_manager(id)) WITH CHECK (public.is_club_manager(id));
CREATE POLICY clubs_super_admin_all ON public.clubs FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- staff_members : chacun voit sa fiche et celles de son club ; seul le président
-- (ou le super_admin) gère l'équipe, et personne ne peut s'octroyer super_admin.
CREATE POLICY staff_self_read ON public.staff_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_club_staff(club_id));
CREATE POLICY staff_president_write ON public.staff_members FOR ALL TO authenticated
  USING (club_id IS NOT NULL AND public.has_club_role(club_id, ARRAY['president']))
  WITH CHECK (club_id IS NOT NULL AND role <> 'super_admin' AND public.has_club_role(club_id, ARRAY['president']));
CREATE POLICY staff_super_admin_all ON public.staff_members FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Contenu public de la vitrine : lecture publique, écriture par le bureau.
CREATE POLICY facilities_public_read ON public.facilities FOR SELECT USING (public.is_public_club(club_id) OR public.is_club_staff(club_id));
CREATE POLICY facilities_manager_write ON public.facilities FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY categories_public_read ON public.categories FOR SELECT USING (public.is_public_club(club_id) OR public.is_club_staff(club_id));
CREATE POLICY categories_manager_write ON public.categories FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY schedules_public_read ON public.schedules FOR SELECT USING (public.is_public_club(club_id) OR public.is_club_staff(club_id));
CREATE POLICY schedules_manager_write ON public.schedules FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY club_products_public_read ON public.club_products FOR SELECT USING (public.is_public_club(club_id) OR public.is_club_staff(club_id));
CREATE POLICY club_products_manager_write ON public.club_products FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY posts_public_read ON public.posts FOR SELECT
  USING ((is_published AND published_at <= now() AND public.is_public_club(club_id)) OR public.is_club_staff(club_id));
CREATE POLICY posts_manager_write ON public.posts FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY sponsors_public_read ON public.sponsors FOR SELECT USING (public.is_public_club(club_id) OR public.is_club_staff(club_id));
CREATE POLICY sponsors_manager_write ON public.sponsors FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

-- Événements : publics (calendrier, résultats), éditables par tout le staff (coachs compris).
CREATE POLICY events_public_read ON public.events FOR SELECT USING (public.is_public_club(club_id) OR public.is_club_staff(club_id));
CREATE POLICY events_staff_write ON public.events FOR ALL TO authenticated
  USING (public.is_club_staff(club_id)) WITH CHECK (public.is_club_staff(club_id));

-- Données personnelles et financières : staff uniquement.
CREATE POLICY members_staff_read ON public.members FOR SELECT TO authenticated USING (public.is_club_staff(club_id));
CREATE POLICY members_manager_write ON public.members FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY family_registrations_manager_all ON public.family_registrations FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));
-- Les coachs voient le contact d'urgence de leurs licenciés (feuille d'appel).
CREATE POLICY family_registrations_coach_read ON public.family_registrations FOR SELECT TO authenticated
  USING (public.is_club_staff(club_id));

CREATE POLICY payment_installments_manager_all ON public.payment_installments FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY member_product_orders_manager_all ON public.member_product_orders FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY attendances_staff_all ON public.attendances FOR ALL TO authenticated
  USING (public.is_club_staff(club_id)) WITH CHECK (public.is_club_staff(club_id));

CREATE POLICY event_convocations_staff_all ON public.event_convocations FOR ALL TO authenticated
  USING (public.is_club_staff(club_id)) WITH CHECK (public.is_club_staff(club_id));

CREATE POLICY sponsor_leads_manager_all ON public.sponsor_leads FOR ALL TO authenticated
  USING (public.is_club_manager(club_id)) WITH CHECK (public.is_club_manager(club_id));

CREATE POLICY page_views_staff_read ON public.anonymous_page_views FOR SELECT TO authenticated
  USING (public.is_club_staff(club_id));

-- Super-admin
CREATE POLICY saas_prospects_super_admin_all ON public.saas_prospects FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
CREATE POLICY announcements_read ON public.platform_announcements FOR SELECT TO authenticated
  USING (is_active OR public.is_super_admin());
CREATE POLICY announcements_super_admin_all ON public.platform_announcements FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Le super_admin a accès à toutes les tables de club (support, Mode Miroir).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities', 'categories', 'schedules', 'club_products', 'family_registrations',
    'payment_installments', 'members', 'member_product_orders', 'attendances', 'events', 'event_convocations',
    'posts', 'sponsors', 'sponsor_leads', 'anonymous_page_views']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin())',
      t || '_super_admin_all', t);
  END LOOP;
END $$;

-- =============================================================================
-- STOCKAGE
-- Chemins : <club_id>/<dossier>/<fichier>. Les pièces privées (photos, certificats,
-- justificatifs) sont déposées par le serveur et lues via URL signée courte.
-- =============================================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('club-public-assets', 'club-public-assets', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('club-private-docs', 'club-private-docs', false) ON CONFLICT DO NOTHING;

CREATE POLICY public_assets_read ON storage.objects FOR SELECT
  USING (bucket_id = 'club-public-assets');
CREATE POLICY public_assets_manager_write ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'club-public-assets' AND public.is_club_manager(((storage.foldername(name))[1])::uuid));
CREATE POLICY public_assets_manager_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'club-public-assets' AND public.is_club_manager(((storage.foldername(name))[1])::uuid));
CREATE POLICY public_assets_manager_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'club-public-assets' AND public.is_club_manager(((storage.foldername(name))[1])::uuid));

CREATE POLICY private_docs_manager_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'club-private-docs' AND public.is_club_manager(((storage.foldername(name))[1])::uuid));
CREATE POLICY private_docs_manager_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'club-private-docs' AND public.is_club_manager(((storage.foldername(name))[1])::uuid));
