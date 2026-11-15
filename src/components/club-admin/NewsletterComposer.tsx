'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { cancelNewsletter, countRecipients, deleteNewsletterDraft, saveNewsletter, scheduleNewsletter, sendTestNewsletter } from '@/actions/newsletter.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { parseBody, type Block, type Inline } from '@/lib/newsletter';
import { useAction } from './useAction';

export type NewsletterItem = {
  id: string;
  subject: string;
  body: string;
  audience: { categoryIds: string[]; includePastSeasons: boolean };
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
  sendAt: string | null;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
};

const STATUS: Record<NewsletterItem['status'], { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  scheduled: { label: 'Programmée', tone: 'info' },
  sending: { label: 'Envoi en cours', tone: 'warning' },
  sent: { label: 'Envoyée', tone: 'success' },
  cancelled: { label: 'Annulée', tone: 'neutral' },
};
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

function Parts({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.href ? (
          <a key={i} className="underline" href={p.href} target="_blank" rel="noreferrer">
            {p.text}
          </a>
        ) : p.bold ? (
          <strong key={i}>{p.text}</strong>
        ) : (
          <span key={i} className="whitespace-pre-line">
            {p.text}
          </span>
        ),
      )}
    </>
  );
}

/** Aperçu fidèle au rendu de l'e-mail (mêmes blocs, jamais de HTML libre). */
function Preview({ subject, blocks }: { subject: string; blocks: Block[] }) {
  return (
    <div className="grid gap-3 rounded-xl border bg-white p-4 text-sm leading-6">
      <p className="text-lg font-bold">{subject || 'Objet du message'}</p>
      <p>Bonjour Prénom,</p>
      {blocks.length === 0 ? <p className="text-muted-foreground">Votre message apparaîtra ici.</p> : null}
      {blocks.map((b, i) =>
        b.type === 'h' ? (
          <p key={i} className="text-base font-bold">
            <Parts parts={b.content} />
          </p>
        ) : b.type === 'ul' ? (
          <ul key={i} className="list-disc pl-5">
            {b.items.map((it, j) => (
              <li key={j}>
                <Parts parts={it} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Parts parts={b.content} />
          </p>
        ),
      )}
      <p className="text-xs text-muted-foreground">Pied de message : lien « Ne plus recevoir la newsletter ».</p>
    </div>
  );
}

export function NewsletterComposer({
  categories,
  initial,
}: {
  categories: { id: string; name: string }[];
  initial: NewsletterItem | null;
}) {
  const [id, setId] = useState(initial?.id ?? null);
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [categoryIds, setCategoryIds] = useState<string[]>(initial?.audience.categoryIds ?? []);
  const [past, setPast] = useState(initial?.audience.includePastSeasons ?? false);
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [sendAt, setSendAt] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [, startCount] = useTransition();
  const { pending, run } = useAction();
  const blocks = useMemo(() => parseBody(body), [body]);
  const audience = useMemo(() => ({ categoryIds, includePastSeasons: past }), [categoryIds, past]);

  useEffect(() => {
    startCount(async () => {
      const res = await countRecipients(audience);
      setCount(res.ok && res.data ? res.data.count : null);
    });
  }, [audience]);

  const save = async () => {
    const res = await saveNewsletter({ id: id ?? undefined, subject, body, audience });
    if (res.ok && res.data) setId(res.data.id);
    return res;
  };

  return (
    <Card>
      <CardHeader title={id ? 'Brouillon' : 'Nouvelle newsletter'} description="Écrivez simplement : une ligne vide sépare les paragraphes." />
      <CardBody className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <Field id="nl-subject" label="Objet">
            <Input id="nl-subject" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} placeholder="Ex. : reprise des entraînements" />
          </Field>
          <Field id="nl-body" label="Message" hint="« ## » en début de ligne pour un titre, « - » pour une liste, **texte** pour du gras ; les liens https deviennent cliquables.">
            <Textarea id="nl-body" className="min-h-64" value={body} maxLength={20000} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <fieldset className="grid gap-1">
            <legend className="mb-1 text-sm font-medium">Destinataires</legend>
            <p className="text-sm text-muted-foreground">Responsables des inscriptions de la saison{categoryIds.length ? ' des catégories cochées' : ', toutes catégories'}.</p>
            {categories.map((c) => (
              <label key={c.id} htmlFor={`nl-cat-${c.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  id={`nl-cat-${c.id}`}
                  type="checkbox"
                  className="size-5"
                  checked={categoryIds.includes(c.id)}
                  onChange={(e) => setCategoryIds((list) => (e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id)))}
                />
                {c.name}
              </label>
            ))}
            <label htmlFor="nl-past" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
              <input id="nl-past" type="checkbox" className="size-5" checked={past} onChange={(e) => setPast(e.target.checked)} />
              Inclure les familles des saisons passées
            </label>
            <p className="text-sm font-medium" aria-live="polite">
              {count === null ? 'Calcul des destinataires…' : `${count} adresse${count > 1 ? 's' : ''} (désinscrits exclus)`}
            </p>
          </fieldset>
        </div>
        <div className="grid content-start gap-2">
          <p className="text-sm font-medium">Aperçu</p>
          <Preview subject={subject} blocks={blocks} />
        </div>
      </CardBody>
      <CardBody className="grid gap-4 border-t">
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">Quand</legend>
          <label htmlFor="nl-now" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input id="nl-now" type="radio" name="nl-when" className="size-5" checked={when === 'now'} onChange={() => setWhen('now')} />
            Maintenant (dans les 15 minutes)
          </label>
          <label htmlFor="nl-later" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input id="nl-later" type="radio" name="nl-when" className="size-5" checked={when === 'later'} onChange={() => setWhen('later')} />
            À une date précise
          </label>
          {when === 'later' ? (
            <Field id="nl-at" label="Date et heure d’envoi" className="sm:col-span-2 sm:max-w-xs">
              <Input id="nl-at" type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} />
            </Field>
          ) : null}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(save)}>
            Enregistrer le brouillon
          </Button>
          <Button
            variant="outline"
            disabled={pending || !subject || !body}
            onClick={() =>
              run(async () => {
                const saved = await save();
                return saved.ok && saved.data ? sendTestNewsletter(saved.data.id) : saved;
              })
            }
          >
            M’envoyer un test
          </Button>
          <Button
            disabled={pending || !subject || !body || !count || (when === 'later' && !sendAt)}
            onClick={() =>
              confirm(`Envoyer « ${subject} » à ${count} adresse${(count ?? 0) > 1 ? 's' : ''} ?`) &&
              run(
                async () => {
                  const saved = await save();
                  if (!saved.ok || !saved.data) return saved;
                  return scheduleNewsletter(saved.data.id, when === 'later' ? new Date(sendAt).toISOString() : null);
                },
                () => window.location.assign('/club-admin/newsletter'),
              )
            }
          >
            <Send aria-hidden /> {when === 'later' ? 'Programmer l’envoi' : 'Envoyer'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Historique : brouillons, envois programmés (annulables) et envois terminés. */
export function NewsletterHistory({ items }: { items: NewsletterItem[] }) {
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader title="Messages" />
      {items.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted-foreground">Aucune newsletter pour l’instant.</p>
        </CardBody>
      ) : (
        <ul className="divide-y">
          {items.map((n) => (
            <li key={n.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-medium">{n.subject}</span>
                  <Badge tone={STATUS[n.status].tone}>{STATUS[n.status].label}</Badge>
                </div>
                <p className="text-muted-foreground">
                  {n.status === 'draft'
                    ? `Créée le ${dateTime.format(new Date(n.createdAt))}`
                    : n.status === 'scheduled'
                      ? `Envoi prévu le ${dateTime.format(new Date(n.sendAt!))} - ${n.recipientCount} adresse${n.recipientCount > 1 ? 's' : ''}`
                      : `${n.sentCount} envoyé${n.sentCount > 1 ? 's' : ''} sur ${n.recipientCount}${n.failedCount ? ` - ${n.failedCount} échec${n.failedCount > 1 ? 's' : ''}` : ''}${n.sendAt ? ` - ${dateTime.format(new Date(n.sendAt))}` : ''}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {n.status === 'draft' ? (
                  <>
                    <a href={`/club-admin/newsletter?brouillon=${n.id}`} className="inline-flex min-h-11 items-center rounded-lg border px-3 font-medium">
                      Reprendre
                    </a>
                    <Button variant="ghost" disabled={pending} aria-label={`Supprimer le brouillon ${n.subject}`} onClick={() => confirm('Supprimer ce brouillon ?') && run(() => deleteNewsletterDraft(n.id))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </>
                ) : n.status === 'scheduled' ? (
                  <Button variant="outline" disabled={pending} onClick={() => run(() => cancelNewsletter(n.id))}>
                    Annuler l’envoi
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
