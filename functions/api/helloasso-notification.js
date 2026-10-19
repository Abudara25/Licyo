// URL de notification à enregistrer chez HelloAsso (Mon compte › Intégrations et API), avec le secret
// de l'organisation en paramètre : https://<domaine>/api/helloasso-notification?key=<secret>
// (Sportville : HELLOASSO_WEBHOOK_SECRET, voir _shared/integrations.js)
// (l'URL complète est affichée dans /admin/parametres). Seules les notifications "Order" sont traitées
// (voir _shared/helloasso.js). HelloAsso réessaie tant qu'il ne reçoit pas de 200 : on renvoie 200 pour
// tout ce qui est volontairement ignoré, 500 seulement si le traitement a échoué et doit être retenté.
import { processHelloAssoOrder } from '../_shared/helloasso.js';
import { getAutomationsConfig } from '../_shared/settings-kv.js';
import { resolveOrganization } from '../_shared/organization.js';
import { isValidHelloAssoKey } from '../_shared/integrations.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env, waitUntil }) {
  const url = new URL(request.url);
  // L'organisation est celle du domaine enregistré chez HelloAsso ; la clé doit être SON secret.
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization || !isValidHelloAssoKey(env, organization.id, url.searchParams.get('key'))) {
    return json({ error: 'forbidden' }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ status: 'ignored', reason: 'contenu illisible' });
  }
  if (payload?.eventType !== 'Order') return json({ status: 'ignored', reason: `événement ${payload?.eventType || 'inconnu'}` });
  if (!(await getAutomationsConfig(env, organization.id)).helloassoAutoPay) return json({ status: 'ignored', reason: 'automatisation désactivée' });

  try {
    return json(await processHelloAssoOrder(env, payload.data, url.origin, waitUntil, organization.id));
  } catch {
    return json({ error: 'processing_failed' }, 500);
  }
}
