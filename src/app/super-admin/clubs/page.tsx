import { createAdminClient } from '@/lib/supabase/admin';
import { clubSiteUrl } from '@/lib/env';
import { getSportPreset } from '@/config/sports-presets';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ClubsTable, type ClubRow } from '@/components/super-admin/SuperAdminWidgets';

export default async function ClubsPage() {
  const admin = createAdminClient();
  const [{ data: clubs }, { data: members }] = await Promise.all([
    admin.from('clubs').select('*').order('created_at', { ascending: false }),
    admin.from('members').select('club_id').eq('dossier_status', 'validated'),
  ]);
  const counts = new Map<string, number>();
  for (const m of members ?? []) counts.set(m.club_id, (counts.get(m.club_id) ?? 0) + 1);
  const rows: ClubRow[] = (clubs ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    city: c.city,
    sport: getSportPreset(c.sport_type).label,
    status: c.status,
    plan: c.subscription_plan,
    demoExpiresAt: c.demo_expires_at,
    members: counts.get(c.id) ?? 0,
    siteUrl: clubSiteUrl(c),
  }));
  return (
    <>
      <PageHeader title="Clubs" description="« Prendre le contrôle » ouvre le back-office du club tel que son bureau le voit (Mode Miroir, 4 heures)." />
      <ClubsTable clubs={rows} />
    </>
  );
}
