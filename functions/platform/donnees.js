// Module de données de l'interface (réservé à un opérateur connecté, voir _middleware.js) : jamais mis en cache.
import { buildSnapshot, snapshotModule } from '../_shared/platform-snapshot.js';
import { PLATFORM_ROLE_LABELS } from '../_shared/platform-auth.js';

export async function onRequestGet(context) {
  const operator = { ...context.data.operator, roleLabel: PLATFORM_ROLE_LABELS[context.data.operator.role] };
  const body = snapshotModule(await buildSnapshot(context.env, operator));
  return new Response(body, { headers: { 'Content-Type': 'text/javascript;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
