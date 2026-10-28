import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { TrialForm } from '@/components/vitrine/PublicForms';

type Props = { params: Promise<{ domain: string }>; searchParams: Promise<{ section?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  return clubMetadata(club, { title: 'Séance d\'essai gratuite', path: '/essai' });
}

export default async function TrialPage({ params, searchParams }: Props) {
  const { domain } = await params;
  const { section } = await searchParams;
  const { club, categories, schedules } = await loadClubOr404(domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  return (
    <>
      <PageTitle title="Séance d'essai gratuite" intro={`Venez découvrir le ${v.sportName} sans engagement : choisissez un créneau, on vous attend.`} />
      <div className="page-container mt-8 max-w-3xl">
        {club.enabled_modules.trials ? (
          <TrialForm clubSlug={club.slug} categories={categories} schedules={schedules} initialCategoryId={section} />
        ) : (
          <p className="rounded-xl bg-muted p-4">Les séances d'essai ne sont pas proposées en ligne. Contactez le club : {club.contact_email}.</p>
        )}
      </div>
    </>
  );
}
