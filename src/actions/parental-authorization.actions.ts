'use server';

import { createElement } from 'react';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { getClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { clubSiteUrl } from '@/lib/env';
import { sendClubEmailSafely } from '@/lib/email/mailer';
import { ParentalAuthorizationRequestEmail } from '@/lib/email/templates';
import { guardPublicForm, turnstileTokenFrom } from '@/lib/security/public-guard';
import { getSportPreset } from '@/config/sports-presets';
import { authorizationPending, buildSignedAuthorization, parseParentalAuthorization } from '@/config/parental-authorization';
import type { ActionResult } from '@/lib/validation';

// Autorisation parentale signée après l'inscription : par le lien personnel envoyé à la famille (enfants inscrits
// avant l'activation, séances d'essai, dossiers saisis par le bureau). Mêmes règles qu'à l'inscription : texte rendu
// par le serveur à partir des réglages du club, copie figée, une seule signature par adhérent et par saison.

const MEMBER_FIELDS = 'id, club_id, family_id, season, first_name, last_name, birth_date, is_minor, dossier_status, anonymized_at, parental_authorization, magic_action_token';
const SUBJECT = (name: string) => `Autorisation parentale à signer - ${name}`;

type Signable = { id: string; club_id: string; family_id: string | null; season: string; first_name: string; last_name: string; birth_date: string; is_minor: boolean; dossier_status: string; anonymized_at: string | null; parental_authorization: unknown; magic_action_token: string };

const signSchema = z.object({
  clubSlug: z.string().min(1).max(80),
  token: z.string().uuid(),
  signerName: z.string().trim().min(3, 'Nom du responsable légal obligatoire.').max(120),
  signerQuality: z.enum(['mere', 'pere', 'tuteur'], { errorMap: () => ({ message: 'Indiquez votre qualité (mère, père ou tuteur).' }) }),
  accepted: z.literal(true, { errorMap: () => ({ message: 'Vous devez accepter l’autorisation parentale.' }) }),
  signatureDataUrl: z.string().startsWith('data:image/png;base64,', 'La signature est obligatoire.').max(300_000, 'Signature trop lourde.'),
});

/** Signature par le lien personnel (page publique /autorisation/[token]). */
export async function signParentalAuthorization(input: unknown): Promise<ActionResult> {
  const blocked = await guardPublicForm({ bucket: 'autorisation', max: 10, windowSeconds: 3600, turnstileToken: turnstileTokenFrom(input) });
  if (blocked) return { ok: false, error: blocked };
  const parsed = signSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Formulaire incomplet.' };
  const v = parsed.data;
  const admin = createAdminClient();
  const { data: club } = await admin.from('clubs').select('*').eq('slug', v.clubSlug).maybeSingle();
  if (!club) return { ok: false, error: 'Club introuvable.' };
  const config = parseParentalAuthorization(club.registration_form);
  const { data: m } = await admin.from('members').select(MEMBER_FIELDS).eq('club_id', club.id).eq('magic_action_token', v.token).maybeSingle();
  if (!config.enabled || !authorizationPending(m as Signable | null, club.current_season)) return { ok: false, error: 'Ce lien n’est plus valable : l’autorisation a peut-être déjà été signée.' };
  const signed = await buildSignedAuthorization(
    config.text,
    {
      signerName: v.signerName,
      signerQuality: v.signerQuality,
      childName: `${m!.first_name} ${m!.last_name}`,
      birthDate: m!.birth_date,
      clubName: club.name,
      sport: getSportPreset(club.sport_type).label,
      season: club.current_season,
    },
    { now: new Date(), channel: 'lien', signatureDataUrl: v.signatureDataUrl },
  );
  // Écriture conditionnelle : deux envois simultanés ne signent pas deux fois.
  const { data: done } = await admin.from('members').update({ parental_authorization: signed }).eq('id', m!.id).is('parental_authorization', null).select('id');
  if (!done?.length) return { ok: false, error: 'L’autorisation a déjà été signée.' };
  return { ok: true, message: 'Merci : l’autorisation parentale est signée et transmise au club.' };
}

/**
 * Le bureau demande l'autorisation aux familles concernées (un adhérent, ou tous ceux de la saison qui ne l'ont pas
 * signée). Une même demande n'est pas renvoyée avant 3 jours.
 */
export async function requestParentalAuthorizations(memberId?: string): Promise<ActionResult<{ sent: number }>> {
  const ctx = await getClubContext();
  if (!ctx) return { ok: false, error: 'Session expirée : reconnectez-vous.' };
  if (!grantsCan(ctx.grants, 'members.write')) return { ok: false, error: 'Action non autorisée pour votre compte.' };
  const { club } = ctx;
  if (!parseParentalAuthorization(club.registration_form).enabled) return { ok: false, error: 'L’autorisation parentale en ligne est désactivée (page Formulaire d’inscription).' };
  if (memberId && !z.string().uuid().safeParse(memberId).success) return { ok: false, error: 'Adhérent introuvable.' };
  const admin = createAdminClient();
  let q = admin.from('members').select(MEMBER_FIELDS).eq('club_id', club.id).eq('season', club.current_season).eq('is_minor', true).is('parental_authorization', null).is('anonymized_at', null);
  if (memberId) q = q.eq('id', memberId);
  const { data: members } = await q.limit(500);
  const pending = [];
  for (const m of (members ?? []) as Signable[]) if (authorizationPending(m, club.current_season)) pending.push(m);
  if (!pending.length) return { ok: false, error: memberId ? 'Cette autorisation est déjà signée ou n’est pas demandée.' : 'Aucune autorisation à demander.' };
  const familyIds = [...new Set(pending.map((m) => m.family_id).filter((x): x is string => Boolean(x)))];
  const { data: families } = familyIds.length ? await admin.from('family_registrations').select('id, payer_first_name, payer_email').in('id', familyIds) : { data: [] };
  const familyOf = new Map((families ?? []).map((f) => [f.id, f]));
  const since = new Date(Date.now() - 3 * 86400000).toISOString();
  const { data: recent } = await admin.from('email_log').select('subject, recipient').eq('club_id', club.id).eq('kind', 'autorisation_parentale').gte('created_at', since);
  const already = new Set((recent ?? []).map((r) => `${r.recipient}|${r.subject}`));
  let sent = 0;
  let skipped = 0;
  for (const m of pending) {
    const f = m.family_id ? familyOf.get(m.family_id) : undefined;
    const name = `${m.first_name} ${m.last_name}`;
    if (!f?.payer_email || already.has(`${f.payer_email.toLowerCase()}|${SUBJECT(name)}`)) {
      skipped++;
      continue;
    }
    const ok = await sendClubEmailSafely({
      club,
      to: f.payer_email,
      subject: SUBJECT(name),
      kind: 'autorisation_parentale',
      reactComponent: createElement(ParentalAuthorizationRequestEmail, {
        club,
        firstName: f.payer_first_name,
        memberName: m.first_name,
        link: `${clubSiteUrl(club)}/autorisation/${m.magic_action_token}`,
      }),
    });
    if (ok) sent++;
  }
  revalidatePath('/club-admin', 'layout');
  if (!sent) return { ok: false, error: skipped ? 'Demande déjà envoyée ces 3 derniers jours.' : 'Aucun e-mail n’a pu être envoyé.' };
  return { ok: true, data: { sent }, message: `${sent} demande${sent > 1 ? 's' : ''} d’autorisation envoyée${sent > 1 ? 's' : ''}${skipped ? ` (${skipped} déjà relancée${skipped > 1 ? 's' : ''} récemment)` : ''}.` };
}
