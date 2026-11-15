'use server';

import { createElement } from 'react';
import { revalidatePath, revalidateTag } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { getDatabase } from '@/lib/db/d1';
import { getClubContext } from '@/lib/db/server';
import { grantsCan, type Permission } from '@/lib/permissions';
import { categoriesForBirthYear, ageOn } from '@/lib/age';
import { clubTag } from '@/lib/tenant';
import { sendClubEmailSafely } from '@/lib/email/mailer';
import { sendInvitationEmail } from '@/lib/waitlist-mail';
import { PreregistrationReceivedEmail } from '@/lib/email/templates';
import { guardPublicForm, turnstileTokenFrom } from '@/lib/security/public-guard';
import { firstError, type ActionResult } from '@/lib/validation';
import { clubAvailability, issueInvitation, queuePosition, setPreregistrationStatus } from '@/lib/waitlist';
import type { Club } from '@/types/database';

const phone = z
  .string()
  .trim()
  .regex(/^(\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}$/, 'Numéro de téléphone invalide (ex. 06 12 34 56 78).');
const name = (label: string) => z.string().trim().min(1, `${label} obligatoire.`).max(80);

const preregistrationSchema = z.object({
  clubSlug: z.string().min(1).max(50),
  categoryId: z.string().uuid('Choisissez une catégorie.'),
  firstName: name('Prénom'),
  lastName: name('Nom'),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date de naissance invalide.'),
  gender: z.enum(['M', 'F', 'X']),
  contactName: z.string().trim().min(2, 'Nom du contact obligatoire.').max(120),
  email: z.string().trim().toLowerCase().email('E-mail invalide.').max(254),
  phone,
  message: z.string().trim().max(1000).optional().default(''),
  // Champ piège invisible : rempli uniquement par les robots.
  website: z.string().max(0).optional(),
});

async function loadOpenClub(slug: string): Promise<Club | null> {
  const { data } = await createAdminClient().from('clubs').select('*').eq('slug', slug).maybeSingle();
  if (!data) return null;
  const demoOk = data.status === 'demo' && (!data.demo_expires_at || new Date(data.demo_expires_at) > new Date());
  return data.status === 'active' || demoOk ? data : null;
}

/**
 * Pré-inscription ou liste d'attente, depuis le site du club. Acceptée seulement si la catégorie est en
 * pré-inscription ou complète (sinon : inscription directe). Le rang suit l'ordre d'arrivée.
 */
export async function submitPreregistration(input: unknown): Promise<ActionResult<{ position: number | null }>> {
  const blocked = await guardPublicForm({ bucket: 'preregistration', max: 6, windowSeconds: 3600, turnstileToken: turnstileTokenFrom(input) });
  if (blocked) return { ok: false, error: blocked };
  const parsed = preregistrationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const v = parsed.data;

  const club = await loadOpenClub(v.clubSlug);
  if (!club || !club.enabled_modules.inscriptions) return { ok: false, error: 'Les demandes sont fermées pour ce club.' };
  const admin = createAdminClient();
  const { data: category } = await admin.from('categories').select('*').eq('id', v.categoryId).eq('club_id', club.id).maybeSingle();
  if (!category) return { ok: false, error: 'Catégorie introuvable.' };

  const age = ageOn(v.birthDate);
  if (!(age >= 2 && age <= 100)) return { ok: false, error: 'Date de naissance invalide.' };
  if (categoriesForBirthYear([category], Number(v.birthDate.slice(0, 4)), v.gender).length === 0) {
    return { ok: false, error: `${v.firstName} n’a pas l’âge requis pour « ${category.name} ».` };
  }

  const db = getDatabase();
  const availability = (await clubAvailability(db, club.id, club.current_season, [category])).get(category.id)!;
  if (availability.publicState === 'open') {
    return { ok: false, error: `Il reste des places en « ${category.name} » : inscrivez-vous directement depuis la page Inscription.` };
  }
  if (availability.publicState === 'closed') return { ok: false, error: `« ${category.name} » n’accepte pas de demande pour le moment.` };

  const { data: row, error } = await admin
    .from('preregistrations')
    .insert({
      club_id: club.id,
      category_id: category.id,
      season: club.current_season,
      first_name: v.firstName,
      last_name: v.lastName.toUpperCase(),
      birth_date: v.birthDate,
      gender: v.gender,
      contact_name: v.contactName,
      email: v.email,
      phone: v.phone,
      message: v.message || null,
    })
    .select('id')
    .maybeSingle();
  if (error || !row) {
    return /UNIQUE/i.test(error?.message ?? '')
      ? { ok: false, error: `Une demande est déjà enregistrée pour ${v.firstName} dans cette catégorie.` }
      : { ok: false, error: 'Enregistrement impossible. Réessayez dans un instant.' };
  }
  const position = await queuePosition(db, row.id);
  const kind = availability.publicState === 'waitlist' ? 'waitlist' : 'preregistration';
  await sendClubEmailSafely({
    club,
    to: v.email,
    subject: `${kind === 'waitlist' ? 'Liste d’attente' : 'Pré-inscription'} - ${club.name}`,
    kind: 'preinscription_recue',
    reactComponent: createElement(PreregistrationReceivedEmail, {
      club,
      contactName: v.contactName,
      personName: `${v.firstName} ${v.lastName}`,
      categoryName: category.name,
      kind,
      position,
    }),
  });
  return { ok: true, data: { position }, message: 'Demande enregistrée.' };
}

