'use server';

import { headers } from 'next/headers';
import { createElement } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { uploadClubFile, deletePrivateFiles, PRIVATE_BUCKET, UploadError } from '@/lib/supabase/storage';
import { getStripe } from '@/lib/stripe/client';
import { toCents } from '@/lib/stripe/fee-calculator';
import { computeCart } from '@/lib/pricing';
import { ageOn, categoriesForBirthYear } from '@/lib/age';
import { installmentDates, invoiceNumber } from '@/lib/season';
import { splitInstallments, formatEuros } from '@/lib/pricing';
import { clubSiteUrl } from '@/lib/env';
import { sendClubEmailSafely } from '@/lib/email/mailer';
import { RegistrationReceivedEmail, TrialConfirmationEmail } from '@/lib/email/templates';
import { scheduleLabel } from '@/lib/seo-geo/json-ld';
import {
  firstError,
  registrationSchema,
  sponsorLeadSchema,
  trialSchema,
  type ActionResult,
} from '@/lib/validation';
import type { Club } from '@/types/database';

const PAYMENT_LABELS = { card: 'carte bancaire', check: 'chèque', cash: 'espèces', transfer: 'virement' } as const;

/** Club public (actif ou démo non expirée) chargé côté serveur : le navigateur ne fournit que le slug. */
async function loadPublicClub(slug: string): Promise<Club | null> {
  const { data } = await createAdminClient().from('clubs').select('*').eq('slug', slug).maybeSingle();
  if (!data) return null;
  const demoOk = data.status === 'demo' && (!data.demo_expires_at || new Date(data.demo_expires_at) > new Date());
  return data.status === 'active' || demoOk ? data : null;
}

// Limitation simple par IP et par instance : freine les robots sans dépendance externe.
const hits = new Map<string, number[]>();
async function rateLimited(bucket: string, max: number, windowMs: number): Promise<boolean> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

function fileFrom(formData: FormData, key: string): File | null {
  const value = formData.get(key);
  return value instanceof File && value.size > 0 ? value : null;
}

/**
 * Tunnel d'inscription. Le navigateur envoie les saisies et les fichiers ; tout
 * le reste (catégories, prix, remises, frais, capacité) est relu et recalculé ici.
 */
