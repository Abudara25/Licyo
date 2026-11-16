// Étape 1 du flux OAuth Sveltia CMS : redirige vers l'écran d'autorisation GitHub.
// Voir functions/_shared/oauth-common.js pour le contexte, et functions/callback.js pour la suite.
import { getDomainPatterns, outputHTML } from './_shared/oauth-common.js';

export async function onRequestGet({ request, env }) {
  const { searchParams } = new URL(request.url);
  const { provider, site_id: domain } = Object.fromEntries(searchParams);

  if (provider !== 'github') {
    return outputHTML({
      env,
      error: 'Seul le backend GitHub est pris en charge par cet administrateur.',
      errorCode: 'UNSUPPORTED_BACKEND',
    });
  }

  const { ALLOWED_DOMAINS, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;
  const domainPatterns = getDomainPatterns(ALLOWED_DOMAINS);

  if (domainPatterns.length && !domainPatterns.some((pattern) => new RegExp(pattern).test(domain ?? ''))) {
    return outputHTML({
      env,
      error: "Ce domaine n'est pas autorisé à utiliser cet administrateur.",
      errorCode: 'UNSUPPORTED_DOMAIN',
    });
  }

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return outputHTML({
      env,
      error: "L'identifiant ou le secret de l'application OAuth GitHub n'est pas configuré.",
      errorCode: 'MISCONFIGURED_CLIENT',
    });
  }

  const csrfToken = globalThis.crypto.randomUUID().replaceAll('-', '');
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    scope: 'repo,user',
    state: csrfToken,
  });

  return new Response('', {
    status: 302,
    headers: {
      Location: `https://github.com/login/oauth/authorize?${params.toString()}`,
      'Set-Cookie': `csrf-token=${csrfToken}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax; Secure`,
    },
  });
}
