// Invitation d'un membre de l'équipe Licyo : il choisit son mot de passe, son compte est créé et il est connecté.
import { findOperatorInvite, acceptOperatorInvite, createPlatformSession, PlatformError, PLATFORM_ROLE_LABELS, MIN_PASSWORD_LENGTH } from '../../_shared/platform-auth.js';
import { platformAuthPage } from '../../_shared/platform-ui/shell.js';
import { html } from '../../_shared/platform-ui/html.js';
import { respond, notice } from '../../_shared/platform-ui/kit.js';

const headers = { 'Referrer-Policy': 'same-origin' };
const invalid = () =>
  respond(
    platformAuthPage({ title: 'Invitation', content: String(html`<h1>Lien plus valable</h1><p class="lead">Ce lien a expiré, a déjà servi ou a été annulé. Demandez-en un nouveau au fondateur.</p><a class="btn btn-secondary btn-block" href="/platform/connexion">Aller à la connexion</a>`) }),
    410,
    headers
  );

function form(invite, error = '') {
  return String(html`
    <h1>Bienvenue, ${invite.name}</h1>
    <p class="lead">Rôle dans l’équipe Licyo : <strong>${PLATFORM_ROLE_LABELS[invite.role]}</strong>. Choisissez votre mot de passe.</p>
    ${error ? notice('danger', error, 'alert') : ''}
    <form method="POST">
      <div class="field"><label for="username">Adresse e-mail (identifiant)</label><input class="input" id="username" name="username" type="email" value="${invite.email}" autocomplete="username" readonly></div>
      <div class="field"><label for="password">Mot de passe</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" required autofocus><span class="hint">${MIN_PASSWORD_LENGTH} caractères au moins.</span></div>
      <div class="field"><label for="confirm">Confirmer le mot de passe</label><input class="input" id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" required></div>
      <button type="submit" class="btn btn-primary btn-block">Activer mon compte</button>
    </form>`);
}

export async function onRequestGet({ env, params }) {
  const invite = await findOperatorInvite(env.DB, String(params.token || '')).catch(() => null);
  return invite ? respond(platformAuthPage({ title: 'Invitation', content: form(invite) }), 200, headers) : invalid();
}

export async function onRequestPost({ request, env, params }) {
  const token = String(params.token || '');
  const data = await request.formData();
  try {
    const operator = await acceptOperatorInvite(env.DB, token, String(data.get('password') || ''), String(data.get('confirm') || ''));
    const response = new Response('', { status: 303, headers: { Location: '/platform', 'Cache-Control': 'no-store' } });
    for (const c of await createPlatformSession(env, operator.id)) response.headers.append('Set-Cookie', c);
    return response;
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    const invite = await findOperatorInvite(env.DB, token).catch(() => null);
    return invite ? respond(platformAuthPage({ title: 'Invitation', content: form(invite, error.message) }), 400, headers) : invalid();
  }
}
