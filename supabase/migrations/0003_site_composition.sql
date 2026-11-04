CREATE OR REPLACE FUNCTION public.unique_site_sections(value text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=public AS $$ SELECT cardinality(value) = (SELECT count(DISTINCT x) FROM unnest(value) x) $$;
-- Composition publique uniquement : aucune donnée privée dans cette table.
CREATE TABLE IF NOT EXISTS public.club_site_settings (
 club_id uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
 sections text[] NOT NULL DEFAULT ARRAY['hero','numbers','practice','story','events','news','sponsors'],
 CONSTRAINT valid_site_sections CHECK (
  public.unique_site_sections(sections) AND cardinality(sections) BETWEEN 1 AND 7 AND 'hero'=ANY(sections)
  AND sections <@ ARRAY['hero','numbers','practice','story','events','news','sponsors']::text[]
  AND array_position(sections,NULL) IS NULL
 )
);
ALTER TABLE public.club_site_settings ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.club_site_settings TO anon,authenticated;
GRANT INSERT,UPDATE ON public.club_site_settings TO authenticated;
CREATE POLICY site_settings_public ON public.club_site_settings FOR SELECT USING(public.is_public_club(club_id));
CREATE POLICY site_settings_manager_read ON public.club_site_settings FOR SELECT TO authenticated USING(public.is_club_manager(club_id));
CREATE POLICY site_settings_insert ON public.club_site_settings FOR INSERT TO authenticated WITH CHECK(public.has_club_role(club_id,ARRAY['president','secretary']::text[]) OR public.is_super_admin());
CREATE POLICY site_settings_update ON public.club_site_settings FOR UPDATE TO authenticated USING(public.has_club_role(club_id,ARRAY['president','secretary']::text[]) OR public.is_super_admin()) WITH CHECK(public.has_club_role(club_id,ARRAY['president','secretary']::text[]) OR public.is_super_admin());
