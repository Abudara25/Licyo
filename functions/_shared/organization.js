// Organisation courante, déterminée CÔTÉ SERVEUR uniquement (fondations SaaS, 2026-09-23) :
// - pages et API publiques : d'après le domaine de la requête (table organization_domains) ;
// - espace admin : d'après la session (admin_sessions.organization_id, voir isAuthed dans admin-auth.js).
// Un organization_id envoyé par le navigateur n'est jamais pris en compte.
import { ensureSchema } from './inscriptions-db.js';
import { DEMO_ORG_ID } from './schema.js';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const CACHE_TTL_MS = 60_000;
const cache = new Map(); // domaine → { org, expires }

// "a.b.licyo.pages.dev" → ["a.b.licyo.pages.dev", "b.licyo.pages.dev", "licyo.pages.dev"].
// Un sous-domaine hérite de l'organisation d'un domaine enregistré (déploiements de prévisualisation
// <hash>.licyo.pages.dev) ; on s'arrête avant le suffixe de premier niveau.
function candidateDomains(hostname) {
  const labels = hostname.split('.');
  const candidates = [];
  for (let i = 0; i < labels.length - 1; i++) candidates.push(labels.slice(i).join('.'));
  return candidates;
}

// Renvoie l'organisation active du domaine de la requête, ou null (domaine inconnu, organisation
// suspendue) : l'appelant répond alors 404, sans rien révéler d'autre.
export async function resolveOrganization(request, env) {
  const hostname = new URL(request.url).hostname.toLowerCase();
  // Développement local (wrangler pages dev) : pas de domaine, organisation configurable.
  if (LOOPBACK.has(hostname)) return loadOrganization(env, env.LOCAL_ORGANIZATION_ID || DEMO_ORG_ID);

  const cached = cache.get(hostname);
  if (cached && cached.expires > Date.now() && cached.db === env.DB) return cached.org;

  await ensureSchema(env.DB);
  const candidates = candidateDomains(hostname);
  if (!candidates.length) return null;
  const org = await env.DB.prepare(
    `SELECT o.* FROM organization_domains d JOIN organizations o ON o.id = d.organization_id
     WHERE d.domain IN (${candidates.map(() => '?').join(', ')}) AND o.status = 'active'
     ORDER BY length(d.domain) DESC LIMIT 1`
  )
    .bind(...candidates)
    .first();
  cache.set(hostname, { org: org || null, expires: Date.now() + CACHE_TTL_MS, db: env.DB });
  return org || null;
}

export async function loadOrganization(env, organizationId) {
  if (!organizationId) return null;
  await ensureSchema(env.DB);
  return (await env.DB.prepare("SELECT * FROM organizations WHERE id = ? AND status = 'active'").bind(organizationId).first()) || null;
}

// Réponse commune quand le domaine ne correspond à aucune organisation.
export const unknownOrganization = () => new Response('Organisation inconnue.', { status: 404, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });

// Tests uniquement.
export function clearOrganizationCache() {
  cache.clear();
}
