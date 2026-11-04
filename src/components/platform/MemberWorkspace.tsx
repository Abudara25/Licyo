'use client';
import { useState, useTransition } from 'react';
import { FileText, Upload, CalendarDays, ArrowUpRight } from 'lucide-react';
import {
  memberDocument,
  uploadMemberDocument,
  memberConvocation,
} from '@/actions/member.actions';
import { Button } from '@/components/ui/button';
export type PortalDossier = {
  id: string;
  name: string;
  club: string;
  season: string;
  category: string;
  status: string;
  reason: string | null;
  canEdit: boolean;
  docs: { photo: boolean; medical: boolean; id: boolean };
};
export type PortalPayment = {
  id: string;
  club: string;
  total: number;
  paid: number;
  status: string;
  invoice: string | null;
};
export type PortalConvocation = {
  id: string;
  name: string;
  title: string;
  date: string;
  location: string;
  response: string;
};
const labels: Record<string, string> = {
  pending_review: 'En cours de vérification',
  needs_correction: 'Une pièce à compléter',
  validated: 'Dossier validé',
  rejected: 'Dossier refusé',
  trial_requested: 'Essai demandé',
  trial_done: 'Essai effectué',
};
export function MemberWorkspace({
  dossiers,
  payments,
  convocations,
  demo = false,
}: {
  dossiers: PortalDossier[];
  payments: PortalPayment[];
  convocations: PortalConvocation[];
  demo?: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState('');
  const money = (n: number) =>
    new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
    }).format(n);
  return (
    <div>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="dashboard-grid">
        <div className="metric-card">
          <span>Les adhérents de ma famille</span>
          <strong>{dossiers.length}</strong>
          <small>Chaque dossier, au même endroit</small>
        </div>
        <div className="metric-card">
          <span>Documents à compléter</span>
          <strong>
            {dossiers.filter((d) => d.status === 'needs_correction').length}
          </strong>
          <small>Le club vous accompagne</small>
        </div>
        <div className="metric-card">
          <span>Prochains rendez-vous</span>
          <strong>{convocations.length}</strong>
          <small>Confirmez votre présence</small>
        </div>
      </div>
      <section id="dossiers" className="mt-9">
        <h2 className="mb-5 text-xl font-semibold">
          Les dossiers de ma famille
        </h2>
        <div className="portal-cards">
          {!dossiers.length ? (
            <div className="workspace-card">
              <h2>Bienvenue dans votre espace</h2>
              <p>
                Aucun dossier n’est associé à cette adresse. Utilisez l’adresse
                e-mail du responsable indiquée lors de l’inscription, ou
                contactez votre club.
              </p>
            </div>
          ) : (
            dossiers.map((d) => (
              <article key={d.id} className="workspace-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <span className="eyebrow">
                      {d.club} · {d.season}
                    </span>
                    <h2 className="mt-2">{d.name}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {d.category}
                    </p>
                  </div>
                  <span className="status-pill">
                    {labels[d.status] ?? d.status}
                  </span>
                </div>
                {d.reason ? <p className="notice">{d.reason}</p> : null}
                {(['photo', 'medical', 'id'] as const).map((kind) => (
                  <div className="portal-document" key={kind}>
                    <span className="flex items-center gap-3 text-sm">
                      <FileText size={17} />
                      {kind === 'photo'
                        ? 'Photo'
                        : kind === 'medical'
                          ? 'Document médical'
                          : 'Pièce d’identité'}
                      <small className="text-muted-foreground">
                        {d.docs[kind] ? 'Transmis' : 'Non fourni'}
                      </small>
                    </span>
                    <div className="flex flex-wrap gap-3">
                      {d.docs[kind] ? (
                        <Button
                          variant="outline"
                          disabled={pending || demo}
                          onClick={() =>
                            start(async () => {
                              const r = await memberDocument(d.id, kind);
                              if (r.ok && r.data)
                                window.location.assign(r.data.url);
                              else if (!r.ok) setMessage(r.error);
                            })
                          }
                        >
                          Consulter <ArrowUpRight size={15} />
                        </Button>
                      ) : null}
                      {d.canEdit ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const form = new FormData(e.currentTarget);
                            form.set('memberId', d.id);
                            form.set('kind', kind);
                            start(async () => {
                              const r = await uploadMemberDocument(form);
                              setMessage(
                                r.ok
                                  ? (r.message ?? 'Document transmis')
                                  : r.error,
                              );
                            });
                          }}
                        >
                          <label className="sr-only" htmlFor={d.id + kind}>
                            Nouveau fichier : {kind}
                          </label>
                          <input
                            className="max-w-[180px] text-base"
                            id={d.id + kind}
                            name="file"
                            type="file"
                            required
                            accept={
                              kind === 'photo'
                                ? 'image/jpeg,image/png,image/webp'
                                : 'image/jpeg,image/png,image/webp,application/pdf'
                            }
                            disabled={demo}
                          />
                          <Button
                            type="submit"
                            variant="outline"
                            disabled={pending || demo}
                          >
                            <Upload size={15} /> Envoyer
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  </div>
                ))}
              </article>
            ))
          )}
        </div>
      </section>
      <section id="paiements" className="mt-9">
        <h2 className="mb-5 text-xl font-semibold">Mes cotisations</h2>
        <div className="portal-cards">
          {!payments.length ? (
            <p className="workspace-card text-sm">
              Aucune cotisation disponible.
            </p>
          ) : (
            payments.map((p) => (
              <article className="workspace-card" key={p.id}>
                <div className="flex flex-wrap justify-between gap-4">
                  <div>
                    <h2>{p.club}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {p.invoice ?? 'Cotisation'} · {money(p.paid)} réglés sur{' '}
                      {money(p.total)}
                    </p>
                  </div>
                  <strong>
                    {money(Math.max(0, p.total - p.paid))}
                    <span className="mt-1 block text-xs font-normal text-muted-foreground">
                      restant à régler
                    </span>
                  </strong>
                </div>
                {p.paid > 0 && !demo ? (
                  <a
                    className="text-link mt-4"
                    href={'/api/membre/attestation/' + p.id}
                  >
                    Télécharger mon attestation <ArrowUpRight size={16} />
                  </a>
                ) : null}
                {p.paid < p.total ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Pour régler le solde, rapprochez-vous du club.
                  </p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
      <section id="convocations" className="mt-9">
        <h2 className="mb-5 text-xl font-semibold">Mes rendez-vous</h2>
        <div className="portal-cards">
          {!convocations.length ? (
            <p className="workspace-card text-sm">
              Aucune convocation à venir.
            </p>
          ) : (
            convocations.map((c) => (
              <article className="workspace-card" key={c.id}>
                <span className="eyebrow">
                  <CalendarDays size={15} />
                  {c.name}
                </span>
                <h2 className="mt-3">{c.title}</h2>
                <p className="mt-3 text-sm">
                  {new Date(c.date).toLocaleString('fr-FR', {
                    timeZone: 'Europe/Paris',
                  })}{' '}
                  · {c.location}
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  {(['present', 'absent'] as const).map((r) => (
                    <Button
                      key={r}
                      variant={c.response === r ? 'default' : 'outline'}
                      disabled={pending || demo}
                      onClick={() =>
                        start(async () => {
                          const result = await memberConvocation(c.id, r);
                          setMessage(
                            result.ok
                              ? 'Votre réponse est enregistrée.'
                              : result.error,
                          );
                        })
                      }
                    >
                      {r === 'present' ? 'Je serai présent' : 'Je serai absent'}
                    </Button>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
