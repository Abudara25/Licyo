// Lieu de naissance saisi depuis l'espace famille /depot/<token> (carte « Lieu de naissance », proposée aussi dans
// l'e-mail de relance) : requis pour que l'inscription soit complète (hasBirthPlace). Même protection que la page (le
// jeton secret de la famille, et un signal de même origine vérifié par functions/depot/_middleware.js). Une fois
// l'inscription complète, la correction passe par le club (fiche admin).
import { isInscriptionComplete } from '../../_shared/inscriptions-db.js';
import { afterInscriptionChange } from '../../_shared/automations.js';
import { loadFamilyAccess } from '../../_shared/family-links.js';

const MAX_LENGTH = 200;

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadFamilyAccess(request, env, params.token);
  if (access.status === 'unknown') return new Response('Lien invalide.', { status: 404 });
  // Lien expiré ou révoqué : retour sur la page, qui propose d'en recevoir un nouveau par e-mail.
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: `/depot/${encodeURIComponent(params.token)}` } });
  const { row: inscription, organization } = access;

  const back = (param) => new Response('', { status: 302, headers: { Location: `/depot/${encodeURIComponent(params.token)}?${param}#naissance` } });
  const error = (message) => back(`naissanceError=${encodeURIComponent(message)}`);

  let form;
  try {
    form = await request.formData();
  } catch {
    return error('Envoi invalide, réessayez.');
  }
  const value = (name) => String(form.get(name) ?? '').trim();
  const pays = value('paysNaissance');
  const ville = value('villeNaissance');
  const cp = value('cpNaissance');
  if (!pays || !ville) return error('Indiquez la ville et le pays de naissance.');
  if (pays.length > MAX_LENGTH || ville.length > MAX_LENGTH) return error('Texte trop long.');
  if (cp && !/^\d{5}$/.test(cp)) return error('Le code postal doit comporter 5 chiffres.');
  if (isInscriptionComplete(inscription)) return error("L'inscription est complète : pour corriger le lieu de naissance, écrivez au club.");

  try {
    await env.DB.prepare('UPDATE inscriptions SET ville_naissance = ?, pays_naissance = ?, cp_naissance = ? WHERE organization_id = ? AND id = ?')
      .bind(ville, pays, cp || null, organization.id, inscription.id)
      .run();
  } catch {
    return error("Échec de l'enregistrement, réessayez ou écrivez-nous à contact@clubdemo.licyo.fr.");
  }

  // Peut rendre l'inscription complète : e-mail « Dossier complet » (une seule fois), CRM à jour par la réconciliation.
  waitUntil(afterInscriptionChange(env, { organizationId: organization.id, id: inscription.id, before: inscription, step: 'naissance', source: 'famille', siteUrl: new URL(request.url).origin }));
  return back('naissanceOk=1');
}
