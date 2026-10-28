'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Check, FileWarning, Search, X } from 'lucide-react';
import { getMemberDocumentUrl, markTrialDone, rejectMember, requestCorrection, validateMember, verifyPassSport } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import type { DossierStatus } from '@/types/database';

export type ReviewItem = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  isMinor: boolean;
  status: DossierStatus;
  categoryName: string;
  medicalRequirement: string;
  healthOk: boolean;
  passSportCode: string | null;
  passSportVerified: boolean;
  consentImage: boolean;
  consentExit: boolean;
  rejectionReason: string | null;
  docs: { photo: boolean; medical: boolean; id: boolean };
  payer: { name: string; email: string; phone: string; city: string } | null;
  paymentStatus: string | null;
  createdAt: string;
};

const STATUS: Record<DossierStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'danger' | 'neutral' }> = {
  pending_review: { label: 'À vérifier', tone: 'info' },
  needs_correction: { label: 'Correction demandée', tone: 'warning' },
  validated: { label: 'Validé', tone: 'success' },
  rejected: { label: 'Refusé', tone: 'danger' },
  trial_requested: { label: 'Essai demandé', tone: 'info' },
  trial_done: { label: 'Essai fait', tone: 'neutral' },
};
const DOCS = { photo: 'Photo', medical: 'Certificat', id: 'Identité' } as const;

