'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { findUserByEmail, rateLimit } from '@/lib/auth/session';
import { sendLoginLink } from '@/lib/auth/links';
import { safeNextPath } from '@/lib/auth/tokens';

export type LoginLinkResult = { ok: true } | { ok: false; error: string };

/**
 * Envoie un lien de connexion. Réponse identique que le compte existe ou non :
 * on ne révèle pas qui a un compte. Seuls /commencer et /espace-adherent
 * peuvent créer un compte ; ailleurs, il faut avoir été invité.
 */
export async function requestLoginLink(input: { email: string; next: string }): Promise<LoginLinkResult> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email().max(254), next: z.string().max(300) })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Adresse e-mail invalide.' };
  const { email } = parsed.data;
  const next = safeNextPath(parsed.data.next);

  const ip = (await headers()).get('cf-connecting-ip') ?? 'inconnue';
  const allowed = (await rateLimit(`login:email:${email}`, 5, 3600)) && (await rateLimit(`login:ip:${ip}`, 30, 3600));
  if (!allowed) return { ok: false, error: 'Trop de demandes. Réessayez dans une heure.' };

  const canCreate = next.startsWith('/commencer') || next.startsWith('/espace-adherent');
  if (!canCreate && !(await findUserByEmail(email))) return { ok: true };

  await sendLoginLink(email, next, canCreate);
  return { ok: true };
}
