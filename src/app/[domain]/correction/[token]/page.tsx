import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { createAdminClient } from '@/lib/db/admin';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { CorrectionForm } from '@/components/vitrine/PublicForms';
import { memberDocumentState } from '@/lib/member-documents';

type Props = { params: Promise<{ domain: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function CorrectionPage({ params }: Props) {
  const { domain, token } = await params;
  const { club } = await loadClubOr404(domain);
  const valid = /^[0-9a-f-]{36}$/i.test(token);
  const { data: member } = valid
    ? await createAdminClient()
        .from('members')
        .select('id, club_id, first_name, dossier_status, rejection_reason, photo_storage_path, medical_doc_storage_path, id_doc_storage_path, health_questionnaire_passed, category_id, is_minor')
        .eq('club_id', club.id)
        .eq('magic_action_token', token)
        .maybeSingle()
    : { data: null };
  // Dossier en attente : seulement s'il manque encore des pièces (lien envoyé par les relances automatiques).
  const state = member ? await memberDocumentState(member) : null;
  const missing = state?.missing ?? [];
  const open = member && (member.dossier_status === 'needs_correction' || (member.dossier_status === 'pending_review' && missing.length > 0));

  return (
    <>
      <PageTitle title="Compléter le dossier" />
      <div className="page-container mt-8 max-w-2xl">
        {open ? (
          <>
            <p className="mb-4">Dossier de <strong>{member.first_name}</strong> : ajoutez le ou les documents demandés.</p>
            <CorrectionForm
              token={token}
              slots={(member.dossier_status === 'needs_correction' ? state!.slots : state!.slots.filter((s) => missing.includes(s.label.charAt(0).toLowerCase() + s.label.slice(1)))).map(({ field, label, photoOnly }) => ({ field, label, photoOnly }))}
              reason={member.dossier_status === 'needs_correction' ? (member.rejection_reason ?? 'Document à remplacer.') : `Pièces manquantes : ${missing.join(', ')}.`}
            />
          </>
        ) : (
          <p className="rounded-xl bg-muted p-4">Ce lien n'est plus valable : le dossier a déjà été corrigé ou le lien a expiré. Contactez le club si besoin : {club.contact_email}.</p>
        )}
      </div>
    </>
  );
}