export async function submitRegistration(formData: FormData): Promise<ActionResult<{ redirectUrl?: string; familyId: string }>> {
  if (await rateLimited('registration', 10, 60 * 60 * 1000)) return { ok: false, error: 'Trop de tentatives. Réessayez dans une heure.' };

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? ''));
  } catch {
    return { ok: false, error: 'Formulaire illisible.' };
  }
  const parsed = registrationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const input = parsed.data;

  const club = await loadPublicClub(input.clubSlug);
  if (!club || !club.enabled_modules.inscriptions) return { ok: false, error: 'Les inscriptions en ligne sont fermées pour ce club.' };
  const admin = createAdminClient();
  const season = club.current_season;

  const [{ data: categories }, { data: products }] = await Promise.all([
    admin.from('categories').select('*').eq('club_id', club.id),
    admin.from('club_products').select('*').eq('club_id', club.id),
  ]);
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));
  const productById = new Map((products ?? []).map((p) => [p.id, p]));

  // Renouvellement : le jeton doit désigner un adhérent de ce club.
  if (input.renewalToken) {
    const { data: previous } = await admin.from('members').select('id').eq('club_id', club.id).eq('magic_action_token', input.renewalToken).maybeSingle();
    if (!previous) return { ok: false, error: 'Lien de réinscription invalide.' };
  }

  // Contrôles métier par personne.
  const cartMembers = [];
  for (const [i, m] of input.members.entries()) {
    const category = categoryById.get(m.categoryId);
    if (!category) return { ok: false, error: `Section introuvable pour ${m.firstName}.` };
    const birthYear = Number(m.birthDate.slice(0, 4));
    if (categoriesForBirthYear([category], birthYear, m.gender).length === 0) {
      return { ok: false, error: `${m.firstName} n'a pas l'âge requis pour « ${category.name} ».` };
    }
    const age = ageOn(m.birthDate);
    if (!(age >= 2 && age <= 100)) return { ok: false, error: `Date de naissance de ${m.firstName} invalide.` };
    if (category.medical_requirement !== 'health_questionnaire' && !fileFrom(formData, `medical_${i}`)) {
      return { ok: false, error: `Un certificat médical est demandé pour ${m.firstName} (${category.name}).` };
    }
    if (category.medical_requirement === 'health_questionnaire' && !m.healthQuestionnairePassed && !fileFrom(formData, `medical_${i}`)) {
      return { ok: false, error: `Questionnaire de santé : si une réponse est « oui », joignez un certificat médical pour ${m.firstName}.` };
    }
    const memberProducts = [];
    for (const p of m.products) {
      const product = productById.get(p.productId);
      if (!product || !product.available_sizes.includes(p.size)) return { ok: false, error: 'Article de boutique indisponible.' };
      memberProducts.push({ price: Number(product.price) });
    }
    cartMembers.push({
      licensePrice: Number(category.annual_price),
      usesPassSport: club.accepts_pass_sport && age >= 6 && age <= 30 && Boolean(m.passSportCode),
      products: memberProducts,
    });
  }

  // Capacité des sections (hors dossiers refusés).
  for (const categoryId of new Set(input.members.map((m) => m.categoryId))) {
    const category = categoryById.get(categoryId)!;
    const wanted = input.members.filter((m) => m.categoryId === categoryId).length;
    const { count } = await admin
      .from('members')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId)
      .eq('season', season)
      .not('dossier_status', 'in', '(rejected,trial_requested,trial_done)');
    if ((count ?? 0) + wanted > category.max_capacity) return { ok: false, error: `La section « ${category.name} » est complète.` };
  }

  const payByCard = input.paymentMethod === 'card';
  if (payByCard && !(club.enabled_modules.payments && club.stripe_connect_onboarded && club.stripe_connect_account_id)) {
    return { ok: false, error: 'Le paiement par carte n\'est pas encore disponible pour ce club.' };
  }
  const installments = club.accepts_installments && input.paymentMethod === 'check' ? input.installmentsCount : 1;
  const totals = computeCart(
    cartMembers,
    {
      siblingDiscount: club.sibling_discount_rules,
      acceptsPassSport: club.accepts_pass_sport,
      passSportAmount: Number(club.pass_sport_amount),
      passStripeFeesToParents: club.pass_stripe_fees_to_parents,
    },
    payByCard,
  );

  // Pièces jointes : déposées avant l'écriture en base, supprimées si l'écriture échoue.
  const uploaded: string[] = [];
  const docPaths: { photo: string | null; medical: string | null; id: string | null }[] = [];
  try {
    for (let i = 0; i < input.members.length; i++) {
      const paths = { photo: null as string | null, medical: null as string | null, id: null as string | null };
      for (const kind of ['photo', 'medical', 'id'] as const) {
        const file = fileFrom(formData, `${kind}_${i}`);
        if (file) {
          paths[kind] = await uploadClubFile(PRIVATE_BUCKET, club.id, `members/${season}`, file, kind !== 'photo');
          uploaded.push(paths[kind]!);
        }
      }
      docPaths.push(paths);
    }
  } catch (error) {
    await deletePrivateFiles(uploaded);
    return { ok: false, error: error instanceof UploadError ? error.message : 'Envoi des pièces impossible.' };
  }

  const { data: family, error: familyError } = await admin
    .from('family_registrations')
    .insert({
      club_id: club.id,
      season,
      is_adult_self_registration: input.isAdultSelfRegistration,
      payer_first_name: input.payer.firstName,
      payer_last_name: input.payer.lastName,
      payer_email: input.payer.email,
      payer_phone: input.payer.phone,
      emergency_contact_name: input.emergency.name,
      emergency_contact_phone: input.emergency.phone,
      address: input.payer.address,
      city: input.payer.city,
      postal_code: input.payer.postalCode,
      licenses_subtotal: totals.licensesSubtotal,
      products_subtotal: totals.productsSubtotal,
      sibling_discount_amount: totals.siblingDiscountAmount,
      aids_deduction_amount: totals.aidsDeductionAmount,
      stripe_fee_added: totals.stripeFeeAdded,
      final_total_amount: totals.finalTotalAmount,
      payment_status: totals.finalTotalAmount === 0 ? 'paid' : 'unpaid',
      payment_method: input.paymentMethod,
      invoice_number: invoiceNumber(season),
    })
    .select('id, invoice_number')
    .single();
  if (familyError || !family) {
    await deletePrivateFiles(uploaded);
    console.error('[inscription] famille', familyError?.message);
    return { ok: false, error: 'Enregistrement impossible. Réessayez dans un instant.' };
  }

  const memberRows = input.members.map((m, i) => ({
    club_id: club.id,
    family_id: family.id,
    category_id: m.categoryId,
    season,
    first_name: m.firstName,
    last_name: m.lastName.toUpperCase(),
    birth_date: m.birthDate,
    is_minor: ageOn(m.birthDate) < 18,
    gender: m.gender,
    photo_storage_path: docPaths[i].photo,
    medical_doc_storage_path: docPaths[i].medical,
    id_doc_storage_path: docPaths[i].id,
    health_questionnaire_passed: m.healthQuestionnairePassed,
    pass_sport_code: m.passSportCode || null,
    consent_image_rights: m.consentImageRights,
    consent_emergency_medical: m.consentEmergencyMedical,
    // Sortie seul : sans objet pour un adulte.
    consent_autonomous_exit: ageOn(m.birthDate) >= 18 ? true : m.consentAutonomousExit,
    signature_data_url: m.signatureDataUrl,
    registration_type: input.renewalToken ? ('renewal' as const) : ('full' as const),
  }));
  const { data: members, error: membersError } = await admin.from('members').insert(memberRows).select('id');
  if (membersError || !members) {
    await admin.from('family_registrations').delete().eq('id', family.id);
    await deletePrivateFiles(uploaded);
    console.error('[inscription] membres', membersError?.message);
    return { ok: false, error: 'Enregistrement impossible. Réessayez dans un instant.' };
  }

  const orders = input.members.flatMap((m, i) =>
    m.products.map((p) => ({
      club_id: club.id,
      member_id: members[i].id,
      product_id: p.productId,
      selected_size: p.size,
      price_at_order: Number(productById.get(p.productId)!.price),
    })),
  );
  if (orders.length) await admin.from('member_product_orders').insert(orders);

  // Échéancier prévisionnel pour les règlements hors carte.
  if (!payByCard && totals.finalTotalAmount > 0) {
    const dates = installmentDates(season, installments);
    const amounts = splitInstallments(totals.finalTotalAmount, installments);
    await admin.from('payment_installments').insert(
      amounts.map((amount, i) => ({
        club_id: club.id,
        family_id: family.id,
        amount,
        payment_type: input.paymentMethod,
        scheduled_deposit_date: dates[i],
      })),
    );
  }

  await sendClubEmailSafely({
    club,
    to: input.payer.email,
    subject: `Inscription reçue - ${club.name}`,
    reactComponent: createElement(RegistrationReceivedEmail, {
      club,
      payerFirstName: input.payer.firstName,
      memberNames: input.members.map((m) => `${m.firstName} ${m.lastName}`),
      total: formatEuros(totals.finalTotalAmount),
      paymentLabel: installments > 1 ? `${installments} chèques` : PAYMENT_LABELS[input.paymentMethod],
    }),
  });

  if (payByCard && totals.finalTotalAmount > 0) {
    const site = clubSiteUrl(club);
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        customer_email: input.payer.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: toCents(totals.finalTotalAmount),
              product_data: { name: `Inscription ${season} - ${club.name}`, description: input.members.map((m) => m.firstName).join(', ') },
            },
          },
        ],
        metadata: { family_id: family.id, club_id: club.id },
        payment_intent_data: { metadata: { family_id: family.id, club_id: club.id } },
        success_url: `${site}/inscription?paiement=ok`,
        cancel_url: `${site}/inscription?paiement=annule`,
      },
      { stripeAccount: club.stripe_connect_account_id! },
    );
    await admin.from('family_registrations').update({ stripe_checkout_session_id: session.id }).eq('id', family.id);
    return { ok: true, data: { familyId: family.id, redirectUrl: session.url ?? undefined } };
  }

  return { ok: true, data: { familyId: family.id }, message: 'Dossier enregistré. Un e-mail de confirmation vous a été envoyé.' };
}