// ---------------------------------------------------------------------------
// Back-office
// ---------------------------------------------------------------------------

async function requireClub(permission: Permission) {
  const ctx = await getClubContext();
  if (!ctx) throw new Error('Session expirée : reconnectez-vous.');
  if (!grantsCan(ctx.grants, permission)) throw new Error('Action non autorisée pour votre compte.');
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

export async function invitePreregistration(id: string): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireClub('members.write');
    const prId = z.string().uuid().parse(id);
    const db = getDatabase();
    const token = await issueInvitation(db, club.id, prId);
    if (!token) return { ok: false, error: 'Cette demande n’est plus en attente.' };
    const { data: row } = await createAdminClient().from('preregistrations').select('*').eq('id', prId).eq('club_id', club.id).maybeSingle();
    if (!row) return { ok: false, error: 'Demande introuvable.' };
    try {
      await sendInvitationEmail(club, row, token, row.invite_expires_at!);
    } catch {
      // Sans e-mail, la famille ne saurait rien : on rend la place au lieu de la bloquer.
      await setPreregistrationStatus(db, club.id, prId, 'waiting');
      return { ok: false, error: 'E-mail impossible à envoyer : la demande reste en attente.' };
    }
    revalidatePath('/club-admin/preinscriptions');
    return { ok: true, message: `Invitation envoyée à ${row.email}.` };
  });
}

export async function updatePreregistrationStatus(id: string, status: 'waiting' | 'declined' | 'cancelled' | 'registered'): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireClub('members.write');
    const s = z.enum(['waiting', 'declined', 'cancelled', 'registered']).parse(status);
    const ok = await setPreregistrationStatus(getDatabase(), club.id, z.string().uuid().parse(id), s);
    if (!ok) return { ok: false, error: 'Demande introuvable ou déjà inscrite.' };
    revalidatePath('/club-admin/preinscriptions');
    return { ok: true };
  });
}

/** Mode d'inscription d'une catégorie et invitation automatique. */
export async function updateCategoryRegistration(categoryId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireClub('organization.manage');
    const v = z.object({ mode: z.enum(['open', 'preregistration', 'closed']), autoInvite: z.boolean() }).parse(input);
    const { error } = await createAdminClient()
      .from('categories')
      .update({ registration_mode: v.mode, auto_invite: v.autoInvite })
      .eq('id', z.string().uuid().parse(categoryId))
      .eq('club_id', club.id);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    revalidateTag(clubTag(club.slug));
    revalidatePath('/club-admin/preinscriptions');
    return { ok: true, message: 'Catégorie mise à jour.' };
  });
}
