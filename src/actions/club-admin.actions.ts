'use server';

import { createElement } from 'react';
import { revalidatePath, revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, getClubContext, isManager, type ClubContext } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { deletePrivateFiles, PUBLIC_BUCKET, publicAssetUrl, signedPrivateUrl, uploadClubFile, UploadError } from '@/lib/supabase/storage';
import { getStripe } from '@/lib/stripe/client';
import { encryptSecret } from '@/lib/utils/crypto';
import { IMPERSONATION_COOKIE } from '@/lib/utils/impersonation';
import { isAllowedSmtpHost, sendClubEmail, sendClubEmailSafely } from '@/lib/email/mailer';
import { ConvocationEmail, CorrectionRequestEmail, DossierValidatedEmail, RenewalInvitationEmail, TestEmail } from '@/lib/email/templates';
import { appUrl, clubSiteUrl } from '@/lib/env';
import { clubTag, DOMAINS_TAG } from '@/lib/tenant';
import { previousSeason, todayIso } from '@/lib/season';
import { firstError, hexColor, httpUrl, slugify, type ActionResult } from '@/lib/validation';
import type { StaffRole } from '@/types/database';

type Ctx = ClubContext & { supabase: Awaited<ReturnType<typeof createClient>> };

/** Contexte du club courant + contrôle de rôle. Lève une erreur lisible sinon. */
async function requireCtx(roles?: StaffRole[]): Promise<Ctx> {
  const ctx = await getClubContext();
  if (!ctx) throw new Error('Session expirée : reconnectez-vous.');
  if (roles && !roles.includes(ctx.role) && ctx.role !== 'super_admin') throw new Error('Action réservée au bureau du club.');
  return { ...ctx, supabase: await createClient() };
}

const MANAGERS: StaffRole[] = ['president', 'secretary', 'treasurer'];

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error; // redirect()
    console.error('[club-admin]', error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof Error ? error.message : 'Une erreur est survenue.' };
  }
}

function refreshPublic(slug: string) {
  revalidateTag(clubTag(slug));
}

const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Inscriptions : validation split-screen
// ---------------------------------------------------------------------------

export async function getMemberDocumentUrl(memberId: string, kind: 'photo' | 'medical' | 'id'): Promise<ActionResult<{ url: string; isPdf: boolean }>> {
  return run(async () => {
    const { supabase } = await requireCtx(MANAGERS);
    // La lecture passe par la RLS : un identifiant d'un autre club ne renvoie rien.
    const { data: member } = await supabase.from('members').select('photo_storage_path, medical_doc_storage_path, id_doc_storage_path').eq('id', uuid.parse(memberId)).maybeSingle();
    const path = member && { photo: member.photo_storage_path, medical: member.medical_doc_storage_path, id: member.id_doc_storage_path }[kind];
    if (!path) return { ok: false, error: 'Aucune pièce de ce type.' };
    const url = await signedPrivateUrl(path, 300);
    if (!url) return { ok: false, error: 'Pièce introuvable.' };
    return { ok: true, data: { url, isPdf: path.endsWith('.pdf') } };
  });
}

export async function validateMember(memberId: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const { data: member, error } = await supabase
      .from('members')
      .update({ dossier_status: 'validated', rejection_reason: null })
      .eq('id', uuid.parse(memberId))
      .eq('club_id', club.id)
      .select('*')
      .single();
    if (error || !member) return { ok: false, error: 'Dossier introuvable.' };
    const [{ data: family }, { data: category }] = await Promise.all([
      member.family_id ? supabase.from('family_registrations').select('payer_email').eq('id', member.family_id).maybeSingle() : Promise.resolve({ data: null }),
      member.category_id ? supabase.from('categories').select('name').eq('id', member.category_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    if (family?.payer_email) {
      await sendClubEmailSafely({
        club,
        to: family.payer_email,
        subject: `Inscription validée - ${member.first_name}`,
        reactComponent: createElement(DossierValidatedEmail, { club, memberName: `${member.first_name} ${member.last_name}`, categoryName: category?.name ?? '' }),
      });
    }
    revalidatePath('/club-admin/inscriptions');
    return { ok: true, message: 'Dossier validé.' };
  });
}

export async function requestCorrection(memberId: string, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const cleanReason = z.string().trim().min(5, 'Précisez la pièce à remplacer.').max(500).parse(reason);
    const token = crypto.randomUUID();
    const { data: member, error } = await supabase
      .from('members')
      .update({ dossier_status: 'needs_correction', rejection_reason: cleanReason, magic_action_token: token })
      .eq('id', uuid.parse(memberId))
      .eq('club_id', club.id)
      .select('*')
      .single();
    if (error || !member) return { ok: false, error: 'Dossier introuvable.' };
    const { data: family } = member.family_id
      ? await supabase.from('family_registrations').select('payer_email').eq('id', member.family_id).maybeSingle()
      : { data: null };
    if (!family?.payer_email) return { ok: false, error: 'Aucune adresse e-mail pour ce dossier.' };
    await sendClubEmail({
      club,
      to: family.payer_email,
      subject: `Dossier de ${member.first_name} : une pièce à remplacer`,
      reactComponent: createElement(CorrectionRequestEmail, {
        club,
        memberName: `${member.first_name} ${member.last_name}`,
        reason: cleanReason,
        link: `${clubSiteUrl(club)}/correction/${token}`,
      }),
    });
    revalidatePath('/club-admin/inscriptions');
    return { ok: true, message: 'Lien de correction envoyé à la famille.' };
  });
}

