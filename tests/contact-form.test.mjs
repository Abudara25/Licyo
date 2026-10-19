// 2026-10-09 : formulaire de contact envoyé depuis la boîte du club (functions/api/contact.js) au lieu de FormSubmit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import * as api from '../functions/api/contact.js';
import { fixture } from './helpers/inscriptions.mjs';

const SITE = 'https://clubdemo.licyo.fr';
const VALID = { nom: 'Camille Martin', email: 'camille@example.fr', sujet: 'Autre demande', message: 'Bonjour,\n\nUne question.', rgpd: true };

async function setup(t) {
  clearOrganizationCache();
  const env = { ...(await fixture()), BREVO_API_KEY: 'cle-de-test' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  const post = (body, { headers = {}, ip = '1.2.3.4' } = {}) =>
    api.onRequestPost({
      request: new Request(`${SITE}/api/contact`, {
        method: 'POST',
        headers: { Origin: SITE, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
    });
  return { env, sent, post };
}

test('envoi : message au club, Reply-To = visiteur, journalisé', async (t) => {
  const { env, sent, post } = await setup(t);
  const res = await post(VALID);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [{ email: 'contact@clubdemo.licyo.fr' }]);
  assert.deepEqual(sent[0].replyTo, { email: 'camille@example.fr', name: 'Camille Martin' });
  assert.equal(sent[0].subject, 'Contact : Autre demande — Camille Martin');
  assert.match(sent[0].textContent, /Une question\./);
  const log = await env.DB.prepare('SELECT organization_id, kind, ok FROM email_log').first();
  assert.deepEqual({ ...log }, { organization_id: DEMO_ORG_ID, kind: 'club_contact', ok: 1 });
});

test('contenu échappé dans le HTML', async (t) => {
  const { sent, post } = await setup(t);
  await post({ ...VALID, nom: '<b>X</b>', message: '<script>alert(1)</script>' });
  assert.doesNotMatch(sent[0].htmlContent, /<script>|<b>X<\/b>/);
  assert.match(sent[0].htmlContent, /&lt;script&gt;/);
});

test('refus : champs manquants, e-mail invalide ou dangereux, consentement, trop long', async (t) => {
  const { sent, post } = await setup(t);
  for (const body of [
    { ...VALID, nom: '' },
    { ...VALID, message: '   ' },
    { ...VALID, email: 'pas-un-email' },
    { ...VALID, email: 'a@b.fr\r\nBcc: x@y.fr' },
    { ...VALID, email: 'a<b>@c.fr' },
    { ...VALID, rgpd: false },
    { ...VALID, message: 'x'.repeat(5001) },
  ]) {
    assert.equal((await post(body, { ip: Math.random().toString() })).status, 400, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(sent.length, 0);
});

test('autre origine refusée ; piège à robots silencieux', async (t) => {
  const { sent, post } = await setup(t);
  assert.equal((await post(VALID, { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await post(VALID, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const trap = await post({ ...VALID, site_web: 'http://spam' });
  assert.equal(trap.status, 200);
  assert.equal(sent.length, 0);
});

test('limite par connexion', async (t) => {
  const { sent, post } = await setup(t);
  for (let i = 0; i < api.CONTACT_LIMITS.visitor.limit; i++) assert.equal((await post(VALID)).status, 200);
  assert.equal((await post(VALID)).status, 429);
  assert.equal(sent.length, api.CONTACT_LIMITS.visitor.limit);
});

test('envoi sans JavaScript : formulaire classique puis retour sur /contact', async (t) => {
  const { env, sent } = await setup(t);
  const form = (fields) =>
    api.onRequestPost({
      request: new Request(`${SITE}/api/contact`, {
        method: 'POST',
        headers: { Origin: SITE, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      }),
      env,
    });
  const ok = await form({ nom: 'Camille', email: 'camille@example.fr', sujet: 'Autre demande', message: 'Bonjour', rgpd: 'on' });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('Location'), '/contact?envoi=ok#formulaire-contact');
  const ko = await form({ nom: 'Camille', email: 'camille@example.fr', message: 'Bonjour' });
  assert.equal(ko.headers.get('Location'), '/contact?envoi=erreur#formulaire-contact');
  assert.equal(sent.length, 1);
});

test('aucun service d’envoi configuré : 503, rien d’envoyé', async (t) => {
  const { env, sent } = await setup(t);
  delete env.BREVO_API_KEY;
  const res = await api.onRequestPost({
    request: new Request(`${SITE}/api/contact`, { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(VALID) }),
    env,
  });
  assert.equal(res.status, 503);
  assert.equal(sent.length, 0);
});
