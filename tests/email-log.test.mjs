import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { sendReminderEmail, sendFollowUpEmail } from '../functions/_shared/confirmation-email.js';
import { onRequestGet as eventsGet } from '../functions/admin/events.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

test('chaque e-mail envoyé est inscrit au journal, succès comme échec, et visible dans /admin/events', async (t) => {
  const env = { ...(await fixture()), BREVO_API_KEY: 'test', ADMIN_PASSWORD: 'x' };
  const row = await seedInscription(env.DB, { enfant_prenom: 'Nina', enfant_nom: 'Martin' });

  let fail = false;
  t.mock.method(globalThis, 'fetch', async () =>
    fail
      ? new Response(JSON.stringify({ message: 'Quota dépassé' }), { status: 402 })
      : new Response(JSON.stringify({ messageId: '<abc@brevo>' }), { status: 201 })
  );

  assert.equal(await sendReminderEmail(env, row, 'https://clubdemo.licyo.fr', 'auto'), true);
  fail = true;
  assert.equal(await sendFollowUpEmail(env, row, 'https://clubdemo.licyo.fr', { step: 'paiement' }), false);

  const { results } = await env.DB.prepare('SELECT * FROM email_log ORDER BY id').all();
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((r) => [r.kind, r.origin, r.inscription_id, r.ok, r.recipients]),
    [
      ['relance', 'auto', row.id, 1, 'parent@example.fr'],
      ['suivi', 'auto', row.id, 0, 'parent@example.fr'],
    ]
  );
  assert.equal(results[0].message_id, '<abc@brevo>');
  assert.equal(results[1].error, 'Quota dépassé');

  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const html = await (
    await eventsGet({ request: new Request(`https://clubdemo.licyo.fr/admin/events?inscription=${row.id}`, { headers: { Cookie: cookie } }), env })
  ).text();
  assert.match(html, /E-mails de Nina Martin/);
  assert.match(html, /Relance famille/);
  assert.match(html, /Échec \(402\)/);

  const onlyFailures = await (
    await eventsGet({ request: new Request('https://clubdemo.licyo.fr/admin/events?statut=echec', { headers: { Cookie: cookie } }), env })
  ).text();
  assert.doesNotMatch(onlyFailures, /<strong class="adm-mail-kind">Relance famille/);
});