export async function rejectMember(memberId: string, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const { error } = await supabase
      .from('members')
      .update({ dossier_status: 'rejected', rejection_reason: z.string().trim().max(500).parse(reason) || null })
      .eq('id', uuid.parse(memberId))
      .eq('club_id', club.id);
    if (error) return { ok: false, error: 'Mise à jour impossible.' };
    revalidatePath('/club-admin/inscriptions');
    return { ok: true, message: 'Dossier refusé.' };
  });
}

export async function markTrialDone(memberId: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx();
    await supabase.from('members').update({ dossier_status: 'trial_done' }).eq('id', uuid.parse(memberId)).eq('club_id', club.id);
    revalidatePath('/club-admin/inscriptions');
    return { ok: true };
  });
}

export async function verifyPassSport(memberId: string, verified: boolean): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('members').update({ pass_sport_verified: verified }).eq('id', uuid.parse(memberId)).eq('club_id', club.id);
    revalidatePath('/club-admin/inscriptions');
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Trésorerie : échéancier et règlements
// ---------------------------------------------------------------------------

const installmentSchema = z.object({
  familyId: z.string().uuid(),
  amount: z.coerce.number().positive('Montant positif.').max(10000),
  paymentType: z.enum(['check', 'cash', 'transfer', 'pass_sport', 'caf', 'other_aid', 'card']),
  checkNumber: z.string().trim().max(30).optional(),
  scheduledDepositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['pending', 'deposited', 'cashed', 'rejected']).default('pending'),
});

/** Recalcule le montant encaissé d'un dossier à partir de son échéancier. */
async function syncFamilyPaid(supabase: Ctx['supabase'], familyId: string) {
  const [{ data: family }, { data: rows }] = await Promise.all([
    supabase.from('family_registrations').select('final_total_amount, stripe_checkout_session_id').eq('id', familyId).single(),
    supabase.from('payment_installments').select('amount, status, payment_type').eq('family_id', familyId),
  ]);
  if (!family) return;
  const paid = (rows ?? []).filter((r) => r.status === 'deposited' || r.status === 'cashed').reduce((s, r) => s + Number(r.amount), 0);
  const amount = Math.round(paid * 100) / 100;
  const total = Number(family.final_total_amount);
  const types = new Set((rows ?? []).filter((r) => r.status !== 'rejected').map((r) => r.payment_type));
  await supabase
    .from('family_registrations')
    .update({
      amount_paid: amount,
      payment_status: amount >= total ? 'paid' : amount > 0 ? 'partial' : 'unpaid',
      payment_method: types.size > 1 ? 'mixed' : types.size === 1 ? ([...types][0] === 'caf' || [...types][0] === 'other_aid' ? 'mixed' : ([...types][0] as 'check')) : undefined,
    })
    .eq('id', familyId);
}

export async function addInstallment(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = installmentSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const v = parsed.data;
    const { error } = await supabase.from('payment_installments').insert({
      club_id: club.id,
      family_id: v.familyId,
      amount: v.amount,
      payment_type: v.paymentType,
      check_number: v.checkNumber || null,
      scheduled_deposit_date: v.scheduledDepositDate,
      status: v.status,
    });
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    await syncFamilyPaid(supabase, v.familyId);
    revalidatePath('/club-admin/tresorerie');
    return { ok: true, message: 'Règlement ajouté.' };
  });
}

export async function updateInstallment(id: string, patch: { status?: string; checkNumber?: string; scheduledDepositDate?: string }): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const v = z
      .object({
        status: z.enum(['pending', 'deposited', 'cashed', 'rejected']).optional(),
        checkNumber: z.string().trim().max(30).optional(),
        scheduledDepositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(patch);
    const { data, error } = await supabase
      .from('payment_installments')
      .update({
        ...(v.status ? { status: v.status } : {}),
        ...(v.checkNumber !== undefined ? { check_number: v.checkNumber || null } : {}),
        ...(v.scheduledDepositDate ? { scheduled_deposit_date: v.scheduledDepositDate } : {}),
      })
      .eq('id', uuid.parse(id))
      .eq('club_id', club.id)
      .select('family_id')
      .single();
    if (error || !data) return { ok: false, error: 'Échéance introuvable.' };
    await syncFamilyPaid(supabase, data.family_id);
    revalidatePath('/club-admin/tresorerie');
    return { ok: true };
  });
}

export async function deleteInstallment(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const { data } = await supabase.from('payment_installments').delete().eq('id', uuid.parse(id)).eq('club_id', club.id).select('family_id').single();
    if (data) await syncFamilyPaid(supabase, data.family_id);
    revalidatePath('/club-admin/tresorerie');
    return { ok: true };
  });
}

