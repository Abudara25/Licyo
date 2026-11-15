'use server';
import { z } from 'zod';
import { revalidatePath, revalidateTag } from 'next/cache';
import { createClient, getClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { createAdminClient } from '@/lib/db/admin';
import { moduleEnabled } from '@/lib/platform';
import { clubTag } from '@/lib/tenant';
import {
  uploadClubFile,
  PUBLIC_BUCKET,
  publicAssetUrl,
  deletePublicFiles,
} from '@/lib/storage';
import { type ActionResult, firstError } from '@/lib/validation';
import { guardPublicForm, turnstileTokenFrom } from '@/lib/security/public-guard';
export async function requestPrivateLesson(
  input: unknown,
): Promise<ActionResult> {
  const blocked = await guardPublicForm({ bucket: 'lesson', max: 5, windowSeconds: 3600, turnstileToken: turnstileTokenFrom(input) });
  if (blocked) return { ok: false, error: blocked };
  const parsed = z
    .object({
      slug: z.string().max(50),
      name: z.string().trim().min(1).max(80),
      email: z.string().email().max(120),
      message: z.string().trim().min(10).max(2000),
      website: z.string().max(0),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const p = parsed.data;
  const db = createAdminClient();
  const { data: club } = await db
    .from('public_clubs')
    .select('id,enabled_modules')
    .eq('slug', p.slug)
    .maybeSingle();
  if (!club || !moduleEnabled(club.enabled_modules, 'private_lessons'))
    return { ok: false, error: 'Les demandes de cours sont fermées.' };
  const { error } = await db.from('club_requests').insert({
    club_id: club.id,
    kind: 'private_lesson',
    first_name: p.name,
    email: p.email,
    message: p.message,
  });
  return error
    ? { ok: false, error: 'Envoi impossible.' }
    : { ok: true, message: 'Demande reçue. Le club vous recontactera.' };
}
export async function updateClubRequest(
  id: string,
  status: string,
): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx || !grantsCan(ctx.grants, 'members.write'))
    return { ok: false, error: 'Accès refusé.' };
  if (
    !z.string().uuid().safeParse(id).success ||
    !['new', 'contacted', 'closed'].includes(status)
  )
    return { ok: false, error: 'Demande invalide.' };
  const { error } = await (
    await createClient()
  )
    .from('club_requests')
    .update({ status })
    .eq('id', id)
    .eq('club_id', ctx.club.id);
  revalidatePath('/club-admin/demandes');
  return error ? { ok: false, error: 'Mise à jour impossible.' } : { ok: true };
}
export async function addGalleryPhoto(form: FormData): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (
    !ctx ||
    !grantsCan(ctx.grants, 'content.write') ||
    !moduleEnabled(ctx.club.enabled_modules, 'gallery')
  )
    return { ok: false, error: 'Accès refusé.' };
  const title = String(form.get('title') ?? '').trim();
  const file = form.get('file');
  if (!title || title.length > 120 || !(file instanceof File))
    return { ok: false, error: 'Ajoutez un titre et une photo.' };
  try {
    const path = await uploadClubFile(
      PUBLIC_BUCKET,
      ctx.club.id,
      'gallery',
      file,
      false,
    );
    const { error } = await (
      await createClient()
    )
      .from('club_gallery')
      .insert({ club_id: ctx.club.id, title, image_url: publicAssetUrl(path) });
    if (error) {
      await deletePublicFiles([path]);
      return { ok: false, error: 'Enregistrement impossible.' };
    }
    revalidateTag(clubTag(ctx.club.slug));
    revalidatePath('/club-admin/galerie');
    return { ok: true, message: 'Photo ajoutée.' };
  } catch {
    return {
      ok: false,
      error: 'Envoi impossible. Photo JPEG, PNG ou WebP, 5 Mo maximum.',
    };
  }
}
export async function removeGalleryPhoto(id: string): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (
    !ctx ||
    !grantsCan(ctx.grants, 'content.write') ||
    !z.string().uuid().safeParse(id).success
  )
    return { ok: false, error: 'Accès refusé.' };
  const { error } = await (
    await createClient()
  )
    .from('club_gallery')
    .delete()
    .eq('id', id)
    .eq('club_id', ctx.club.id);
  revalidateTag(clubTag(ctx.club.slug));
  revalidatePath('/club-admin/galerie');
  return error ? { ok: false, error: 'Suppression impossible.' } : { ok: true };
}
