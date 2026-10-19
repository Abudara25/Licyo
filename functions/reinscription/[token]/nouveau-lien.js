// « Recevoir un nouveau lien » depuis un lien de réinscription expiré (2026-10-16) : un nouveau jeton remplace l'ancien
// (qui ne sert plus à rien) et part UNIQUEMENT aux adresses enregistrées sur la fiche, au plus une fois par heure et par
// fiche, cinq demandes par heure et par connexion. Réponse identique dans tous les cas. Même origine exigée.
import { resolveOrganization } from '../../_shared/organization.js';
import { ensureInscriptionsTable } from '../../_shared/inscriptions-db.js';
import { ensureFamilyLinksTable, renewReinscriptionLink, RENEW_LIMIT } from '../../_shared/family-links.js';
import { getCategoriesConfig } from '../../_shared/settings-kv.js';
import { sendReinscriptionEmail } from '../../_shared/confirmation-email.js';
import { clientKey, hitRateLimit, hasSameOriginSignal } from '../../_shared/security.js';

const CLIENT_LIMIT = { limit: 5, windowSeconds: 3600 };
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function onRequestPost({ request, env, params, waitUntil }) {
  if (!hasSameOriginSignal(request)) return new Response('Requête refusée.', { status: 403 });
  const done = new Response('', { status: 303, headers: { Location: `/reinscription/${encodeURIComponent(params.token)}?envoye=1`, 'Cache-Control': 'no-store' } });
  if (!TOKEN_RE.test(String(params.token))) return done;
  try {
    const { allowed: clientOk } = await hitRateLimit(env.DB, `famlink:client:${await clientKey(request)}`, CLIENT_LIMIT);
    if (!clientOk) return done;
    const organization = await resolveOrganization(request, env);
    if (!organization) return done;
    await ensureInscriptionsTable(env.DB);
    await ensureFamilyLinksTable(env.DB);
    const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND reinscription_token = ?').bind(organization.id, params.token).first();
    if (!row) return done;
    const { allowed } = await hitRateLimit(env.DB, `famlink:reinsc:${row.id}`, RENEW_LIMIT);
    if (!allowed) return done;
    const token = await renewReinscriptionLink(env.DB, organization.id, row.id);
    const { dateLimiteReinscription } = await getCategoriesConfig(env, organization.id);
    waitUntil(sendReinscriptionEmail(env, { ...row, reinscription_token: token }, new URL(request.url).origin, dateLimiteReinscription, false).catch(() => {}));
  } catch {
    // Même réponse dans tous les cas.
  }
  return done;
}
