import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { onRequestGet, onRequestPost } from '../functions/admin/inscriptions/[id].js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

// Un seul environnement pour tout le fichier : les tables de session sont créées une fois par module.
let shared;
async function authedEnv() {
  if (!shared) {
    const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
    const cookie = (await createSession(env, DEMO_ORG_ID, await testUser(env, DEMO_ORG_ID))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
    shared = { env, cookie };
  }
  return shared;
}

function editForm(row, overrides = {}) {
  const form = new FormData();
  const fields = { ...validData, naissance: row.naissance, ...overrides };
  for (const [key, value] of Object.entries(fields)) {
    if (value === false) continue;
    form.set(key, value === true ? 'on' : String(value));
  }
  return form;
}

const post = (env, cookie, id, form, waitUntil = () => {}) =>
  onRequestPost({
    request: new Request(`https://clubdemo.licyo.fr/admin/inscriptions/${id}`, { method: 'POST', body: form, headers: { Cookie: cookie } }),
    env,
    params: { id: String(id) },
    waitUntil,
  });

test('modifier la fiche : le statut de paiement se corrige (payé par erreur → non payé)', async () => {
  const { env, cookie } = await authedEnv();
  const row = await seedInscription(env.DB, { paye: 1, complete_notified_at: '2026-09-16 10:00:00' });

  const page = await onRequestGet({
    request: new Request(`https://clubdemo.licyo.fr/admin/inscriptions/${row.id}?edit=1`, { headers: { Cookie: cookie } }),
    env,
    params: { id: String(row.id) },
  });
  assert.match(await page.text(), /<option value="1" selected>Payé<\/option>/);

  const tasks = [];
  const res = await post(env, cookie, row.id, editForm(row, { paye: '0' }), (p) => tasks.push(p));
  assert.equal(res.status, 302);
  const after = await env.DB.prepare('SELECT paye, complete_notified_at FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(after.paye, 0);
  assert.equal(after.complete_notified_at, null); // « Dossier complet » repartira au vrai paiement
  assert.equal(tasks.length, 1); // seule la synchronisation CRM : aucun e-mail pour une correction vers non payé
});

test('modifier la fiche : passer à payé déclenche le suivi, champ absent = statut inchangé', async () => {
  const { env, cookie } = await authedEnv();
  const row = await seedInscription(env.DB, { paye: 0 });

  const tasks = [];
  await post(env, cookie, row.id, editForm(row, { paye: '1' }), (p) => tasks.push(p));
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
  assert.equal(tasks.length, 2); // synchronisation CRM + e-mail de suivi
  await Promise.allSettled(tasks);

  await post(env, cookie, row.id, editForm(row)); // ancien formulaire sans le champ paye
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
});

test("modifier la fiche : le code Pass'Sport s'ajoute et s'efface", async () => {
  const { env, cookie } = await authedEnv();
  const row = await seedInscription(env.DB, { enfant_prenom: 'Noé' });
  const code = () => env.DB.prepare('SELECT pass_sport_code FROM inscriptions WHERE id = ?').bind(row.id).first();

  await post(env, cookie, row.id, editForm(row, { passSportCode: ' 24-ABC12345 ' }));
  assert.equal((await code()).pass_sport_code, '24-ABC12345');

  await post(env, cookie, row.id, editForm(row, { passSportCode: '' }));
  assert.equal((await code()).pass_sport_code, null);
});
