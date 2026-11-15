import 'server-only';
import { createAdminClient } from '@/lib/db/admin';
import { documentApplies } from '@/config/registration-documents';
import { clubDocuments, missingDocuments } from '@/lib/reminders';
import type { Member } from '@/types/database';

export type UploadSlot = { field: string; label: string; photoOnly: boolean; key: string; storage: 'photo' | 'id' | 'medical' | 'extra' };

/**
 * État des pièces d'un dossier, selon les réglages ACTUELS du club : pièces déposables (champ de formulaire),
 * pièces obligatoires manquantes, et pièces complémentaires déjà déposées. Partagé par la page de complément et
 * l'action qui reçoit les fichiers : la même règle des deux côtés.
 */
export async function memberDocumentState(member: Pick<Member, 'id' | 'club_id' | 'category_id' | 'is_minor' | 'photo_storage_path' | 'medical_doc_storage_path' | 'id_doc_storage_path' | 'health_questionnaire_passed'>) {
  const admin = createAdminClient();
  const [{ data: club }, { data: category }, { data: extras }] = await Promise.all([
    admin.from('clubs').select('registration_form, sport_type').eq('id', member.club_id).maybeSingle(),
    member.category_id ? admin.from('categories').select('medical_requirement').eq('id', member.category_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('member_documents').select('doc_key, storage_path').eq('member_id', member.id),
  ]);
  const documents = clubDocuments(club?.registration_form ?? {}, club?.sport_type);
  const extraKeys = new Set((extras ?? []).map((e) => e.doc_key));
  const missing = missingDocuments({ ...member, medical_requirement: category?.medical_requirement ?? null }, documents, extraKeys);
  const slots: UploadSlot[] = [
    { field: 'medical', label: 'Certificat médical', photoOnly: false, key: 'medical', storage: 'medical' },
    ...documents
      .filter((d) => documentApplies(d, Boolean(member.is_minor)))
      .map((d) => ({
        field: d.storage === 'extra' ? `doc_${d.key}` : d.storage,
        label: d.label,
        photoOnly: d.storage === 'photo',
        key: d.key,
        storage: d.storage,
      })),
  ];
  return { slots, missing, extras: extras ?? [] };
}
