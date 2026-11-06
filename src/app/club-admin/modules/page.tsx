import { SiteMediaEditor } from "@/components/platform/SiteMediaEditor";
import { resolveMedia } from "@/lib/site-media";
import { moduleEnabled } from "@/lib/platform";
import { SiteComposer } from "@/components/platform/SiteComposer";
import { createClient } from "@/lib/supabase/server";
import { requireClubContext } from "@/lib/supabase/server";
import { PageHeader } from "@/components/club-admin/AdminShell";
import { ModulesEditor } from "@/components/platform/ModulesEditor";
export default async function ModulesPage() {
  const { club } = await requireClubContext([
    "president",
    "secretary",
    "super_admin",
  ]);
  const db = await createClient();
  const [composition, photos, media] = await Promise.all([
    db
      .from("club_site_settings")
      .select("sections")
      .eq("club_id", club.id)
      .maybeSingle(),
    db
      .from("club_gallery")
      .select("id,title,image_url")
      .eq("club_id", club.id)
      .order("created_at", { ascending: false }),
    db
      .from("club_site_media")
      .select("section,stock_id,photo_id")
      .eq("club_id", club.id),
  ]);
  if (composition.error || photos.error || media.error)
    throw new Error("Configuration de vitrine indisponible");
  return (
    <>
      <PageHeader
        title="Un espace à votre image"
        description="Choisissez votre modèle et les fonctions utiles à votre association."
      />
      <SiteComposer initial={composition.data?.sections} />
      <SiteMediaEditor
        sport={club.sport_type}
        photos={photos.data ?? []}
        initial={resolveMedia(media.data ?? [], photos.data ?? [])}
        galleryEnabled={moduleEnabled(club.enabled_modules, "gallery")}
      />
      <ModulesEditor
        settings={club.enabled_modules}
        template={club.theme_preset}
      />
    </>
  );
}
