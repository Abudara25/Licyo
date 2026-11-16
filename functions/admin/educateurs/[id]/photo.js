// Photo d'un éducateur, pour la fiche admin (organisation de la session uniquement).
import { isAuthed } from '../../../_shared/admin-auth.js';
import { getEducateur, educateurPhotoResponse } from '../../../_shared/educateurs.js';

export async function onRequestGet({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) return new Response('Non autorisé.', { status: 401 });
  const id = /^\d{1,9}$/.test(String(params.id)) ? Number(params.id) : null;
  const row = id && (await getEducateur(env.DB, admin.organizationId, id));
  const response = await educateurPhotoResponse(env, row || null);
  if (response.ok && new URL(request.url).searchParams.has('download')) response.headers.set('Content-Disposition', 'attachment; filename="photo-educateur"');
  return response;
}
