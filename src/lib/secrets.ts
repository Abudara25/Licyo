import 'server-only';
import { cloudflareEnv } from '@/lib/db/d1';

/**
 * Secret ou variable du Worker : liaison Cloudflare d'abord (`wrangler secret put`, `.dev.vars` en local), puis
 * process.env. En `next dev`, OpenNext expose .dev.vars dans le contexte Cloudflare mais pas dans process.env.
 */
export function workerVar(name: string): string | undefined {
  let fromBinding: unknown;
  try {
    fromBinding = (cloudflareEnv() as unknown as Record<string, unknown>)[name];
  } catch {
    fromBinding = undefined; // hors requête (build, scripts)
  }
  const value = typeof fromBinding === 'string' && fromBinding ? fromBinding : process.env[name];
  return value || undefined;
}