export async function updateOrderStatus(orderId: string, status: 'to_order' | 'ordered' | 'received' | 'delivered'): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('member_product_orders').update({ delivery_status: z.enum(['to_order', 'ordered', 'received', 'delivered']).parse(status) }).eq('id', uuid.parse(orderId)).eq('club_id', club.id);
    revalidatePath('/club-admin/tresorerie');
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Feuille d'appel
// ---------------------------------------------------------------------------

const attendanceSchema = z.object({
  scheduleId: z.string().uuid(),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(z.object({ memberId: z.string().uuid(), isPresent: z.boolean() })).max(200),
});

/** Enregistre (ou rejoue après une coupure réseau) une feuille d'appel : opération idempotente. */
export async function saveAttendance(input: unknown): Promise<ActionResult<{ saved: number }>> {
  return run(async () => {
    const { supabase, club } = await requireCtx();
    const parsed = attendanceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { scheduleId, sessionDate, entries } = parsed.data;
    if (sessionDate > todayIso()) return { ok: false, error: 'Impossible de faire l\'appel d\'une séance future.' };
    const { error } = await supabase.from('attendances').upsert(
      entries.map((e) => ({ club_id: club.id, schedule_id: scheduleId, member_id: e.memberId, session_date: sessionDate, is_present: e.isPresent })),
      { onConflict: 'schedule_id,member_id,session_date' },
    );
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    return { ok: true, data: { saved: entries.length } };
  });
}

// ---------------------------------------------------------------------------
// Sportif : sections, créneaux, lieux, événements, convocations
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(60),
  min_birth_year: z.coerce.number().int().min(1920).max(2030),
  max_birth_year: z.coerce.number().int().min(1920).max(2030),
  gender_filter: z.enum(['mixed', 'M', 'F']),
  annual_price: z.coerce.number().min(0).max(5000),
  max_capacity: z.coerce.number().int().min(1).max(1000),
  medical_requirement: z.enum(['health_questionnaire', 'medical_cert_standard', 'medical_cert_competition']),
  coach_name: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  display_order: z.coerce.number().int().min(0).max(999).default(0),
});

export async function upsertCategory(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = categorySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    if (v.min_birth_year > v.max_birth_year) return { ok: false, error: 'L\'année de naissance minimale doit précéder la maximale.' };
    const row = { ...v, coach_name: v.coach_name || null, description: v.description || null, club_id: club.id };
    const { error } = id ? await supabase.from('categories').update(row).eq('id', id).eq('club_id', club.id) : await supabase.from('categories').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true, message: 'Section enregistrée.' };
  });
}

export async function deleteCategory(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const { error } = await supabase.from('categories').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    if (error) return { ok: false, error: 'Suppression impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true };
  });
}

const scheduleSchema = z.object({
  id: z.string().uuid().optional(),
  category_id: z.string().uuid(),
  facility_id: z.string().uuid().nullable().optional(),
  day_of_week: z.coerce.number().int().min(1).max(7),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function upsertSchedule(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = scheduleSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    if (v.start_time >= v.end_time) return { ok: false, error: 'L\'heure de fin doit suivre l\'heure de début.' };
    const row = { ...v, facility_id: v.facility_id || null, club_id: club.id };
    const { error } = id ? await supabase.from('schedules').update(row).eq('id', id).eq('club_id', club.id) : await supabase.from('schedules').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true, message: 'Créneau enregistré.' };
  });
}

export async function deleteSchedule(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('schedules').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true };
  });
}

const facilitySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().min(1).max(160),
  city: z.string().trim().min(1).max(80),
  postal_code: z.string().trim().regex(/^\d{5}$/, 'Code postal à 5 chiffres.'),
  google_maps_url: httpUrl(500).optional().or(z.literal('')),
  latitude: z.coerce.number().min(-90).max(90).optional().or(z.literal('')),
  longitude: z.coerce.number().min(-180).max(180).optional().or(z.literal('')),
});

export async function upsertFacility(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = facilitySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    const row = {
      ...v,
      google_maps_url: v.google_maps_url || null,
      latitude: v.latitude === '' || v.latitude === undefined ? null : v.latitude,
      longitude: v.longitude === '' || v.longitude === undefined ? null : v.longitude,
      club_id: club.id,
    };
    const { error } = id ? await supabase.from('facilities').update(row).eq('id', id).eq('club_id', club.id) : await supabase.from('facilities').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true, message: 'Lieu enregistré.' };
  });
}

export async function deleteFacility(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('facilities').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true };
  });
}

const eventSchema = z.object({
  id: z.string().uuid().optional(),
  category_id: z.string().uuid().nullable().optional().or(z.literal('')),
  event_type: z.enum(['competition', 'tournament', 'training_camp', 'club_event', 'meeting']),
  title: z.string().trim().min(1).max(120),
  event_date: z.string().min(10),
  location_text: z.string().trim().max(160).optional(),
  is_home: z.boolean().default(true),
  score_club: z.coerce.number().int().min(0).max(999).nullable().optional().or(z.literal('')),
  score_opponent: z.coerce.number().int().min(0).max(999).nullable().optional().or(z.literal('')),
});

