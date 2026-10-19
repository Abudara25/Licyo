// Actualités de l'organisation du domaine (liste lue par assets/js/actualites.js). L'organisation est résolue côté
// serveur ; aucun paramètre du navigateur ne choisit l'organisation ni le fichier lu (voir _shared/news.js).
import { resolveOrganization } from '../_shared/organization.js';
import { articlesForOrganization } from '../_shared/news.js';

const json = (status, data) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  let organization;
  try {
    organization = await resolveOrganization(request, env);
  } catch (error) {
    console.warn(`Actualités : organisation non résolue (${error?.name || 'Error'})`);
    return json(503, { error: 'Service momentanément indisponible.' });
  }
  if (!organization) return json(404, { error: 'Organisation inconnue.' });
  try {
    return json(200, { articles: articlesForOrganization(organization.id) });
  } catch (error) {
    console.warn(`Actualités : liste non lue pour ${organization.id} (${error?.name || 'Error'})`);
    return json(503, { error: 'Service momentanément indisponible.' });
  }
}
