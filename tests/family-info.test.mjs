// Infos envoyées aux familles une fois le paiement reçu (2026-10-14) : annonce de l'e-mail de la FFF pour la
// licence, lien du groupe WhatsApp réglé dans /admin/parametres, infos pratiques.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as parametres from '../functions/admin/parametres.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getFamilyInfo, normalizeWhatsappUrl } from '../functions/_shared/settings-kv.js';
import { sendFollowUpEmail } from '../functions/_shared/confirmation-email.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://clubdemo.licyo.fr';
const LINK = 'https://chat.whatsapp.com/AbCdEf123456GhIjKl7890';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, cookie };
}

const saveLink = (env, cookie, value) => {
  const body = new FormData();
  body.set('action', 'family-info');
  body.set('whatsappUrl', value);
  return parametres.onRequestPost({ request: new Request(`${HOST}/admin/parametres`, { method: 'POST', headers: { Cookie: cookie }, body }), env });
};

const captureEmails = (t) => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  return sent;
};

test('lien WhatsApp : seuls les liens d’invitation sont acceptés, paramètres retirés', () => {
  assert.equal(normalizeWhatsappUrl(`${LINK}?mode=ac_t`), LINK);
  assert.equal(normalizeWhatsappUrl(' '), null);
  assert.equal(normalizeWhatsappUrl('http://chat.whatsapp.com/AbCdEf123456'), null);
  assert.equal(normalizeWhatsappUrl('https://evil.example/AbCdEf123456'), null);
  assert.equal(normalizeWhatsappUrl('https://chat.whatsapp.com.evil.example/AbCdEf123456'), null);
  assert.equal(normalizeWhatsappUrl('javascript:alert(1)'), null);
  assert.equal(normalizeWhatsappUrl('https://chat.whatsapp.com/"><script>'), null);
});

test('Paramètres : enregistrer, refuser un faux lien, vider', async () => {
  const { env, cookie } = await setup();
  let res = await saveLink(env, cookie, `${LINK}?mode=ac_t`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Infos enregistrées/);
  assert.equal((await getFamilyInfo(env, A)).whatsappUrl, LINK);

  res = await saveLink(env, cookie, 'https://exemple.fr/groupe');
  assert.equal(res.status, 400);
  assert.equal((await getFamilyInfo(env, A)).whatsappUrl, LINK); // rien d'écrasé

  res = await saveLink(env, cookie, '');
  assert.equal(res.status, 200);
  assert.equal((await getFamilyInfo(env, A)).whatsappUrl, '');
});

test('e-mail « paiement reçu » : FFF, WhatsApp et infos pratiques', async (t) => {
  const { env, cookie } = await setup();
  await saveLink(env, cookie, LINK);
  const row = await seedInscription(env.DB, { paye: 1 });
  const sent = captureEmails(t);
  assert.equal(await sendFollowUpEmail(env, row, HOST, { step: 'paiement' }), true);
  const { htmlContent, textContent } = sent[0];
  for (const body of [htmlContent, textContent]) {
    assert.match(body, /Fédération Française de Football/);
    assert.match(body, /Une fois toutes les étapes validées/);
    assert.match(body, /« non » à toutes les questions, vous n’avez rien d’autre à fournir, aucun certificat médical/);
    assert.ok(body.includes(LINK));
    assert.match(body, /jeudi/);
    assert.match(body, /seuls les éducateurs encadrent les enfants/);
    assert.ok(body.includes('https://www.instagram.com/clubdemo'));
    assert.ok(body.includes('https://www.facebook.com/clubdemo'));
  }
  assert.doesNotMatch(htmlContent, /définitive/);
});

test('e-mail « Dossier complet » : FFF annoncée pour les prochains jours', async (t) => {
  const { env } = await setup();
  const row = await seedInscription(env.DB, { paye: 1 });
  const sent = captureEmails(t);
  await sendFollowUpEmail(env, row, HOST, { complete: true });
  assert.match(sent[0].textContent, /Dans les prochains jours, vous allez recevoir un e-mail de la Fédération/);
});

test('sans paiement ni lien : ni bloc FFF ni WhatsApp', async (t) => {
  const { env, cookie } = await setup();
  await saveLink(env, cookie, '');
  const sent = captureEmails(t);
  const unpaid = await seedInscription(env.DB, { paye: 0, photo_uploaded_at: '2026-10-01 10:00:00' });
  await sendFollowUpEmail(env, unpaid, HOST, { step: 'photo' });
  assert.doesNotMatch(sent[0].textContent, /FFF|WhatsApp/);

  const paid = await seedInscription(env.DB, { paye: 1 });
  await sendFollowUpEmail(env, paid, HOST, { step: 'paiement' });
  assert.match(sent[1].textContent, /FFF/);
  assert.doesNotMatch(sent[1].textContent, /WhatsApp/);
});
