-- A section can reference a stock identifier or a public image of the same club.
CREATE UNIQUE INDEX IF NOT EXISTS club_gallery_club_photo ON public.club_gallery(club_id,id);

CREATE TABLE IF NOT EXISTS public.club_site_media (
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (section IN ('hero','practice','story','events','news')),
  stock_id text CHECK (stock_id ~ '^[0-9]{1,12}$'),
  photo_id uuid,
  PRIMARY KEY (club_id,section),
  CHECK (num_nonnulls(stock_id,photo_id) = 1),
  FOREIGN KEY (club_id,photo_id) REFERENCES public.club_gallery(club_id,id) ON DELETE CASCADE
);

ALTER TABLE public.club_site_media ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.club_site_media TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.club_site_media TO authenticated;
GRANT ALL ON public.club_site_media TO service_role;
CREATE POLICY site_media_public ON public.club_site_media FOR SELECT
  USING (public.is_public_club(club_id));
CREATE POLICY site_media_editor ON public.club_site_media FOR ALL TO authenticated
  USING (public.has_club_role(club_id,ARRAY['president','secretary']::text[]) OR public.is_super_admin())
  WITH CHECK (public.has_club_role(club_id,ARRAY['president','secretary']::text[]) OR public.is_super_admin());