export async function upsertEvent(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx();
    const parsed = eventSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    const date = new Date(v.event_date);
    if (Number.isNaN(date.getTime())) return { ok: false, error: 'Date invalide.' };
    const row = {
      ...v,
      event_date: date.toISOString(),
      category_id: v.category_id || null,
      location_text: v.location_text || null,
      score_club: v.score_club === '' || v.score_club === undefined ? null : v.score_club,
      score_opponent: v.score_opponent === '' || v.score_opponent === undefined ? null : v.score_opponent,
      club_id: club.id,
    };
    const { error } = id ? await supabase.from('events').update(row).eq('id', id).eq('club_id', club.id) : await supabase.from('events').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true, message: 'Événement enregistré.' };
  });
}

export async function deleteEvent(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx();
    await supabase.from('events').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    refreshPublic(club.slug);
    revalidatePath('/club-admin/sportif');
    return { ok: true };
  });
}

/** Convoque des adhérents validés et envoie le lien de réponse aux familles. */
export async function sendConvocations(eventId: string, memberIds: string[]): Promise<ActionResult<{ sent: number }>> {
  return run(async () => {
    const { supabase, club } = await requireCtx();
    const ids = z.array(z.string().uuid()).min(1, 'Sélectionnez au moins une personne.').max(100).parse(memberIds);
    const { data: event } = await supabase.from('events').select('*').eq('id', uuid.parse(eventId)).eq('club_id', club.id).maybeSingle();
    if (!event) return { ok: false, error: 'Événement introuvable.' };
    const { data: convocations, error } = await supabase
      .from('event_convocations')
      .upsert(ids.map((member_id) => ({ club_id: club.id, event_id: event.id, member_id })), { onConflict: 'event_id,member_id' })
      .select('*');
    if (error || !convocations) return { ok: false, error: 'Convocations impossibles.' };
    const { data: members } = await supabase.from('members').select('id, first_name, last_name, family_id').in('id', ids).eq('club_id', club.id);
    const familyIds = [...new Set((members ?? []).map((m) => m.family_id).filter((x): x is string => Boolean(x)))];
    const { data: families } = familyIds.length ? await supabase.from('family_registrations').select('id, payer_email').in('id', familyIds) : { data: [] };
    const emailByFamily = new Map((families ?? []).map((f) => [f.id, f.payer_email]));
    const dateLabel = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(event.event_date));
    let sent = 0;
    for (const c of convocations) {
      const member = members?.find((m) => m.id === c.member_id);
      const to = member?.family_id ? emailByFamily.get(member.family_id) : undefined;
      if (!member || !to) continue;
      const ok = await sendClubEmailSafely({
        club,
        to,
        subject: `Convocation : ${event.title}`,
        reactComponent: createElement(ConvocationEmail, {
          club,
          memberName: `${member.first_name} ${member.last_name}`,
          eventTitle: event.title,
          dateLabel,
          location: event.location_text ?? club.city,
          link: `${clubSiteUrl(club)}/convocation/${c.response_token}`,
        }),
      });
      if (ok) sent++;
    }
    revalidatePath('/club-admin/sportif');
    return { ok: true, data: { sent }, message: `${sent} convocation(s) envoyée(s).` };
  });
}

// ---------------------------------------------------------------------------
// Contenus : textes, actualités, partenaires, boutique, images
// ---------------------------------------------------------------------------

export async function updateClubTexts(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const v = z
      .object({
        club_history_text: z.string().trim().max(5000),
        president_word_text: z.string().trim().max(3000),
        president_name: z.string().trim().max(80),
      })
      .parse(input);
    const { error } = await supabase
      .from('clubs')
      .update({ club_history_text: v.club_history_text || null, president_word_text: v.president_word_text || null, president_name: v.president_name || null })
      .eq('id', club.id);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true, message: 'Textes enregistrés.' };
  });
}

const postSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(140),
  content: z.string().trim().min(1).max(20000),
  cover_image_url: httpUrl(500).optional().or(z.literal('')),
  is_published: z.boolean(),
});

export async function upsertPost(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = postSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    const row = { ...v, cover_image_url: v.cover_image_url || null, club_id: club.id };
    if (id) {
      const { error } = await supabase.from('posts').update(row).eq('id', id).eq('club_id', club.id);
      if (error) return { ok: false, error: 'Enregistrement impossible.' };
    } else {
      const base = slugify(v.title) || 'actualite';
      let slug = base;
      for (let i = 2; i < 50; i++) {
        const { count } = await supabase.from('posts').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('slug', slug);
        if (!count) break;
        slug = `${base}-${i}`;
      }
      const { error } = await supabase.from('posts').insert({ ...row, slug });
      if (error) return { ok: false, error: 'Enregistrement impossible.' };
    }
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true, message: 'Actualité enregistrée.' };
  });
}

export async function deletePost(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('posts').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true };
  });
}

const sponsorSchema = z.object({
  id: z.string().uuid().optional(),
  company_name: z.string().trim().min(1).max(100),
  logo_url: httpUrl(500),
  website_url: httpUrl(300).optional().or(z.literal('')),
  description: z.string().trim().max(500).optional(),
  display_order: z.coerce.number().int().min(0).max(999).default(0),
});

