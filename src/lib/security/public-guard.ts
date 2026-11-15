import 'server-only';
import { headers } from 'next/headers';
import { rateLimit } from '@/lib/auth/session';
import { turnstileMessage, verifyTurnstile } from './turnstile';
import { workerVar } from '@/lib/secrets';

/** Adresse du visiteur : fournie par Cloudflare (cf-connecting-ip), jamais par le formulaire. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'inconnue';
}

/**
 * Garde commune aux formulaires publics (inscription, essai, partenariat, cours, connexion) :
 * 1. limitation de débit en base D1 (partagée entre toutes les instances du Worker, contrairement à la mémoire) ;
 * 2. vérification Turnstile si le secret TURNSTILE_SECRET_KEY est configuré.
 * Renvoie un message d'erreur pour l'utilisateur, ou null si la demande peut continuer.
 */
export async function guardPublicForm(opts: {
  bucket: string;
  max: number;
  windowSeconds: number;
  turnstileToken: unknown;
}): Promise<string | null> {
  const ip = await clientIp();
  if (!(await rateLimit(`public:${opts.bucket}:${ip}`, opts.max, opts.windowSeconds))) {
    return 'Trop de tentatives. Réessayez plus tard.';
  }
  const check = await verifyTurnstile({ secret: workerVar('TURNSTILE_SECRET_KEY'), token: opts.turnstileToken, ip });
  return check.ok ? null : turnstileMessage(check.reason);
}

/** Jeton Turnstile lu dans une entrée de formulaire (objet ou FormData), sans le valider. */
export function turnstileTokenFrom(input: unknown): unknown {
  if (input instanceof FormData) return input.get('turnstileToken');
  return input && typeof input === 'object' ? (input as Record<string, unknown>).turnstileToken : undefined;
}
