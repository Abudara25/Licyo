import { requireClubContext, createClient, MANAGER_ROLES } from '@/lib/supabase/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { SplitScreenValidator, type ReviewItem } from '@/components/club-admin/SplitScreenValidator';
import { RenewalButton } from '@/components/club-admin/RenewalButton';

export default async function InscriptionsPage() {
  const { club } = await requireClubContext(MANAGER_ROLES);
  const supabase = await createClient();
  const [{ data: members }, { data: categories }, { data: families }] = await Promise.all([
    supabase
      .from('members')
      .select('*')
      .eq('club_id', club.id)
      .or(`season.eq.${club.current_season},dossier_status.eq.trial_requested`)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase.from('categories').select('id, name, medical_requirement').eq('club_id', club.id),
    supabase.from('family_registrations').select('id, payer_first_name, payer_last_name, payer_email, payer_phone, city, payment_status').eq('club_id', club.id).eq('season', club.current_season),
  ]);
  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const famById = new Map((families ?? []).map((f) => [f.id, f]));

  const items: ReviewItem[] = (members ?? []).map((m) => {
    const c = m.category_id ? catById.get(m.category_id) : undefined;
    const f = m.family_id ? famById.get(m.family_id) : undefined;
    return {
      id: m.id,
      firstName: m.first_name,
      lastName: m.last_name,
      birthDate: m.birth_date,
      isMinor: m.is_minor,
      status: m.dossier_status,
      categoryName: c?.name ?? 'Sans section',
      medicalRequirement: c?.medical_requirement ?? 'health_questionnaire',
      healthOk: m.health_questionnaire_passed,
      passSportCode: m.pass_sport_code,
      passSportVerified: m.pass_sport_verified,
      consentImage: m.consent_image_rights,
      consentExit: m.consent_autonomous_exit,
      rejectionReason: m.rejection_reason,
      docs: { photo: Boolean(m.photo_storage_path), medical: Boolean(m.medical_doc_storage_path), id: Boolean(m.id_doc_storage_path) },
      payer: f ? { name: `${f.payer_first_name} ${f.payer_last_name}`, email: f.payer_email, phone: f.payer_phone, city: f.city } : null,
      paymentStatus: f?.payment_status ?? null,
      createdAt: m.created_at,
    };
  });

  return (
    <>
      <PageHeader title="Inscriptions" description={`Vérification des dossiers - saison ${club.current_season}`} actions={<RenewalButton />} />
      <SplitScreenValidator items={items} />
    </>
  );
}
