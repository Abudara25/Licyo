// Étape 2 du flux OAuth Sveltia CMS : échange le code GitHub contre un token, renvoyé à la
// popup d'origine (functions/auth.js). Voir functions/_shared/oauth-common.js.
import { outputHTML } from './_shared/oauth-common.js';

export async function onRequestGet({ request, env }) {
  const { searchParams } = new URL(request.url);
  const { code, state } = Object.fromEntries(searchParams);
  const [, csrfToken] = request.headers.get('Cookie')?.match(/\bcsrf-token=([0-9a-f]{32})\b/) ?? [];

  if (!code || !state) {
    return outputHTML({
      env,
      error: "Le code d'autorisation n'a pas été reçu. Merci de réessayer.",
      errorCode: 'AUTH_CODE_REQUEST_FAILED',
    });
  }

  if (!csrfToken || state !== csrfToken) {
    return outputHTML({
      env,
      error: 'Anomalie détectée (CSRF). Connexion annulée.',
      errorCode: 'CSRF_DETECTED',
    });
  }

  const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return outputHTML({
      env,
      error: "L'identifiant ou le secret de l'application OAuth GitHub n'est pas configuré.",
      errorCode: 'MISCONFIGURED_CLIENT',
    });
  }

  let response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, client_id: GITHUB_CLIENT_ID, client_secret: GITHUB_CLIENT_SECRET }),
    });
  } catch {
    // response reste undefined
  }

  if (!response) {
    return outputHTML({
      env,
      error: "Impossible de demander un token d'accès. Merci de réessayer.",
      errorCode: 'TOKEN_REQUEST_FAILED',
    });
  }

  let token = '';
  let error = '';
  try {
    ({ access_token: token, error } = await response.json());
  } catch {
    return outputHTML({
      env,
      error: 'Réponse invalide de GitHub. Merci de réessayer.',
      errorCode: 'MALFORMED_RESPONSE',
    });
  }

  return outputHTML({ env, token, error });
}
