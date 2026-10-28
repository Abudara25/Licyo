import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ProspectBoard } from '@/components/super-admin/SuperAdminWidgets';

export default async function CrmPage() {
  const { data: prospects } = await createAdminClient().from('saas_prospects').select('*').order('created_at', { ascending: false });
  return (
    <>
      <PageHeader title="Prospects" description="Du premier appel à la signature : démo, devis PDF et suivi." />
      <ProspectBoard prospects={prospects ?? []} />
    </>
  );
}