export async function upsertSponsor(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = sponsorSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    const row = { ...v, website_url: v.website_url || null, description: v.description || null, club_id: club.id };
    const { error } = id ? await supabase.from('sponsors').update(row).eq('id', id).eq('club_id', club.id) : await supabase.from('sponsors').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true, message: 'Partenaire enregistré.' };
  });
}

export async function deleteSponsor(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('sponsors').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true };
  });
}

export async function updateSponsorLead(id: string, status: 'new' | 'contacted' | 'won' | 'lost'): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    await supabase.from('sponsor_leads').update({ status: z.enum(['new', 'contacted', 'won', 'lost']).parse(status) }).eq('id', uuid.parse(id)).eq('club_id', club.id);
    revalidatePath('/club-admin/contenus');
    return { ok: true };
  });
}

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  price: z.coerce.number().min(0).max(1000),
  available_sizes: z.string().trim().max(300),
  photo_url: httpUrl(500).optional().or(z.literal('')),
});

export async function upsertProduct(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    const sizes = v.available_sizes.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 30);
    if (sizes.length === 0) return { ok: false, error: 'Indiquez au moins une taille (séparées par des virgules).' };
    const row = { name: v.name, price: v.price, available_sizes: sizes, photo_url: v.photo_url || null, club_id: club.id };
    const { error } = id ? await supabase.from('club_products').update(row).eq('id', id).eq('club_id', club.id) : await supabase.from('club_products').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true, message: 'Article enregistré.' };
  });
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const { error } = await supabase.from('club_products').delete().eq('id', uuid.parse(id)).eq('club_id', club.id);
    if (error) return { ok: false, error: 'Suppression impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin/contenus');
    return { ok: true };
  });
}

/**
 * Dépose une image publique du club. Pour le logo, la photo d'accueil et la
 * signature, la colonne du club est mise à jour ; sinon l'URL est renvoyée
 * (couverture d'actualité, logo de partenaire, photo d'article).
 */
export async function uploadClubImage(formData: FormData): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const kind = z.enum(['logo', 'hero', 'signature', 'post', 'sponsor', 'product']).parse(formData.get('kind'));
    const file = formData.get('file');
    if (!(file instanceof File)) return { ok: false, error: 'Aucun fichier.' };
    let path: string;
    try {
      path = await uploadClubFile(PUBLIC_BUCKET, club.id, kind, file, false);
    } catch (error) {
      return { ok: false, error: error instanceof UploadError ? error.message : 'Envoi impossible.' };
    }
    const url = publicAssetUrl(path);
    const patch =
      kind === 'logo' ? { logo_url: url } : kind === 'hero' ? { hero_image_url: url } : kind === 'signature' ? { president_signature_url: url } : null;
    if (patch) {
      await supabase.from('clubs').update(patch).eq('id', club.id);
      refreshPublic(club.slug);
      revalidatePath('/club-admin', 'layout');
    }
    return { ok: true, data: { url } };
  });
}

// ---------------------------------------------------------------------------
// Paramètres
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  sport_type: z.string().trim().min(1).max(30),
  primary_color: hexColor,
  secondary_color: hexColor,
  city: z.string().trim().min(1).max(80),
  postal_code: z.string().trim().regex(/^\d{5}$/),
  nearby_cities: z.string().trim().max(400),
  contact_email: z.string().trim().email(),
  contact_phone: z.string().trim().max(20),
  rna_number: z.string().trim().max(20),
  siret_number: z.string().trim().max(20),
  federation_name: z.string().trim().max(120),
  affiliation_number: z.string().trim().max(40),
  facebook: httpUrl(300).or(z.literal('')),
  instagram: httpUrl(300).or(z.literal('')),
  whatsapp: httpUrl(300).or(z.literal('')),
  current_season: z.string().regex(/^\d{4}-\d{4}$/),
  sibling_enabled: z.boolean(),
  second_member_discount: z.coerce.number().min(0).max(1000),
  third_member_discount: z.coerce.number().min(0).max(1000),
  discount_type: z.enum(['fixed_euros', 'percent']),
  accepts_pass_sport: z.boolean(),
  pass_sport_amount: z.coerce.number().min(0).max(500),
  accepts_caf_aids: z.boolean(),
  accepts_installments: z.boolean(),
  pass_stripe_fees_to_parents: z.boolean(),
  modules: z.object({
    inscriptions: z.boolean(),
    trials: z.boolean(),
    payments: z.boolean(),
    boutique: z.boolean(),
    attendance: z.boolean(),
    sponsors: z.boolean(),
    social_generator: z.boolean(),
  }),
});

