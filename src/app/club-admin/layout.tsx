import type { Metadata } from 'next';
import { requireClubContext, createClient } from '@/lib/supabase/server';
import { exitImpersonation, signOut } from '@/actions/club-admin.actions';
import { getSportPreset } from '@/config/sports-presets';
import { clubSiteUrl } from '@/lib/env';
import { ClubAdminNav } from '@/components/club-admin/ClubAdminNav';

export const metadata: Metadata = { title: 'Back-office', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ClubAdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireClubContext();
  const supabase = await createClient();
  const { data: announcements } = await supabase.from('platform_announcements').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(2);
  const preset = getSportPreset(ctx.club.sport_type);

  const banner = (
    <>
      {ctx.impersonating ? (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-sm font-semibold text-amber-950">
          <span>Mode Miroir : vous voyez le back-office de « {ctx.club.name} » comme son bureau.</span>
          <form action={exitImpersonation}>
            <button type="submit" className="min-h-9 rounded-md bg-amber-950 px-3 text-amber-50">Quitter</button>
          </form>
        </div>
      ) : null}
      {ctx.club.status === 'demo' ? (
        <p className="bg-blue-600 px-4 py-2 text-sm text-white">
          Compte de démonstration{ctx.club.demo_expires_at ? ` jusqu'au ${new Date(ctx.club.demo_expires_at).toLocaleDateString('fr-FR')}` : ''}. Abonnez-vous dans Paramètres pour publier votre site.
        </p>
      ) : null}
      {(announcements ?? []).map((a) => (
        <div key={a.id} role="note" className="border-b bg-white px-4 py-2 text-sm">
          <strong>{a.title}</strong> - {a.message}
        </div>
      ))}
    </>
  );

  return (
    <ClubAdminNav
      clubName={ctx.club.name}
      subtitle={`${preset.label} - saison ${ctx.club.current_season}`}
      role={ctx.role}
      siteUrl={clubSiteUrl(ctx.club)}
      attendanceEnabled={ctx.club.enabled_modules.attendance}
      banner={banner}
      signOutAction={signOut}
    >
      {children}
    </ClubAdminNav>
  );
}
