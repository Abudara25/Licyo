import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { processHelloAssoOrder } from '../functions/_shared/helloasso.js';
import { DEFAULT_CATEGORIES_CONFIG } from '../functions/_shared/settings-kv.js';
import { fixture, seedInscription, synchronizeReads } from './helpers/inscriptions.mjs';

const siteUrl = 'https://clubdemo.licyo.fr';
const order = (overrides = {}) => ({
  id: 'commande-1',
  formSlug: DEFAULT_CATEGORIES_CONFIG.categories[0].helloAssoUrl.split('/').pop(),
  payer: { firstName: 'Samia', lastName: 'Durand', email: 'parent@example.fr' },
  payments: [{ state: 'Authorized' }],
  items: [{ user: { firstName: 'Léa', lastName: 'Durand' } }],
  ...overrides,
});

test('HelloAsso : paiement et commande enregistrés ensemble, répétition ignorée', async () => {
  const env = await fixture();
  const row = await seedInscription(env.DB);
  assert.deepEqual(await processHelloAssoOrder(env, order(), siteUrl, undefined, DEMO_ORG_ID), { status: 'matched', matched: [row.id] });
  assert.deepEqual(await processHelloAssoOrder(env, order(), siteUrl, undefined, DEMO_ORG_ID), { status: 'duplicate' });
  const paid = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(paid.paye, 1);
  assert.equal(paid.helloasso_order_id, 'commande-1');
  assert.equal((await env.DB.prepare('SELECT * FROM helloasso_orders').first()).inscription_ids, String(row.id));
});

test('HelloAsso : échec après écriture des paiements annule tout, puis reprise réussie', async (t) => {
  const env = await fixture();
  const row = await seedInscription(env.DB);
  const batch = env.DB.batch.bind(env.DB);
  const fault = t.mock.method(env.DB, 'batch', (statements) =>
    batch([...statements, env.DB.prepare('INSERT INTO table_absente VALUES (1)')]));
  const tasks = [];
  await assert.rejects(processHelloAssoOrder(env, order(), siteUrl, (task) => tasks.push(task), DEMO_ORG_ID), /table_absente/);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM helloasso_orders').first()).n, 0);
  assert.equal(tasks.length, 0, 'aucun e-mail avant validation de la transaction');
  fault.mock.restore();
  assert.equal((await processHelloAssoOrder(env, order(), siteUrl, undefined, DEMO_ORG_ID)).status, 'matched');
});

test('HelloAsso : notifications simultanées de la même commande, un seul traitement', { timeout: 5000 }, async (t) => {
  const env = await fixture();
  await seedInscription(env.DB);
  synchronizeReads(t, env.DB, /^SELECT \* FROM inscriptions WHERE archived_at/);
  const tasks = [];
  const results = await Promise.all([
    processHelloAssoOrder(env, order(), siteUrl, (task) => tasks.push(task), DEMO_ORG_ID),
    processHelloAssoOrder(env, order(), siteUrl, (task) => tasks.push(task), DEMO_ORG_ID),
  ]);
  await Promise.all(tasks);
  assert.deepEqual(results.map((r) => r.status).sort(), ['duplicate', 'matched']);
  assert.equal(tasks.length, 1, 'une seule automatisation après paiement');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM helloasso_orders').first()).n, 1);
});

test('HelloAsso : deux commandes concurrentes ne remplacent pas le premier rattachement', { timeout: 5000 }, async (t) => {
  const env = await fixture();
  await seedInscription(env.DB);
  synchronizeReads(t, env.DB, /^SELECT \* FROM inscriptions WHERE archived_at/);
  const results = await Promise.all([
    processHelloAssoOrder(env, order(), siteUrl, undefined, DEMO_ORG_ID),
    processHelloAssoOrder(env, order({ id: 'commande-2' }), siteUrl, undefined, DEMO_ORG_ID),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['matched', 'unmatched']);
  const paid = await env.DB.prepare('SELECT * FROM inscriptions').first();
  const record = await env.DB.prepare('SELECT * FROM helloasso_orders WHERE order_id = ?').bind(paid.helloasso_order_id).first();
  assert.equal(record.status, 'matched');
  const other = await env.DB.prepare("SELECT * FROM helloasso_orders WHERE status = 'unmatched'").first();
  assert.equal(other.inscription_ids, '');
});

test('HelloAsso : commande impayée retentable et rapprochement partiel explicite', async () => {
  const env = await fixture();
  const row = await seedInscription(env.DB);
  assert.equal((await processHelloAssoOrder(env, order({ payments: [] }), siteUrl, undefined, DEMO_ORG_ID)).status, 'unpaid');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM helloasso_orders').first()).n, 0);
  const result = await processHelloAssoOrder(env, order({
    items: [...order().items, { user: { firstName: 'Autre', lastName: 'Enfant' } }],
  }), siteUrl, undefined, DEMO_ORG_ID);
  assert.deepEqual(result, { status: 'partial', matched: [row.id] });
});

test('HelloAsso : une fiche archivée entre la lecture et la transaction ne passe pas payée', async (t) => {
  const env = await fixture();
  const row = await seedInscription(env.DB);
  const batch = env.DB.batch.bind(env.DB);
  t.mock.method(env.DB, 'batch', async (statements) => {
    await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(row.id).run();
    return batch(statements);
  });
  assert.deepEqual(await processHelloAssoOrder(env, order(), siteUrl, undefined, DEMO_ORG_ID), { status: 'unmatched', matched: [] });
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 0);
});

test('HelloAsso : panne de vérification API retentable, sans paiement ni commande traitée', async (t) => {
  const env = { ...await fixture(), HELLOASSO_CLIENT_ID: 'test', HELLOASSO_CLIENT_SECRET: 'test' };
  await seedInscription(env.DB);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  await assert.rejects(processHelloAssoOrder(env, order(), siteUrl, undefined, DEMO_ORG_ID), /HelloAsso token 503/);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions').first()).paye, 0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM helloasso_orders').first()).n, 0);
});
