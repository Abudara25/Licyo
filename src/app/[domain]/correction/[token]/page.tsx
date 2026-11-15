import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { createAdminClient } from '@/lib/db/admin';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { CorrectionForm } from '@/components/vitrine/PublicForms';
import { missingDocuments } from '@/lib/reminders';

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
        .select('first_name, dossier_status, rejection_reason, photo_storage_path, medical_doc_storage_path, health_questionnaire_passed, category_id')
        .eq('club_id', club.id)
        .eq('magic_action_token', token)
        .maybeSingle()
    : { data: null };
  // Dossier en attente : seulement s'il manque encore des pièces (lien envoyé par les relances automatiques).
  const { data: category } = member?.category_id
    ? await createAdminClient().from('categories').select('medical_requirement').eq('id', member.category_id).maybeSingle()
    : { data: null };
  const missing = member ? missingDocuments({ ...member, medical_requirement: category?.medical_requirement ?? null }) : [];
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
