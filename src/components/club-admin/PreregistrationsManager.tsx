'use client';

import { useState } from 'react';
import { MailPlus, RotateCcw, UserCheck, X } from 'lucide-react';
import { invitePreregistration, updateCategoryRegistration, updatePreregistrationStatus } from '@/actions/preregistration.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { PUBLIC_STATE_LABELS, type CategoryAvailability } from '@/lib/waitlist';
import type { Preregistration, PreregistrationStatus, RegistrationMode } from '@/types/database';
import { useAction } from './useAction';

export type CategoryQueue = {
  category: { id: string; name: string; registration_mode: RegistrationMode; auto_invite: boolean };
  availability: CategoryAvailability;
  requests: Preregistration[];
};

const STATUS: Record<PreregistrationStatus, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  waiting: { label: 'En attente', tone: 'neutral' },
  invited: { label: 'Invitée', tone: 'info' },
  registered: { label: 'Inscrite', tone: 'success' },
  declined: { label: 'Refusée', tone: 'danger' },
  expired: { label: 'Lien expiré', tone: 'warning' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};

const MODE_LABELS: Record<RegistrationMode, string> = {
  open: 'Ouvertes',
  preregistration: 'Pré-inscriptions',
  closed: 'Fermées',
};
const MODE_HINTS: Record<RegistrationMode, string> = {
  open: 'Inscription directe tant qu’il reste des places, puis liste d’attente.',
  preregistration: 'Les familles laissent leurs coordonnées ; vous les invitez à l’ouverture.',
  closed: 'Ni inscription ni liste d’attente pour cette catégorie.',
};

const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'Europe/Paris' });
const dayTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

export function PreregistrationsManager({ queues, canWrite, canConfigure }: { queues: CategoryQueue[]; canWrite: boolean; canConfigure: boolean }) {
  if (queues.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted-foreground">Créez d’abord les catégories du club (page Sportif).</p>
        </CardBody>
      </Card>
    );
  }
  return (
    <div className="grid gap-6">
      {queues.map((q) => (
        <QueueCard key={q.category.id} queue={q} canWrite={canWrite} canConfigure={canConfigure} />
      ))}
    </div>
  );
}

function QueueCard({ queue, canWrite, canConfigure }: { queue: CategoryQueue; canWrite: boolean; canConfigure: boolean }) {
  const { category, availability: a } = queue;
  const { pending, run } = useAction();
  const [showDone, setShowDone] = useState(false);
  const active = queue.requests.filter((r) => r.status === 'waiting' || r.status === 'invited' || r.status === 'expired');
  const done = queue.requests.filter((r) => !active.includes(r));
  let rank = 0;

  return (
    <Card>
      <CardHeader
        title={category.name}
        description={`${a.occupied} inscrit${a.occupied > 1 ? 's' : ''} sur ${a.capacity} - ${a.remaining} place${a.remaining > 1 ? 's' : ''} libre${a.remaining > 1 ? 's' : ''} - ${a.waiting} en attente - ${a.invited} invitation${a.invited > 1 ? 's' : ''} en cours`}
        action={<Badge tone={a.publicState === 'open' ? 'success' : a.publicState === 'closed' ? 'neutral' : 'warning'}>{PUBLIC_STATE_LABELS[a.publicState]}</Badge>}
      />
      {canConfigure ? (
        <CardBody className="grid gap-3 border-b sm:grid-cols-[1fr_auto] sm:items-center">
          <label className="grid gap-1.5 text-sm font-medium" htmlFor={`mode-${category.id}`}>
            Inscriptions
            <Select
              id={`mode-${category.id}`}
              value={category.registration_mode}
              disabled={pending}
              onChange={(e) =>
                run(() => updateCategoryRegistration(category.id, { mode: e.target.value as RegistrationMode, autoInvite: category.auto_invite }))
              }
            >
              {(Object.keys(MODE_LABELS) as RegistrationMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </Select>
            <span className="text-xs font-normal text-muted-foreground">{MODE_HINTS[category.registration_mode]}</span>
          </label>
          <label htmlFor={`auto-${category.id}`} className="flex min-h-11 cursor-pointer items-start gap-3 text-sm sm:max-w-xs">
            <input
              id={`auto-${category.id}`}
              type="checkbox"
              className="mt-0.5 size-5 shrink-0"
              checked={category.auto_invite}
              disabled={pending || category.registration_mode !== 'open'}
              onChange={(e) => run(() => updateCategoryRegistration(category.id, { mode: category.registration_mode, autoInvite: e.target.checked }))}
            />
            <span>
              <span className="font-medium">Invitation automatique</span>
              <span className="block text-muted-foreground">Chaque nuit, une place libérée est proposée à la personne suivante.</span>
            </span>
          </label>
        </CardBody>
      ) : null}

      {active.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted-foreground">Aucune demande en cours.</p>
        </CardBody>
      ) : (
        <ol className="divide-y">
          {active.map((r) => {
            if (r.status === 'waiting') rank++;
            return (
              <li key={r.id} className="grid gap-2 p-3 text-sm md:grid-cols-[1fr_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {r.status === 'waiting' ? <span className="font-semibold tabular-nums">n° {rank}</span> : null}
                    <span className="font-medium">
                      {r.first_name} {r.last_name}
                    </span>
                    <span className="text-muted-foreground">né(e) le {day.format(new Date(r.birth_date))}</span>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </div>
                  <p className="break-words text-muted-foreground">
                    {r.contact_name} - <a className="underline" href={`mailto:${r.email}`}>{r.email}</a> -{' '}
                    <a className="underline" href={`tel:${r.phone.replace(/\s/g, '')}`}>{r.phone}</a>
                  </p>
                  <p className="text-muted-foreground">
                    Demande du {dayTime.format(new Date(r.created_at))}
                    {r.status === 'invited' && r.invite_expires_at ? ` - lien valable jusqu’au ${dayTime.format(new Date(r.invite_expires_at))}` : ''}
                  </p>
                  {r.message ? <p className="mt-1 whitespace-pre-line break-words">« {r.message} »</p> : null}
                </div>
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    {r.status === 'waiting' || r.status === 'expired' ? (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          (a.remaining > 0 ||
                            confirm(`« ${category.name} » est complet : inviter ${r.first_name} dépassera la capacité prévue (${a.capacity} places). Continuer ?`)) &&
                          run(() => invitePreregistration(r.id))
                        }
                      >
                        <MailPlus aria-hidden /> {r.status === 'expired' ? 'Réinviter' : 'Inviter'}
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => updatePreregistrationStatus(r.id, 'registered'))}>
                      <UserCheck aria-hidden /> Inscrit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      aria-label={`Retirer la demande de ${r.first_name}`}
                      onClick={() => confirm(`Retirer la demande de ${r.first_name} ${r.last_name} ?`) && run(() => updatePreregistrationStatus(r.id, 'cancelled'))}
                    >
                      <X aria-hidden /> Retirer
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {done.length ? (
        <CardBody className="border-t">
          <Button variant="ghost" size="sm" onClick={() => setShowDone((s) => !s)} aria-expanded={showDone}>
            {showDone ? 'Masquer' : 'Afficher'} les demandes traitées ({done.length})
          </Button>
          {showDone ? (
            <ul className="mt-2 grid gap-2 text-sm">
              {done.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  <span>
                    {r.first_name} {r.last_name}
                  </span>
                  <span className="text-muted-foreground">{r.email}</span>
                  {canWrite && r.status !== 'registered' ? (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => updatePreregistrationStatus(r.id, 'waiting'))}>
                      <RotateCcw aria-hidden /> Remettre en attente
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      ) : null}
    </Card>
  );
}
