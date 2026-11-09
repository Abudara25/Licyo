-- Extend the template catalogue without rewriting existing club settings.
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
 IF COALESCE(payload->>'template','') NOT IN ('club','arena','studio','heritage') THEN RAISE EXCEPTION 'Modèle invalide'; END IF;
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
