import { requireClubContext, createClient, isManager } from '@/lib/supabase/server';
import { getSportPreset } from '@/config/sports-presets';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { SportifManager } from '@/components/club-admin/SportifManager';

export default async function SportifPage() {
  const { club, role } = await requireClubContext();
  const supabase = await createClient();
  const [{ data: categories }, { data: schedules }, { data: facilities }, { data: events }, { data: members }, { data: convocations }] = await Promise.all([
    supabase.from('categories').select('*').eq('club_id', club.id).order('display_order'),
    supabase.from('schedules').select('*').eq('club_id', club.id).order('day_of_week').order('start_time'),
    supabase.from('facilities').select('*').eq('club_id', club.id).order('name'),
    supabase.from('events').select('*').eq('club_id', club.id).order('event_date', { ascending: false }).limit(200),
    supabase.from('members').select('id, first_name, last_name, category_id').eq('club_id', club.id).eq('season', club.current_season).eq('dossier_status', 'validated').order('last_name'),
    supabase.from('event_convocations').select('event_id, member_id, response_status').eq('club_id', club.id),
  ]);
  const vocab = getSportPreset(club.sport_type).vocabulary;
  return (
    <>
      <PageHeader title="Sportif" description={`${vocab.groups.charAt(0).toUpperCase() + vocab.groups.slice(1)}, créneaux, calendrier et convocations`} />
      <SportifManager
        canManage={isManager(role)}
        vocab={vocab}
        categories={categories ?? []}
        schedules={schedules ?? []}
        facilities={facilities ?? []}
        events={events ?? []}
        members={(members ?? []).map((m) => ({ id: m.id, name: `${m.last_name} ${m.first_name}`, categoryId: m.category_id }))}
        convocations={(convocations ?? []).map((c) => ({ eventId: c.event_id, memberId: c.member_id, status: c.response_status }))}
      />
    </>
  );
}
