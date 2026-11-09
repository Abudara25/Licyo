import { requireModule } from '@/lib/module-access';
import { createClient } from '@/lib/db/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { GalleryEditor } from '@/components/platform/CommunityForms';
export default async function Gallery() {
  const { club } = await requireModule('gallery');
  const { data, error } = await (
    await createClient()
  )
    .from('club_gallery')
    .select('*')
    .eq('club_id', club.id)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Galerie indisponible');
  return (
    <>
      <PageHeader
        title="Les moments du club"
        description="Publiez les photos pour lesquelles vous disposez des autorisations nécessaires."
      />
      <GalleryEditor photos={data ?? []} />
    </>
  );
}
