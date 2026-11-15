'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/db/admin';
import { getDatabase } from '@/lib/db/d1';
import { getClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { erasePerson } from '@/lib/personal-data';
import { deletePrivateFilesVerified } from '@/lib/storage';
import type { ActionResult } from '@/lib/validation';

/**
 * Droit à l'effacement (RGPD, art. 17) d'une personne, à sa demande ou à celle de ses parents. Réservé à la
 * présidence, confirmation tapée, tracé dans audit_events. Les montants réglés restent (obligations comptables).
 */
export async function erasePersonData(personId: string, confirmation: string): Promise<ActionResult<{ complete: boolean }>> {
  const ctx = await getClubContext();
  if (!ctx) return { ok: false, error: 'Session expirée : reconnectez-vous.' };
  if (!grantsCan(ctx.grants, 'club.admin')) return { ok: false, error: 'Réservé à la présidence du club.' };
  if (confirmation !== 'EFFACER') return { ok: false, error: 'Tapez EFFACER pour confirmer.' };
  const id = z.string().uuid().safeParse(personId);
  if (!id.success) return { ok: false, error: 'Personne introuvable.' };
  try {
    const done = await erasePerson(getDatabase(), ctx.club.id, id.data, new Date(), deletePrivateFilesVerified);
    if (!done) return { ok: false, error: 'Personne introuvable ou déjà effacée.' };
    await createAdminClient().from('audit_events').insert({ club_id: ctx.club.id, actor_id: ctx.auth.userId, action: 'rgpd.effacement', object_id: id.data });
    revalidatePath('/club-admin', 'layout');
    if (!done.personneSupprimee) {
      return {
        ok: true,
        data: { complete: false },
        message: `${done.echecsFichiers} fichier(s) n’ont pas pu être supprimés : relancez l’effacement dans quelques minutes pour terminer.`,
      };
    }
    const shared = done.famillesPartagees
      ? ` ${done.famillesPartagees} dossier(s) familial(aux) conservé(s) : ils concernent aussi un frère ou une sœur toujours au club.`
      : '';
    return {
      ok: true,
      data: { complete: true },
      message: `Données effacées : ${done.pieces} pièce(s) supprimée(s), ${done.adherents} inscription(s) anonymisée(s).${shared}`,
    };
  } catch (error) {
    console.error('[rgpd] effacement', error instanceof Error ? error.message : error);
    return { ok: false, error: 'L’effacement s’est interrompu. Ce qui était déjà traité est enregistré ; relancez-le pour terminer.' };
  }
}
