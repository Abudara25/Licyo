'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAuthContext } from '@/lib/supabase/server';
import { IMPERSONATION_COOKIE, IMPERSONATION_MAX_AGE, signImpersonation } from '@/lib/utils/impersonation';
import { birthYearsForSeason, getSportPreset, SPORT_IDS } from '@/config/sports-presets';
import { appUrl } from '@/lib/env';
import { clubTag, DOMAINS_TAG } from '@/lib/tenant';
import { categoriesForBirthYear } from '@/lib/age';
import { firstError, hexColor, slugify, type ActionResult } from '@/lib/validation';

/** Toute action de ce fichier exige un super_admin vérifié côté serveur. */
async function requireSuperAdmin() {
  const auth = await getAuthContext();
  if (!auth?.isSuperAdmin) throw new Error('Accès réservé à l\'administrateur de la plateforme.');
  return auth;
}

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    console.error('[super-admin]', error instanceof Error ? error.message : error);
    return { ok: false, error: error instanceof Error ? error.message : 'Une erreur est survenue.' };
  }
}

const uuid = z.string().uuid();

async function uniqueSlug(base: string): Promise<string> {
  const admin = createAdminClient();
  const root = slugify(base) || 'club';
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const { count } = await admin.from('clubs').select('id', { count: 'exact', head: true }).eq('slug', candidate);
    if (!count) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

function nextDateForDays(days: number, hour = 15): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const demoSchema = z.object({
  name: z.string().trim().min(2, 'Nom du club obligatoire.').max(120),
  sportType: z.enum(SPORT_IDS as [string, ...string[]]),
  city: z.string().trim().min(1, 'Ville obligatoire.').max(80),
  postalCode: z.string().trim().regex(/^\d{5}$/, 'Code postal à 5 chiffres.'),
  contactEmail: z.string().trim().email('E-mail invalide.'),
  primaryColor: hexColor.optional().or(z.literal('')),
  secondaryColor: hexColor.optional().or(z.literal('')),
  prospectId: z.string().uuid().optional().or(z.literal('')),
});

/**
 * Générateur de démo : club + lieu + 4 sections + 6 créneaux + 2 événements
 * + 3 actualités + boutique, depuis le preset du sport. En cas d'échec, le
 * club est supprimé (cascade) pour ne pas laisser de démo à moitié créée.
 */
export async function createDemoClub(input: unknown): Promise<ActionResult<{ clubId: string; slug: string }>> {
  return run(async () => {
    await requireSuperAdmin();
    const parsed = demoSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const v = parsed.data;
    const preset = getSportPreset(v.sportType);
    const admin = createAdminClient();
    const slug = await uniqueSlug(v.name);
    const season = '2026-2027';

    const { data: club, error } = await admin
      .from('clubs')
      .insert({
        name: v.name,
        slug,
        sport_type: preset.id,
        theme_preset: preset.themePreset,
        primary_color: (v.primaryColor || preset.defaultPrimary).toUpperCase(),
        secondary_color: (v.secondaryColor || preset.defaultSecondary).toUpperCase(),
        city: v.city,
        postal_code: v.postalCode,
        contact_email: v.contactEmail,
        federation_name: preset.federation || null,
        club_history_text: `${v.name} accueille petits et grands à ${v.city} pour la pratique du ${preset.vocabulary.sportName}, en loisir comme en compétition. Notre équipe de bénévoles et d'${preset.vocabulary.coaches} diplômés transmet chaque saison le goût du sport et de l'effort collectif.`,
        president_word_text: `Bienvenue sur le site du club ! Que vous veniez pour découvrir le ${preset.vocabulary.sportName} ou pour progresser, vous trouverez ici une équipe passionnée. Au plaisir de vous accueillir.`,
        status: 'demo',
        current_season: season,
      })
      .select('*')
      .single();
    if (error || !club) return { ok: false, error: 'Création du club impossible.' };

    try {
      const { data: facility } = await admin
        .from('facilities')
        .insert({ club_id: club.id, name: preset.demo.facilityName, address: 'Adresse à compléter', city: v.city, postal_code: v.postalCode })
        .select('id')
        .single();
      const { data: categories, error: catError } = await admin
        .from('categories')
        .insert(
          preset.demo.categories.map((c, i) => ({
            club_id: club.id,
            name: c.name,
            ...birthYearsForSeason(season, c),
            annual_price: c.price,
            medical_requirement: c.medical,
            description: c.description,
            display_order: i,
          })),
        )
        .select('id, display_order');
      if (catError || !categories) throw new Error(catError?.message);
      const catByOrder = new Map(categories.map((c) => [c.display_order, c.id]));
      await admin.from('schedules').insert(
        preset.demo.schedules.map(([catIndex, day, start, end]) => ({
          club_id: club.id,
          category_id: catByOrder.get(catIndex)!,
          facility_id: facility?.id ?? null,
          day_of_week: day,
          start_time: start,
          end_time: end,
        })),
      );
      await admin.from('events').insert(
        preset.demo.events.map((e) => ({
          club_id: club.id,
          event_type: e.type,
          title: e.title,
          event_date: nextDateForDays(e.daysFromNow),
          is_home: e.isHome,
          location_text: e.location,
        })),
      );
      await admin.from('posts').insert(
        preset.demo.posts.map((p, i) => ({
          club_id: club.id,
          title: p.title,
          slug: slugify(p.title),
          content: p.content,
          published_at: new Date(Date.now() - i * 3 * 24 * 3600 * 1000).toISOString(),
        })),
      );
      await admin.from('club_products').insert(preset.demo.products.map((p) => ({ club_id: club.id, name: p.name, price: p.price, available_sizes: p.sizes })));
      if (v.prospectId) await admin.from('saas_prospects').update({ demo_club_id: club.id, stage: 'demo' }).eq('id', v.prospectId);
    } catch (e) {
      await admin.from('clubs').delete().eq('id', club.id);
      console.error('[demo]', e instanceof Error ? e.message : e);
      return { ok: false, error: 'Création de la démo interrompue ; rien n\'a été conservé.' };
    }

    revalidateTag(DOMAINS_TAG);
    revalidateTag(clubTag(slug));
    revalidatePath('/super-admin', 'layout');
    return { ok: true, data: { clubId: club.id, slug }, message: `Démo « ${v.name} » prête.` };
  });
}

/** Mode Miroir : cookie signé, lié au super_admin, valable 4 heures. */
export async function startImpersonation(clubId: string): Promise<void> {
  const auth = await requireSuperAdmin();
  const { data: club } = await createAdminClient().from('clubs').select('id').eq('id', uuid.parse(clubId)).maybeSingle();
  if (!club) throw new Error('Club introuvable.');
  (await cookies()).set(IMPERSONATION_COOKIE, await signImpersonation(club.id, auth.userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: IMPERSONATION_MAX_AGE,
  });
  console.info(`[audit] mode miroir : ${auth.email} sur le club ${club.id}`);
  redirect('/club-admin');
}

export async function updateClubAdmin(clubId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    const v = z
      .object({
        status: z.enum(['demo', 'active', 'suspended', 'archived']).optional(),
        subscription_plan: z.enum(['vitrine', 'integral']).optional(),
        extendDemoDays: z.coerce.number().int().min(1).max(90).optional(),
      })
      .parse(input);
    const admin = createAdminClient();
    const { data: club } = await admin.from('clubs').select('slug, demo_expires_at').eq('id', uuid.parse(clubId)).single();
    if (!club) return { ok: false, error: 'Club introuvable.' };
    const base = club.demo_expires_at && new Date(club.demo_expires_at) > new Date() ? new Date(club.demo_expires_at) : new Date();
    const { error } = await admin
      .from('clubs')
      .update({
        ...(v.status ? { status: v.status } : {}),
        ...(v.subscription_plan ? { subscription_plan: v.subscription_plan } : {}),
        ...(v.extendDemoDays ? { demo_expires_at: new Date(base.getTime() + v.extendDemoDays * 86400000).toISOString() } : {}),
      })
      .eq('id', clubId);
    if (error) return { ok: false, error: 'Mise à jour impossible.' };
    revalidateTag(clubTag(club.slug));
    revalidatePath('/super-admin/clubs');
    return { ok: true, message: 'Club mis à jour.' };
  });
}

