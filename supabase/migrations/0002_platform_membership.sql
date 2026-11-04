-- Extension additive : offres par effectif, espace famille, modules et isolation.
-- Retour arrière : conserver les données et protections, revenir au code précédent.
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS declared_member_count INTEGER NOT NULL DEFAULT 0 CHECK (declared_member_count BETWEEN 0 AND 1000000);
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS membership_tier_id TEXT;
CREATE TABLE IF NOT EXISTS public.membership_tiers (
 id TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,40}$'),
 name TEXT NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
 min_members INTEGER NOT NULL CHECK (min_members >= 0),
 max_members INTEGER CHECK (max_members IS NULL OR max_members >= min_members),
 monthly_cents INTEGER CHECK (monthly_cents IS NULL OR monthly_cents >= 0),
 stripe_price_id TEXT CHECK (stripe_price_id IS NULL OR stripe_price_id ~ '^price_[A-Za-z0-9]+$'),
 is_active BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO public.membership_tiers (id,name,min_members,max_members) VALUES
 ('essentiel','Essentiel',0,100),('collectif','Collectif',101,300),('elan','Élan',301,700),('sur-mesure','Sur mesure',701,NULL)
ON CONFLICT DO NOTHING;
ALTER TABLE public.clubs ADD CONSTRAINT clubs_tier_fk FOREIGN KEY (membership_tier_id) REFERENCES public.membership_tiers(id);
ALTER TABLE public.membership_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tiers_read ON public.membership_tiers FOR SELECT USING (is_active OR public.is_super_admin());
CREATE POLICY tiers_manage ON public.membership_tiers FOR ALL TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE TABLE IF NOT EXISTS public.family_access (
 club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 family_id UUID NOT NULL REFERENCES public.family_registrations(id) ON DELETE CASCADE,
 user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (family_id,user_id)
);
CREATE INDEX IF NOT EXISTS family_access_user_idx ON public.family_access(user_id,club_id);
ALTER TABLE public.family_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY family_access_self ON public.family_access FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.is_super_admin());
CREATE OR REPLACE FUNCTION public.has_family_access(target_family UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.family_access WHERE family_id=target_family AND user_id=auth.uid());
$$;
-- L'adresse provient exclusivement du compte Auth confirmé. Aucune adresse fournie par le client.
CREATE OR REPLACE FUNCTION public.claim_family_access() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE verified_email TEXT;
BEGIN
 SELECT lower(email) INTO verified_email FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 IF verified_email IS NULL THEN RAISE EXCEPTION 'Adresse non confirmée'; END IF;
 INSERT INTO public.family_access(club_id,family_id,user_id)
 SELECT club_id,id,auth.uid() FROM public.family_registrations WHERE lower(payer_email)=verified_email
 ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.claim_family_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_family_access() TO authenticated;

DROP POLICY family_registrations_coach_read ON public.family_registrations;
DROP POLICY members_staff_read ON public.members;
CREATE POLICY members_manager_read ON public.members FOR SELECT TO authenticated USING (public.is_club_manager(club_id));
CREATE POLICY families_own_read ON public.family_registrations FOR SELECT TO authenticated USING (public.has_family_access(id));
CREATE POLICY members_own_read ON public.members FOR SELECT TO authenticated USING (public.has_family_access(family_id));
CREATE POLICY installments_own_read ON public.payment_installments FOR SELECT TO authenticated USING (public.has_family_access(family_id));
CREATE POLICY convocations_own_read ON public.event_convocations FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.members m WHERE m.id=member_id AND public.has_family_access(m.family_id)));

