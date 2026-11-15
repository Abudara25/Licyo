'use client';

import { useState, useTransition } from 'react';
import { submitPreregistration } from '@/actions/preregistration.actions';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { TurnstileField } from '@/components/ui/turnstile';
import { categoriesForBirthYear } from '@/lib/age';
import { PUBLIC_STATE_LABELS, type CategoryAvailability } from '@/lib/waitlist';
import type { Category } from '@/types/database';

export type PreregistrationChoice = Pick<Category, 'id' | 'name' | 'min_birth_year' | 'max_birth_year' | 'gender_filter'> & {
  state: Extract<CategoryAvailability['publicState'], 'waitlist' | 'preregistration'>;
  waiting: number;
};

/** Demande de place : liste d'attente d'une catégorie complète, ou pré-inscription d'une catégorie pas encore ouverte. */
export function PreregistrationForm({ clubSlug, choices, initialCategoryId }: { clubSlug: string; choices: PreregistrationChoice[]; initialCategoryId?: string }) {
  const [v, setV] = useState({
    firstName: '',
    lastName: '',
    birthDate: '',
    gender: 'X' as 'M' | 'F' | 'X',
    categoryId: choices.some((c) => c.id === initialCategoryId) ? initialCategoryId! : '',
    contactName: '',
    email: '',
    phone: '',
    message: '',
    website: '',
  });
  const [token, setToken] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (patch: Partial<typeof v>) => setV((x) => ({ ...x, ...patch }));
  const eligible = v.birthDate
    ? categoriesForBirthYear(choices, Number(v.birthDate.slice(0, 4)), v.gender)
    : choices;
  const selected = choices.find((c) => c.id === v.categoryId);

  if (done) {
    return (
      <div role="status" className="rounded-2xl border bg-white p-6 text-center">
        <p className="text-lg font-bold">Demande enregistrée</p>
        <p className="mt-2 text-muted-foreground">{done}</p>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4 rounded-2xl border bg-white p-4 sm:grid-cols-2 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await submitPreregistration({ ...v, clubSlug, turnstileToken: token });
          if (!res.ok) {
            setError(res.error);
            return;
          }
          const position = res.data?.position;
          setDone(
            `${position ? `${v.firstName} est en position ${position}. ` : ''}Un e-mail de confirmation vous a été envoyé ; vous recevrez un lien personnel dès qu’une place est disponible.`,
          );
        });
      }}
    >
      <p className="font-semibold sm:col-span-2">La personne concernée</p>
      <Field id="pr-fn" label="Prénom">
        <Input id="pr-fn" required value={v.firstName} onChange={(e) => set({ firstName: e.target.value })} />
      </Field>
      <Field id="pr-ln" label="Nom">
        <Input id="pr-ln" required value={v.lastName} onChange={(e) => set({ lastName: e.target.value })} />
      </Field>
      <Field id="pr-bd" label="Date de naissance">
        <Input id="pr-bd" type="date" required value={v.birthDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set({ birthDate: e.target.value, categoryId: '' })} />
      </Field>
      <Field id="pr-g" label="Genre">
        <Select id="pr-g" value={v.gender} onChange={(e) => set({ gender: e.target.value as 'M' | 'F' | 'X', categoryId: '' })}>
          <option value="X">Non précisé</option>
          <option value="F">Féminin</option>
          <option value="M">Masculin</option>
        </Select>
      </Field>
      <Field
        id="pr-cat"
        label="Catégorie souhaitée"
        className="sm:col-span-2"
        hint={selected ? `${PUBLIC_STATE_LABELS[selected.state]} - ${selected.waiting} demande${selected.waiting > 1 ? 's' : ''} avant la vôtre` : v.birthDate && eligible.length === 0 ? 'Aucune catégorie en liste d’attente pour cet âge.' : undefined}
      >
        <Select id="pr-cat" required value={v.categoryId} disabled={!v.birthDate} onChange={(e) => set({ categoryId: e.target.value })}>
          <option value="">{v.birthDate ? 'Choisir…' : 'Renseignez d’abord la date de naissance'}</option>
          {eligible.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({PUBLIC_STATE_LABELS[c.state]})
            </option>
          ))}
        </Select>
      </Field>

      <p className="font-semibold sm:col-span-2">Vos coordonnées</p>
      <Field id="pr-cn" label="Nom et prénom (parent ou adhérent majeur)" className="sm:col-span-2">
        <Input id="pr-cn" required autoComplete="name" value={v.contactName} onChange={(e) => set({ contactName: e.target.value })} />
      </Field>
      <Field id="pr-em" label="E-mail">
        <Input id="pr-em" type="email" required autoComplete="email" inputMode="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />
      </Field>
      <Field id="pr-ph" label="Téléphone">
        <Input id="pr-ph" type="tel" required autoComplete="tel" inputMode="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />
      </Field>
      <Field id="pr-msg" label="Message au club (facultatif)" className="sm:col-span-2">
        <Textarea id="pr-msg" maxLength={1000} value={v.message} onChange={(e) => set({ message: e.target.value })} />
      </Field>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="sr-only" aria-hidden value={v.website} onChange={(e) => set({ website: e.target.value })} />
      <div className="sm:col-span-2">
        <TurnstileField action="preregistration" onToken={setToken} />
      </div>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 sm:col-span-2">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="club" size="lg" className="sm:col-span-2" disabled={pending}>
        {pending ? 'Envoi…' : 'Envoyer ma demande'}
      </Button>
    </form>
  );
}
