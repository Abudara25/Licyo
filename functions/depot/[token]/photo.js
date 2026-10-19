// Photo de l'enfant depuis l'espace famille /depot/<token> : GET l'affiche, POST la dépose. Même
// protection que la page (le jeton secret de la famille), mêmes règles que le dépôt admin
// (_shared/photo-storage.js).
import { photoError, storePhoto, photoResponse } from '../../_shared/photo-storage.js';
import { afterInscriptionChange } from '../../_shared/automations.js';
import { loadFamilyAccess } from '../../_shared/family-links.js';

// Le lien ne vaut que sur le domaine de son organisation et tant qu'il n'a pas expiré (_shared/family-links.js).
export async function onRequestGet({ request, env, params }) {
  const access = await loadFamilyAccess(request, env, params.token);
  return photoResponse(env, access.status === 'ok' ? access.row : null);
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadFamilyAccess(request, env, params.token);
  if (access.status === 'unknown') return new Response('Lien invalide.', { status: 404 });
  // Lien expiré ou révoqué : retour sur la page, qui propose d'en recevoir un nouveau par e-mail.
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: `/depot/${encodeURIComponent(params.token)}` } });
  const { row: inscription, organization } = access;

  const back = (param) => new Response('', { status: 302, headers: { Location: `/depot/${encodeURIComponent(params.token)}?${param}#photo` } });
  const withError = (message) => back(`photoError=${encodeURIComponent(message)}`);

  let form;
  try {
    form = await request.formData();
  } catch {
    return withError('Envoi invalide, réessayez.');
  }

  const file = form.get('photo');
  const error = photoError(file);
  if (error) return withError(error);
  if (!env.DOSSIERS) {
    return withError("L'envoi en ligne n'est pas encore activé — envoyez-nous la photo par e-mail à contact@clubdemo.licyo.fr en attendant.");
  }

  let stored;
  try {
    stored = await storePhoto(env, inscription, file, waitUntil);
  } catch {
    return withError("Échec de l'envoi, réessayez ou écrivez-nous à contact@clubdemo.licyo.fr.");
  }
  if (stored.error) return withError(stored.error);
  waitUntil(afterInscriptionChange(env, { organizationId: inscription.organization_id, id: inscription.id, before: inscription, step: 'photo', source: 'famille', siteUrl: new URL(request.url).origin }));
  return back('photoOk=1');
}
