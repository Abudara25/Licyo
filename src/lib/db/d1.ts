import 'server-only';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { SqlDatabase } from './query';

/** Liaisons Cloudflare déclarées dans wrangler.jsonc. */
export type LicyoEnv = {
  DB: D1Database;
  PUBLIC_ASSETS: R2Bucket;
  PRIVATE_DOCS: R2Bucket;
  EMAIL?: { send(message: unknown): Promise<unknown> };
};

export function cloudflareEnv(): LicyoEnv {
  return getCloudflareContext().env as unknown as LicyoEnv;
}

/** Base D1 de la requête en cours. */
export function getDatabase(): SqlDatabase {
  return cloudflareEnv().DB as unknown as SqlDatabase;
}
