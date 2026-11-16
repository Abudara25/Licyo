// Connexion à la console fondateur : e-mail et mot de passe d'un opérateur Licyo (jamais un compte de club).
import { platformLogin, createPlatformSession, platformOperator, operatorCount, bootstrapConfigured } from '../_shared/platform-auth.js';
import { platformAuthPage } from '../_shared/platform-ui/shell.js';
import { html } from '../_shared/platform-ui/html.js';
import { respond, notice } from '../_shared/platform-ui/kit.js';

export function loginForm({ error = '', email = '', firstRun = false } = {}) {
  return String(html`
    <h1>Connexion</h1>
    <p class="lead">Console de l’équipe Licyo. Les comptes des clubs ne s’y connectent pas.</p>
    ${firstRun ? notice('info', html`Aucun compte n’existe encore. Le fondateur crée le sien avec le lien de démarrage.`) : ''}
    ${error ? notice('danger', error, 'alert') : ''}
    <form method="POST" action="/platform/connexion">
      <div class="field"><label for="email">Adresse e-mail</label><input class="input" id="email" name="email" type="email" autocomplete="username" inputmode="email" maxlength="200" value="${email}" required autofocus></div>
      <div class="field"><label for="password">Mot de passe</label><input class="input" id="password" name="password" type="password" autocomplete="current-password" maxlength="200" required></div>
      <button type="submit" class="btn btn-primary btn-block">Se connecter</button>
    </form>`);
}

export async function onRequestGet({ request, env }) {
  if (await platformOperator(request, env, { touch: false })) return new Response('', { status: 303, headers: { Location: '/platform' } });
  const firstRun = bootstrapConfigured(env) && (await operatorCount(env.DB).catch(() => 1)) === 0;
  return respond(platformAuthPage({ title: 'Connexion', content: loginForm({ firstRun }) }));
}

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const email = String(form.get('email') || '');
  const result = await platformLogin(request, env, email, String(form.get('password') || ''));
  if (result.error) return respond(platformAuthPage({ title: 'Connexion', content: loginForm({ error: result.error, email }) }), result.status);
  const cookies = await createPlatformSession(env, result.operator.id);
  const response = new Response('', { status: 303, headers: { Location: '/platform', 'Cache-Control': 'no-store' } });
  for (const c of cookies) response.headers.append('Set-Cookie', c);
  return response;
}