export async function deleteClub(clubId: string, confirmSlug: string): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    const admin = createAdminClient();
    const { data: club } = await admin.from('clubs').select('slug, status').eq('id', uuid.parse(clubId)).single();
    if (!club) return { ok: false, error: 'Club introuvable.' };
    if (club.slug !== confirmSlug) return { ok: false, error: `Tapez « ${club.slug} » pour confirmer.` };
    if (club.status === 'active') return { ok: false, error: 'Archivez d\'abord un club actif avant de le supprimer.' };
    await admin.from('clubs').delete().eq('id', clubId);
    revalidateTag(DOMAINS_TAG);
    revalidateTag(clubTag(club.slug));
    revalidatePath('/super-admin', 'layout');
    return { ok: true, message: 'Club supprimé.' };
  });
}

/** Donne l'accès au back-office à un dirigeant (invitation par e-mail). */
export async function inviteClubOwner(clubId: string, input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    const parsed = z
      .object({
        email: z.string().trim().toLowerCase().email(),
        fullName: z.string().trim().min(2).max(80),
        role: z.enum(['president', 'secretary', 'treasurer', 'coach']).default('president'),
      })
      .safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const v = parsed.data;
    const admin = createAdminClient();
    const redirectTo = `${appUrl()}/auth/callback?next=/club-admin`;
    const invited = await admin.auth.admin.inviteUserByEmail(v.email, { redirectTo });
    const userId = invited.data.user?.id ?? (await admin.auth.admin.generateLink({ type: 'magiclink', email: v.email, options: { redirectTo } })).data.user?.id;
    if (!userId) return { ok: false, error: 'Invitation impossible.' };
    const { error } = await admin
      .from('staff_members')
      .upsert({ user_id: userId, club_id: uuid.parse(clubId), full_name: v.fullName, email: v.email, role: v.role }, { onConflict: 'user_id,club_id' });
    if (error) return { ok: false, error: 'Ajout impossible.' };
    revalidatePath('/super-admin/clubs');
    return { ok: true, message: `Accès envoyé à ${v.email}.` };
  });
}

