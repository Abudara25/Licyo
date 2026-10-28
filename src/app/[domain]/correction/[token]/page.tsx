import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { CorrectionForm } from '@/components/vitrine/PublicForms';

type Props = { params: Promise<{ domain: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CorrectionPage({ params }: Props) {
  const { domain, token } = await params;
  const { club } = await loadClubOr404(domain);
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const { data: member } = valid
    ? await createAdminClient().from('members').select('first_name, dossier_status, rejection_reason').eq('club_id', club.id).eq('magic_action_token', token).maybeSingle()
    : { data: null };

  return (
    <>
      <PageTitle title="Compléter le dossier" />
      <div className="page-container mt-8 max-w-2xl">
        {member && member.dossier_status === 'needs_correction' ? (
          <>
            <p className="mb-4">Dossier de <strong>{member.first_name}</strong> : ajoutez le ou les documents demandés.</p>
            <CorrectionForm token={token} reason={member.rejection_reason ?? 'Document à remplacer.'} />
          </>
        ) : (
          <p className="rounded-xl bg-muted p-4">Ce lien n'est plus valable : le dossier a déjà été corrigé ou le lien a expiré. Contactez le club si besoin : {club.contact_email}.</p>
        )}
      </div>
    </>
  );
}