export async function updateClubSettings(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { supabase, club } = await requireCtx(MANAGERS);
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const v = parsed.data;
    if (v.discount_type === 'percent' && (v.second_member_discount > 100 || v.third_member_discount > 100)) {
      return { ok: false, error: 'Une remise en pourcentage ne peut dépasser 100 %.' };
    }
    const { error } = await supabase
      .from('clubs')
      .update({
        name: v.name,
        sport_type: v.sport_type,
        primary_color: v.primary_color.toUpperCase(),
        secondary_color: v.secondary_color.toUpperCase(),
        city: v.city,
        postal_code: v.postal_code,
        nearby_cities: v.nearby_cities.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 15),
        contact_email: v.contact_email,
        contact_phone: v.contact_phone || null,
        rna_number: v.rna_number || null,
        siret_number: v.siret_number || null,
        federation_name: v.federation_name || null,
        affiliation_number: v.affiliation_number || null,
        social_links: { facebook: v.facebook, instagram: v.instagram, whatsapp: v.whatsapp },
        current_season: v.current_season,
        sibling_discount_rules: { enabled: v.sibling_enabled, second_member_discount: v.second_member_discount, third_member_discount: v.third_member_discount, discount_type: v.discount_type },
        accepts_pass_sport: v.accepts_pass_sport,
        pass_sport_amount: v.pass_sport_amount,
        accepts_caf_aids: v.accepts_caf_aids,
        accepts_installments: v.accepts_installments,
        pass_stripe_fees_to_parents: v.pass_stripe_fees_to_parents,
        // Le module vitrine reste toujours actif : c'est le cœur de l'offre.
        enabled_modules: { ...v.modules, vitrine: true, payments: v.modules.payments && club.subscription_plan === 'integral' },
      })
      .eq('id', club.id);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    refreshPublic(club.slug);
    revalidatePath('/club-admin', 'layout');
    return { ok: true, message: 'Paramètres enregistrés.' };
  });
}

export async function saveSmtpSettings(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireCtx(['president', 'secretary']);
    const parsed = z
      .object({
        host: z.string().trim().min(3).max(120),
        port: z.coerce.number().int().refine((p) => [25, 465, 587, 2525].includes(p), 'Port SMTP : 465 ou 587.'),
        user: z.string().trim().email('L\'identifiant SMTP doit être une adresse e-mail.'),
        pass: z.string().min(1, 'Mot de passe obligatoire.').max(200),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const v = parsed.data;
    if (!isAllowedSmtpHost(v.host)) return { ok: false, error: 'Serveur SMTP non autorisé.' };
    const admin = createAdminClient();
    const { error } = await admin.from('club_mail_credentials').upsert({
      club_id: club.id,
      smtp_settings_enc: encryptSecret(JSON.stringify({ host: v.host, port: v.port, secure: v.port === 465, user: v.user, pass: v.pass })),
      updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    await admin.from('clubs').update({ email_provider: 'smtp', email_sender_address: v.user }).eq('id', club.id);
    revalidatePath('/club-admin/parametres');
    return { ok: true, message: 'Serveur SMTP enregistré. Envoyez un e-mail de test pour vérifier.' };
  });
}

export async function selectEmailProvider(provider: 'platform' | 'gmail' | 'smtp'): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireCtx(['president', 'secretary']);
    const p = z.enum(['platform', 'gmail', 'smtp']).parse(provider);
    const admin = createAdminClient();
    if (p !== 'platform') {
      const { data: creds } = await admin.from('club_mail_credentials').select('*').eq('club_id', club.id).maybeSingle();
      if (p === 'gmail' && !creds?.google_refresh_token_enc) return { ok: false, error: 'Connectez d\'abord votre compte Gmail.' };
      if (p === 'smtp' && !creds?.smtp_settings_enc) return { ok: false, error: 'Renseignez d\'abord votre serveur SMTP.' };
    }
    await admin.from('clubs').update({ email_provider: p }).eq('id', club.id);
    revalidatePath('/club-admin/parametres');
    return { ok: true };
  });
}

export async function disconnectEmailAccount(kind: 'gmail' | 'smtp'): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireCtx(['president', 'secretary']);
    const admin = createAdminClient();
    await admin
      .from('club_mail_credentials')
      .update(kind === 'gmail' ? { google_refresh_token_enc: null, google_account_email: null } : { smtp_settings_enc: null })
      .eq('club_id', club.id);
    if (club.email_provider === kind) await admin.from('clubs').update({ email_provider: 'platform' }).eq('id', club.id);
    revalidatePath('/club-admin/parametres');
    return { ok: true, message: 'Déconnecté. Les e-mails partent désormais du serveur Licyo.' };
  });
}

export async function sendTestEmail(): Promise<ActionResult> {
  return run(async () => {
    const { club, auth } = await requireCtx(MANAGERS);
    const labels = { platform: 'serveur Licyo', gmail: 'Gmail', smtp: 'serveur SMTP du club' };
    const result = await sendClubEmail({
      club,
      to: auth.email,
      subject: `Test d'envoi - ${club.name}`,
      reactComponent: createElement(TestEmail, { club, provider: labels[club.email_provider] }),
    });
    if (result.provider !== club.email_provider) {
      return { ok: false, error: `L'envoi via ${labels[club.email_provider]} a échoué ; le test est parti via le serveur Licyo. Vérifiez vos paramètres.` };
    }
    return { ok: true, message: `E-mail de test envoyé à ${auth.email} via ${labels[result.provider]}.` };
  });
}

