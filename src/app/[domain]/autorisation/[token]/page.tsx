import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { createAdminClient } from '@/lib/db/admin';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { getSportPreset } from '@/config/sports-presets';
import { authorizationPending, parseParentalAuthorization } from '@/config/parental-authorization';
import { AuthorizationSignForm } from './AuthorizationSignForm';

type Props = { params: Promise<{ domain: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Autorisation parentale à signer par le lien personnel envoyé à la famille. */
export default async function AuthorizationSignPage({ params }: Props) {
  const { domain, token } = await params;
  const { club } = await loadClubOr404(domain);
  const config = parseParentalAuthorization(club.registration_form);
  const { data: member } = /^[0-9a-f-]{36}$/i.test(token)
    ? await createAdminClient()
        .from('members')
        .select('first_name, last_name, birth_date, season, is_minor, dossier_status, anonymized_at, parental_authorization')
        .eq('club_id', club.id)
        .eq('magic_action_token', token)
        .maybeSingle()
    : { data: null };
  const open = config.enabled && authorizationPending(member, club.current_season);

  return (
    <>
      <PageTitle title="Autorisation parentale" />
      <div className="page-container mt-8 max-w-2xl">
        {open && member ? (
          <AuthorizationSignForm
            clubSlug={club.slug}
            token={token}
            template={config.text}
            child={{ name: `${member.first_name} ${member.last_name}`, firstName: member.first_name, birthDate: member.birth_date }}
            context={{ clubName: club.name, sport: getSportPreset(club.sport_type).label, season: club.current_season }}
          />
        ) : (
          <p className="rounded-xl bg-muted p-4">
            Ce lien n’est plus valable : l’autorisation a peut-être déjà été signée. Contactez le club si besoin : {club.contact_email}.
          </p>
        )}
      </div>
    </>
  );
}
