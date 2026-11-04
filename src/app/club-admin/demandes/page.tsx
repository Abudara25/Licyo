import { requireModule } from '@/lib/module-access';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { RequestStatus } from '@/components/platform/CommunityForms';
export default async function Requests() {
  const { club } = await requireModule('private_lessons');
  const { data, error } = await (
    await createClient()
  )
    .from('club_requests')
    .select('*')
    .eq('club_id', club.id)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error('Demandes indisponibles');
  return (
    <>
      <PageHeader
        title="Demandes de cours"
        description="Accompagnez chaque personne vers la pratique qui lui convient."
      />
      <div className="grid gap-5">
        {!data?.length ? (
          <p className="workspace-card text-sm">
            Aucune demande pour le moment.
          </p>
        ) : (
          data.map((d) => (
            <article className="workspace-card" key={d.id}>
              <h2>{d.first_name}</h2>
              <a href={'mailto:' + d.email} className="text-link">
                {d.email}
              </a>
              <p className="whitespace-pre-line">{d.message}</p>
              <div className="mt-5 max-w-xs">
                <RequestStatus id={d.id} status={d.status} />
              </div>
            </article>
          ))
        )}
      </div>
    </>
  );
}
