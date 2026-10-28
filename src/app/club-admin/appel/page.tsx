import { requireClubContext, createClient } from '@/lib/supabase/server';
import { DAY_LABELS } from '@/config/sports-presets';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { OfflineAttendanceSheet, type RosterSlot } from '@/components/club-admin/OfflineAttendanceSheet';
import { todayIso } from '@/lib/season';

export default async function AttendancePage() {
  const ctx = await requireClubContext();
  const { club } = ctx;
  const supabase = await createClient();
  const [{ data: schedules }, { data: categories }, { data: members }, { data: families }] = await Promise.all([
    supabase.from('schedules').select('*').eq('club_id', club.id).order('day_of_week').order('start_time'),
    supabase.from('categories').select('id, name').eq('club_id', club.id),
    supabase.from('members').select('id, first_name, last_name, category_id, family_id, is_minor, consent_autonomous_exit').eq('club_id', club.id).eq('season', club.current_season).eq('dossier_status', 'validated').order('last_name'),
    supabase.from('family_registrations').select('id, emergency_contact_name, emergency_contact_phone').eq('club_id', club.id).eq('season', club.current_season),
  ]);

  // Un éducateur avec des groupes attribués ne voit que ses groupes.
  const membership = ctx.auth.memberships.find((m) => m.club_id === club.id);
  const assigned = ctx.role === 'coach' && membership?.assigned_category_ids.length ? new Set(membership.assigned_category_ids) : null;
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));
  const famById = new Map((families ?? []).map((f) => [f.id, f]));

  const slots: RosterSlot[] = (schedules ?? [])
    .filter((s) => !assigned || assigned.has(s.category_id))
    .map((s) => ({
      scheduleId: s.id,
      weekday: s.day_of_week,
      label: `${DAY_LABELS[s.day_of_week]} ${s.start_time.slice(0, 5)} - ${catName.get(s.category_id) ?? ''}`,
      members: (members ?? [])
        .filter((m) => m.category_id === s.category_id)
        .map((m) => {
          const f = m.family_id ? famById.get(m.family_id) : undefined;
          return {
            id: m.id,
            name: `${m.last_name} ${m.first_name}`,
            isMinor: m.is_minor,
            canLeaveAlone: m.consent_autonomous_exit,
            emergencyName: f?.emergency_contact_name ?? '',
            emergencyPhone: f?.emergency_contact_phone ?? '',
          };
        }),
    }));

  return (
    <>
      <PageHeader title="Feuille d'appel" description="Fonctionne aussi sans réseau une fois la page ouverte." />
      <OfflineAttendanceSheet clubId={club.id} initialSlots={slots} today={todayIso()} />
    </>
  );
}
