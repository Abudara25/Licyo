import type { Metadata } from 'next';
import { loadClubOr404, sitePrefix } from '@/lib/tenant';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { getDatabase } from '@/lib/db/d1';
import { clubAvailability } from '@/lib/waitlist';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { PreregistrationForm, type PreregistrationChoice } from '@/components/vitrine/PreregistrationForm';

type Props = { params: Promise<{ domain: string }>; searchParams: Promise<{ categorie?: string }> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  return clubMetadata(club, { title: 'Pré-inscription et liste d’attente', path: '/pre-inscription' });
}

export default async function PreregistrationPage({ params, searchParams }: Props) {
  const { domain } = await params;
  const { categorie } = await searchParams;
  const { club, categories } = await loadClubOr404(domain);
  const availability = await clubAvailability(getDatabase(), club.id, club.current_season, categories);
  const choices: PreregistrationChoice[] = categories.flatMap((c) => {
    const a = availability.get(c.id)!;
    return a.publicState === 'waitlist' || a.publicState === 'preregistration'
      ? [{ id: c.id, name: c.name, min_birth_year: c.min_birth_year, max_birth_year: c.max_birth_year, gender_filter: c.gender_filter, state: a.publicState, waiting: a.waiting }]
      : [];
  });

  return (
    <>
      <PageTitle
        title="Pré-inscription et liste d’attente"
        intro="Un groupe est complet ou pas encore ouvert ? Laissez vos coordonnées : les places sont proposées dans l’ordre d’arrivée des demandes, par un lien personnel envoyé par e-mail."
      />
      <div className="page-container mt-8 max-w-3xl">
        {!club.enabled_modules.inscriptions ? (
          <p className="rounded-xl bg-muted p-4">Les demandes en ligne ne sont pas ouvertes. Contactez le club : {club.contact_email}.</p>
        ) : choices.length === 0 ? (
          <p className="rounded-xl bg-muted p-4">
            Aucune catégorie n’est complète ou en pré-inscription en ce moment.{' '}
            <a className="font-semibold underline" href={`${sitePrefix(domain)}/inscription`}>
              Inscrivez-vous directement
            </a>
            .
          </p>
        ) : (
          <PreregistrationForm clubSlug={club.slug} choices={choices} initialCategoryId={categorie} />
        )}
      </div>
    </>
  );
}