/** Ouvre (ou reprend) l'inscription Stripe Connect du club pour encaisser en ligne. */
export async function startStripeConnect(): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const { club } = await requireCtx(['president', 'treasurer']);
    if (club.subscription_plan !== 'integral') return { ok: false, error: 'Le paiement en ligne est inclus dans l\'offre Intégral.' };
    const stripe = getStripe();
    let accountId = club.stripe_connect_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'standard',
        country: 'FR',
        email: club.contact_email,
        business_profile: { name: club.name, mcc: '7941', url: clubSiteUrl(club) },
        metadata: { club_id: club.id },
      });
      accountId = account.id;
      await createAdminClient().from('clubs').update({ stripe_connect_account_id: accountId }).eq('id', club.id);
    }
    const link = await stripe.accountLinks.create({
      account: accountId,
      type: 'account_onboarding',
      refresh_url: `${appUrl()}/club-admin/parametres?stripe=reprendre`,
      return_url: `${appUrl()}/club-admin/parametres?stripe=retour`,
    });
    return { ok: true, data: { url: link.url } };
  });
}

/** Relit l'état du compte Connect au retour de Stripe. */
export async function refreshStripeConnectStatus(): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireCtx(MANAGERS);
    if (!club.stripe_connect_account_id) return { ok: false, error: 'Aucun compte Stripe.' };
    const account = await getStripe().accounts.retrieve(club.stripe_connect_account_id);
    await createAdminClient().from('clubs').update({ stripe_connect_onboarded: Boolean(account.charges_enabled) }).eq('id', club.id);
    revalidatePath('/club-admin/parametres');
    return { ok: true, message: account.charges_enabled ? 'Paiement en ligne activé.' : 'Stripe attend encore des informations.' };
  });
}

/** Abonnement à la plateforme (Stripe Billing). */
export async function startSubscriptionCheckout(plan: 'vitrine' | 'integral'): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const { club, auth } = await requireCtx(['president', 'treasurer']);
    const { priceIdForPlan } = await import('@/lib/stripe/client');
    const p = z.enum(['vitrine', 'integral']).parse(plan);
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceIdForPlan(p), quantity: 1 }],
      customer: club.stripe_customer_id ?? undefined,
      customer_email: club.stripe_customer_id ? undefined : auth.email,
      client_reference_id: club.id,
      metadata: { club_id: club.id, plan: p },
      subscription_data: { metadata: { club_id: club.id, plan: p } },
      success_url: `${appUrl()}/club-admin/parametres?abonnement=ok`,
      cancel_url: `${appUrl()}/club-admin/parametres`,
    });
    return { ok: true, data: { url: session.url! } };
  });
}

export async function openBillingPortal(): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const { club } = await requireCtx(['president', 'treasurer']);
    if (!club.stripe_customer_id) return { ok: false, error: 'Aucun abonnement en cours.' };
    const portal = await getStripe().billingPortal.sessions.create({ customer: club.stripe_customer_id, return_url: `${appUrl()}/club-admin/parametres` });
    return { ok: true, data: { url: portal.url } };
  });
}

/**
 * Domaine personnalisé : seulement enregistré en base. Le proxy (Caddy, TLS à
 * la demande) interroge /api/domains/check avant d'émettre le certificat :
 * aucune API d'hébergeur, le projet reste déplaçable.
 */
export async function setCustomDomain(domain: string): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireCtx(['president']);
    const value = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const admin = createAdminClient();
    if (!value) {
      await admin.from('clubs').update({ custom_domain: null }).eq('id', club.id);
    } else {
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return { ok: false, error: 'Nom de domaine invalide (ex. www.monclub.fr).' };
      const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '').replace(/:\d+$/, '');
      if (root && (value === root || value.endsWith(`.${root}`))) return { ok: false, error: 'Ce domaine appartient à la plateforme.' };
      const { error } = await admin.from('clubs').update({ custom_domain: value }).eq('id', club.id);
      if (error) return { ok: false, error: 'Ce domaine est déjà utilisé par un autre club.' };
    }
    revalidateTag(DOMAINS_TAG);
    refreshPublic(club.slug);
    revalidatePath('/club-admin/parametres');
    const target = process.env.CUSTOM_DOMAIN_CNAME_TARGET ?? `sites.${(process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'licyo.fr').replace(/:\d+$/, '')}`;
    return { ok: true, message: value ? `Domaine enregistré. Chez votre registraire, créez un enregistrement CNAME de ${value} vers ${target}. Le HTTPS s'active tout seul.` : 'Domaine retiré.' };
  });
}

// ---------------------------------------------------------------------------
// Équipe du club
// ---------------------------------------------------------------------------

export async function inviteStaff(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const { club } = await requireCtx(['president']);
    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        fullName: z.string().trim().min(2).max(80),
        role: z.enum(['president', 'secretary', 'treasurer', 'coach']),
        categoryIds: z.array(z.string().uuid()).default([]),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const v = parsed.data;
    const admin = createAdminClient();
    const redirectTo = `${appUrl()}/auth/callback?next=/club-admin`;
    let userId: string | undefined;
    const invited = await admin.auth.admin.inviteUserByEmail(v.email, { redirectTo });
    if (invited.data.user) userId = invited.data.user.id;
    else {
      // Compte existant : on récupère son identifiant via un lien de connexion.
      const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: v.email, options: { redirectTo } });
      userId = link.data.user?.id;
    }
    if (!userId) return { ok: false, error: 'Invitation impossible.' };
    const { error } = await admin.from('staff_members').upsert(
      { user_id: userId, club_id: club.id, full_name: v.fullName, email: v.email, role: v.role, assigned_category_ids: v.categoryIds },
      { onConflict: 'user_id,club_id' },
    );
    if (error) return { ok: false, error: 'Ajout impossible.' };
    revalidatePath('/club-admin/parametres');
    return { ok: true, message: invited.data.user ? `Invitation envoyée à ${v.email}.` : `${v.email} a déjà un compte : accès ajouté.` };
  });
}

