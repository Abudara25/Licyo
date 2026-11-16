// POST /platform/api/organisations/<id> : actions sur une organisation (permission orgs.manage, middleware).
//   action=block   (motif obligatoire) : bloque l'accès — site public et espace admin fermés, bureau déconnecté ;
//   action=unblock                      : rétablit l'accès.
import { setOrganizationStatus } from '../../../_shared/platform-data.js';
import { PlatformError } from '../../../_shared/platform-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const reason = String(form.get('reason') || '').trim();
  try {
    if (action === 'block') {
      if (reason.length < 3) return json({ error: 'Indiquez le motif du blocage.' }, 400);
      await setOrganizationStatus(env, context.data.operator, String(params.id), 'suspended', reason);
      return json({ ok: true });
    }
    if (action === 'unblock') {
      await setOrganizationStatus(env, context.data.operator, String(params.id), 'active', reason);
      return json({ ok: true });
    }
    return json({ error: 'Action inconnue.' }, 400);
  } catch (error) {
    if (error instanceof PlatformError) return json({ error: error.message }, 400);
    throw error;
  }
}
