import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { onRequestPost as parametresPost } from '../functions/admin/parametres.js';
import { createD1, createKV } from './helpers/d1.mjs';

// Valeurs tirées à chaque exécution : aucun mot de passe écrit en dur, même factice.
const ADMIN_SECRET = `Demo-${randomUUID()}`;
const NEW_SECRET = `Nouveau-${randomUUID()}`;

test('changement de mot de passe : l’e-mail ne contient que le code, jamais le mot de passe', async (t) => {
  const env = { DB: createD1(), INSCRIPTION_STATUS: createKV(), ADMIN_PASSWORD: ADMIN_SECRET, BREVO_API_KEY: 'test' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    sent.push({ url: String(url), body: String(opts?.body || '') });
    return new Response('{}', { status: 201 });
  });

  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const form = new FormData();
  form.set('action', 'password');
  form.set('currentPassword', ADMIN_SECRET);
  form.set('newPassword', NEW_SECRET);
  form.set('confirmPassword', NEW_SECRET);
  const res = await parametresPost({
    request: new Request('https://clubdemo.licyo.fr/admin/parametres', { method: 'POST', body: form, headers: { Cookie: cookie } }),
    env,
  });
  assert.equal(res.status, 200);

  const brevo = sent.filter((s) => s.url.includes('brevo.com'));
  assert.equal(brevo.length, 1, 'un seul e-mail envoyé');
  const { body } = brevo[0];
  assert.ok(!body.includes(NEW_SECRET), 'le nouveau mot de passe n’est pas dans l’e-mail');
  assert.ok(!body.includes(ADMIN_SECRET), 'l’ancien mot de passe n’est pas dans l’e-mail');
  const payload = JSON.parse(body);
  assert.match(payload.textContent, /Code de confirmation : \d{6}/);
  assert.doesNotMatch(payload.subject, /\d{6}/, 'le code n’apparaît pas dans l’objet (aperçu écran verrouillé)');
});
