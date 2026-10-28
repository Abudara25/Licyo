import type { Metadata } from 'next';
import { MapPin } from 'lucide-react';
import { loadClubOr404 } from '@/lib/tenant';
import { DAY_LABELS, getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { PageTitle } from '@/components/vitrine/PageTitle';

type Props = { params: Promise<{ domain: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  return clubMetadata(club, { title: 'Horaires', path: '/planning' });
}

export default async function PlanningPage({ params }: Props) {
  const { domain } = await params;
  const { club, categories, schedules, facilities } = await loadClubOr404(domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  const days = [1, 2, 3, 4, 5, 6, 7].filter((d) => schedules.some((s) => s.day_of_week === d));
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';

  return (
    <>
      <PageTitle title="Horaires" intro={`Tous les ${v.trainings} de la semaine, saison ${club.current_season}.`} />
      <div className="page-container mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {days.length === 0 ? <p className="text-muted-foreground">Le planning sera publié prochainement.</p> : null}
        {days.map((d) => (
          <section key={d} aria-labelledby={`jour-${d}`} className="rounded-xl border bg-white">
            <h2 id={`jour-${d}`} className="rounded-t-xl bg-club-primary px-4 py-2 font-bold text-club-primary-fg">{DAY_LABELS[d]}</h2>
            <ul className="divide-y">
              {schedules.filter((s) => s.day_of_week === d).map((s) => {
                const facility = facilities.find((f) => f.id === s.facility_id);
                return (
                  <li key={s.id} className="px-4 py-3">
                    <p className="font-semibold tabular-nums">{s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)}</p>
                    <p>{categoryName(s.category_id)}</p>
                    {facility ? (
                      <p className="mt-0.5 flex items-start gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden />
                        {facility.google_maps_url ? (
                          <a href={facility.google_maps_url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{facility.name}</a>
                        ) : (
                          facility.name
                        )}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      {facilities.length > 0 ? (
        <section aria-labelledby="lieux" className="page-container mt-10">
          <h2 id="lieux" className="text-2xl font-bold">Nos {v.venues}</h2>
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {facilities.map((f) => (
              <li key={f.id} className="rounded-xl border bg-white p-4">
                <p className="font-semibold">{f.name}</p>
                <p className="text-sm text-muted-foreground">{f.address}, {f.postal_code} {f.city}</p>
                {f.google_maps_url ? (
                  <a href={f.google_maps_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold underline">Itinéraire</a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