// ---------------------------------------------------------------------------
// CRM prospects
// ---------------------------------------------------------------------------

const prospectSchema = z.object({
  id: z.string().uuid().optional(),
  club_name: z.string().trim().min(2).max(120),
  sport_type: z.string().trim().min(1).max(30),
  city: z.string().trim().min(1).max(80),
  contact_name: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  stage: z.enum(['lead', 'contacted', 'demo', 'quote_sent', 'won', 'lost']).default('lead'),
});

export async function upsertProspect(input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    const parsed = prospectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
    const { id, ...v } = parsed.data;
    const row = { ...v, contact_name: v.contact_name || null, phone: v.phone || null, email: v.email || null };
    const admin = createAdminClient();
    const { error } = id ? await admin.from('saas_prospects').update(row).eq('id', id) : await admin.from('saas_prospects').insert(row);
    if (error) return { ok: false, error: 'Enregistrement impossible.' };
    revalidatePath('/super-admin/crm');
    return { ok: true, message: 'Prospect enregistré.' };
  });
}

export async function moveProspect(id: string, stage: string): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    const s = z.enum(['lead', 'contacted', 'demo', 'quote_sent', 'won', 'lost']).parse(stage);
    await createAdminClient().from('saas_prospects').update({ stage: s }).eq('id', uuid.parse(id));
    revalidatePath('/super-admin/crm');
    return { ok: true };
  });
}

export async function deleteProspect(id: string): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    await createAdminClient().from('saas_prospects').delete().eq('id', uuid.parse(id));
    revalidatePath('/super-admin/crm');
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Annonces de la plateforme
// ---------------------------------------------------------------------------

