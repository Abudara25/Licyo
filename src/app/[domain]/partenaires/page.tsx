import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadClubOr404 } from '@/lib/tenant';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { SponsorLeadForm } from '@/components/vitrine/PublicForms';

type Props = { params: Promise<{ domain: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  return clubMetadata(club, { title: 'Partenaires', path: '/partenaires' });
}

export default async function SponsorsPage({ params }: Props) {
  const { domain } = await params;
  const { club, sponsors } = await loadClubOr404(domain);
  if (!club.enabled_modules.sponsors) notFound();
  return (
    <>
      <PageTitle title="Nos partenaires" intro="Ils soutiennent le club et ses bénévoles. Merci à eux !" />
      <div className="page-container mt-8">
        {sponsors.length === 0 ? <p className="text-muted-foreground">Soyez le premier partenaire du club !</p> : null}
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sponsors.map((s) => (
            <li key={s.id} className="flex flex-col rounded-xl border bg-white p-5">
              <div className="flex h-24 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.logo_url} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
              </div>
              <p className="mt-3 font-semibold">{s.company_name}</p>
              {s.description ? <p className="mt-1 text-sm text-muted-foreground">{s.description}</p> : null}
              {s.website_url ? (
                <a href={s.website_url} target="_blank" rel="noopener noreferrer sponsored" className="mt-auto inline-flex min-h-11 items-center pt-2 text-sm font-semibold underline">
                  Visiter le site
                </a>
              ) : null}
            </li>
          ))}
        </ul>
        <section aria-labelledby="devenir" className="mt-12 max-w-3xl">
          <h2 id="devenir" className="text-2xl font-bold">Devenir partenaire</h2>
          <p className="mt-1 mb-4 text-muted-foreground">Visibilité locale, maillots, panneaux, événements : laissez vos coordonnées, le bureau vous rappelle.</p>
          <SponsorLeadForm clubSlug={club.slug} />
        </section>
      </div>
    </>
  );
}
