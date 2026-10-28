import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { CsvImporter } from '@/components/super-admin/SuperAdminWidgets';

export default async function ImportPage() {
  const { data: clubs } = await createAdminClient().from('clubs').select('id, name').neq('status', 'archived').order('name');
  return (
    <>
      <PageHeader title="Import CSV" description="Reprise des adhérents d'une saison précédente : ils sont créés comme validés, la section est déduite de l'année de naissance." />
      <CsvImporter clubs={clubs ?? []} />
    </>
  );
}
