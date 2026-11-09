'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/db/server';
import { createAdminClient } from '@/lib/db/admin';
import {
  uploadClubFile,
  PRIVATE_BUCKET,
  signedPrivateUrl,
  deletePrivateFiles,
} from '@/lib/storage';
import { moduleEnabled } from '@/lib/platform';
import { type ActionResult } from '@/lib/validation';
export async function memberDocument(
  memberId: string,
  kind: 'photo' | 'medical' | 'id',
): Promise<ActionResult<{ url: string }>> {
  if (
    !z.string().uuid().safeParse(memberId).success ||
    !['photo', 'medical', 'id'].includes(kind)
  )
    return { ok: false, error: 'Document invalide.' };
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, error: 'Reconnectez-vous.' };
  const { data: m } = await db
    .from('members')
    .select('*')
    .eq('id', memberId)
    .maybeSingle();
  if (!m?.family_id) return { ok: false, error: 'Dossier introuvable.' };
  const { data: a } = await db
    .from('family_access')
    .select('family_id')
    .eq('user_id', user.id)
    .eq('family_id', m.family_id)
    .maybeSingle();
  if (!a) return { ok: false, error: 'Accès refusé.' };
  const path = {
    photo: m.photo_storage_path,
    medical: m.medical_doc_storage_path,
    id: m.id_doc_storage_path,
  }[kind];
  const url = path ? await signedPrivateUrl(path, 120) : null;
  return url
    ? { ok: true, data: { url } }
    : { ok: false, error: 'Aucun document disponible.' };
}
export async function uploadMemberDocument(
  form: FormData,
): Promise<ActionResult> {
  const id = String(form.get('memberId'));
  const kind = String(form.get('kind'));
  if (
    !z.string().uuid().safeParse(id).success ||
    !['photo', 'medical', 'id'].includes(kind)
  )
    return { ok: false, error: 'Document invalide.' };
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, error: 'Reconnectez-vous.' };
  const { data: m } = await db
    .from('members')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!m?.family_id) return { ok: false, error: 'Dossier introuvable.' };
  const [{ data: a }, { data: c }] = await Promise.all([
    db
      .from('family_access')
      .select('family_id')
      .eq('user_id', user.id)
      .eq('family_id', m.family_id)
      .maybeSingle(),
    db
      .from('public_clubs')
      .select('enabled_modules')
      .eq('id', m.club_id)
      .maybeSingle(),
  ]);
  if (!a || !c || !moduleEnabled(c.enabled_modules, 'member_portal'))
    return { ok: false, error: 'Accès indisponible.' };
  if (!['needs_correction', 'pending_review'].includes(m.dossier_status))
    return {
      ok: false,
      error: 'Ce dossier ne peut plus être modifié. Contactez le club.',
    };
  const file = form.get('file');
  if (!(file instanceof File))
    return { ok: false, error: 'Choisissez un fichier.' };
  try {
    const path = await uploadClubFile(
      PRIVATE_BUCKET,
      m.club_id,
      'members/' + m.season,
      file,
      kind !== 'photo',
    );
    const column = (
      {
        photo: 'photo_storage_path',
        medical: 'medical_doc_storage_path',
        id: 'id_doc_storage_path',
      } as const
    )[kind as 'photo' | 'medical' | 'id'];
    const { data: updated, error } = await createAdminClient()
      .from('members')
      .update({ [column]: path, dossier_status: 'pending_review' } as Partial<
        import('@/types/database').Member
      >)
      .eq('id', m.id)
      .eq('club_id', m.club_id)
      .eq('dossier_status', m.dossier_status)
      .select('id');
    if (error || !updated?.length) {
      await deletePrivateFiles([path]);
      return { ok: false, error: 'Le dossier a changé. Rechargez la page.' };
    }
    revalidatePath('/espace-adherent');
    return { ok: true, message: 'Document transmis au club.' };
  } catch {
    return {
      ok: false,
      error: 'Envoi impossible. Formats acceptés : photo ou PDF, 5 Mo maximum.',
    };
  }
}
export async function memberConvocation(
  id: string,
  response: 'present' | 'absent',
): Promise<ActionResult> {
  if (
    !z.string().uuid().safeParse(id).success ||
    !['present', 'absent'].includes(response)
  )
    return { ok: false, error: 'Réponse invalide.' };
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { ok: false, error: 'Reconnectez-vous.' };
  const { data: c } = await db
    .from('event_convocations')
    .select('id,member_id,club_id')
    .eq('id', id)
    .maybeSingle();
  if (!c) return { ok: false, error: 'Convocation introuvable.' };
  const { data: m } = await db
    .from('members')
    .select('family_id')
    .eq('id', c.member_id)
    .maybeSingle();
  if (!m?.family_id) return { ok: false, error: 'Accès refusé.' };
  const { data: a } = await db
    .from('family_access')
    .select('family_id')
    .eq('user_id', user.id)
    .eq('family_id', m.family_id)
    .maybeSingle();
  if (!a) return { ok: false, error: 'Accès refusé.' };
  const { error } = await createAdminClient()
    .from('event_convocations')
    .update({ response_status: response })
    .eq('id', id)
    .eq('club_id', c.club_id);
  if (error) return { ok: false, error: 'Réponse non enregistrée.' };
  revalidatePath('/espace-adherent');
  return { ok: true, message: 'Réponse enregistrée.' };
}
