// Passage d'un enfant à l'autre dans l'espace famille (2026-11-14, _shared/siblings.js) : depuis le lien valable d'un
// enfant, ouvre l'espace d'un frère ou d'une sœur (même responsable par e-mail, même organisation, fiche active, liens
// non révoqués par le club). Un lien neuf de la fiche visée est créé, puis redirection vers son espace.
// Lien expiré, inconnu, ou enfant qui n'est pas de la fratrie : rien n'est révélé (même page que le lien d'origine).
import { loadFamilyAccess, issueFamilyLink } from '../../../_shared/family-links.js';
import { findSiblings } from '../../../_shared/siblings.js';
import { hitRateLimit } from '../../../_shared/security.js';

// Au plus 30 passages par heure et par fiche d'origine (chaque passage crée un lien).
const SWITCH_LIMIT = { limit: 30, windowSeconds: 3600 };

const redirect = (location) => new Response('', { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin' } });

export async function onRequestGet({ request, env, params }) {
  const back = `/depot/${encodeURIComponent(params.token)}`;
  const access = await loadFamilyAccess(request, env, params.token);
  if (access.status !== 'ok') return redirect(back);
  const targetId = Number(params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) return redirect(back);
  const sibling = (await findSiblings(env.DB, access.organization.id, access.row)).find((s) => s.id === targetId);
  if (!sibling) return redirect(back);
  const { allowed } = await hitRateLimit(env.DB, `famswitch:${access.row.id}`, SWITCH_LIMIT);
  if (!allowed) return redirect(`${back}?fratrie=limite`);
  const token = await issueFamilyLink(env.DB, access.organization.id, sibling.id);
  return redirect(`/depot/${token}`);
}
