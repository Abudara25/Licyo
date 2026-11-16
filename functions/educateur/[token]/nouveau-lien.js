// « Recevoir un nouveau lien » depuis un lien de fiche éducateur expiré ou révoqué. Le nouveau lien part UNIQUEMENT à
// l'adresse enregistrée par le club (jamais affiché), au plus une fois par heure et par fiche, cinq demandes par heure
// et par connexion. Réponse identique dans tous les cas : rien ne révèle l'existence d'une fiche.
import { loadEducateurAccess, RENEW_LIMIT } from '../../_shared/educateurs.js';
import { sendEducateurLinkEmail } from '../../_shared/confirmation-email.js';
import { clientKey, hitRateLimit } from '../../_shared/security.js';

const CLIENT_LIMIT = { limit: 5, windowSeconds: 3600 };

export async function onRequestPost({ request, env, params, waitUntil }) {
  const done = new Response('', { status: 303, headers: { Location: `/educateur/${encodeURIComponent(params.token)}?envoye=1`, 'Cache-Control': 'no-store' } });
  try {
    const { allowed: clientOk } = await hitRateLimit(env.DB, `educlink:client:${await clientKey(request)}`, CLIENT_LIMIT);
    if (!clientOk) return done;
    const access = await loadEducateurAccess(request, env, params.token);
    if (!access.row || access.row.archived_at) return done;
    const { allowed } = await hitRateLimit(env.DB, `educlink:fiche:${access.row.id}`, RENEW_LIMIT);
    if (!allowed) return done;
    waitUntil(sendEducateurLinkEmail(env, access.row, new URL(request.url).origin, { origin: 'famille', renew: true }).catch(() => {}));
  } catch {
    // Même réponse : rien ne doit distinguer un échec d'un succès.
  }
  return done;
}
