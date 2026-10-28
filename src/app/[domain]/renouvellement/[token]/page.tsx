import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSportPreset } from '@/config/sports-presets';
import { categoriesForBirthYear } from '@/lib/age';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { RegistrationTunnel } from '@/components/vitrine/RegistrationTunnel';

type Props = { params: Promise<{ domain: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Réinscription pré-remplie à partir du dossier de la saison précédente. */
export default async function RenewalPage({ params }: Props) {
  const { domain, token } = await params;
  const { club, categories, products } = await loadClubOr404(domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  const admin = createAdminClient();
  const { data: member } = /^[0-9a-f-]{36}$/i.test(token)
    ? await admin.from('members').select('*').eq('club_id', club.id).eq('magic_action_token', token).maybeSingle()
    : { data: null };
  const { data: family } = member?.family_id ? await admin.from('family_registrations').select('*').eq('id', member.family_id).maybeSingle() : { data: null };

  if (!member || member.season === club.current_season) {
    return (
      <>
        <PageTitle title="Réinscription" />
        <div className="page-container mt-8 max-w-2xl">
          <p className="rounded-xl bg-muted p-4">Ce lien de réinscription n'est plus valable. Utilisez le formulaire d'inscription classique.</p>
        </div>
      </>
    );
  }

  const nextCategory = categoriesForBirthYear(categories, Number(member.birth_date.slice(0, 4)), member.gender)[0];
  return (
    <>
      <PageTitle title={`Réinscription ${club.current_season}`} intro={`Les informations de ${member.first_name} sont pré-remplies : vérifiez-les et ajoutez les pièces à renouveler.`} />
      <div className="page-container mt-8">
        <RegistrationTunnel
          club={club}
          categories={categories}
          products={club.enabled_modules.boutique ? products : []}
          vocab={v}
          prefill={{
            renewalToken: token,
            members: [
              {
                firstName: member.first_name,
                lastName: member.last_name,
                birthDate: member.birth_date,
                gender: member.gender,
                categoryId: nextCategory?.id ?? '',
                consentImageRights: member.consent_image_rights,
                consentAutonomousExit: member.consent_autonomous_exit,
              },
            ],
            payer: family
              ? { firstName: family.payer_first_name, lastName: family.payer_last_name, email: family.payer_email, phone: family.payer_phone, address: family.address, postalCode: family.postal_code, city: family.city }
              : undefined,
            emergency: family ? { name: family.emergency_contact_name, phone: family.emergency_contact_phone } : undefined,
          }}
        />
      </div>
    </>
  );
}
