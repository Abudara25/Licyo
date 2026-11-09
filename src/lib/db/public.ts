import 'server-only';
import { makeClient, type DbClient } from './client.ts';
import { getDatabase } from './d1.ts';

/** Client visiteur anonyme (lectures publiques de vitrine), soumis aux règles « public ». */
export function createPublicClient(): DbClient {
  return makeClient(getDatabase(), { role: 'anon' });
}
