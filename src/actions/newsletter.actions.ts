'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getClubContext, type ClubContext } from '@/lib/db/server';
import { getDatabase } from '@/lib/db/d1';
import { grantsCan } from '@/lib/permissions';
import { parseAudience, resolveRecipients } from '@/lib/newsletter';
import { sendNewsletterDelivery } from '@/lib/newsletter-mail';
import type { ActionResult } from '@/lib/validation';

const PATH = '/club-admin/newsletter';

async function ctxOrThrow(): Promise<ClubContext> {
  const ctx = await getClubContext();
  if (!ctx) throw new Error('Session expirée : reconnectez-vous.');
  if (!grantsCan(ctx.grants, 'communication.manage')) throw new Error('Action réservée aux personnes qui gèrent la communication du club.');
  return ctx;
}

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return { ok: false, error: error instanceof Error ? error.message : 'Une erreur est survenue.' };
  }
}

const draftSchema = z.object({
  id: z.string().uuid().optional(),
  subject: z.string().trim().min(3, 'Objet trop court.').max(150, 'Objet trop long (150 caractères).'),
  body: z.string().trim().min(10, 'Message trop court.').max(20000, 'Message trop long.'),
  audience: z.object({ categoryIds: z.array(z.string().uuid()).max(50), includePastSeasons: z.boolean() }),
});

/** Nombre de destinataires d'un public (désinscrits exclus), pour l'affichage avant envoi. */
export async function countRecipients(audience: unknown): Promise<ActionResult<{ count: number }>> {
  return run(async () => {
    const ctx = await ctxOrThrow();
    const recipients = await resolveRecipients(getDatabase(), ctx.club, parseAudience(audience));
    return { ok: true, data: { count: recipients.length } };
  });
}

/** Crée ou met à jour un brouillon. */
export async function saveNewsletter(input: unknown): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const ctx = await ctxOrThrow();
    const v = draftSchema.parse(input);
    const db = await createClient();
    const audience = parseAudience(v.audience);
    if (v.id) {
      const { data } = await db
        .from('newsletters')
        .update({ subject: v.subject, body: v.body, audience, updated_at: new Date().toISOString() })
        .eq('id', v.id)
        .eq('club_id', ctx.club.id)
        .eq('status', 'draft')
        .select('id');
      if (!data?.length) return { ok: false, error: 'Seul un brouillon peut être modifié.' };
      revalidatePath(PATH);
      return { ok: true, data: { id: v.id }, message: 'Brouillon enregistré.' };
    }
    const { data, error } = await db
      .from('newsletters')
      .insert({ club_id: ctx.club.id, subject: v.subject, body: v.body, audience, created_by: ctx.auth.userId })
      .select('id')
      .single();
    if (error || !data) return { ok: false, error: 'Enregistrement impossible.' };
    revalidatePath(PATH);
    return { ok: true, data: { id: data.id }, message: 'Brouillon enregistré.' };
  });
}

/** Programme l'envoi (maintenant ou à une date) : la tâche planifiée l'enverra par lots dans le quart d'heure. */
export async function scheduleNewsletter(id: string, sendAt: string | null): Promise<ActionResult> {
  return run(async () => {
    const ctx = await ctxOrThrow();
    const db = await createClient();
    const { data: n } = await db.from('newsletters').select('*').eq('id', z.string().uuid().parse(id)).eq('club_id', ctx.club.id).maybeSingle();
    if (!n || n.status !== 'draft') return { ok: false, error: 'Seul un brouillon peut être programmé.' };
    const now = Date.now();
    const when = sendAt ? new Date(sendAt) : new Date(now);
    if (Number.isNaN(when.getTime())) return { ok: false, error: 'Date d’envoi invalide.' };
    if (sendAt && (when.getTime() < now - 60_000 || when.getTime() > now + 90 * 86400000)) {
      return { ok: false, error: 'Choisissez une date dans les 90 prochains jours.' };
    }
    const recipients = await resolveRecipients(getDatabase(), ctx.club, parseAudience(n.audience));
    if (!recipients.length) return { ok: false, error: 'Aucun destinataire pour ce public.' };
    const { data } = await db
      .from('newsletters')
      .update({ status: 'scheduled', send_at: when.toISOString(), recipient_count: recipients.length, updated_at: new Date().toISOString() })
      .eq('id', n.id)
      .eq('status', 'draft')
      .select('id');
    if (!data?.length) return { ok: false, error: 'Programmation impossible.' };
    revalidatePath(PATH);
    return {
      ok: true,
      message: sendAt ? `Envoi programmé à ${recipients.length} adresse${recipients.length > 1 ? 's' : ''}.` : `Envoi lancé : ${recipients.length} adresse${recipients.length > 1 ? 's' : ''}, dans les 15 minutes.`,
    };
  });
}

/** Annule un envoi programmé qui n'a pas commencé : le message redevient un brouillon. */
export async function cancelNewsletter(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await ctxOrThrow();
    const { data } = await (await createClient())
      .from('newsletters')
      .update({ status: 'draft', send_at: null, updated_at: new Date().toISOString() })
      .eq('id', z.string().uuid().parse(id))
      .eq('club_id', ctx.club.id)
      .eq('status', 'scheduled')
      .select('id');
    if (!data?.length) return { ok: false, error: 'L’envoi a déjà commencé ou n’est pas programmé.' };
    revalidatePath(PATH);
    return { ok: true, message: 'Envoi annulé : le message est redevenu un brouillon.' };
  });
}

/** Supprime un brouillon. */
export async function deleteNewsletterDraft(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await ctxOrThrow();
    const { data } = await (await createClient()).from('newsletters').delete().eq('id', z.string().uuid().parse(id)).eq('club_id', ctx.club.id).eq('status', 'draft').select('id');
    if (!data?.length) return { ok: false, error: 'Seul un brouillon peut être supprimé.' };
    revalidatePath(PATH);
    return { ok: true, message: 'Brouillon supprimé.' };
  });
}

/** Envoie un exemplaire de test à la personne connectée (le lien de désinscription y est inactif). */
export async function sendTestNewsletter(id: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await ctxOrThrow();
    if (!ctx.auth.email) return { ok: false, error: 'Votre compte n’a pas d’adresse e-mail.' };
    const { data: n } = await (await createClient()).from('newsletters').select('*').eq('id', z.string().uuid().parse(id)).eq('club_id', ctx.club.id).maybeSingle();
    if (!n) return { ok: false, error: 'Message introuvable.' };
    await sendNewsletterDelivery({
      newsletter: { id: n.id, club_id: n.club_id, subject: `[Test] ${n.subject}`, body: n.body, audience: JSON.stringify(n.audience) },
      email: ctx.auth.email,
      firstName: null,
      unsubscribeToken: 'test-sans-effet',
    });
    return { ok: true, message: `Test envoyé à ${ctx.auth.email}.` };
  });
}
