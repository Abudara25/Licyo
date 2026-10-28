'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { requestTrial, respondConvocation, submitCorrection, submitSponsorLead } from '@/actions/public-club.actions';
import { compressImage } from '@/lib/utils/image-compression';
import { categoriesForBirthYear } from '@/lib/age';
import { DAY_LABELS } from '@/config/sports-presets';
import { Field, Input, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import type { Category, Schedule } from '@/types/database';

function Success({ message }: { message: string }) {
  return (
    <div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-900">
      <p className="text-lg font-semibold">{message}</p>
    </div>
  );
}

export function TrialForm({ clubSlug, categories, schedules, initialCategoryId }: { clubSlug: string; categories: Category[]; schedules: Schedule[]; initialCategoryId?: string }) {
  const [v, setV] = useState({ firstName: '', lastName: '', birthDate: '', gender: 'X' as 'M' | 'F' | 'X', contactFirstName: '', contactLastName: '', email: '', phone: '', address: '', postalCode: '', city: '', scheduleId: '' });
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });

  const eligibleCats = v.birthDate ? categoriesForBirthYear(categories, Number(v.birthDate.slice(0, 4)), v.gender) : categories.filter((c) => !initialCategoryId || c.id === initialCategoryId);
  const slots = schedules.filter((s) => eligibleCats.some((c) => c.id === s.category_id));

  if (done) return <Success message={done} />;
  return (
    <form
      className="grid gap-4 rounded-2xl border bg-white p-4 sm:grid-cols-2 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await requestTrial({ ...v, clubSlug });
          if (res.ok) setDone(res.message ?? 'Séance réservée.');
          else setError(res.error);
        });
      }}
    >
      <p className="font-semibold sm:col-span-2">La personne qui vient essayer</p>
      <Field id="t-fn" label="Prénom"><Input id="t-fn" required value={v.firstName} onChange={set('firstName')} /></Field>
      <Field id="t-ln" label="Nom"><Input id="t-ln" required value={v.lastName} onChange={set('lastName')} /></Field>
      <Field id="t-bd" label="Date de naissance"><Input id="t-bd" type="date" required value={v.birthDate} onChange={(e) => setV({ ...v, birthDate: e.target.value, scheduleId: '' })} /></Field>
      <Field id="t-g" label="Genre">
        <Select id="t-g" value={v.gender} onChange={(e) => setV({ ...v, gender: e.target.value as 'M' | 'F' | 'X', scheduleId: '' })}>
          <option value="X">Non précisé</option><option value="F">Féminin</option><option value="M">Masculin</option>
        </Select>
      </Field>
      <Field id="t-slot" label="Créneau souhaité" className="sm:col-span-2" hint={v.birthDate && slots.length === 0 ? 'Aucun créneau pour cet âge : contactez le club.' : undefined}>
        <Select id="t-slot" required value={v.scheduleId} onChange={set('scheduleId')}>
          <option value="">Choisir…</option>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>
              {categories.find((c) => c.id === s.category_id)?.name} - {DAY_LABELS[s.day_of_week]} {s.start_time.slice(0, 5)}
            </option>
          ))}
        </Select>
      </Field>
      <p className="mt-2 font-semibold sm:col-span-2">Vos coordonnées</p>
      <Field id="t-cfn" label="Prénom"><Input id="t-cfn" required autoComplete="given-name" value={v.contactFirstName} onChange={set('contactFirstName')} /></Field>
      <Field id="t-cln" label="Nom"><Input id="t-cln" required autoComplete="family-name" value={v.contactLastName} onChange={set('contactLastName')} /></Field>
      <Field id="t-em" label="E-mail"><Input id="t-em" type="email" required autoComplete="email" value={v.email} onChange={set('email')} /></Field>
      <Field id="t-ph" label="Téléphone"><Input id="t-ph" type="tel" required autoComplete="tel" value={v.phone} onChange={set('phone')} /></Field>
      <Field id="t-ad" label="Adresse" className="sm:col-span-2" hint="Nécessaire pour l'assurance pendant la séance."><Input id="t-ad" required autoComplete="street-address" value={v.address} onChange={set('address')} /></Field>
      <Field id="t-pc" label="Code postal"><Input id="t-pc" required inputMode="numeric" maxLength={5} autoComplete="postal-code" value={v.postalCode} onChange={set('postalCode')} /></Field>
      <Field id="t-ci" label="Ville"><Input id="t-ci" required autoComplete="address-level2" value={v.city} onChange={set('city')} /></Field>
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      <Button type="submit" variant="club" size="lg" className="sm:col-span-2" disabled={pending}>{pending ? 'Envoi…' : 'Réserver la séance d\'essai'}</Button>
    </form>
  );
}

