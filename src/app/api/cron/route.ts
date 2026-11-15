import { getDatabase } from '@/lib/db/d1';
import { runScheduledTasks, sameSecret } from '@/lib/scheduled';
import { workerVar } from '@/lib/secrets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Point d'entrée des tâches planifiées. Appelé par le Cron Trigger du Worker (worker.ts, `scheduled`) avec
 * « Authorization: Bearer <CRON_SECRET> ». Sans secret configuré, la route est fermée.
 * Réponse : le résultat de chaque tâche (chiffres seulement) ; 500 si l'une d'elles a échoué.
 */
export async function POST(req: Request) {
  const expected = workerVar('CRON_SECRET') ?? '';
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!expected || !sameSecret(given, expected)) return new Response('Accès refusé', { status: 401 });

  const results = await runScheduledTasks(getDatabase());
  const failed = results.filter((r) => r.status === 'failed');
  for (const r of results) console.log(`[cron] ${r.task} : ${r.status} - ${r.detail}`);
  return Response.json({ ok: failed.length === 0, results }, { status: failed.length ? 500 : 200, headers: { 'Cache-Control': 'no-store' } });
}
