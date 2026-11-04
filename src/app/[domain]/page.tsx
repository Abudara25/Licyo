import { loadClubOr404, sitePrefix } from '@/lib/tenant';
import { ClubLanding } from '@/components/vitrine/ClubLanding';
export default async function ClubHome({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  return (
    <ClubLanding
      data={await loadClubOr404(domain)}
      prefix={sitePrefix(domain)}
    />
  );
}
