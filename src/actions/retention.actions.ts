'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { getDatabase } from '@/lib/db/d1';
import { getClubContext, type ClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { RETENTION_BOUNDS, applyRetention, logRetention, parseRetentionPolicy } from '@/lib/retention';
import { deletePrivateFilesVerified } from '@/lib/storage';
import type { ActionResult } from '@/lib/validation';

const PATH = '/club-admin/parametres';

async function presidentOrError(): Promise<ClubContext | string> {
  const ctx = await getClubContext();
  if (!ctx) return 'Session expirée : reconnectez-vous.';
  if (!grantsCan(ctx.grants, 'club.admin')) return 'Réservé à la présidence du club.';
  return ctx;
}

const bounded = (key: keyof typeof RETENTION_BOUNDS, unit: string) =>
  z
    .number()
    .int()
    .min(RETENTION_BOUNDS[key][0], `${RETENTION_BOUNDS[key][0]} ${unit} au minimum.`)
    .max(RETENTION_BOUNDS[key][1], `${RETENTION_BOUNDS[key][1]} ${unit} au maximum.`);

/** Durées de conservation du club et activation de l'application automatique (chaque nuit). */
export async function saveRetentionPolicy(input: unknown): Promise<ActionResult> {
  const ctx = await presidentOrError();
  if (typeof ctx === 'string') return { ok: false, error: ctx };
  const parsed = z
    .object({
      enabled: z.boolean(),
      documentsMonths: bounded('documentsMonths', 'mois'),
      membersYears: bounded('membersYears', 'an(s)'),
      preregistrationsMonths: bounded('preregistrationsMonths', 'mois'),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Réglages invalides.' };
  if (parsed.data.documentsMonths > parsed.data.membersYears * 12) {
    return { ok: false, error: 'Les pièces ne peuvent pas être gardées plus longtemps que les fiches des adhérents.' };
  }
  const policy = parseRetentionPolicy(parsed.data);
  const { error } = await createAdminClient().from('clubs').update({ retention_policy: policy }).eq('id', ctx.club.id);
  if (error) return { ok: false, error: 'Enregistrement impossible.' };
  revalidatePath(PATH);
  return { ok: true, message: policy.enabled ? 'Conservation enregistrée : appliquée chaque nuit.' : 'Durées enregistrées (application automatique désactivée).' };
}

/** Applique tout de suite les durées enregistrées (même si l'application automatique est désactivée). */
export async function applyRetentionNow(confirmation: string): Promise<ActionResult> {
  const ctx = await presidentOrError();
  if (typeof ctx === 'string') return { ok: false, error: ctx };
  if (confirmation !== 'SUPPRIMER') return { ok: false, error: 'Tapez SUPPRIMER pour confirmer.' };
  try {
    const db = getDatabase();
    const now = new Date();
    const done = await applyRetention(db, ctx.club.id, parseRetentionPolicy(ctx.club.retention_policy), now, deletePrivateFilesVerified);
    await logRetention(db, ctx.club.id, 'manual', done, now);
    revalidatePath('/club-admin', 'layout');
    const failed = done.echecsFichiers ? ` ${done.echecsFichiers} fichier(s) n'ont pas pu être supprimés : ils restent attachés et seront retentés au prochain passage.` : '';
    return {
      ok: true,
      message: `${done.pieces} pièce(s) supprimée(s), ${done.adherents} adhérent(s) et ${done.familles} dossier(s) anonymisés, ${done.preinscriptions} demande(s) supprimée(s).${failed}`,
    };
  } catch (error) {
    console.error('[conservation] application manuelle', error instanceof Error ? error.message : error);
    return { ok: false, error: 'L’application s’est interrompue. Ce qui était déjà traité est enregistré ; relancez plus tard pour le reste.' };
  }
}
