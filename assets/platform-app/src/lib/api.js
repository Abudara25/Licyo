// Appels au serveur de la console (actions réelles). Le jeton CSRF vient du formulaire caché #csrf-source, que le
// serveur remplit pour la session courante (functions/platform/_middleware.js). Réponses JSON { ok, error?, ... }.
export function csrfToken() {
  return document.querySelector('#csrf-source input[name="_csrf"]')?.value || '';
}

export async function post(path, fields = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((v) => body.append(key, String(v)));
    else if (value !== undefined && value !== null) body.append(key, String(value));
  }
  body.append('_csrf', csrfToken());
  let response;
  try {
    response = await fetch(path, { method: 'POST', body, credentials: 'same-origin', headers: { Accept: 'application/json' } });
  } catch {
    return { ok: false, error: 'Connexion au serveur impossible. Réessayez.' };
  }
  if (response.status === 401) {
    window.location.assign('/platform/connexion');
    return { ok: false, error: 'Session expirée.' };
  }
  const data = await response.json().catch(() => ({}));
  return response.ok ? { ok: true, ...data } : { ok: false, error: data.error || 'Action refusée.' };
}

// Après une action : recharge la page pour relire les données réelles, en gardant la route.
export const reloadData = () => window.location.reload();
