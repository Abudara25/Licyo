import {
  requireClubContext,
  createClient,
  isManager,
} from '@/lib/supabase/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ManagementDashboard } from '@/components/platform/ManagementDashboard';
export default async function ClubDashboard({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string }>;
}) {
  const { club, role } = await requireClubContext();
  const db = await createClient();
  const { erreur } = await searchParams;
  const [
    { data: rows, count },
    { count: pending },
    { data: families },
    { data: cats },
    { data: events },
  ] = await Promise.all([
    db
      .from('coach_roster')
      .select('*', { count: 'exact' })
      .eq('club_id', club.id)
      .eq('season', club.current_season)
      .order('last_name')
      .limit(6),
    db
      .from('coach_roster')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', club.id)
      .eq('season', club.current_season)
      .in('dossier_status', ['pending_review', 'needs_correction']),
    isManager(role)
      ? db
          .from('family_registrations')
          .select('final_total_amount,amount_paid')
          .eq('club_id', club.id)
          .eq('season', club.current_season)
      : Promise.resolve({ data: [] }),
    db.from('categories').select('id,name').eq('club_id', club.id),
    db
      .from('events')
      .select('id,title,event_date')
      .eq('club_id', club.id)
      .gte('event_date', new Date().toISOString())
      .order('event_date')
      .limit(3),
  ]);
  return (
    <>
      <PageHeader
        title="Une belle saison commence."
        description={club.name + ' · Saison ' + club.current_season}
      />
      {erreur ? (
        <p className="notice" role="status">
          {erreur === 'module'
            ? 'Ce module est désactivé pour votre club.'
            : 'Cette page est réservée à un autre rôle.'}
        </p>
      ) : null}
      <ManagementDashboard
        count={count ?? 0}
        pending={pending ?? 0}
        paid={(families ?? []).reduce((s, f) => s + Number(f.amount_paid), 0)}
        total={(families ?? []).reduce(
          (s, f) => s + Number(f.final_total_amount),
          0,
        )}
        rows={(rows ?? []).map((m) => ({
          id: m.id,
          name: m.first_name + ' ' + m.last_name,
          group:
            cats?.find((c) => c.id === m.category_id)?.name ?? 'Sans groupe',
          status:
            m.dossier_status === 'validated'
              ? 'Validé'
              : m.dossier_status === 'needs_correction'
                ? 'À compléter'
                : 'À vérifier',
        }))}
        events={(events ?? []).map((e) => ({
          id: e.id,
          title: e.title,
          date: e.event_date,
        }))}
      />
    </>
  );
}