/** Réservation d'une séance d'essai gratuite sur un créneau existant. */
export async function requestTrial(input: unknown): Promise<ActionResult> {
  if (await rateLimited('trial', 10, 60 * 60 * 1000)) return { ok: false, error: 'Trop de tentatives. Réessayez dans une heure.' };
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const t = parsed.data;
  const club = await loadPublicClub(t.clubSlug);
  if (!club || !club.enabled_modules.trials) return { ok: false, error: 'Les séances d\'essai ne sont pas ouvertes.' };

  const admin = createAdminClient();
  const { data: schedule } = await admin.from('schedules').select('*').eq('id', t.scheduleId).eq('club_id', club.id).maybeSingle();
  if (!schedule) return { ok: false, error: 'Créneau introuvable.' };
  const { data: category } = await admin.from('categories').select('*').eq('id', schedule.category_id).single();
  if (!category || categoriesForBirthYear([category], Number(t.birthDate.slice(0, 4)), t.gender).length === 0) {
    return { ok: false, error: 'Ce créneau ne correspond pas à l\'âge indiqué.' };
  }
  const { data: facility } = schedule.facility_id
    ? await admin.from('facilities').select('*').eq('id', schedule.facility_id).maybeSingle()
    : { data: null };

  const { data: family, error } = await admin
    .from('family_registrations')
    .insert({
      club_id: club.id,
      season: club.current_season,
      is_adult_self_registration: ageOn(t.birthDate) >= 18,
      payer_first_name: t.contactFirstName,
      payer_last_name: t.contactLastName,
      payer_email: t.email,
      payer_phone: t.phone,
      emergency_contact_name: `${t.contactFirstName} ${t.contactLastName}`,
      emergency_contact_phone: t.phone,
      address: t.address,
      city: t.city,
      postal_code: t.postalCode,
      payment_status: 'paid',
    })
    .select('id')
    .single();
  if (error || !family) return { ok: false, error: 'Enregistrement impossible.' };
  await admin.from('members').insert({
    club_id: club.id,
    family_id: family.id,
    category_id: category.id,
    season: club.current_season,
    first_name: t.firstName,
    last_name: t.lastName.toUpperCase(),
    birth_date: t.birthDate,
    is_minor: ageOn(t.birthDate) < 18,
    gender: t.gender,
    registration_type: 'trial',
    dossier_status: 'trial_requested',
  });

  await sendClubEmailSafely({
    club,
    to: t.email,
    subject: `Séance d'essai - ${club.name}`,
    reactComponent: createElement(TrialConfirmationEmail, {
      club,
      memberName: t.firstName,
      slotLabel: scheduleLabel(schedule.day_of_week, schedule.start_time, schedule.end_time),
      venue: facility ? `${facility.name}, ${facility.address} ${facility.city}` : club.city,
    }),
  });
  return { ok: true, message: 'Séance d\'essai réservée. Un e-mail récapitulatif vous a été envoyé.' };
}

