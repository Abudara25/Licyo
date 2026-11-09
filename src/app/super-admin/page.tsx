import { ControlDashboard } from '@/components/super-admin/ControlDashboard';
import { requireSuperAdmin } from '@/lib/db/server';
import { createAdminClient } from '@/lib/db/admin';
import { AnnouncementsPanel } from '@/components/super-admin/SuperAdminWidgets';
import { PLANS } from '@/lib/stripe/client';
import { formatEuros } from '@/lib/pricing';

export default async function SuperAdminHome() {
  await requireSuperAdmin();
  // Le layout a vérifié le rôle super_admin ; lecture transversale via service role.
  const admin = createAdminClient();
  const results = await Promise.all([
    admin
      .from('clubs')
      .select(
        'id,name,sport_type,declared_member_count,status, subscription_plan, membership_tier_id, demo_expires_at',
      ),
    admin
      .from('saas_prospects')
      .select('id', { count: 'exact', head: true })
      .not('stage', 'in', '(won,lost)'),
    admin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('dossier_status', 'validated'),
    admin
      .from('platform_announcements')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('membership_tiers').select('id,monthly_cents'),
  ]);
  if (results.some((r) => r.error))
    throw new Error(
      'Les données du pilotage sont temporairement indisponibles.',
    );
  const [
    { data: clubs },
    { count: prospects },
    { count: members },
    { data: announcements },
    { data: tiers },
  ] = results;
  const active = (clubs ?? []).filter((c) => c.status === 'active');
  const mrr = active.reduce(
    (s, c) =>
      s +
      (c.membership_tier_id
        ? (tiers?.find((t) => t.id === c.membership_tier_id)?.monthly_cents ??
            0) / 100
        : PLANS[c.subscription_plan as 'vitrine' | 'integral'].monthly),
    0,
  );

  return (
    <>
      <ControlDashboard
        clubs={clubs ?? []}
        prospects={prospects ?? 0}
        members={members ?? 0}
        revenue={
          active.some(
            (c) =>
              c.membership_tier_id &&
              tiers?.find((t) => t.id === c.membership_tier_id)
                ?.monthly_cents == null,
          )
            ? 'À définir'
            : formatEuros(mrr)
        }
      />
      <AnnouncementsPanel announcements={announcements ?? []} />
    </>
  );
}
