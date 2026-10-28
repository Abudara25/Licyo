import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { Stat } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { AnnouncementsPanel } from '@/components/super-admin/SuperAdminWidgets';
import { PLANS } from '@/lib/stripe/client';
import { formatEuros } from '@/lib/pricing';

export default async function SuperAdminHome() {
  // Le layout a vérifié le rôle super_admin ; lecture transversale via service role.
  const admin = createAdminClient();
  const [{ data: clubs }, { count: prospects }, { count: members }, { data: announcements }] = await Promise.all([
    admin.from('clubs').select('status, subscription_plan, demo_expires_at'),
    admin.from('saas_prospects').select('id', { count: 'exact', head: true }).not('stage', 'in', '(won,lost)'),
    admin.from('members').select('id', { count: 'exact', head: true }).eq('dossier_status', 'validated'),
    admin.from('platform_announcements').select('*').order('created_at', { ascending: false }).limit(10),
  ]);
  const active = (clubs ?? []).filter((c) => c.status === 'active');
  const demos = (clubs ?? []).filter((c) => c.status === 'demo');
  const expiringSoon = demos.filter((c) => c.demo_expires_at && new Date(c.demo_expires_at).getTime() - Date.now() < 3 * 86400000).length;
  const mrr = active.reduce((s, c) => s + PLANS[c.subscription_plan as 'vitrine' | 'integral'].monthly, 0);

  return (
    <>
      <PageHeader title="Vue d'ensemble" actions={<Link href="/super-admin/demo-generator" className={buttonVariants()}>Générer une démo</Link>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Clubs abonnés" value={active.length} hint={`${formatEuros(mrr)} / mois`} />
        <Stat label="Démos en cours" value={demos.length} hint={expiringSoon ? `${expiringSoon} expirent sous 3 jours` : undefined} />
        <Stat label="Prospects ouverts" value={prospects ?? 0} />
        <Stat label="Adhérents gérés" value={members ?? 0} />
      </div>
      <AnnouncementsPanel announcements={announcements ?? []} />
    </>
  );
}
