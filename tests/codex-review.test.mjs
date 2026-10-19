// Correctifs de la revue Codex (2026-10-08) :
// 1. inscriptions fermées : l'API refuse un envoi direct, sauf réinscription par lien personnel (même enfant) ;
// 2. Base illisible : la connexion admin est refusée (503), le secret historique ADMIN_PASSWORD n'ouvre jamais rien.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/inscriptions.js';
import { handleLogin } from '../functions/_shared/admin-auth.js';
import { hashPassword } from '../functions/_shared/security.js';
import { setInscriptionStatus, getCategoriesConfig, setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { fixture, validData, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const submit = (env, data) =>
  onRequestPost({
    request: new Request('https://clubdemo.licyo.fr/api/inscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(data),
    }),
    env, waitUntil: () => {},
  });
const count = async (env) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n;

test('inscriptions fermées à la main : envoi direct à l’API refusé (403), rien d’enregistré', async () => {
  clearOrganizationCache();
  const env = await fixture();
  await setInscriptionStatus(env, A, 'closed');
  const response = await submit(env, validData);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).closed, true);
  assert.equal(await count(env), 0);
  // Rouvertes : accepté.
  await setInscriptionStatus(env, A, 'open');
  assert.equal((await submit(env, validData)).status, 200);
});

test('date de fermeture automatique atteinte : refusé même si le statut manuel est « ouvert »', async () => {
  clearOrganizationCache();
  const env = await fixture();
  await setInscriptionStatus(env, A, 'open');
  const config = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...config, dateFermetureInscriptions: '2000-01-01' }, { expectedVersion: config.version });
  assert.equal((await submit(env, validData)).status, 403);
  assert.equal(await count(env), 0);
});

test('fermé : la réinscription par lien personnel reste possible, pour le même enfant seulement', async () => {
  clearOrganizationCache();
  const env = await fixture();
  const token = crypto.randomUUID();
  await seedInscription(env.DB, { saison: '2025-2026', reinscription_token: token, email: 'ancienne@example.fr' });
  await setInscriptionStatus(env, A, 'closed');
  const before = await count(env);
  // Jeton inventé, ou jeton valide mais autre enfant (autre date de naissance) : refusé.
  assert.equal((await submit(env, { ...validData, reinscriptionToken: crypto.randomUUID() })).status, 403);
  assert.equal((await submit(env, { ...validData, naissance: '2021-03-03', reinscriptionToken: token })).status, 403);
  assert.equal((await submit(env, { ...validData, reinscriptionToken: 'pas-un-jeton' })).status, 403);
  assert.equal(await count(env), before);
  // Jeton valide, même enfant : accepté.
  assert.equal((await submit(env, { ...validData, reinscriptionToken: token })).status, 200);
  assert.equal(await count(env), before + 1);
});

test('base indisponible à la connexion : 503 « réessayez », aucune session, et l’ancien secret partagé n’ouvre jamais rien', async () => {
  const env = await fixture();
  env.ADMIN_PASSWORD = 'ancien-secret-historique';
  clearOrganizationCache();
  const form = new FormData();
  form.set('email', 'responsable@club.example');
  form.set('password', 'ancien-secret-historique');
  const request = () => new Request('https://clubdemo.licyo.fr/admin/inscriptions', { method: 'POST', headers: { 'CF-Connecting-IP': '203.0.113.9' } });
  const refused = await handleLogin(request(), env, form);
  assert.equal(refused.status, 401, 'le secret historique ne vaut plus rien');
  const broken = { ...env, DB: { ...env.DB, prepare: (sql) => (/FROM users/.test(sql) ? { bind: () => ({ first: async () => { throw new Error('D1 indisponible'); } }) } : env.DB.prepare(sql)), batch: env.DB.batch.bind(env.DB) } };
  const response = await handleLogin(request(), broken, form);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.match(await response.text(), /indisponible/);
});
