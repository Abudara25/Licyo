// Reçoit les événements envoyés directement par le navigateur (assets/js/main.js, éléments [data-track-event] ;
// Cloudflare Zaraz, qui les relayait, est retiré depuis le 2026-10-16). Même origine exigée. Aucun cookie, aucune IP, aucun identifiant de
// visiteur stocké : un type d'événement, la route de la page, une date, rattachés à l'organisation du site.
//
// Durcissement R0a (2026-09-28) — la route est publique et non authentifiée :
//   - organisation résolue CÔTÉ SERVEUR par le domaine de la requête (resolveOrganization) : domaine inconnu ou
//     organisation inactive → 404, rien n'est écrit. Aucun champ du corps (organization_id compris) n'est pris en compte
//     hormis `event` et `page` ;
//   - événement en liste blanche (SITE_EVENT_TYPES) ;
//   - page : chemin simple validé (parsePage), puis ramené à une route de la version publiée du site de l'organisation
//     (publishedRoute) ; tout autre chemin est enregistré sans page ;
//   - corps borné (8 Ko), limites de débit par visiteur et par organisation (SITE_EVENT_LIMITS) ;
//   - panne de base : 503, rien n'est écrit (échec fermé).
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';
import { clientKey, hitRateLimit, hasSameOriginSignal } from '../_shared/security.js';
import { SITE_EVENT_LIMITS, ensureSiteEventsTable, isSiteEventType, parsePage, publishedRoute } from '../_shared/site-events.js';

export const MAX_BODY_BYTES = 8192;

const reply = (status, body, headers = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store', ...headers } });

// Corps lu au plus jusqu'à la limite (le Content-Length peut manquer ou mentir) ; UTF-8 strict. null : trop volumineux.
async function readBoundedText(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function onRequestPost({ request, env }) {
  if (!hasSameOriginSignal(request)) return reply(403, 'Requête refusée');
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply(413, 'Requête trop volumineuse');

  let raw;
  try {
    raw = await readBoundedText(request, MAX_BODY_BYTES);
  } catch {
    return reply(400, 'Requête illisible');
  }
  if (raw === null) return reply(413, 'Requête trop volumineuse');

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return reply(400, 'JSON invalide');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, 'Objet JSON attendu');
  if (!isSiteEventType(data.event)) return reply(400, 'Événement inconnu');
  const page = parsePage(data.page);
  if (!page.ok) return reply(400, 'Page invalide');

  let organization;
  try {
    organization = await resolveOrganization(request, env);
  } catch {
    return reply(503, 'Service indisponible');
  }
  if (!organization) return unknownOrganization();

  try {
    const perClient = await hitRateLimit(env.DB, `site-event:client:${organization.id}:${await clientKey(request)}`, SITE_EVENT_LIMITS.client);
    if (!perClient.allowed) return reply(429, 'Trop de requêtes', { 'Retry-After': String(perClient.retryAfter) });
    const perOrganization = await hitRateLimit(env.DB, `site-event:org:${organization.id}`, SITE_EVENT_LIMITS.organization);
    if (!perOrganization.allowed) return reply(429, 'Trop de requêtes', { 'Retry-After': String(perOrganization.retryAfter) });
  } catch {
    return reply(503, 'Service indisponible');
  }

  let route = null;
  try {
    route = await publishedRoute(env, organization.id, page.path);
  } catch (error) {
    console.warn(`Mesure d'audience : routes publiées non lues pour ${organization.id} (${error?.name || 'Error'})`);
  }

  try {
    await ensureSiteEventsTable(env.DB);
    await env.DB.prepare('INSERT INTO site_events (organization_id, event, page) VALUES (?, ?, ?)').bind(organization.id, data.event, route).run();
  } catch {
    return reply(503, 'Échec de l’enregistrement');
  }

  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
