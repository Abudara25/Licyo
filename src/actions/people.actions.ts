'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import type { ActionResult } from '@/lib/validation';

/** Notes internes d'une fiche adhérent (droit members.write ; règles d'accès SQL en plus). */
export async function updatePersonNotes(personId: string, notes: string): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx) return { ok: false, error: 'Session expirée : reconnectez-vous.' };
  if (!grantsCan(ctx.grants, 'members.write')) return { ok: false, error: 'Action non autorisée pour votre compte.' };
  const id = z.string().uuid().safeParse(personId);
  const text = z.string().max(2000, 'Notes trop longues (2000 caractères).').safeParse(notes);
  if (!id.success || !text.success) return { ok: false, error: text.success ? 'Fiche introuvable.' : text.error.issues[0].message };
  const { data, error } = await (await createClient())
    .from('people')
    .update({ notes: text.data.trim() || null })
    .eq('id', id.data)
    .eq('club_id', ctx.club.id)
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'Enregistrement impossible.' };
  revalidatePath(`/club-admin/adherents/${id.data}`);
  return { ok: true, message: 'Notes enregistrées.' };
}
