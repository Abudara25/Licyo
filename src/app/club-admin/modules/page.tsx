import { SiteComposer } from '@/components/platform/SiteComposer';
import { createClient } from '@/lib/supabase/server';
import { requireClubContext } from '@/lib/supabase/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ModulesEditor } from '@/components/platform/ModulesEditor';
export default async function ModulesPage() {
  const { club } = await requireClubContext([
    'president',
    'secretary',
    'super_admin',
  ]);
  const { data, error } = await (
    await createClient()
  )
    .from('club_site_settings')
    .select('sections')
    .eq('club_id', club.id)
    .maybeSingle();
  if (error) throw new Error('Composition indisponible');
  return (
    <>
      <PageHeader
        title="Un espace à votre image"
        description="Choisissez votre modèle et les fonctions utiles à votre association."
      />
      <SiteComposer initial={data?.sections} />
      <ModulesEditor
        settings={club.enabled_modules}
        template={club.theme_preset}
      />
    </>
  );
}
