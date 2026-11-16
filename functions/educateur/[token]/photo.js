// Photo de l'éducateur depuis sa fiche /educateur/<lien> : GET l'affiche, POST la dépose (_shared/educateurs.js).
import { loadEducateurAccess, storeEducateurPhoto, educateurPhotoResponse } from '../../_shared/educateurs.js';

export async function onRequestGet({ request, env, params }) {
  const access = await loadEducateurAccess(request, env, params.token);
  return educateurPhotoResponse(env, access.status === 'ok' ? access.row : null);
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadEducateurAccess(request, env, params.token);
  if (access.status === 'unknown') return new Response('Lien invalide.', { status: 404 });
  const base = `/educateur/${encodeURIComponent(params.token)}`;
  if (access.status !== 'ok') return new Response('', { status: 303, headers: { Location: base } });
  const back = (query) => new Response('', { status: 303, headers: { Location: `${base}?${query}#photo` } });
  let form;
  try {
    form = await request.formData();
  } catch {
    return back(`photoError=${encodeURIComponent('Envoi invalide, réessayez.')}`);
  }
  let stored;
  try {
    stored = await storeEducateurPhoto(env, access.row, form.get('photo'), waitUntil);
  } catch {
    stored = { error: 'Échec de l’envoi, réessayez.' };
  }
  return back(stored.error ? `photoError=${encodeURIComponent(stored.error)}` : 'photoOk=1');
}
