import { getMemberContext } from '@/lib/member';
import { AdminShell, PageHeader } from '@/components/club-admin/AdminShell';
import { MemberWorkspace } from '@/components/platform/MemberWorkspace';
import { UserRound, Wallet, CalendarDays } from 'lucide-react';
import { signOut } from '@/actions/club-admin.actions';
import { moduleEnabled } from '@/lib/platform';
export const dynamic = 'force-dynamic';
export default async function MemberPage() {
  const { db, user, access } = await getMemberContext();
  const ids = access.map((a) => a.family_id);
  const [
    { data: families },
    { data: members },
    { data: clubs },
    { data: categories },
    { data: convocations },
    { data: events },
  ] = await Promise.all([
    db.from('family_registrations').select('*').in('id', ids),
    db
      .from('members')
      .select(
        'id,first_name,last_name,club_id,family_id,season,category_id,dossier_status,rejection_reason,photo_storage_path,medical_doc_storage_path,id_doc_storage_path',
      )
      .in('family_id', ids),
    db
      .from('public_clubs')
      .select('id,name,enabled_modules')
      .in('id', [...new Set(access.map((a) => a.club_id))]),
    db
      .from('categories')
      .select('id,name')
      .in(
        'club_id',
        access.map((a) => a.club_id),
      ),
    db
      .from('event_convocations')
      .select('id,club_id,event_id,member_id,response_status'),
    db
      .from('events')
      .select('id,title,event_date,location_text')
      .in(
        'club_id',
        access.map((a) => a.club_id),
      )
      .gte('event_date', new Date().toISOString()),
  ]);
  const clubMap = new Map(
    (clubs ?? [])
      .filter((c) => moduleEnabled(c.enabled_modules, 'member_portal'))
      .map((c) => [c.id, c]),
  );
  const memberMap = new Map((members ?? []).map((m) => [m.id, m]));
  const eventMap = new Map((events ?? []).map((e) => [e.id, e]));
  return (
    <AdminShell
      title="Mon espace adhérent"
      subtitle={user.email}
      links={[
        {
          href: '/espace-adherent',
          label: 'Ma famille',
          glyph: <UserRound aria-hidden />,
        },
        {
          href: '/espace-adherent#paiements',
          label: 'Mes cotisations',
          glyph: <Wallet aria-hidden />,
        },
        {
          href: '/espace-adherent#convocations',
          label: 'Mes rendez-vous',
          glyph: <CalendarDays aria-hidden />,
        },
      ]}
      footer={
        <form action={signOut}>
          <button className="min-h-11" type="submit">
            Se déconnecter
          </button>
        </form>
      }
    >
      <PageHeader
        title="Le club, à portée de main."
        description="Vos dossiers, vos documents et les prochains rendez-vous de votre famille."
      />
      <MemberWorkspace
        dossiers={(members ?? [])
          .filter((m) => clubMap.has(m.club_id))
          .map((m) => ({
            id: m.id,
            name: m.first_name + ' ' + m.last_name,
            club: clubMap.get(m.club_id)!.name,
            season: m.season,
            category:
              categories?.find((c) => c.id === m.category_id)?.name ??
              'Groupe à confirmer',
            status: m.dossier_status,
            reason: m.rejection_reason,
            canEdit: ['needs_correction', 'pending_review'].includes(
              m.dossier_status,
            ),
            docs: {
              photo: Boolean(m.photo_storage_path),
              medical: Boolean(m.medical_doc_storage_path),
              id: Boolean(m.id_doc_storage_path),
            },
          }))}
        payments={(families ?? [])
          .filter((f) => clubMap.has(f.club_id))
          .map((f) => ({
            id: f.id,
            club: clubMap.get(f.club_id)!.name,
            total: Number(f.final_total_amount),
            paid: Number(f.amount_paid),
            status: f.payment_status,
            invoice: f.invoice_number,
          }))}
        convocations={(convocations ?? [])
          .filter(
            (c) =>
              clubMap.has(c.club_id) &&
              eventMap.has(c.event_id) &&
              memberMap.has(c.member_id),
          )
          .map((c) => ({
            id: c.id,
            name: memberMap.get(c.member_id)!.first_name,
            title: eventMap.get(c.event_id)!.title,
            date: eventMap.get(c.event_id)!.event_date,
            location: eventMap.get(c.event_id)!.location_text ?? '',
            response: c.response_status,
          }))}
      />
    </AdminShell>
  );
}
