import { requireModule } from '@/lib/module-access';
import { can, createClient, requireClubContext } from '@/lib/db/server';
import { getDatabase } from '@/lib/db/d1';
import { clubAvailability } from '@/lib/waitlist';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { PreregistrationsManager, type CategoryQueue } from '@/components/club-admin/PreregistrationsManager';

/** Pré-inscriptions et listes d'attente par catégorie, dans l'ordre d'arrivée. */
export default async function PreregistrationsPage() {
  await requireModule('inscriptions');
  const ctx = await requireClubContext('members.read');
  const { club } = ctx;
  const db = await createClient();
  const [{ data: categories }, { data: requests }] = await Promise.all([
    db.from('categories').select('*').eq('club_id', club.id).order('display_order'),
    db
      .from('preregistrations')
      .select('*')
      .eq('club_id', club.id)
      .eq('season', club.current_season)
      .order('created_at', { ascending: true })
      .limit(2000),
  ]);
  const availability = await clubAvailability(getDatabase(), club.id, club.current_season, categories ?? []);
  const queues: CategoryQueue[] = (categories ?? []).map((c) => ({
    category: { id: c.id, name: c.name, registration_mode: c.registration_mode, auto_invite: c.auto_invite },
    availability: availability.get(c.id)!,
    requests: (requests ?? []).filter((r) => r.category_id === c.id),
  }));

  return (
    <>
      <PageHeader
        title="Pré-inscriptions et listes d’attente"
        description={`Saison ${club.current_season} - les places sont proposées dans l’ordre d’arrivée, par un lien personnel valable 7 jours.`}
      />
      <PreregistrationsManager queues={queues} canWrite={can(ctx, 'members.write')} canConfigure={can(ctx, 'organization.manage')} />
    </>
  );
}
