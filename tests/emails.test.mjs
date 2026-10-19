// E-mails de compte (phase 3) : jamais de mot de passe dans un e-mail, objet sans « mot de passe » (vocabulaire
// d'hameçonnage), un lien personnel à usage unique.
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { onRequestPost as comptePost } from '../functions/admin/compte.js';
import { onRequestPost as forgotPost } from '../functions/admin/mot-de-passe-oublie.js';
import { createD1, createKV } from './helpers/d1.mjs';
import { testUser, TEST_PASSWORD } from './helpers/accounts.mjs';
import { clearOrganizationCache } from '../functions/_shared/organization.js';

const NEW_SECRET = `Nouveau-${randomUUID()}`;

function captureMail(t) {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    sent.push({ url: String(url), body: String(opts?.body || '') });
    return new Response('{}', { status: 201 });
  });
  return sent;
}

test('changement de mot de passe depuis Mon compte : aucun e-mail, rien d’envoyé en clair', async (t) => {
  const env = { DB: createD1(), INSCRIPTION_STATUS: createKV(), BREVO_API_KEY: 'test' };
  const sent = captureMail(t);
  const cookie = (await createSession(env, DEMO_ORG_ID, await testUser(env, DEMO_ORG_ID))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const form = new FormData();
  form.set('action', 'password');
  form.set('current', TEST_PASSWORD);
  form.set('password', NEW_SECRET);
  form.set('confirm', NEW_SECRET);
  const res = await comptePost({ request: new Request('https://clubdemo.licyo.fr/admin/compte', { method: 'POST', body: form, headers: { Cookie: cookie } }), env });
  assert.equal(res.status, 303);
  assert.equal(sent.length, 0);
});

test('mot de passe oublié : lien personnel, jamais de mot de passe, objet neutre', async (t) => {
  clearOrganizationCache();
  const env = { DB: createD1(), INSCRIPTION_STATUS: createKV(), BREVO_API_KEY: 'test' };
  const sent = captureMail(t);
  await testUser(env, DEMO_ORG_ID, 'owner', { email: 'oubli@club.example' });
  const form = new FormData();
  form.set('email', 'oubli@club.example');
  const res = await forgotPost({ request: new Request('https://clubdemo.licyo.fr/admin/mot-de-passe-oublie', { method: 'POST', body: form, headers: { 'Sec-Fetch-Site': 'same-origin' } }), env });
  assert.equal(res.status, 200);
  const brevo = sent.filter((s) => s.url.includes('brevo.com'));
  assert.equal(brevo.length, 1);
  const payload = JSON.parse(brevo[0].body);
  assert.ok(!brevo[0].body.includes(TEST_PASSWORD));
  assert.doesNotMatch(payload.subject, /mot de passe/i);
  assert.match(payload.textContent, /\/admin\/reinitialiser\/[A-Za-z0-9_-]{20,}/);
});