export async function submitSponsorLead(input: unknown): Promise<ActionResult> {
  if (await rateLimited('sponsor', 5, 60 * 60 * 1000)) return { ok: false, error: 'Trop de tentatives.' };
  const parsed = sponsorLeadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const club = await loadPublicClub(parsed.data.clubSlug);
  if (!club || !club.enabled_modules.sponsors) return { ok: false, error: 'Formulaire indisponible.' };
  const { error } = await createAdminClient().from('sponsor_leads').insert({
    club_id: club.id,
    company_name: parsed.data.companyName,
    contact_name: parsed.data.contactName,
    phone: parsed.data.phone,
    email: parsed.data.email,
    estimated_budget: parsed.data.estimatedBudget || null,
  });
  if (error) return { ok: false, error: 'Envoi impossible.' };
  return { ok: true, message: 'Merci ! Le club vous recontacte rapidement.' };
}

/** Correction d'un dossier via le lien magique : remplace les pièces demandées. */
export async function submitCorrection(formData: FormData): Promise<ActionResult> {
  if (await rateLimited('correction', 20, 60 * 60 * 1000)) return { ok: false, error: 'Trop de tentatives.' };
  const token = String(formData.get('token') ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, error: 'Lien invalide.' };
  const admin = createAdminClient();
  const { data: member } = await admin.from('members').select('*').eq('magic_action_token', token).maybeSingle();
  if (!member || member.dossier_status !== 'needs_correction') return { ok: false, error: 'Ce lien n\'est plus valable.' };

  const updates: Record<string, string> = {};
  const replaced: string[] = [];
  try {
    for (const [kind, column] of [
      ['photo', 'photo_storage_path'],
      ['medical', 'medical_doc_storage_path'],
      ['id', 'id_doc_storage_path'],
    ] as const) {
      const file = fileFrom(formData, kind);
      if (file) {
        updates[column] = await uploadClubFile(PRIVATE_BUCKET, member.club_id, `members/${member.season}`, file, kind !== 'photo');
        if (member[column]) replaced.push(member[column]!);
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof UploadError ? error.message : 'Envoi impossible.' };
  }
  if (Object.keys(updates).length === 0) return { ok: false, error: 'Ajoutez au moins un document.' };

  // Le jeton est renouvelé : le lien reçu par e-mail ne sert qu'une fois.
  const { error } = await admin
    .from('members')
    .update({ ...updates, dossier_status: 'pending_review', rejection_reason: null, magic_action_token: crypto.randomUUID() })
    .eq('id', member.id)
    .eq('dossier_status', 'needs_correction');
  if (error) return { ok: false, error: 'Enregistrement impossible.' };
  await deletePrivateFiles(replaced);
  return { ok: true, message: 'Merci, le dossier est de nouveau en cours de vérification.' };
}

export async function respondConvocation(token: string, status: 'present' | 'absent'): Promise<ActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(token) || !['present', 'absent'].includes(status)) return { ok: false, error: 'Lien invalide.' };
  const { data, error } = await createAdminClient()
    .from('event_convocations')
    .update({ response_status: status })
    .eq('response_token', token)
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'Convocation introuvable.' };
  return { ok: true, message: status === 'present' ? 'Présence confirmée, merci !' : 'Absence enregistrée, merci de nous avoir prévenus.' };
}

/** Compteur d'audience anonyme (aucun cookie, aucune IP stockée). */
export async function trackPageView(clubId: string, path: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(clubId)) return;
  await createAdminClient().rpc('increment_page_view', { target_club: clubId, path: path.slice(0, 200) });
}
