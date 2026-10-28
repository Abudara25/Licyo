'use client';

import { useState } from 'react';
import { Pencil, Plus, Send, Trash2 } from 'lucide-react';
import {
  deleteCategory,
  deleteEvent,
  deleteFacility,
  deleteSchedule,
  sendConvocations,
  upsertCategory,
  upsertEvent,
  upsertFacility,
  upsertSchedule,
} from '@/actions/club-admin.actions';
import { DAY_LABELS, type SportVocabulary } from '@/config/sports-presets';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import { formatEuros } from '@/lib/pricing';
import type { Category, ClubEvent, Facility, Schedule } from '@/types/database';
import { useAction } from './useAction';

type MemberLite = { id: string; name: string; categoryId: string | null };
type ConvocationLite = { eventId: string; memberId: string; status: string };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function SportifManager({
  canManage,
  vocab,
  categories,
  schedules,
  facilities,
  events,
  members,
  convocations,
}: {
  canManage: boolean;
  vocab: SportVocabulary;
  categories: Category[];
  schedules: Schedule[];
  facilities: Facility[];
  events: ClubEvent[];
  members: MemberLite[];
  convocations: ConvocationLite[];
}) {
  const [tab, setTab] = useState<'events' | 'categories' | 'schedules' | 'facilities'>('events');
  const [editing, setEditing] = useState<{ kind: string; data: Record<string, unknown> } | null>(null);
  const [convoking, setConvoking] = useState<ClubEvent | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, run } = useAction();
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '';
  const close = () => setEditing(null);
  const set = (k: string, v: unknown) => setEditing((e) => (e ? { ...e, data: { ...e.data, [k]: v } } : e));
  const d = (editing?.data ?? {}) as Record<string, string & boolean & number>;

  const tabs = [
    ['events', vocab.hasScores ? 'Calendrier et résultats' : 'Calendrier'],
    ['categories', cap(vocab.groups)],
    ['schedules', 'Créneaux'],
    ['facilities', cap(vocab.venues)],
  ] as const;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>{label}</Button>
        ))}
      </div>

      {tab === 'events' ? (
        <Card>
          <CardHeader
            title="Événements"
            description={`${cap(vocab.competitions)}, tournois, stages et vie du club`}
            action={<Button onClick={() => setEditing({ kind: 'event', data: { event_type: 'competition', is_home: true, event_date: toLocalInput(new Date(Date.now() + 7 * 86400000).toISOString()) } })}><Plus aria-hidden /> Ajouter</Button>}
          />
          {events.length === 0 ? <div className="p-4"><EmptyState title="Aucun événement" /></div> : null}
          <ul className="divide-y">
            {events.map((e) => {
              const convs = convocations.filter((c) => c.eventId === e.id);
              return (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">{e.title} {e.category_id ? <span className="text-xs text-muted-foreground">({catName(e.category_id)})</span> : null}</p>
                    <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(e.event_date))}{e.location_text ? ` - ${e.location_text}` : ''}</p>
                    {convs.length > 0 ? (
                      <p className="mt-1 flex flex-wrap gap-1 text-xs">
                        <Badge tone="success">{convs.filter((c) => c.status === 'present').length} présent(s)</Badge>
                        <Badge tone="danger">{convs.filter((c) => c.status === 'absent').length} absent(s)</Badge>
                        <Badge>{convs.filter((c) => c.status === 'pending').length} sans réponse</Badge>
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {vocab.hasScores && e.score_club != null ? <span className="mr-2 font-bold tabular-nums">{e.score_club} - {e.score_opponent}</span> : null}
                    <Button size="sm" variant="outline" onClick={() => { setConvoking(e); setSelected(new Set(convs.map((c) => c.memberId))); }}><Send aria-hidden /> Convoquer</Button>
                    <Button size="icon" variant="ghost" aria-label={`Modifier ${e.title}`} onClick={() => setEditing({ kind: 'event', data: { ...e, event_date: toLocalInput(e.event_date), category_id: e.category_id ?? '' } })}><Pencil aria-hidden /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Supprimer ${e.title}`} onClick={() => confirm('Supprimer cet événement ?') && run(() => deleteEvent(e.id))}><Trash2 aria-hidden /></Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {tab === 'categories' ? (
        <Card>
          <CardHeader title={cap(vocab.groups)} description="Tranches d'années de naissance, tarifs et capacité" action={canManage ? <Button onClick={() => setEditing({ kind: 'category', data: { gender_filter: 'mixed', medical_requirement: 'health_questionnaire', max_capacity: 30, annual_price: 150, display_order: categories.length } })}><Plus aria-hidden /> Ajouter</Button> : undefined} />
          <ul className="divide-y">
            {categories.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-muted-foreground">Né(e)s {c.min_birth_year}-{c.max_birth_year} - {formatEuros(Number(c.annual_price))} - {members.filter((m) => m.categoryId === c.id).length}/{c.max_capacity} places</p>
                </div>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Modifier ${c.name}`} onClick={() => setEditing({ kind: 'category', data: { ...c, coach_name: c.coach_name ?? '', description: c.description ?? '' } })}><Pencil aria-hidden /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Supprimer ${c.name}`} onClick={() => confirm('Supprimer cette section et ses créneaux ?') && run(() => deleteCategory(c.id))}><Trash2 aria-hidden /></Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tab === 'schedules' ? (
        <Card>
          <CardHeader title="Créneaux" action={canManage && categories.length ? <Button onClick={() => setEditing({ kind: 'schedule', data: { category_id: categories[0].id, day_of_week: 3, start_time: '14:00', end_time: '15:30', facility_id: facilities[0]?.id ?? '' } })}><Plus aria-hidden /> Ajouter</Button> : undefined} />
          <ul className="divide-y">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <p><span className="font-medium">{DAY_LABELS[s.day_of_week]} {s.start_time.slice(0, 5)}-{s.end_time.slice(0, 5)}</span> - {catName(s.category_id)} <span className="text-sm text-muted-foreground">{facilities.find((f) => f.id === s.facility_id)?.name}</span></p>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label="Modifier le créneau" onClick={() => setEditing({ kind: 'schedule', data: { ...s, start_time: s.start_time.slice(0, 5), end_time: s.end_time.slice(0, 5), facility_id: s.facility_id ?? '' } })}><Pencil aria-hidden /></Button>
                    <Button size="icon" variant="ghost" aria-label="Supprimer le créneau" onClick={() => confirm('Supprimer ce créneau ?') && run(() => deleteSchedule(s.id))}><Trash2 aria-hidden /></Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {tab === 'facilities' ? (
        <Card>
          <CardHeader title={cap(vocab.venues)} action={canManage ? <Button onClick={() => setEditing({ kind: 'facility', data: {} })}><Plus aria-hidden /> Ajouter</Button> : undefined} />
          <ul className="divide-y">
            {facilities.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <p><span className="font-medium">{f.name}</span> <span className="text-sm text-muted-foreground">{f.address}, {f.postal_code} {f.city}</span></p>
                {canManage ? (
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" aria-label={`Modifier ${f.name}`} onClick={() => setEditing({ kind: 'facility', data: { ...f, google_maps_url: f.google_maps_url ?? '', latitude: f.latitude ?? '', longitude: f.longitude ?? '' } })}><Pencil aria-hidden /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Supprimer ${f.name}`} onClick={() => confirm('Supprimer ce lieu ?') && run(() => deleteFacility(f.id))}><Trash2 aria-hidden /></Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && close()} title={{ event: 'Événement', category: cap(vocab.group), schedule: 'Créneau', facility: cap(vocab.venue) }[editing?.kind ?? 'event'] ?? ''}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!editing) return;
            const data = { ...editing.data };
            const action =
              editing.kind === 'event'
                ? () => upsertEvent({ ...data, event_date: new Date(String(data.event_date)).toISOString() })
                : editing.kind === 'category'
                  ? () => upsertCategory(data)
                  : editing.kind === 'schedule'
                    ? () => upsertSchedule({ ...data, facility_id: data.facility_id || null })
                    : () => upsertFacility(data);
            run(action, close);
          }}
        >
          {editing?.kind === 'event' ? (
            <>
              <Field id="ev-t" label="Titre"><Input id="ev-t" required value={d.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="ev-ty" label="Type">
                  <Select id="ev-ty" value={d.event_type} onChange={(e) => set('event_type', e.target.value)}>
                    <option value="competition">{cap(vocab.competition)}</option>
                    <option value="tournament">Tournoi</option>
                    <option value="training_camp">Stage</option>
                    <option value="club_event">Vie du club</option>
                    <option value="meeting">Réunion</option>
                  </Select>
                </Field>
                <Field id="ev-d" label="Date et heure"><Input id="ev-d" type="datetime-local" required value={d.event_date ?? ''} onChange={(e) => set('event_date', e.target.value)} /></Field>
              </div>
              <Field id="ev-c" label={cap(vocab.group)}>
                <Select id="ev-c" value={d.category_id ?? ''} onChange={(e) => set('category_id', e.target.value)}>
                  <option value="">Tout le club</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field id="ev-l" label="Lieu"><Input id="ev-l" value={d.location_text ?? ''} onChange={(e) => set('location_text', e.target.value)} /></Field>
              {vocab.hasScores ? (
                <>
                  <Checkbox id="ev-h" checked={Boolean(d.is_home)} onChange={(v) => set('is_home', v)} label={`À ${vocab.home}`} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field id="ev-s1" label={`Score du club (${vocab.scoreUnit})`}><Input id="ev-s1" type="number" min="0" inputMode="numeric" value={d.score_club ?? ''} onChange={(e) => set('score_club', e.target.value)} /></Field>
                    <Field id="ev-s2" label="Score adverse"><Input id="ev-s2" type="number" min="0" inputMode="numeric" value={d.score_opponent ?? ''} onChange={(e) => set('score_opponent', e.target.value)} /></Field>
                  </div>
                </>
              ) : null}
            </>
          ) : null}

          {editing?.kind === 'category' ? (
            <>
              <Field id="ca-n" label="Nom"><Input id="ca-n" required value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="ca-min" label="Né(e)s de (année)"><Input id="ca-min" type="number" inputMode="numeric" required value={d.min_birth_year ?? ''} onChange={(e) => set('min_birth_year', e.target.value)} /></Field>
                <Field id="ca-max" label="à (année)"><Input id="ca-max" type="number" inputMode="numeric" required value={d.max_birth_year ?? ''} onChange={(e) => set('max_birth_year', e.target.value)} /></Field>
                <Field id="ca-p" label="Cotisation annuelle (€)"><Input id="ca-p" type="number" step="0.01" min="0" inputMode="decimal" required value={d.annual_price ?? ''} onChange={(e) => set('annual_price', e.target.value)} /></Field>
                <Field id="ca-cap" label="Places"><Input id="ca-cap" type="number" min="1" inputMode="numeric" required value={d.max_capacity ?? ''} onChange={(e) => set('max_capacity', e.target.value)} /></Field>
              </div>
              <Field id="ca-g" label="Public">
                <Select id="ca-g" value={d.gender_filter} onChange={(e) => set('gender_filter', e.target.value)}>
                  <option value="mixed">Mixte</option><option value="F">Féminin</option><option value="M">Masculin</option>
                </Select>
              </Field>
              <Field id="ca-m" label="Pièce médicale">
                <Select id="ca-m" value={d.medical_requirement} onChange={(e) => set('medical_requirement', e.target.value)}>
                  <option value="health_questionnaire">Questionnaire de santé</option>
                  <option value="medical_cert_standard">Certificat médical</option>
                  <option value="medical_cert_competition">Certificat médical compétition</option>
                </Select>
              </Field>
              <Field id="ca-co" label={cap(vocab.coach)}><Input id="ca-co" value={d.coach_name ?? ''} onChange={(e) => set('coach_name', e.target.value)} /></Field>
              <Field id="ca-de" label="Description"><Textarea id="ca-de" value={d.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
              <Field id="ca-o" label="Ordre d'affichage"><Input id="ca-o" type="number" min="0" value={d.display_order ?? 0} onChange={(e) => set('display_order', e.target.value)} /></Field>
            </>
          ) : null}

          {editing?.kind === 'schedule' ? (
            <>
              <Field id="sc-c" label={cap(vocab.group)}>
                <Select id="sc-c" value={d.category_id} onChange={(e) => set('category_id', e.target.value)}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field id="sc-d" label="Jour">
                <Select id="sc-d" value={d.day_of_week} onChange={(e) => set('day_of_week', Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{DAY_LABELS[n]}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="sc-s" label="Début"><Input id="sc-s" type="time" required value={d.start_time ?? ''} onChange={(e) => set('start_time', e.target.value)} /></Field>
                <Field id="sc-e" label="Fin"><Input id="sc-e" type="time" required value={d.end_time ?? ''} onChange={(e) => set('end_time', e.target.value)} /></Field>
              </div>
              <Field id="sc-f" label={cap(vocab.venue)}>
                <Select id="sc-f" value={d.facility_id ?? ''} onChange={(e) => set('facility_id', e.target.value)}>
                  <option value="">Non précisé</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </Select>
              </Field>
            </>
          ) : null}

          {editing?.kind === 'facility' ? (
            <>
              <Field id="fa-n" label="Nom"><Input id="fa-n" required value={d.name ?? ''} onChange={(e) => set('name', e.target.value)} /></Field>
              <Field id="fa-a" label="Adresse"><Input id="fa-a" required value={d.address ?? ''} onChange={(e) => set('address', e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field id="fa-p" label="Code postal"><Input id="fa-p" required inputMode="numeric" maxLength={5} value={d.postal_code ?? ''} onChange={(e) => set('postal_code', e.target.value)} /></Field>
                <Field id="fa-c" label="Ville"><Input id="fa-c" required value={d.city ?? ''} onChange={(e) => set('city', e.target.value)} /></Field>
              </div>
              <Field id="fa-m" label="Lien Google Maps (facultatif)"><Input id="fa-m" type="url" value={d.google_maps_url ?? ''} onChange={(e) => set('google_maps_url', e.target.value)} /></Field>
            </>
          ) : null}

          <Button type="submit" size="lg" disabled={pending}>Enregistrer</Button>
        </form>
      </Dialog>

      <Dialog open={convoking !== null} onOpenChange={(o) => !o && setConvoking(null)} title="Convoquer" description={convoking?.title}>
        {(() => {
          const pool = members.filter((m) => !convoking?.category_id || m.categoryId === convoking.category_id);
          return (
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSelected(new Set(pool.map((m) => m.id)))}>Tout sélectionner</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Aucun</Button>
              </div>
              <ul className="max-h-[50dvh] overflow-y-auto rounded-lg border">
                {pool.map((m) => (
                  <li key={m.id} className="border-b last:border-0">
                    <label className="flex min-h-11 items-center gap-3 px-3">
                      <input type="checkbox" className="size-5" checked={selected.has(m.id)} onChange={(e) => { const n = new Set(selected); if (e.target.checked) n.add(m.id); else n.delete(m.id); setSelected(n); }} />
                      {m.name} <span className="text-xs text-muted-foreground">{catName(m.categoryId)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button size="lg" disabled={pending || selected.size === 0} onClick={() => convoking && run(() => sendConvocations(convoking.id, [...selected]), () => setConvoking(null))}>
                Envoyer {selected.size} convocation(s)
              </Button>
            </div>
          );
        })()}
      </Dialog>
    </>
  );
}