CREATE OR REPLACE FUNCTION public.can_coach_category(target_club UUID,target_category UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.is_club_manager(target_club) OR EXISTS (
 SELECT 1 FROM public.staff_members WHERE user_id=auth.uid() AND club_id=target_club AND role='coach'
 AND target_category=ANY(assigned_category_ids));
$$;
CREATE VIEW public.coach_roster WITH (security_barrier=true) AS
 SELECT id,club_id,family_id,category_id,season,first_name,last_name,is_minor,consent_autonomous_exit,dossier_status
 FROM public.members WHERE public.can_coach_category(club_id,category_id);
CREATE VIEW public.coach_contacts WITH (security_barrier=true) AS
 SELECT f.id,f.club_id,f.season,f.emergency_contact_name,f.emergency_contact_phone
 FROM public.family_registrations f WHERE public.is_club_manager(f.club_id) OR EXISTS
 (SELECT 1 FROM public.members m WHERE m.family_id=f.id AND public.can_coach_category(m.club_id,m.category_id));
GRANT SELECT ON public.coach_roster,public.coach_contacts TO authenticated;
REVOKE ALL ON public.coach_roster,public.coach_contacts FROM anon;

DROP POLICY attendances_staff_all ON public.attendances;
CREATE POLICY attendances_scoped ON public.attendances FOR ALL TO authenticated USING (
 EXISTS (SELECT 1 FROM public.schedules s WHERE s.id=schedule_id AND s.club_id=attendances.club_id AND public.can_coach_category(s.club_id,s.category_id))
) WITH CHECK (
 EXISTS (SELECT 1 FROM public.schedules s JOIN public.members m ON m.category_id=s.category_id AND m.club_id=s.club_id
 WHERE s.id=schedule_id AND m.id=member_id AND s.club_id=attendances.club_id AND public.can_coach_category(s.club_id,s.category_id))
);
DROP POLICY events_staff_write ON public.events;
CREATE POLICY events_scoped_write ON public.events FOR ALL TO authenticated
 USING (public.can_coach_category(club_id,category_id)) WITH CHECK (public.can_coach_category(club_id,category_id));
DROP POLICY event_convocations_staff_all ON public.event_convocations;
CREATE POLICY convocations_scoped_write ON public.event_convocations FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND public.can_coach_category(e.club_id,e.category_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM public.events e JOIN public.members m ON m.club_id=e.club_id
 WHERE e.id=event_id AND m.id=member_id AND e.club_id=event_convocations.club_id
 AND (e.category_id IS NULL OR m.category_id=e.category_id) AND public.can_coach_category(e.club_id,e.category_id)));

-- Les contraintes relationnelles vérifient aussi le tenant.
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['family_registrations','members','categories','facilities','schedules','events','club_products']
 LOOP EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE(club_id,id)',t,t||'_tenant_id_unique'); END LOOP;
END $$;
ALTER TABLE public.members ADD CONSTRAINT members_family_tenant_fk FOREIGN KEY(club_id,family_id) REFERENCES public.family_registrations(club_id,id);
ALTER TABLE public.members ADD CONSTRAINT members_category_tenant_fk FOREIGN KEY(club_id,category_id) REFERENCES public.categories(club_id,id);
ALTER TABLE public.schedules ADD CONSTRAINT schedules_category_tenant_fk FOREIGN KEY(club_id,category_id) REFERENCES public.categories(club_id,id);
ALTER TABLE public.schedules ADD CONSTRAINT schedules_facility_tenant_fk FOREIGN KEY(club_id,facility_id) REFERENCES public.facilities(club_id,id);
ALTER TABLE public.payment_installments ADD CONSTRAINT installments_family_tenant_fk FOREIGN KEY(club_id,family_id) REFERENCES public.family_registrations(club_id,id);
ALTER TABLE public.attendances ADD CONSTRAINT attendance_schedule_tenant_fk FOREIGN KEY(club_id,schedule_id) REFERENCES public.schedules(club_id,id);
ALTER TABLE public.attendances ADD CONSTRAINT attendance_member_tenant_fk FOREIGN KEY(club_id,member_id) REFERENCES public.members(club_id,id);
ALTER TABLE public.events ADD CONSTRAINT events_category_tenant_fk FOREIGN KEY(club_id,category_id) REFERENCES public.categories(club_id,id);
ALTER TABLE public.event_convocations ADD CONSTRAINT convocation_event_tenant_fk FOREIGN KEY(club_id,event_id) REFERENCES public.events(club_id,id);
ALTER TABLE public.event_convocations ADD CONSTRAINT convocation_member_tenant_fk FOREIGN KEY(club_id,member_id) REFERENCES public.members(club_id,id);
ALTER TABLE public.member_product_orders ADD CONSTRAINT orders_member_tenant_fk FOREIGN KEY(club_id,member_id) REFERENCES public.members(club_id,id);
ALTER TABLE public.member_product_orders ADD CONSTRAINT orders_product_tenant_fk FOREIGN KEY(club_id,product_id) REFERENCES public.club_products(club_id,id);
ALTER TABLE public.family_access ADD CONSTRAINT access_family_tenant_fk FOREIGN KEY(club_id,family_id) REFERENCES public.family_registrations(club_id,id);

