// Vérification Cloudflare Turnstile côté serveur (siteverify). Module pur : la clé secrète et fetch sont fournis
// par l'appelant, ce qui permet de le tester sans réseau.
//
// Sans clé secrète configurée (développement, recette sans domaine), la vérification est désactivée et le signale :
// les formulaires restent protégés par la limitation de débit en base (src/lib/security/public-guard.ts).

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type TurnstileResult =
  | { ok: true; skipped: boolean }
  | { ok: false; reason: 'missing-token' | 'rejected' | 'unavailable' };

export async function verifyTurnstile(opts: {
  secret: string | undefined;
  token: unknown;
  ip?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<TurnstileResult> {
  if (!opts.secret) return { ok: true, skipped: true };
  const token = typeof opts.token === 'string' ? opts.token.trim() : '';
  // Un jeton Turnstile fait au plus 2048 caractères.
  if (!token || token.length > 2048) return { ok: false, reason: 'missing-token' };
  const body = new FormData();
  body.set('secret', opts.secret);
  body.set('response', token);
  if (opts.ip && opts.ip !== 'inconnue') body.set('remoteip', opts.ip);
  try {
    const res = await (opts.fetchImpl ?? fetch)(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? { ok: true, skipped: false } : { ok: false, reason: 'rejected' };
  } catch {
    // Service de vérification injoignable : on refuse plutôt que d'ouvrir le formulaire aux robots.
    return { ok: false, reason: 'unavailable' };
  }
}

export function turnstileMessage(reason: Exclude<TurnstileResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'missing-token':
      return 'Merci de patienter pendant la vérification anti-robot, puis réessayez.';
    case 'rejected':
      return 'La vérification anti-robot a échoué. Rechargez la page et réessayez.';
    default:
      return 'Vérification anti-robot momentanément indisponible. Réessayez dans un instant.';
  }
}
