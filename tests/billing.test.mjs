// Abonnements des clubs à Licyo (2026-10-20) : essai à la création, suivi dans la console, paiements manuels qui
// prolongent la période, passage « En retard » par le cron, affichage côté club. Jamais de suspension automatique.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { addMonths, addDays, startTrial, getSubscription, recordPayment, updateSubscription, markOverdue, billingStats, listSubscriptions, subscriptionNotice, BillingError } from '../functions/_shared/billing.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as plateforme from '../functions/admin/plateforme.js';
import * as parametres from '../functions/admin/parametres.js';
import * as dashboard from '../functions/admin/dashboard.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { fixture } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const SITE = 'https://clubdemo.licyo.fr';
function admin(env, handler, request) {
  let i = 0;
  const next = async () => (i < adminMiddleware.length ? adminMiddleware[i++]({ request, env, params: {}, next, waitUntil() {} }) : handler({ request, env, params: {}, waitUntil() {} }));
  return next();
}
async function post(env, cookie, handler, path, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set(CSRF_FIELD, await csrfTokenFor(new Request(SITE, { headers: { Cookie: cookie } })));
  return admin(env, handler, new Request(SITE + path, { method: 'POST', body, headers: { Cookie: cookie, Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } }));
}

test('dates : mois ajoutés sans déborder, jours', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-10-20', 3), '2027-01-20');
  assert.equal(addDays('2026-10-20', 30), '2026-11-19');
});

test('essai, paiements, retard, indicateurs', async () => {
  const env = await fixture();
  const now = new Date('2026-10-20T10:00:00Z');
  await startTrial(env.DB, DEMO_ORG_ID, { plan: 'premium', now });
  let sub = await getSubscription(env.DB, DEMO_ORG_ID);
  assert.equal(sub.status, 'trial');
  assert.equal(sub.trial_ends_at, '2026-11-19');
  assert.equal(sub.monthly_price_cents, 7900);
  assert.equal(subscriptionNotice(sub, now), null);
  assert.match(subscriptionNotice(sub, new Date('2026-11-15T10:00:00Z')).text, /se termine le 19\/11\/2026/);

  // Paiement pendant l'essai : la période part de la fin de l'essai.
  sub = await recordPayment(env.DB, DEMO_ORG_ID, { amountEuros: '79', months: 2, method: 'virement', reference: 'VIR-1', now });
  assert.equal(sub.status, 'active');
  assert.equal(sub.current_period_end, '2027-01-19');
  await assert.rejects(recordPayment(env.DB, DEMO_ORG_ID, { amountEuros: '-5', now }), BillingError);
  await assert.rejects(recordPayment(env.DB, DEMO_ORG_ID, { amountEuros: '10', method: 'bitcoin', now }), BillingError);

  assert.equal(await markOverdue(env.DB, new Date('2027-01-19T10:00:00Z')), 0, 'échéance le jour même : pas encore en retard');
  assert.equal(await markOverdue(env.DB, new Date('2027-01-20T10:00:00Z')), 1);
  sub = await getSubscription(env.DB, DEMO_ORG_ID);
  assert.equal(sub.status, 'past_due');
  assert.equal(subscriptionNotice(sub).tone, 'error');
  // Paiement en retard : la période repart d'aujourd'hui.
  sub = await recordPayment(env.DB, DEMO_ORG_ID, { amountEuros: '79', months: 1, now: new Date('2027-02-10T10:00:00Z') });
  assert.equal(sub.current_period_end, '2027-03-10');
  assert.equal(sub.status, 'active');

  sub = await updateSubscription(env.DB, DEMO_ORG_ID, { plan: 'essentiel', status: 'active', priceEuros: '25,50', notes: 'Tarif association partenaire' });
  assert.equal(sub.monthly_price_cents, 2550);
  await assert.rejects(updateSubscription(env.DB, DEMO_ORG_ID, { priceEuros: 'gratuit' }), BillingError);
  const stats = billingStats(await listSubscriptions(env.DB));
  assert.deepEqual(stats, { mrrCents: 2550, trials: 0, pastDue: 0, active: 1 });
});

test('console : essai créé avec le club, paiement enregistré ; club : abonnement visible, réservé aux responsables', async (t) => {
  clearOrganizationCache();
  const env = { ...(await fixture()), BREVO_API_KEY: 'x', PLATFORM_ADMIN_EMAILS: 'editeur@licyo.example' };
  t.mock.method(globalThis, 'fetch', async () => new Response('{"messageId":"x"}', { status: 201 }));
  const editor = await testUser(env, DEMO_ORG_ID, 'owner', { email: 'editeur@licyo.example' });
  const cookie = (await createSession(env, DEMO_ORG_ID, editor)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const created = await post(env, cookie, plateforme.onRequestPost, '/admin/plateforme', { action: 'create', name: 'Tennis Exemple', domain: 'tennis.example', sport: 'tennis', city: 'Villeneuve-Exemple', ownerEmail: 'p@tennis.example', plan: 'essentiel' });
  assert.equal(created.status, 200);
  const org = await env.DB.prepare("SELECT id FROM organizations WHERE slug = 'tennis-exemple'").first();
  const sub = await getSubscription(env.DB, org.id);
  assert.equal(sub.plan, 'essentiel');
  assert.equal(sub.status, 'trial');

  const paid = await post(env, cookie, plateforme.onRequestPost, '/admin/plateforme', { action: 'payment', organizationId: org.id, amount: '29', months: '1', method: 'prelevement', reference: 'PRLV' });
  assert.match(await paid.text(), /Paiement enregistré : abonnement actif jusqu’au/);
  const console = await (await admin(env, plateforme.onRequestGet, new Request(`${SITE}/admin/plateforme`, { headers: { Cookie: cookie } }))).text();
  assert.match(console, /Revenu mensuel/);
  assert.match(console, /29 €/);

  // Côté club de démo (sans abonnement suivi) : rien d'affiché ; avec un retard : bandeau pour le responsable seulement.
  await startTrial(env.DB, DEMO_ORG_ID);
  await env.DB.prepare("UPDATE platform_subscriptions SET status = 'past_due' WHERE organization_id = ?").bind(DEMO_ORG_ID).run();
  const params = await (await admin(env, parametres.onRequestGet, new Request(`${SITE}/admin/parametres`, { headers: { Cookie: cookie } }))).text();
  assert.match(params, /Abonnement Licyo/);
  assert.match(params, /En retard/);
  const dash = await (await admin(env, dashboard.onRequestGet, new Request(`${SITE}/admin/dashboard`, { headers: { Cookie: cookie } }))).text();
  assert.match(dash, /en retard de paiement/);
  const secretary = await testUser(env, DEMO_ORG_ID, 'secretary');
  const secCookie = (await createSession(env, DEMO_ORG_ID, secretary)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const secDash = await (await admin(env, dashboard.onRequestGet, new Request(`${SITE}/admin/dashboard`, { headers: { Cookie: secCookie } }))).text();
  assert.doesNotMatch(secDash, /en retard de paiement/);
  // Un club ne peut pas enregistrer de paiement : la console lui est fermée.
  const plain = await testUser(env, DEMO_ORG_ID, 'owner', { email: 'resp@club.example' });
  const plainCookie = (await createSession(env, DEMO_ORG_ID, plain)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  assert.equal((await post(env, plainCookie, plateforme.onRequestPost, '/admin/plateforme', { action: 'payment', organizationId: DEMO_ORG_ID, amount: '1' })).status, 403);
});
