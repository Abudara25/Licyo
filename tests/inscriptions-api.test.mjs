import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../functions/api/inscriptions.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture, validData, synchronizeReads } from './helpers/inscriptions.mjs';
import { resolveFamilyToken } from '../functions/_shared/family-links.js';

async function submit(env, data = validData, tasks = []) {
  return onRequestPost({
    request: new Request('https://clubdemo.licyo.fr/api/inscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() },
      body: JSON.stringify(data),
    }),
    env, waitUntil: (task) => tasks.push(task),
  });
}

test('API : dates impossibles, dates futures et choix falsifiés refusés sans écriture', async () => {
  const env = await fixture();
  for (const patch of [
    { naissance: '2020-99-99' }, { naissance: '2020-02-30' }, { naissance: '2019-02-29' },
    { naissance: '2020-04-31' }, { naissance: '2999-01-01' }, { naissance: '2020-2-01' },
    { tailleMaillot: 'inconnue' }, { modePaiement: 'gratuit' },
  ]) {
    const response = await submit(env, { ...validData, ...patch });
    assert.equal(response.status, 400, JSON.stringify(patch));
  }
  assert.equal((await submit(env, [])).status, 400);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 0);
});

test('API : une date bissextile valide est enregistrée, saison imposée par le serveur', async () => {
  const env = await fixture();
  const tasks = [];
  const response = await submit(env, { ...validData, saison: '2099-2100' }, tasks);
  await Promise.all(tasks);
  assert.equal(response.status, 200);
  const body = await response.json();
  const row = await env.DB.prepare('SELECT * FROM inscriptions').first();
  assert.equal(row.naissance, '2020-02-29');
  assert.equal(row.saison, '2026-2027');
  // Lien famille à durée limitée (_shared/family-links.js), jamais le jeton interne.
  assert.match(body.uploadToken, /^f[A-Za-z0-9_-]{43}$/);
  assert.notEqual(row.upload_token, body.uploadToken);
  assert.equal((await resolveFamilyToken(env.DB, row.organization_id, body.uploadToken)).row.id, row.id);
});

test('API : la carte bancaire au club est un mode de paiement accepté', async () => {
  const env = await fixture();
  const tasks = [];
  const response = await submit(env, { ...validData, modePaiement: 'Carte bancaire' }, tasks);
  await Promise.all(tasks);
  assert.equal(response.status, 200);
  assert.equal((await env.DB.prepare('SELECT mode_paiement FROM inscriptions').first()).mode_paiement, 'Carte bancaire');
});

test("API : le code Pass'Sport est enregistré, nettoyé et facultatif", async () => {
  const env = await fixture();
  const tasks = [];
  await submit(env, { ...validData, passSportCode: '  24-ABC12345  ' }, tasks);
  await submit(env, { ...validData, enfantPrenom: 'Noé', passSportCode: '' }, tasks);
  await Promise.all(tasks);
  const { results } = await env.DB.prepare('SELECT enfant_prenom, pass_sport_code FROM inscriptions ORDER BY id').all();
  assert.equal(results[0].pass_sport_code, '24-ABC12345');
  assert.equal(results[1].pass_sport_code, null);
});

test('API : deux envois simultanés ne créent qu’une fiche et le doublon ne révèle pas le jeton', { timeout: 5000 }, async (t) => {
  const env = await fixture();
  synchronizeReads(t, env.DB, /^SELECT upload_token, created_at, naissance, saison/);
  const tasks = [];
  const responses = await Promise.all([
    submit(env, validData, tasks),
    submit(env, { ...validData, enfantPrenom: 'LEA', email: 'PARENT@example.fr' }, tasks),
  ]);
  await Promise.all(tasks);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 1);
  const duplicate = await responses.find((r) => r.status === 409).json();
  assert.equal(duplicate.duplicate, true);
  assert.equal('uploadToken' in duplicate, false);
});

test('API : une même identité reste autorisée à la saison suivante', async () => {
  const env = await fixture();
  const tasks = [];
  assert.equal((await submit(env, validData, tasks)).status, 200);
  const { DEFAULT_CATEGORIES_CONFIG } = await import('../functions/_shared/settings-kv.js');
  await env.INSCRIPTION_STATUS.put(`org:${DEMO_ORG_ID}:categories_config`, JSON.stringify({ ...DEFAULT_CATEGORIES_CONFIG, saison: '2027-2028' }));
  assert.equal((await submit(env, validData, tasks)).status, 200);
  await Promise.all(tasks);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 2);
});