-- Projection publique : aucune référence de facturation ni signature présidentielle.
DROP POLICY clubs_public_read ON public.clubs;
CREATE VIEW public.public_clubs WITH (security_barrier=true) AS
SELECT id,name,slug,custom_domain,sport_type,theme_preset,primary_color,secondary_color,logo_url,hero_image_url,
club_history_text,president_word_text,president_name,NULL::TEXT AS president_signature_url,rna_number,siret_number,
federation_name,affiliation_number,city,postal_code,nearby_cities,contact_email,contact_phone,social_links,sibling_discount_rules,
accepts_pass_sport,pass_sport_amount,accepts_caf_aids,accepts_installments,pass_stripe_fees_to_parents,enabled_modules,
'platform'::TEXT AS email_provider,NULL::TEXT AS email_sender_address,status,demo_expires_at,
'integral'::TEXT AS subscription_plan,NULL::TEXT AS stripe_customer_id,NULL::TEXT AS stripe_subscription_id,
NULL::TEXT AS stripe_connect_account_id,stripe_connect_onboarded,current_season,created_at,
0::INTEGER AS declared_member_count,NULL::TEXT AS membership_tier_id
FROM public.clubs WHERE public.is_public_club(id);
GRANT SELECT ON public.public_clubs TO anon,authenticated;

-- Les API de données ne peuvent pas modifier l'offre ou les références Stripe.
REVOKE UPDATE ON public.clubs FROM authenticated,anon;
GRANT UPDATE(name,sport_type,theme_preset,primary_color,secondary_color,logo_url,hero_image_url,club_history_text,
president_word_text,president_name,president_signature_url,rna_number,siret_number,federation_name,affiliation_number,
city,postal_code,nearby_cities,contact_email,contact_phone,social_links,sibling_discount_rules,accepts_pass_sport,
pass_sport_amount,accepts_caf_aids,accepts_installments,pass_stripe_fees_to_parents,enabled_modules,current_season)
ON public.clubs TO authenticated;

CREATE TABLE public.club_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('private_lesson','contact')), first_name TEXT NOT NULL, email TEXT NOT NULL,
 message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 2000),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX club_requests_club_idx ON public.club_requests(club_id,created_at DESC);
ALTER TABLE public.club_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY requests_manager ON public.club_requests FOR ALL TO authenticated USING(public.is_club_manager(club_id)) WITH CHECK(public.is_club_manager(club_id));
CREATE TABLE public.club_gallery (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120), image_url TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX club_gallery_club_idx ON public.club_gallery(club_id,created_at DESC);
ALTER TABLE public.club_gallery ENABLE ROW LEVEL SECURITY;
CREATE POLICY gallery_public ON public.club_gallery FOR SELECT USING(public.is_public_club(club_id));
CREATE POLICY gallery_manager ON public.club_gallery FOR ALL TO authenticated USING(public.is_club_manager(club_id)) WITH CHECK(public.is_club_manager(club_id));

