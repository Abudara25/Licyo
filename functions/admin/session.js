// État de la session admin pour assets/js/admin-session.js (déconnexion après inactivité, 2026-10-10).
// GET /admin/session : secondes restantes, SANS prolonger (le minuteur vérifie avant d'avertir ou de couper).
// GET /admin/session?prolonger=1 : activité de l'utilisateur (clics, frappes, « Rester connecté ») → prolonge.
// Une requête venue d'un autre site ne prolonge rien (même règle que /admin/logout). 401 si la session est finie.
import { readSession } from '../_shared/admin-auth.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestGet({ request, env }) {
  const site = request.headers.get('Sec-Fetch-Site');
  const extend = new URL(request.url).searchParams.get('prolonger') === '1' && site !== 'cross-site' && site !== 'same-site';
  const session = await readSession(request, env, { touch: extend });
  if (!session) return json({ authenticated: false }, 401);
  return json({ authenticated: true, remaining: Math.max(0, session.expiresAt - Math.floor(Date.now() / 1000)) });
}
