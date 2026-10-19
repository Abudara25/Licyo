// Ferme la session admin (supprimée de D1, cookies effacés) et renvoie vers la page de connexion.
// Lien simple (GET) : un autre site pourrait y envoyer le navigateur ; dans ce cas la session n'est pas fermée
// (en-tête Sec-Fetch-Site fourni par le navigateur), seule la redirection a lieu.
import { destroySession, withCookies } from '../_shared/admin-auth.js';

export async function onRequestGet({ request, env }) {
  const site = request.headers.get('Sec-Fetch-Site');
  // ?inactif=1 : coupure par le minuteur d'inactivité (admin-session.js), signalée sur l'écran de connexion.
  const inactif = new URL(request.url).searchParams.get('inactif') === '1';
  const redirect = new Response('', { status: 302, headers: { Location: inactif ? '/admin/inscriptions?inactif=1' : '/admin/inscriptions' } });
  if (site === 'cross-site' || site === 'same-site') return redirect;
  return withCookies(redirect, await destroySession(request, env));
}
