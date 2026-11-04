import Link from 'next/link';
import { ArrowUpRight, CheckCircle2, CalendarDays } from 'lucide-react';
export function ManagementDashboard({
  count,
  pending,
  total,
  paid,
  rows,
  events,
  preview = false,
}: {
  count: number;
  pending: number;
  total: number;
  paid: number;
  rows: { id: string; name: string; group: string; status: string }[];
  events: { id: string; title: string; date: string }[];
  preview?: boolean;
}) {
  const money = (n: number) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(n);
  const target = preview ? '/commencer' : '/club-admin/inscriptions';
  return (
    <>
      <div className="dashboard-grid">
        <div className="metric-card">
          <span>Adhérents cette saison</span>
          <strong>{count}</strong>
          <small>Votre communauté, bien entourée</small>
        </div>
        <div className="metric-card">
          <span>Dossiers à accompagner</span>
          <strong>{pending}</strong>
          <small>Chaque inscription compte</small>
        </div>
        <div className="metric-card">
          <span>Cotisations encaissées</span>
          <strong>{money(paid)}</strong>
          <small>sur {money(total)} attendus</small>
        </div>
      </div>
      <div className="workspace-grid">
        <section className="workspace-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2>Les derniers dossiers</h2>
            <Link className="text-link" href={target}>
              Tout voir <ArrowUpRight size={15} />
            </Link>
          </div>
          {!rows.length ? (
            <p className="py-8 text-sm text-muted-foreground">
              Votre première inscription apparaîtra ici.
            </p>
          ) : (
            rows.map((m) => (
              <div className="member-row" key={m.id}>
                <span className="avatar">
                  {m.name
                    .split(' ')
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join('')}
                </span>
                <div>
                  <strong>{m.name}</strong>
                  <small>{m.group}</small>
                </div>
                <span className="status-pill">{m.status}</span>
              </div>
            ))
          )}
        </section>
        <div className="grid gap-5">
          <section className="workspace-card" style={{ background: '#eaf1df' }}>
            <span className="eyebrow">
              <CheckCircle2 size={16} /> VOTRE CLUB AVANCE
            </span>
            <h2 className="mt-4">Une saison à votre image.</h2>
            <p>
              Choisissez les modules utiles à votre association. Le reste peut
              attendre.
            </p>
            <Link
              className="text-link mt-4"
              href={preview ? '/decouvrir/modules' : '/club-admin/modules'}
            >
              Personnaliser mon espace <ArrowUpRight size={16} />
            </Link>
          </section>
          <section className="workspace-card">
            <h2>Prochains rendez-vous</h2>
            {!events.length ? (
              <p className="py-5 text-sm text-muted-foreground">
                Aucun rendez-vous programmé.
              </p>
            ) : (
              events.map((e) => (
                <div className="member-row" key={e.id}>
                  <CalendarDays size={20} />
                  <div>
                    <strong>{e.title}</strong>
                    <small>
                      {new Date(e.date).toLocaleDateString('fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        timeZone: 'Europe/Paris',
                      })}
                    </small>
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </>
  );
}
