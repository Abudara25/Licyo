'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { getDatabase } from '@/lib/db/d1';
import { getClubContext, type ClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { HelloAssoError, fetchPayments, helloAssoToken, organizationSlugFrom } from '@/lib/helloasso';
import { fetchJson, getConnection, helloAssoBase, runHelloAssoSync } from '@/lib/helloasso-connection';
import { decryptSecret, encryptSecret } from '@/lib/utils/crypto';
import type { ActionResult } from '@/lib/validation';

const PATH = '/club-admin/tresorerie/import';

/** Connecter une source d'argent au club : droit d'écriture sur les finances. */
async function ctxOrError(): Promise<ClubContext | string> {
  const ctx = await getClubContext();
  if (!ctx) return 'Session expirée : reconnectez-vous.';
  if (!grantsCan(ctx.grants, 'finance.write')) return 'Réservé aux personnes qui gèrent la trésorerie.';
  return ctx;
}

async function audit(ctx: ClubContext, action: string) {
  await createAdminClient().from('audit_events').insert({ club_id: ctx.club.id, actor_id: ctx.auth.userId, action, object_id: null });
}

/**
 * Enregistre la connexion après l'avoir essayée (jeton + lecture d'une page de paiements). Le secret est chiffré et
 * n'est jamais renvoyé au navigateur ; laisser le secret vide garde celui déjà enregistré.
 */
export async function saveHelloAssoConnection(input: unknown): Promise<ActionResult> {
  const ctx = await ctxOrError();
  if (typeof ctx === 'string') return { ok: false, error: ctx };
  const parsed = z
    .object({ organization: z.string().max(300), clientId: z.string().trim().min(8, 'Identifiant API trop court.').max(200), clientSecret: z.string().trim().max(400) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Informations invalides.' };
  const slug = organizationSlugFrom(parsed.data.organization);
  if (!slug) return { ok: false, error: 'Adresse de l’association invalide : collez l’adresse de sa page HelloAsso ou son identifiant (ex. mon-club-de-judo).' };
  const db = getDatabase();
  const existing = await getConnection(db, ctx.club.id);
  if (!parsed.data.clientSecret && !existing) return { ok: false, error: 'Secret API obligatoire.' };
  try {
    const secret = parsed.data.clientSecret || decryptSecret(existing!.client_secret_enc);
    const token = await helloAssoToken(fetchJson, { organizationSlug: slug, clientId: parsed.data.clientId, clientSecret: secret }, helloAssoBase());
    // Lecture d'essai : droits et association vérifiés avant d'enregistrer.
    await fetchPayments(async (url, init) => fetchJson(url.replace('pageSize=100', 'pageSize=1'), init), token, slug, new Date(Date.now() - 86400000), helloAssoBase());
    const now = new Date().toISOString();
    const enc = encryptSecret(secret);
    const sameAccount = existing && existing.account_ref === slug;
    await db
      .prepare(
        `INSERT INTO club_integrations (club_id, provider, account_ref, client_id, client_secret_enc, status, connected_by, updated_at)
         VALUES (?, 'helloasso', ?, ?, ?, 'active', ?, ?)
         ON CONFLICT (club_id, provider) DO UPDATE SET account_ref = excluded.account_ref, client_id = excluded.client_id,
           client_secret_enc = excluded.client_secret_enc, status = 'active', last_error = NULL, connected_by = excluded.connected_by,
           updated_at = excluded.updated_at, last_sync_at = ${sameAccount ? 'club_integrations.last_sync_at' : 'NULL'}`,
      )
      .bind(ctx.club.id, slug, parsed.data.clientId, enc, ctx.auth.userId, now)
      .run();
    await audit(ctx, 'helloasso.connexion');
    revalidatePath(PATH);
    return { ok: true, message: 'Connexion HelloAsso enregistrée. Lancez une première synchronisation.' };
  } catch (error) {
    if (error instanceof HelloAssoError) return { ok: false, error: error.message };
    console.error('[helloasso] connexion', error instanceof Error ? error.message : error);
    return { ok: false, error: 'HelloAsso ne répond pas. Réessayez dans un instant.' };
  }
}

/** Synchronisation à la demande (la tâche de nuit fait la même chose chaque jour). */
export async function syncHelloAssoNow(): Promise<ActionResult> {
  const ctx = await ctxOrError();
  if (typeof ctx === 'string') return { ok: false, error: ctx };
  const db = getDatabase();
  const conn = await getConnection(db, ctx.club.id);
  if (!conn) return { ok: false, error: 'Aucune connexion HelloAsso.' };
  try {
    const r = await runHelloAssoSync(db, conn);
    revalidatePath(PATH);
    const more = r.tronque ? ' D’autres paiements restent à lire : relancez la synchronisation.' : '';
    return {
      ok: true,
      message: `${r.nouveaux} nouveau${r.nouveaux > 1 ? 'x' : ''} paiement${r.nouveaux > 1 ? 's' : ''} HelloAsso${r.dejaConnus ? `, ${r.dejaConnus} déjà connu${r.dejaConnus > 1 ? 's' : ''}` : ''}.${more}`,
    };
  } catch (error) {
    revalidatePath(PATH);
    return { ok: false, error: error instanceof Error ? error.message : 'Synchronisation impossible.' };
  }
}

/** Supprime la connexion (le secret est effacé ; les opérations déjà importées restent). */
export async function disconnectHelloAsso(): Promise<ActionResult> {
  const ctx = await ctxOrError();
  if (typeof ctx === 'string') return { ok: false, error: ctx };
  await getDatabase().prepare("DELETE FROM club_integrations WHERE club_id = ? AND provider = 'helloasso'").bind(ctx.club.id).run();
  await audit(ctx, 'helloasso.deconnexion');
  revalidatePath(PATH);
  return { ok: true, message: 'Connexion HelloAsso supprimée. Les paiements déjà importés restent.' };
}
