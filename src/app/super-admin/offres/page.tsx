import { requireSuperAdmin } from '@/lib/db/server';
import { createAdminClient } from '@/lib/db/admin';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { TierEditor } from '@/components/platform/TierEditor';
export default async function Offers() {
  await requireSuperAdmin();
  const { data, error } = await createAdminClient()
    .from('membership_tiers')
    .select('*')
    .order('min_members');
  if (error) throw new Error('Grille indisponible');
  return (
    <>
      <PageHeader
        title="Une offre pour chaque club"
        description="Effectifs, tarifs et souscription. Vous gardez la main sur toute la grille."
      />
      <TierEditor tiers={data ?? []} />
    </>
  );
}
