import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { RegistrationTunnel } from '@/components/vitrine/RegistrationTunnel';

type Props = { params: Promise<{ domain: string }>; searchParams: Promise<{ paiement?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  return clubMetadata(club, { title: 'Inscription en ligne', path: '/inscription' });
}

export default async function RegistrationPage({ params, searchParams }: Props) {
  const { domain } = await params;
  const { paiement } = await searchParams;
  const { club, categories, products } = await loadClubOr404(domain);
  const v = getSportPreset(club.sport_type).vocabulary;

  return (
    <>
      <PageTitle title={`Inscription ${club.current_season}`} intro="Inscrivez toute la famille en une fois. Prévoyez une photo et, si besoin, le certificat médical : vous pouvez les prendre en photo avec votre téléphone." />
      <div className="page-container mt-8">
        {paiement === 'ok' ? (
          <p role="status" className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">Paiement reçu, merci ! Votre dossier est en cours de vérification par le club.</p>
        ) : null}
        {paiement === 'annule' ? (
          <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Le paiement a été interrompu. Votre dossier est enregistré : le club vous recontacte pour le règlement.</p>
        ) : null}
        {!club.enabled_modules.inscriptions ? (
          <p className="rounded-xl bg-muted p-4">Les inscriptions en ligne ne sont pas ouvertes. Contactez le club : {club.contact_email}.</p>
        ) : categories.length === 0 ? (
          <p className="rounded-xl bg-muted p-4">Les {v.groups} de la saison ne sont pas encore publiés.</p>
        ) : paiement !== 'ok' ? (
          <RegistrationTunnel club={club} categories={categories} products={club.enabled_modules.boutique ? products : []} vocab={v} />
        ) : null}
      </div>
    </>
  );
}
