import type { Metadata } from 'next';
import Link from 'next/link';
import { loadClubOr404, sitePrefix } from '@/lib/tenant';
import { DAY_LABELS, getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { formatEuros } from '@/lib/pricing';
import { PageTitle } from '@/components/vitrine/PageTitle';

type Props = { params: Promise<{ domain: string }> };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  return clubMetadata(club, { title: `Nos ${v.groups}`, path: '/equipes-et-cours' });
}

const MEDICAL = {
  health_questionnaire: 'Questionnaire de santé',
  medical_cert_standard: 'Certificat médical',
  medical_cert_competition: 'Certificat médical (compétition)',
} as const;

export default async function GroupsPage({ params }: Props) {
  const { domain } = await params;
  const { club, categories, schedules, facilities } = await loadClubOr404(domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  const prefix = sitePrefix(domain);
  const startYear = Number(club.current_season.slice(0, 4));

  return (
    <>
      <PageTitle title={`Nos ${v.groups}`} intro={`Saison ${club.current_season} : groupes par année de naissance, ${v.coaches} et tarifs.`} />
      <div className="page-container mt-8">
        {categories.length === 0 ? <p className="text-muted-foreground">Les {v.groups} de la saison seront bientôt publiés.</p> : null}
        <ul className="grid gap-4 md:grid-cols-2">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-col rounded-xl border bg-white p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-xl font-bold">{c.name}</h2>
                <p className="text-lg font-bold tabular-nums">{formatEuros(Number(c.annual_price))}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                Né(e)s de {c.min_birth_year} à {c.max_birth_year} ({startYear - c.max_birth_year} à {startYear - c.min_birth_year} ans)
                {c.gender_filter !== 'mixed' ? ` - ${c.gender_filter === 'F' ? 'féminin' : 'masculin'}` : ' - mixte'}
              </p>
              {c.description ? <p className="mt-2">{c.description}</p> : null}
              <dl className="mt-3 grid gap-1 text-sm">
                {c.coach_name ? (
                  <div className="flex gap-2"><dt className="font-medium">{cap(v.coach)} :</dt><dd>{c.coach_name}</dd></div>
                ) : null}
                <div className="flex gap-2"><dt className="font-medium">Pièce médicale :</dt><dd>{MEDICAL[c.medical_requirement]}</dd></div>
                <div>
                  <dt className="font-medium">{cap(v.trainings)} :</dt>
                  <dd>
                    <ul className="mt-1 list-inside list-disc">
                      {schedules.filter((s) => s.category_id === c.id).map((s) => (
                        <li key={s.id}>
                          {DAY_LABELS[s.day_of_week]} {s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)}
                          {s.facility_id ? ` (${facilities.find((f) => f.id === s.facility_id)?.name ?? ''})` : ''}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
              </dl>
              {club.enabled_modules.inscriptions ? (
                <Link href={`${prefix}/inscription`} className="mt-4 inline-flex min-h-11 items-center justify-center self-start rounded-lg bg-club-primary px-5 font-semibold text-club-primary-fg">
                  S'inscrire
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
