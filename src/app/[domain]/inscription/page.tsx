import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { RegistrationTunnel, type TunnelPrefill } from '@/components/vitrine/RegistrationTunnel';
import { sitePrefix } from '@/lib/tenant';
import { getDatabase } from '@/lib/db/d1';
import { clubAvailability, findInvitation } from '@/lib/waitlist';

type Props = { params: Promise<{ domain: string }>; searchParams: Promise<{ paiement?: string; invitation?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  return clubMetadata(club, { title: 'Inscription en ligne', path: '/inscription' });
}

export default async function RegistrationPage({ params, searchParams }: Props) {
  const { domain } = await params;
  const { paiement, invitation: invitationToken } = await searchParams;
  const { club, categories, products } = await loadClubOr404(domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  // Places restantes, liste d'attente et pré-inscription : calculées côté serveur à chaque affichage.
  const db = getDatabase();
  const availability = Object.fromEntries(
    [...(await clubAvailability(db, club.id, club.current_season, categories)).values()].map((a) => [a.categoryId, a.publicState]),
  );
  const invitation = invitationToken ? await findInvitation(db, club.id, invitationToken) : null;
  const prefill: TunnelPrefill | undefined = invitation
    ? {
        invitation: { token: invitationToken!, categoryId: invitation.category_id },
        members: [{ firstName: invitation.first_name, lastName: invitation.last_name, birthDate: invitation.birth_date, gender: invitation.gender, categoryId: invitation.category_id }],
        payer: { email: invitation.email, phone: invitation.phone },
      }
    : undefined;
  const preregistrationHref = `${sitePrefix(domain)}/pre-inscription`;

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
          <>
            {invitationToken && !invitation ? (
              <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">Ce lien d’invitation a expiré ou a déjà été utilisé. Contactez le club si la place vous était réservée.</p>
            ) : null}
            {!invitation && Object.values(availability).some((st) => st === 'waitlist' || st === 'preregistration') ? (
              <p className="mb-6 rounded-xl border bg-white p-4">Certains groupes sont complets ou en pré-inscription. <a className="font-semibold underline" href={preregistrationHref}>Rejoindre la liste d’attente</a></p>
            ) : null}
            {invitation ? (
              <p role="status" className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">Une place est réservée pour {invitation.first_name}. Complétez le dossier ci-dessous avant l’expiration du lien.</p>
            ) : null}
            <RegistrationTunnel club={club} categories={categories} products={club.enabled_modules.boutique ? products : []} vocab={v} availability={availability} prefill={prefill} preregistrationHref={preregistrationHref} />
          </>
        ) : null}
      </div>
    </>
  );
}
