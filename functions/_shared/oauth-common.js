// Fonctions partagées par functions/auth.js et functions/callback.js.
// Adapté (GitHub uniquement) de https://github.com/sveltia/sveltia-cms-auth (MIT),
// le relais OAuth officiellement recommandé pour Sveltia CMS — porté ici en Pages
// Functions de ce même projet plutôt qu'en Worker Cloudflare séparé, pour partager
// le même déploiement (git push) et le même dashboard de secrets que le KV existant
// (voir functions/api/inscription-status.js).

const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const getDomainPatterns = (allowedDomains) =>
  (allowedDomains ?? '')
    .split(/,/)
    .map((str) => str.trim())
    .filter(Boolean)
    .map((str) => `^${escapeRegExp(str).replaceAll('\\*', '.+')}$`);

const serialize = (value) => JSON.stringify(value ?? null).replaceAll('<', '\\u003c');

// Réponse HTML qui transmet le token (ou l'erreur) à la fenêtre popup Sveltia CMS via postMessage.
export const outputHTML = ({ token, error, errorCode, env = {} }) => {
  const provider = 'github';
  const state = error ? 'error' : 'success';
  const content = error ? { provider, error, errorCode } : { provider, token };
  // Les messages d'erreur en français contiennent des apostrophes ("L'identifiant…") : on passe
  // par serialize() (JSON.stringify) pour obtenir un littéral JS correctement échappé, plutôt que
  // de concaténer la chaîne entre guillemets simples (ce que fait l'original anglophone, sans
  // apostrophes, mais qui casserait ici).
  const message = `authorization:${provider}:${state}:${JSON.stringify(content)}`;

  return new Response(
    `
      <!doctype html><html><body><script>
        (() => {
          const trustedPatterns = ${serialize(getDomainPatterns(env.ALLOWED_DOMAINS))};
          const hasToken = ${serialize(!!token)};

          const isTrusted = (origin) => {
            try {
              const { hostname } = new URL(origin);
              return trustedPatterns.some((pattern) => new RegExp(pattern).test(hostname));
            } catch {
              return false;
            }
          };

          window.addEventListener('message', ({ data, origin }) => {
            if (data !== 'authorizing:${provider}') return;
            if (hasToken && trustedPatterns.length && !isTrusted(origin)) return;
            window.opener?.postMessage(${serialize(message)}, origin);
          });
          window.opener?.postMessage('authorizing:${provider}', '*');
        })();
      </script></body></html>
    `,
    {
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Set-Cookie': 'csrf-token=deleted; HttpOnly; Max-Age=0; Path=/; SameSite=Lax; Secure',
      },
    }
  );
};
