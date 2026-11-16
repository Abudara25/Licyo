// « Recevoir un nouveau lien » depuis un lien expiré ou révoqué de l'espace famille (2026-10-16). Le nouveau lien part
// UNIQUEMENT aux adresses enregistrées sur la fiche (jamais affiché ici), au plus une fois par heure et par fiche, et
// cinq demandes par heure et par connexion. La réponse est la même dans tous les cas (lien inconnu, limite atteinte,
// envoi en échec) : elle ne révèle rien sur l'existence d'une inscription. Signal de même origine exigé par
// functions/depot/_middleware.js.
import { loadFamilyAccess, RENEW_LIMIT } from '../../_shared/family-links.js';
import { sendFamilyLinkEmail } from '../../_shared/confirmation-email.js';
import { clientKey, hitRateLimit } from '../../_shared/security.js';

const CLIENT_LIMIT = { limit: 5, windowSeconds: 3600 };

export async function onRequestPost({ request, env, params, waitUntil }) {
  const done = new Response('', { status: 303, headers: { Location: `/depot/${encodeURIComponent(params.token)}?envoye=1`, 'Cache-Control': 'no-store' } });
  try {
    const { allowed: clientOk } = await hitRateLimit(env.DB, `famlink:client:${await clientKey(request)}`, CLIENT_LIMIT);
    if (!clientOk) return done;
    const access = await loadFamilyAccess(request, env, params.token);
    if (!access.row || access.row.archived_at) return done;
    const { allowed } = await hitRateLimit(env.DB, `famlink:fiche:${access.row.id}`, RENEW_LIMIT);
    if (!allowed) return done;
    waitUntil(sendFamilyLinkEmail(env, access.row, new URL(request.url).origin, 'famille').catch(() => {}));
  } catch {
    // Même réponse : rien ne doit distinguer un échec d'un succès.
  }
  return done;
}
