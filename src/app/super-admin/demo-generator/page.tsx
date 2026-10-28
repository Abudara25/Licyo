import { createAdminClient } from '@/lib/supabase/admin';
import { rootDomain } from '@/lib/env';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { DemoGeneratorForm } from '@/components/super-admin/SuperAdminWidgets';

export default async function DemoGeneratorPage() {
  const { data: prospects } = await createAdminClient().from('saas_prospects').select('*').is('demo_club_id', null).not('stage', 'in', '(won,lost)').order('created_at', { ascending: false });
  return (
    <>
      <PageHeader title="Générateur de démo" description="Un site complet aux couleurs du prospect, prêt à montrer en rendez-vous." />
      <DemoGeneratorForm
        rootDomain={rootDomain()}
        prospects={(prospects ?? []).map((p) => ({ id: p.id, label: `${p.club_name} (${p.city})`, name: p.club_name, city: p.city, sport: p.sport_type, email: p.email }))}
      />
    </>
  );
}
