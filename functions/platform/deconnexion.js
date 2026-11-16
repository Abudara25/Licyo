// Déconnexion de la console fondateur (POST seulement : un lien ne peut pas déconnecter à l'insu de l'opérateur).
import { destroyPlatformSession } from '../_shared/platform-auth.js';

export async function onRequestPost({ request, env }) {
  const cookies = await destroyPlatformSession(request, env);
  const response = new Response('', { status: 303, headers: { Location: '/platform/connexion', 'Cache-Control': 'no-store' } });
  for (const c of cookies) response.headers.append('Set-Cookie', c);
  return response;
}
