import 'server-only';
import { cloudflareEnv } from '@/lib/db/d1';

/**
 * Recopie les variables texte du Worker dans process.env quand elles y manquent. Utile en `next dev` seulement
 * (OpenNext expose .dev.vars dans le contexte Cloudflare, pas dans process.env) ; sans effet en production, où
 * OpenNext les y place déjà. Permet aux modules purs (signature HMAC, chiffrement) de lire process.env.
 */
export function hydrateProcessEnv(): void {
  let env: Record<string, unknown>;
  try {
    env = cloudflareEnv() as unknown as Record<string, unknown>;
  } catch {
    return; // hors requête
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Secret ou variable du Worker : liaison Cloudflare d'abord (`wrangler secret put`, `.dev.vars` en local), puis
 * process.env. En `next dev`, OpenNext expose .dev.vars dans le contexte Cloudflare mais pas dans process.env.
 */
export function workerVar(name: string): string | undefined {
  hydrateProcessEnv();
  let fromBinding: unknown;
  try {
    fromBinding = (cloudflareEnv() as unknown as Record<string, unknown>)[name];
  } catch {
    fromBinding = undefined; // hors requête (build, scripts)
  }
  const value = typeof fromBinding === 'string' && fromBinding ? fromBinding : process.env[name];
  return value || undefined;
}
