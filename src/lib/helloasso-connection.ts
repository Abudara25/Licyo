import 'server-only';
import type { SqlDatabase } from '@/lib/db/query';
import { workerVar } from '@/lib/secrets';
import { decryptSecret } from '@/lib/utils/crypto';
import { HELLOASSO_API, HelloAssoError, syncHelloAsso, type Fetch, type SyncResult } from '@/lib/helloasso';

// Connexion HelloAsso d'un club (table club_integrations, lue et écrite par le serveur uniquement) : lancement d'une
// synchronisation et enregistrement de son résultat (nombres et message d'erreur lisible, jamais le secret).

export type HelloAssoConnection = {
  club_id: string;
  account_ref: string;
  client_id: string;
  client_secret_enc: string;
  status: 'active' | 'error';
  last_sync_at: string | null;
  last_error: string | null;
  last_counts: string | null;
};

/** API HelloAsso visée : production par défaut ; HELLOASSO_API_URL pour le bac à sable (https) ou un essai local. */
export function helloAssoBase(): string {
  const v = workerVar('HELLOASSO_API_URL')?.replace(/\/+$/, '');
  if (v && (/^https:\/\//.test(v) || (process.env.NODE_ENV !== 'production' && /^http:\/\/localhost(:\d+)?$/.test(v)))) return v;
  return HELLOASSO_API;
}

export const fetchJson: Fetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20000) });

export async function getConnection(db: SqlDatabase, clubId: string): Promise<HelloAssoConnection | null> {
  const r = await db.prepare("SELECT * FROM club_integrations WHERE club_id = ? AND provider = 'helloasso'").bind(clubId).all<HelloAssoConnection>();
  return r.results?.[0] ?? null;
}

/** Synchronise un club et enregistre l'état de la connexion. Lève l'erreur après l'avoir enregistrée. */
export async function runHelloAssoSync(db: SqlDatabase, conn: HelloAssoConnection, now = new Date(), fetchFn: Fetch = fetchJson): Promise<SyncResult> {
  try {
    const result = await syncHelloAsso(
      db,
      conn.club_id,
      { organizationSlug: conn.account_ref, clientId: conn.client_id, clientSecret: decryptSecret(conn.client_secret_enc) },
      conn.last_sync_at,
      now,
      fetchFn,
      helloAssoBase(),
    );
    const { syncedUntil, ...counts } = result;
    await db
      .prepare("UPDATE club_integrations SET status = 'active', last_sync_at = ?, last_error = NULL, last_counts = ?, updated_at = ? WHERE club_id = ? AND provider = 'helloasso'")
      .bind(syncedUntil, JSON.stringify(counts), now.toISOString(), conn.club_id)
      .run();
    return result;
  } catch (error) {
    const message = error instanceof HelloAssoError ? error.message : error instanceof Error && error.name === 'TimeoutError' ? 'HelloAsso ne répond pas : nouvel essai au prochain passage.' : 'Synchronisation impossible : nouvel essai au prochain passage.';
    if (!(error instanceof HelloAssoError)) console.error('[helloasso] synchronisation', error instanceof Error ? error.message : error);
    await db
      .prepare("UPDATE club_integrations SET status = 'error', last_error = ?, updated_at = ? WHERE club_id = ? AND provider = 'helloasso'")
      .bind(message.slice(0, 300), now.toISOString(), conn.club_id)
      .run();
    throw new HelloAssoError(message, error instanceof HelloAssoError ? error.status : 0);
  }
}

/** Tâche de nuit : tous les clubs connectés, indépendamment les uns des autres. */
export async function runAllHelloAssoSyncs(db: SqlDatabase, now: Date): Promise<string> {
  const r = await db.prepare("SELECT * FROM club_integrations WHERE provider = 'helloasso'").all<HelloAssoConnection>();
  let ok = 0;
  let failed = 0;
  let added = 0;
  for (const conn of r.results ?? []) {
    try {
      added += (await runHelloAssoSync(db, conn, now)).nouveaux;
      ok++;
    } catch {
      failed++;
    }
  }
  return `clubs=${ok} echecs=${failed} nouveaux=${added}`;
}
