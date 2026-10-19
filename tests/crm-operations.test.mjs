// Phase 3.1 : cron (tâches indépendantes) et bouton « Synchroniser maintenant » (origine, verrou, travail borné).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { crmReport } from '../functions/_shared/crm.js';
import * as members from '../functions/admin/adherents.js';
import { SYNC_LIMIT } from '../functions/admin/adherents.js';
import { onRequestPost as cron } from '../functions/api/cron.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const child = (n) => ({
  enfant_prenom: `Enfant${n}`, enfant_nom: `Fictif${n}`, naissance: '2018-03-04', categorie: 'U8 - U9',
  parent_prenom: `Parent${n}`, parent_nom: `Fictif${n}`, email: `parent${n}@example.test`, telephone: `06000${String(n).padStart(5, '0')}`,
});

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', CRON_SECRET: 'secret-de-test' };
  await getCategoriesConfig(env, A);
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, cookie };
}
const cronRequest = () => new Request('https://clubdemo.licyo.fr/api/cron', { method: 'POST', headers: { Authorization: 'Bearer secret-de-test' } });

test('cron : une panne des automatisations n’empêche pas la réconciliation CRM (et le cron le signale)', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { env } = await setup();
  await seedInscription(env.DB, child(1));
  const ran = [];
  const response = await cron({
    request: cronRequest(),
    env,
    tasks: {
      automations: async () => { ran.push('automations'); throw new Error('Brevo indisponible pour Sonia Martin sonia@example.test'); },
      crm: async () => { ran.push('crm'); return 'fait'; },
    },
  });
  assert.deepEqual(ran, ['automations', 'crm'], 'les deux tâches ont tourné');
  assert.equal(response.status, 500, 'l’échec est visible du Worker programmé');
  assert.deepEqual(await response.json(), { automations: 'échec', crm: 'fait' });
  const warned = t.mock.calls?.length ? '' : String(console.warn.mock.calls.map((c) => c.arguments[0]).join(' '));
  assert.doesNotMatch(warned, /Sonia|example\.test/, 'aucune donnée personnelle dans le journal');
});

test('cron : une panne du CRM n’empêche pas les autres tâches', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { env } = await setup();
  const ran = [];
  const response = await cron({
    request: cronRequest(),
    env,
    tasks: {
      automations: async () => { ran.push('automations'); return { reminders: null, summary: false }; },
      crm: async () => { ran.push('crm'); throw new Error('D1'); },
      mirror: async () => { ran.push('mirror'); return 'à jour'; },
    },
  });
  assert.deepEqual(ran, ['automations', 'crm', 'mirror']);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.deepEqual([body.crm, body.mirror, body.summary], ['échec', 'à jour', false]);
});

test('cron : tâches réelles → relie les inscriptions et règle la période courante, réponse 200', async () => {
  const { env } = await setup();
  await seedInscription(env.DB, child(1));
  await seedInscription(env.DB, child(2));
  const response = await cron({ request: cronRequest(), env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual([body.crm.processed, body.crm.failed], [2, 0]);
  const report = await crmReport(env.DB, A);
  assert.deepEqual([report.anomalies, report.currentPeriods], [0, 1]);
});

const post = (env, cookie, headers = {}) => {
  const form = new FormData();
  form.set('action', 'sync');
  return members.onRequestPost({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { method: 'POST', body: form, headers: { Cookie: cookie, ...headers } }), env });
};

test('bouton de synchronisation : une requête venue d’un autre site est refusée, sans rien écrire', async () => {
  const { env, cookie } = await setup();
  await seedInscription(env.DB, child(1));
  for (const headers of [{ Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const res = await post(env, cookie, headers);
    assert.equal(res.status, 403);
  }
  assert.equal((await crmReport(env.DB, A)).memberships, 0);
  assert.equal((await post(env, cookie, { Origin: 'https://clubdemo.licyo.fr', 'Sec-Fetch-Site': 'same-origin' })).status, 302, 'même origine : acceptée');
});

test('bouton de synchronisation : anti double envoi (verrou) et travail borné avec reprise', async () => {
  const { env, cookie } = await setup();
  const total = SYNC_LIMIT + 5;
  for (let n = 1; n <= total; n++) await seedInscription(env.DB, child(n));
  const first = await post(env, cookie);
  assert.equal(first.headers.get('Location'), `/admin/adherents?synced=${SYNC_LIMIT}&remaining=5`, 'borné, avec le reste annoncé');
  const second = await post(env, cookie); // double clic / rafale
  assert.equal(second.headers.get('Location'), '/admin/adherents?syncBusy=1');
  assert.equal((await crmReport(env.DB, A)).memberships, SYNC_LIMIT, 'la seconde requête n’a rien traité');

  await env.DB.prepare('DELETE FROM rate_limits').run(); // fin du verrou de 30 s
  assert.equal((await post(env, cookie)).headers.get('Location'), '/admin/adherents?synced=5');
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);

  const page = await (await members.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/adherents?synced=5&remaining=3&syncBusy=1', { headers: { Cookie: cookie } }), env })).text();
  assert.match(page, /Il en reste 3/);
  assert.match(page, /patientez quelques secondes/);
});

test('le formulaire de synchronisation est protégé contre le double clic (data-once)', async () => {
  const { env, cookie } = await setup();
  await seedInscription(env.DB, child(1));
  const page = await (await members.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { headers: { Cookie: cookie } }), env })).text();
  assert.match(page, /<form method="POST" data-once>/);
});

test('cron : un échec est noté dans l’état (affiché dans Paramètres), sans donnée personnelle', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { env } = await setup();
  const { getCronState } = await import('../functions/_shared/settings-kv.js');
  await cron({
    request: cronRequest(),
    env,
    tasks: { automations: async () => { throw new Error('sonia@example.test'); }, crm: async () => 'fait' },
  });
  const state = await getCronState(env, A);
  assert.equal(state.lastFailure.step, 'automations');
  assert.equal(state.lastFailure.error, 'TaskError');
  assert.doesNotMatch(JSON.stringify(state), /sonia/);
});

test('cron : base injoignable pendant la résolution de l’organisation = 503 noté, jamais une exception', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { env } = await setup();
  const { getCronState } = await import('../functions/_shared/settings-kv.js');
  clearOrganizationCache();
  const { resetSchemaCacheForTests } = await import('../functions/_shared/inscriptions-db.js');
  resetSchemaCacheForTests();
  const broken = { ...env, DB: { ...env.DB, prepare: () => { throw new Error('D1 indisponible'); }, batch: async () => { throw new Error('D1 indisponible'); } } };
  const response = await cron({ request: cronRequest(), env: broken, tasks: {} });
  assert.equal(response.status, 503);
  assert.equal((await getCronState(env, A)).lastFailure.step, 'organisation');
});