export function SponsorLeadForm({ clubSlug }: { clubSlug: string }) {
  const [v, setV] = useState({ companyName: '', contactName: '', phone: '', email: '', estimatedBudget: '', website: '' });
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  if (done) return <Success message={done} />;
  return (
    <form
      className="grid gap-4 rounded-2xl border bg-white p-4 sm:grid-cols-2 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await submitSponsorLead({ ...v, clubSlug });
          if (res.ok) setDone(res.message ?? 'Merci !');
          else setError(res.error);
        });
      }}
    >
      <Field id="s-co" label="Entreprise"><Input id="s-co" required autoComplete="organization" value={v.companyName} onChange={set('companyName')} /></Field>
      <Field id="s-cn" label="Votre nom"><Input id="s-cn" required autoComplete="name" value={v.contactName} onChange={set('contactName')} /></Field>
      <Field id="s-em" label="E-mail"><Input id="s-em" type="email" required autoComplete="email" value={v.email} onChange={set('email')} /></Field>
      <Field id="s-ph" label="Téléphone"><Input id="s-ph" type="tel" required autoComplete="tel" value={v.phone} onChange={set('phone')} /></Field>
      <Field id="s-bu" label="Budget envisagé (facultatif)" className="sm:col-span-2">
        <Select id="s-bu" value={v.estimatedBudget} onChange={set('estimatedBudget')}>
          <option value="">Je ne sais pas encore</option>
          <option value="< 500 €">Moins de 500 €</option>
          <option value="500 - 2 000 €">500 à 2 000 €</option>
          <option value="> 2 000 €">Plus de 2 000 €</option>
        </Select>
      </Field>
      {/* Piège à robots : invisible pour les humains et les lecteurs d'écran. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" value={v.website} onChange={set('website')} />
      {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
      <Button type="submit" variant="club" size="lg" className="sm:col-span-2" disabled={pending}>{pending ? 'Envoi…' : 'Devenir partenaire'}</Button>
    </form>
  );
}

export function CorrectionForm({ token, reason }: { token: string; reason: string }) {
  const [files, setFiles] = useState<Partial<Record<'photo' | 'medical' | 'id', File>>>({});
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done) return <Success message={done} />;

  async function attach(kind: 'photo' | 'medical' | 'id', file?: File) {
    if (!file) return;
    const prepared = file.type.startsWith('image/') ? await compressImage(file) : file;
    if (prepared.size > 5 * 1024 * 1024) return toast.error('Fichier trop lourd (5 Mo maximum).');
    setFiles((f) => ({ ...f, [kind]: prepared }));
  }

  return (
    <form
      className="grid gap-4 rounded-2xl border bg-white p-4 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData();
        fd.set('token', token);
        Object.entries(files).forEach(([k, f]) => fd.set(k, f));
        start(async () => {
          const res = await submitCorrection(fd);
          if (res.ok) setDone(res.message ?? 'Merci !');
          else setError(res.error);
        });
      }}
    >
      <p className="rounded-lg bg-amber-50 p-3 text-amber-900"><strong>Demande du club :</strong> {reason}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {([['photo', 'Photo d\'identité'], ['medical', 'Certificat médical'], ['id', 'Pièce d\'identité']] as const).map(([kind, label]) => (
          <label key={kind} htmlFor={`c-${kind}`} className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-3 text-center text-sm hover:bg-muted">
            <Upload className="size-5" aria-hidden />
            <span className="font-medium">{label}</span>
            <span className="text-xs text-muted-foreground">{files[kind] ? files[kind]!.name.slice(0, 24) : 'Remplacer'}</span>
            <input id={`c-${kind}`} type="file" className="sr-only" accept={kind === 'photo' ? 'image/*' : 'image/*,application/pdf'} onChange={(e) => attach(kind, e.target.files?.[0])} />
          </label>
        ))}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" variant="club" size="lg" disabled={pending || Object.keys(files).length === 0}>{pending ? 'Envoi…' : 'Envoyer les documents'}</Button>
    </form>
  );
}

export function ConvocationResponse({ token, current }: { token: string; current: 'pending' | 'present' | 'absent' }) {
  const [status, setStatus] = useState(current);
  const [pending, start] = useTransition();
  const answer = (s: 'present' | 'absent') =>
    start(async () => {
      const res = await respondConvocation(token, s);
      if (res.ok) {
        setStatus(s);
        toast.success(res.message);
      } else toast.error(res.error);
    });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Button type="button" size="lg" variant={status === 'present' ? 'success' : 'outline'} disabled={pending} onClick={() => answer('present')} aria-pressed={status === 'present'}>Présent(e)</Button>
      <Button type="button" size="lg" variant={status === 'absent' ? 'destructive' : 'outline'} disabled={pending} onClick={() => answer('absent')} aria-pressed={status === 'absent'}>Absent(e)</Button>
    </div>
  );
}
