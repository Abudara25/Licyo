'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { getClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { MAX_STEPS } from '@/lib/reminders';
import type { ActionResult } from '@/lib/validation';

/** Politique de relance du club : activation, délais (jours), types de relance. */
export async function saveReminderPolicy(input: unknown): Promise<ActionResult> {
  const ctx = await getClubContext();
  if (!ctx) return { ok: false, error: 'Session expirée : reconnectez-vous.' };
  if (!grantsCan(ctx.grants, 'settings.manage')) return { ok: false, error: 'Action non autorisée pour votre compte.' };
  const parsed = z
    .object({
      enabled: z.boolean(),
      delaysDays: z.array(z.number().int().min(1, 'Délai d’au moins 1 jour.').max(60, 'Délai de 60 jours au plus.')).min(1).max(MAX_STEPS),
      kinds: z.object({ documents: z.boolean(), correction: z.boolean(), payment: z.boolean() }),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Réglages invalides.' };
  const v = parsed.data;
  const delays = [...new Set(v.delaysDays)].sort((a, b) => a - b);
  if (delays.length !== v.delaysDays.length) return { ok: false, error: 'Deux relances ne peuvent pas avoir le même délai.' };
  if (v.enabled && !Object.values(v.kinds).some(Boolean)) return { ok: false, error: 'Choisissez au moins un type de relance.' };
  const { error } = await createAdminClient()
    .from('clubs')
    .update({ reminder_policy: { enabled: v.enabled, delaysDays: delays, kinds: v.kinds } })
    .eq('id', ctx.club.id);
  if (error) return { ok: false, error: 'Enregistrement impossible.' };
  revalidatePath('/club-admin/a-traiter');
  return { ok: true, message: v.enabled ? 'Relances automatiques activées.' : 'Relances automatiques désactivées.' };
}
