// Bascule manuelle ouvert/fermé des inscriptions, écrite dans le KV "licyo_config"
// (clé "inscription_status") lu par functions/api/inscription-status.js et affiché sur
// inscription.html (bloc #inscription-status, data-status="open"/"closed"). Avant cet endpoint,
// la seule façon de fermer les inscriptions était de modifier la valeur KV à la main dans le
// dashboard Cloudflare — voir CLAUDE.md.
import { isAuthed, loginPage } from '../_shared/admin-auth.js';
import { setInscriptionStatus } from '../_shared/settings-kv.js';

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const form = await request.formData();
  const status = form.get('status');

  if (status === 'open' || status === 'closed') {
    try {
      await setInscriptionStatus(env, admin.organizationId, status);
    } catch {
      // KV indisponible (binding non configuré) : on ignore, la page admin réaffichera l'état par défaut.
    }
  }

  return new Response('', { status: 302, headers: { Location: '/admin/inscriptions' } });
}