export async function removeStaff(staffId: string): Promise<ActionResult> {
  return run(async () => {
    const { club, auth, supabase } = await requireCtx(['president']);
    const { data: target } = await supabase.from('staff_members').select('*').eq('id', uuid.parse(staffId)).eq('club_id', club.id).maybeSingle();
    if (!target) return { ok: false, error: 'Membre introuvable.' };
    if (target.user_id === auth.userId) return { ok: false, error: 'Vous ne pouvez pas retirer votre propre accès.' };
    await supabase.from('staff_members').delete().eq('id', target.id);
    revalidatePath('/club-admin/parametres');
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// RGPD, réinscriptions, navigation
// ---------------------------------------------------------------------------

/**
 * Purge des saisons anciennes : supprime adhérents, dossiers et pièces des
 * saisons antérieures à la saison précédente. Confirmation explicite exigée.
 */
export async function purgeOldSeasons(confirmation: string): Promise<ActionResult<{ deleted: number }>> {
  return run(async () => {
    const { club, supabase } = await requireCtx(['president']);
    if (confirmation !== 'SUPPRIMER') return { ok: false, error: 'Tapez SUPPRIMER pour confirmer.' };
    const keepFrom = previousSeason(club.current_season);
    const { data: oldMembers } = await supabase
      .from('members')
      .select('id, photo_storage_path, medical_doc_storage_path, id_doc_storage_path')
      .eq('club_id', club.id)
      .lt('season', keepFrom);
    const files = (oldMembers ?? []).flatMap((m) => [m.photo_storage_path, m.medical_doc_storage_path, m.id_doc_storage_path]).filter((p): p is string => Boolean(p));
    await deletePrivateFiles(files);
    await supabase.from('family_registrations').delete().eq('club_id', club.id).lt('season', keepFrom);
    await supabase.from('members').delete().eq('club_id', club.id).lt('season', keepFrom);
    revalidatePath('/club-admin', 'layout');
    return { ok: true, data: { deleted: oldMembers?.length ?? 0 }, message: `${oldMembers?.length ?? 0} fiche(s) et ${files.length} pièce(s) supprimées.` };
  });
}

/** Invite les adhérents validés de la saison précédente à se réinscrire. */
export async function sendRenewalInvitations(): Promise<ActionResult<{ sent: number }>> {
  return run(async () => {
    const { club, supabase } = await requireCtx(MANAGERS);
    const from = previousSeason(club.current_season);
    const { data: members } = await supabase.from('members').select('id, first_name, last_name, family_id, magic_action_token').eq('club_id', club.id).eq('season', from).eq('dossier_status', 'validated');
    const { data: already } = await supabase.from('members').select('first_name, last_name, birth_date').eq('club_id', club.id).eq('season', club.current_season);
    const familyIds = [...new Set((members ?? []).map((m) => m.family_id).filter((x): x is string => Boolean(x)))];
    const { data: families } = familyIds.length ? await supabase.from('family_registrations').select('id, payer_email').in('id', familyIds) : { data: [] };
    const emailByFamily = new Map((families ?? []).map((f) => [f.id, f.payer_email]));
    const renewed = new Set((already ?? []).map((m) => `${m.first_name}|${m.last_name}`.toLowerCase()));
    let sent = 0;
    for (const m of members ?? []) {
      const to = m.family_id ? emailByFamily.get(m.family_id) : undefined;
      if (!to || renewed.has(`${m.first_name}|${m.last_name}`.toLowerCase())) continue;
      if (
        await sendClubEmailSafely({
          club,
          to,
          subject: `Réinscription ${club.current_season} - ${club.name}`,
          reactComponent: createElement(RenewalInvitationEmail, {
            club,
            memberName: m.first_name,
            season: club.current_season,
            link: `${clubSiteUrl(club)}/renouvellement/${m.magic_action_token}`,
          }),
        })
      )
        sent++;
    }
    return { ok: true, data: { sent }, message: `${sent} invitation(s) envoyée(s).` };
  });
}

export async function switchActiveClub(clubId: string): Promise<void> {
  const ctx = await getClubContext();
  if (!ctx || !ctx.auth.memberships.some((m) => m.club_id === clubId)) return;
  (await cookies()).set('active_club', clubId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  redirect('/club-admin');
}

export async function exitImpersonation(): Promise<void> {
  (await cookies()).delete(IMPERSONATION_COOKIE);
  redirect('/super-admin/clubs');
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(IMPERSONATION_COOKIE);
  redirect('/login');
}

export async function canManage(): Promise<boolean> {
  const ctx = await getClubContext();
  return Boolean(ctx && isManager(ctx.role));
}
