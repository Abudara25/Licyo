import { requireSuperAdmin } from '@/lib/db/server';
import { createAdminClient } from '@/lib/db/admin';
import { PageHeader } from '@/components/club-admin/AdminShell';
export default async function Audit() {
  await requireSuperAdmin();
  const { data, error } = await createAdminClient()
    .from('audit_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error('Journal indisponible');
  return (
    <>
      <PageHeader
        title="Journal de contrôle"
        description="Les 200 dernières actions enregistrées sur la plateforme."
      />
      <div className="workspace-card">
        {!data?.length ? (
          <p>Aucune action enregistrée.</p>
        ) : (
          data.map((a) => (
            <div className="member-row" key={a.id}>
              <div>
                <strong>{a.action}</strong>
                <small>
                  {a.club_id ?? 'Plateforme'} · {a.actor_id ?? 'Système'}
                </small>
              </div>
              <time className="ml-auto text-xs" dateTime={a.created_at}>
                {new Date(a.created_at).toLocaleString('fr-FR')}
              </time>
            </div>
          ))
        )}
      </div>
    </>
  );
}