CREATE TABLE public.audit_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
 actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL, action TEXT NOT NULL, object_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_club_idx ON public.audit_events(club_id,created_at DESC);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_admin_read ON public.audit_events FOR SELECT TO authenticated USING(public.is_super_admin());

-- Création d'un club et de son premier gestionnaire dans la même transaction.
CREATE OR REPLACE FUNCTION public.provision_club(payload JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid UUID:=auth.uid(); mail TEXT; cid UUID; tier TEXT; count_members INT; modules JSONB; season_year INT;
BEGIN
 SELECT email INTO mail FROM auth.users WHERE id=uid AND email_confirmed_at IS NOT NULL;
 IF mail IS NULL THEN RAISE EXCEPTION 'Connectez-vous avec une adresse confirmée'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(uid::TEXT));
 IF (SELECT count(*) FROM public.staff_members WHERE user_id=uid AND role='president')>=3 THEN RAISE EXCEPTION 'Contactez Licyo pour créer un autre club'; END IF;
 count_members:=(payload->>'memberCount')::INT;
 IF count_members<0 OR count_members>1000000 THEN RAISE EXCEPTION 'Effectif invalide'; END IF;
 SELECT id INTO tier FROM public.membership_tiers WHERE is_active AND count_members>=min_members AND (max_members IS NULL OR count_members<=max_members) ORDER BY min_members DESC LIMIT 1;
 IF tier IS NULL THEN RAISE EXCEPTION 'Aucune tranche disponible pour cet effectif'; END IF;
 IF payload->>'template' NOT IN ('club','arena','studio') THEN RAISE EXCEPTION 'Modèle invalide'; END IF;
 IF length(payload->>'sport') NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'Sport invalide'; END IF;
 IF payload->>'slug' IN ('www','app','admin','api','sites','login','super-admin','club-admin','espace-adherent','decouvrir','commencer','tarifs','modeles') THEN RAISE EXCEPTION 'Adresse réservée'; END IF;
 modules:=jsonb_build_object('vitrine',true,'inscriptions',true,'payments',true,'attendance',true,'trials',true,
 'events',true,'boutique',true,'sponsors',true,'news',true,'gallery',false,'private_lessons',false,'member_portal',true);
 season_year:=extract(year FROM now())::INT-CASE WHEN extract(month FROM now())<7 THEN 1 ELSE 0 END;
 INSERT INTO public.clubs(name,slug,sport_type,theme_preset,city,postal_code,contact_email,declared_member_count,membership_tier_id,enabled_modules,current_season)
 VALUES(payload->>'name',payload->>'slug',payload->>'sport',payload->>'template',payload->>'city',payload->>'postalCode',mail,count_members,tier,modules,season_year||'-'||(season_year+1))
 RETURNING id INTO cid;
 INSERT INTO public.staff_members(user_id,club_id,full_name,email,role) VALUES(uid,cid,payload->>'ownerName',mail,'president');
 INSERT INTO public.audit_events(club_id,actor_id,action,object_id) VALUES(cid,uid,'club.created',cid::TEXT);
 RETURN cid;
END $$;
REVOKE ALL ON FUNCTION public.provision_club(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_club(JSONB) TO authenticated;
GRANT SELECT ON public.membership_tiers,public.family_access,public.club_requests,public.club_gallery,public.audit_events TO authenticated;
GRANT SELECT ON public.membership_tiers,public.club_gallery TO anon;
GRANT ALL ON public.membership_tiers,public.family_access,public.club_requests,public.club_gallery,public.audit_events TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.membership_tiers,public.club_requests,public.club_gallery TO authenticated;


ALTER TABLE public.saas_prospects ADD COLUMN IF NOT EXISTS member_count INTEGER NOT NULL DEFAULT 0 CHECK(member_count BETWEEN 0 AND 1000000);
