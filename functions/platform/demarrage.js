// Démarrage : création du compte propriétaire, une seule fois, tant qu'aucun opérateur n'existe.
// Exige le secret PLATFORM_BOOTSTRAP_TOKEN (dans l'URL ?jeton=…) et l'adresse PLATFORM_OWNER_EMAIL. Ensuite : 404.
import { bootstrapConfigured, operatorCount, bootstrapOwner, createPlatformSession, PlatformError, MIN_PASSWORD_LENGTH } from '../_shared/platform-auth.js';
import { platformAuthPage } from '../_shared/platform-ui/shell.js';
import { html } from '../_shared/platform-ui/html.js';
import { respond, notice } from '../_shared/platform-ui/kit.js';

const notFound = () => new Response('Page introuvable', { status: 404, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store' } });
const available = async (env) => bootstrapConfigured(env) && (await operatorCount(env.DB).catch(() => 1)) === 0;

function form({ token, error = '', name = '', email = '' }) {
  return String(html`
    <h1>Compte du fondateur</h1>
    <p class="lead">Premier compte de la console, avec tous les droits. Ce formulaire ne sert qu’une fois.</p>
    ${error ? notice('danger', error, 'alert') : ''}
    <form method="POST" action="/platform/demarrage?jeton=${token}">
      <div class="field"><label for="name">Prénom et nom</label><input class="input" id="name" name="name" maxlength="120" value="${name}" required autofocus></div>
      <div class="field"><label for="email">Adresse e-mail</label><input class="input" id="email" name="email" type="email" autocomplete="username" maxlength="200" value="${email}" required></div>
      <div class="field"><label for="password">Mot de passe</label><input class="input" id="password" name="password" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" required><span class="hint">${MIN_PASSWORD_LENGTH} caractères au moins : une phrase de quelques mots.</span></div>
      <div class="field"><label for="confirm">Confirmer le mot de passe</label><input class="input" id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" required></div>
      <button type="submit" class="btn btn-primary btn-block">Créer mon compte</button>
    </form>`);
}

export async function onRequestGet({ request, env }) {
  if (!(await available(env))) return notFound();
  const token = new URL(request.url).searchParams.get('jeton') || '';
  return respond(platformAuthPage({ title: 'Démarrage', content: form({ token }) }), 200, { 'Referrer-Policy': 'same-origin' });
}

export async function onRequestPost({ request, env }) {
  if (!(await available(env))) return notFound();
  const token = new URL(request.url).searchParams.get('jeton') || '';
  const data = await request.formData();
  const input = { token, name: String(data.get('name') || ''), email: String(data.get('email') || ''), password: String(data.get('password') || ''), confirm: String(data.get('confirm') || '') };
  try {
    const owner = await bootstrapOwner(env, input);
    const response = new Response('', { status: 303, headers: { Location: '/platform', 'Cache-Control': 'no-store' } });
    for (const c of await createPlatformSession(env, owner.id)) response.headers.append('Set-Cookie', c);
    return response;
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    return respond(platformAuthPage({ title: 'Démarrage', content: form({ token, error: error.message, name: input.name, email: input.email }) }), 400, { 'Referrer-Policy': 'same-origin' });
  }
}
