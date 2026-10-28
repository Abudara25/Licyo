'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, MapPin } from 'lucide-react';
import { DAY_LABELS, type SportVocabulary } from '@/config/sports-presets';
import { categoriesForBirthYear } from '@/lib/age';
import { formatEuros } from '@/lib/pricing';
import type { Category, Facility, Schedule } from '@/types/database';

/** « Né(e) en … ? » → sections, créneaux et tarif correspondants. */
export function SlotFinderWidget({
  categories,
  schedules,
  facilities,
  vocab,
  prefix,
  trialsEnabled,
  registrationEnabled,
}: {
  categories: Category[];
  schedules: Schedule[];
  facilities: Facility[];
  vocab: SportVocabulary;
  prefix: string;
  trialsEnabled: boolean;
  registrationEnabled: boolean;
}) {
  const years = useMemo(() => {
    const min = Math.min(...categories.map((c) => c.min_birth_year), new Date().getFullYear() - 70);
    const max = Math.max(...categories.map((c) => c.max_birth_year), new Date().getFullYear() - 3);
    return Array.from({ length: max - min + 1 }, (_, i) => max - i);
  }, [categories]);
  const [year, setYear] = useState<number | ''>('');
  const [gender, setGender] = useState<'M' | 'F' | 'X'>('X');
  const matches = year === '' ? [] : categoriesForBirthYear(categories, year, gender);
  const facilityName = (id: string | null) => facilities.find((f) => f.id === id)?.name;

  return (
    <section aria-labelledby="slot-finder-title" className="rounded-2xl border bg-white p-4 shadow-sm md:p-6">
      <h2 id="slot-finder-title" className="text-xl font-bold">Trouver son créneau</h2>
      <p className="mt-1 text-sm text-muted-foreground">Indiquez l'année de naissance : nous affichons le bon groupe, les horaires et le tarif.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sf-year" className="mb-1.5 block text-sm font-medium">Année de naissance</label>
          <select id="sf-year" value={year} onChange={(e) => setYear(e.target.value ? Number(e.target.value) : '')} className="min-h-11 w-full rounded-lg border border-input bg-background px-3">
            <option value="">Choisir…</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sf-gender" className="mb-1.5 block text-sm font-medium">Groupe</label>
          <select id="sf-gender" value={gender} onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'X')} className="min-h-11 w-full rounded-lg border border-input bg-background px-3">
            <option value="X">Tous</option>
            <option value="F">Féminin</option>
            <option value="M">Masculin</option>
          </select>
        </div>
      </div>

      <div aria-live="polite" className="mt-4">
        {year !== '' && matches.length === 0 ? (
          <p className="rounded-lg bg-muted p-3 text-sm">Aucun groupe ne correspond à cette année pour le moment. Contactez le club : une solution existe souvent.</p>
        ) : null}
        <ul className="grid gap-3">
          {matches.map((c) => {
            const slots = schedules.filter((s) => s.category_id === c.id);
            return (
              <li key={c.id} className="rounded-xl border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-lg font-semibold">{c.name}</p>
                  <p className="font-bold tabular-nums">{formatEuros(Number(c.annual_price))} / an</p>
                </div>
                {c.coach_name ? <p className="text-sm text-muted-foreground">{vocab.coach.charAt(0).toUpperCase() + vocab.coach.slice(1)} : {c.coach_name}</p> : null}
                <ul className="mt-2 space-y-1 text-sm">
                  {slots.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="flex items-center gap-1.5"><Clock className="size-4" aria-hidden />{DAY_LABELS[s.day_of_week]} {s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)}</span>
                      {facilityName(s.facility_id) ? <span className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="size-4" aria-hidden />{facilityName(s.facility_id)}</span> : null}
                    </li>
                  ))}
                  {slots.length === 0 ? <li className="text-muted-foreground">Horaires communiqués à la rentrée.</li> : null}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {trialsEnabled && slots.length > 0 ? (
                    <Link href={`${prefix}/essai?section=${c.id}`} className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold hover:bg-accent">Essai gratuit</Link>
                  ) : null}
                  {registrationEnabled ? (
                    <Link href={`${prefix}/inscription`} className="inline-flex min-h-11 items-center rounded-lg bg-club-primary px-4 text-sm font-semibold text-club-primary-fg">S'inscrire</Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