/** Validation rapide : liste à gauche, pièce justificative à droite. */
export function SplitScreenValidator({ items }: { items: ReviewItem[] }) {
  const [filter, setFilter] = useState<'todo' | 'trials' | 'all'>('todo');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [doc, setDoc] = useState<'photo' | 'medical' | 'id'>('medical');
  const [preview, setPreview] = useState<{ url: string; isPdf: boolean } | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [dialog, setDialog] = useState<'correction' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) =>
        filter === 'todo' ? i.status === 'pending_review' || i.status === 'needs_correction' : filter === 'trials' ? i.status === 'trial_requested' : true,
      )
      .filter((i) => !q || `${i.firstName} ${i.lastName} ${i.payer?.name ?? ''}`.toLowerCase().includes(q));
  }, [items, filter, query]);
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    const first = (['medical', 'photo', 'id'] as const).find((k) => selected.docs[k]) ?? 'medical';
    setDoc(first);
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPreview(null);
    if (!selected || !selected.docs[doc]) return;
    let cancelled = false;
    setLoadingDoc(true);
    getMemberDocumentUrl(selected.id, doc).then((res) => {
      if (cancelled) return;
      setLoadingDoc(false);
      if (res.ok && res.data) setPreview(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, doc]); // eslint-disable-line react-hooks/exhaustive-deps

  function act(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? 'Enregistré.');
        setDialog(null);
        setReason('');
        const idx = visible.findIndex((i) => i.id === selected?.id);
        setSelectedId(visible[idx + 1]?.id ?? null);
      } else toast.error(res.error);
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filtrer">
          {([['todo', 'À traiter'], ['trials', 'Essais'], ['all', 'Tous']] as const).map(([k, label]) => (
            <Button key={k} size="sm" variant={filter === k ? 'default' : 'outline'} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label}
            </Button>
          ))}
        </div>
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input aria-label="Rechercher un nom" placeholder="Rechercher un nom" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {visible.length === 0 ? (
          <EmptyState title="Rien à traiter" description="Les nouveaux dossiers apparaîtront ici." />
        ) : (
          <ul className="max-h-[70dvh] divide-y overflow-y-auto rounded-xl border bg-white">
            {visible.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(i.id)}
                  aria-current={selected?.id === i.id}
                  className={cn('flex w-full items-start justify-between gap-2 p-3 text-left hover:bg-muted', selected?.id === i.id && 'bg-blue-50')}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{i.lastName} {i.firstName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{i.categoryName} - {i.isMinor ? 'mineur' : 'adulte'}</span>
                  </span>
                  <Badge tone={STATUS[i.status].tone} className="shrink-0">{STATUS[i.status].label}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected ? (
        <section aria-label={`Dossier de ${selected.firstName} ${selected.lastName}`} className="min-w-0 rounded-xl border bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold">{selected.firstName} {selected.lastName}</h2>
              <p className="text-sm text-muted-foreground">
                Né(e) le {new Date(selected.birthDate).toLocaleDateString('fr-FR')} - {selected.categoryName}
              </p>
              {selected.payer ? (
                <p className="mt-1 text-sm">
                  {selected.payer.name} - <a className="underline" href={`mailto:${selected.payer.email}`}>{selected.payer.email}</a> - <a className="underline" href={`tel:${selected.payer.phone}`}>{selected.payer.phone}</a>
                </p>
              ) : null}
            </div>
            <Badge tone={STATUS[selected.status].tone}>{STATUS[selected.status].label}</Badge>
          </div>

          <div className="grid gap-4 p-4 xl:grid-cols-[1fr_240px]">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap gap-2" role="tablist" aria-label="Pièces">
                {(Object.keys(DOCS) as (keyof typeof DOCS)[]).map((k) => (
                  <Button key={k} role="tab" aria-selected={doc === k} size="sm" variant={doc === k ? 'default' : 'outline'} onClick={() => setDoc(k)}>
                    {DOCS[k]} {selected.docs[k] ? '' : '(absent)'}
                  </Button>
                ))}
              </div>
              <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg border bg-zinc-100 md:min-h-[460px]">
                {!selected.docs[doc] ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">Pièce non fournie.</p>
                ) : loadingDoc || !preview ? (
                  <p className="text-sm text-muted-foreground">Chargement…</p>
                ) : preview.isPdf ? (
                  <iframe src={preview.url} title={`${DOCS[doc]} de ${selected.firstName}`} className="h-[460px] w-full md:h-[560px]" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview.url} alt={`${DOCS[doc]} de ${selected.firstName}`} className="max-h-[560px] w-auto object-contain" />
                )}
              </div>
            </div>

            <dl className="grid content-start gap-2 text-sm">
              <div><dt className="font-medium">Santé</dt><dd>{selected.medicalRequirement === 'health_questionnaire' ? (selected.healthOk ? 'Questionnaire : tout « non »' : 'Questionnaire : au moins un « oui »') : 'Certificat exigé'}</dd></div>
              <div><dt className="font-medium">Droit à l'image</dt><dd>{selected.consentImage ? 'Oui' : 'Non'}</dd></div>
              {selected.isMinor ? <div><dt className="font-medium">Sortie seul</dt><dd>{selected.consentExit ? 'Autorisée' : 'Non'}</dd></div> : null}
              <div><dt className="font-medium">Règlement</dt><dd>{selected.paymentStatus === 'paid' ? 'Payé' : selected.paymentStatus === 'partial' ? 'Partiel' : 'Non réglé'}</dd></div>
              {selected.passSportCode ? (
                <div>
                  <dt className="font-medium">Pass'Sport</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    <code>{selected.passSportCode}</code>
                    <label className="flex min-h-9 items-center gap-2">
                      <input type="checkbox" className="size-5" defaultChecked={selected.passSportVerified} onChange={(e) => act(() => verifyPassSport(selected.id, e.target.checked))} />
                      Vérifié
                    </label>
                  </dd>
                </div>
              ) : null}
              {selected.rejectionReason ? <div><dt className="font-medium">Dernière demande</dt><dd>{selected.rejectionReason}</dd></div> : null}
            </dl>
          </div>

          <div className="sticky bottom-0 grid gap-2 border-t bg-white p-4 safe-bottom sm:grid-cols-3">
            {selected.status === 'trial_requested' ? (
              <Button size="lg" variant="secondary" disabled={pending} onClick={() => act(() => markTrialDone(selected.id))} className="sm:col-span-3">
                Essai effectué
              </Button>
            ) : (
              <>
                <Button size="lg" variant="success" disabled={pending} onClick={() => act(() => validateMember(selected.id))}>
                  <Check aria-hidden /> Valider
                </Button>
                <Button size="lg" variant="outline" disabled={pending} onClick={() => setDialog('correction')}>
                  <FileWarning aria-hidden /> Refuser une pièce
                </Button>
                <Button size="lg" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setDialog('reject')}>
                  <X aria-hidden /> Refuser le dossier
                </Button>
              </>
            )}
          </div>

          <Dialog
            open={dialog !== null}
            onOpenChange={(o) => !o && setDialog(null)}
            title={dialog === 'correction' ? 'Demander une correction' : 'Refuser le dossier'}
            description={dialog === 'correction' ? 'La famille reçoit un lien personnel pour remplacer la pièce, sans ressaisir le dossier.' : 'Le dossier ne comptera plus dans les effectifs.'}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act(() => (dialog === 'correction' ? requestCorrection(selected.id, reason) : rejectMember(selected.id, reason)));
              }}
              className="grid gap-3"
            >
              <label htmlFor="reason" className="text-sm font-medium">{dialog === 'correction' ? 'Pièce à remplacer et raison' : 'Motif (facultatif)'}</label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={dialog === 'correction' ? 'Ex. : le certificat médical doit dater de moins d\'un an.' : ''} required={dialog === 'correction'} />
              <div className="flex flex-wrap gap-2">
                {dialog === 'correction'
                  ? ['Photo floue ou mal cadrée.', 'Certificat médical de plus d\'un an.', 'Certificat sans mention de la discipline.', "Pièce d'identité illisible."].map((s) => (
                      <Button key={s} type="button" size="sm" variant="secondary" onClick={() => setReason(s)}>{s}</Button>
                    ))
                  : null}
              </div>
              <Button type="submit" size="lg" variant={dialog === 'correction' ? 'default' : 'destructive'} disabled={pending}>
                {dialog === 'correction' ? 'Envoyer le lien de correction' : 'Confirmer le refus'}
              </Button>
            </form>
          </Dialog>
        </section>
      ) : null}
    </div>
  );
}