export async function createAnnouncement(input: unknown): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    const v = z.object({ title: z.string().trim().min(2).max(120), message: z.string().trim().min(2).max(1000) }).parse(input);
    await createAdminClient().from('platform_announcements').insert(v);
    revalidatePath('/super-admin');
    revalidatePath('/club-admin', 'layout');
    return { ok: true, message: 'Annonce publiée.' };
  });
}

export async function toggleAnnouncement(id: string, isActive: boolean): Promise<ActionResult> {
  return run(async () => {
    await requireSuperAdmin();
    await createAdminClient().from('platform_announcements').update({ is_active: isActive }).eq('id', uuid.parse(id));
    revalidatePath('/super-admin');
    revalidatePath('/club-admin', 'layout');
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Import CSV (Footclubs, Ten'Up, tableurs maison)
// ---------------------------------------------------------------------------

const importRowSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(['M', 'F', 'X']).default('X'),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional(),
  address: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().max(10).optional(),
  city: z.string().trim().max(80).optional(),
});

/**
 * Importe des adhérents déjà licenciés (statut « validé », type « import »).
 * Le fichier est analysé dans le navigateur (papaparse) ; chaque ligne est
 * revalidée ici. La section est déduite de l'année de naissance.
 */
export async function importMembers(clubId: string, rows: unknown[]): Promise<ActionResult<{ imported: number; skipped: { line: number; reason: string }[] }>> {
  return run(async () => {
    await requireSuperAdmin();
    if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: 'Fichier vide.' };
    if (rows.length > 2000) return { ok: false, error: '2 000 lignes maximum par import.' };
    const admin = createAdminClient();
    const { data: club } = await admin.from('clubs').select('*').eq('id', uuid.parse(clubId)).single();
    if (!club) return { ok: false, error: 'Club introuvable.' };
    const { data: categories } = await admin.from('categories').select('*').eq('club_id', club.id);

    const skipped: { line: number; reason: string }[] = [];
    let imported = 0;
    for (const [index, raw] of rows.entries()) {
      const parsed = importRowSchema.safeParse(raw);
      if (!parsed.success) {
        skipped.push({ line: index + 2, reason: firstError(parsed.error) });
        continue;
      }
      const r = parsed.data;
      const category = categoriesForBirthYear(categories ?? [], Number(r.birthDate.slice(0, 4)), r.gender)[0];
      const { data: family, error } = await admin
        .from('family_registrations')
        .insert({
          club_id: club.id,
          season: club.current_season,
          payer_first_name: r.firstName,
          payer_last_name: r.lastName.toUpperCase(),
          payer_email: r.email || '',
          payer_phone: r.phone || '',
          emergency_contact_name: '',
          emergency_contact_phone: r.phone || '',
          address: r.address || '',
          city: r.city || '',
          postal_code: r.postalCode || '',
          payment_status: 'paid',
        })
        .select('id')
        .single();
      if (error || !family) {
        skipped.push({ line: index + 2, reason: 'Écriture impossible.' });
        continue;
      }
      const age = (Date.now() - new Date(r.birthDate).getTime()) / (365.25 * 86400000);
      const { error: memberError } = await admin.from('members').insert({
        club_id: club.id,
        family_id: family.id,
        category_id: category?.id ?? null,
        season: club.current_season,
        first_name: r.firstName,
        last_name: r.lastName.toUpperCase(),
        birth_date: r.birthDate,
        is_minor: age < 18,
        gender: r.gender,
        registration_type: 'import',
        dossier_status: 'validated',
      });
      if (memberError) {
        await admin.from('family_registrations').delete().eq('id', family.id);
        skipped.push({ line: index + 2, reason: 'Écriture impossible.' });
        continue;
      }
      imported++;
    }
    revalidatePath('/super-admin/import');
    return { ok: true, data: { imported, skipped }, message: `${imported} adhérent(s) importé(s), ${skipped.length} ligne(s) ignorée(s).` };
  });
}
