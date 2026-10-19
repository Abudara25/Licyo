import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { onRequestPost as listPost } from '../functions/admin/inscriptions.js';
import { logEmail } from '../functions/_shared/email-log.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { createR2 } from './helpers/d1.mjs';
import { testUser } from './helpers/accounts.mjs';

// Une seule base pour le fichier : la table des sessions admin n'est créée qu'une fois par module.
let shared;
const setup = () => (shared ??= createSetup());
async function createSetup() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', DOSSIERS: createR2(), DOSSIERS_BACKUP: createR2() };
  const cookie = (await createSession(env, DEMO_ORG_ID, await testUser(env, DEMO_ORG_ID))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const post = (fields, overrides = {}) => {
    const form = new FormData();
    Object.entries(fields).forEach(([k, v]) => form.set(k, v));
    return listPost({
      request: new Request('https://clubdemo.licyo.fr/admin/inscriptions', { method: 'POST', body: form, headers: { Cookie: cookie } }),
      env: { ...env, ...overrides },
      waitUntil: () => {},
    });
  };
  return { env, post };
}

// Fiche archivée avec dossier et photo dans les deux buckets, un e-mail journalisé et une commande HelloAsso.
async function seedWithFiles(env, overrides = {}) {
  const row = await seedInscription(env.DB, { archived_at: '2026-09-20 10:00:00', paye: 1, ...overrides });
  const dossier = `dossiers/${row.upload_token}`;
  const photo = `photos/${row.upload_token}`;
  await env.DB.prepare('UPDATE inscriptions SET dossier_key = ?, photo_key = ? WHERE id = ?').bind(dossier, photo, row.id).run();
  for (const bucket of [env.DOSSIERS, env.DOSSIERS_BACKUP]) {
    await bucket.put(dossier, 'pdf');
    await bucket.put(photo, 'jpg');
  }
  await logEmail(env, { to: [{ email: row.email }], subject: `Relance ${row.enfant_prenom}` }, { kind: 'relance', inscriptionId: row.id }, { ok: true, status: 201, messageId: '<x@brevo>' });
  return { row, dossier, photo };
}

test('suppression définitive : fiche, fichiers R2 (deux buckets) et données personnelles des journaux', async () => {
  const { env, post } = await setup();
  const { row, dossier, photo } = await seedWithFiles(env, { helloasso_order_id: 'HA-1' });
  await env.DB.prepare("INSERT INTO helloasso_orders (organization_id, order_id, status, inscription_ids, payer_email) VALUES (?, 'HA-1', 'matched', ?, 'payeur@example.fr')").bind(DEMO_ORG_ID, String(row.id)).run();

  const res = await post({ action: 'delete', id: row.id, view: 'archive' });
  assert.equal(res.status, 302);
  assert.doesNotMatch(res.headers.get('Location'), /bulkError/);

  assert.equal(await env.DB.prepare('SELECT id FROM inscriptions WHERE id = ?').bind(row.id).first(), null);
  for (const bucket of [env.DOSSIERS, env.DOSSIERS_BACKUP]) {
    assert.equal(bucket.store.has(dossier), false, 'dossier supprimé');
    assert.equal(bucket.store.has(photo), false, 'photo supprimée');
  }
  const log = await env.DB.prepare('SELECT * FROM email_log WHERE inscription_id = ?').bind(row.id).first();
  assert.deepEqual([log.recipients, log.subject, log.message_id, log.error], [null, null, null, null]);
  assert.equal(log.kind, 'relance', 'la trace technique de l’envoi reste');
  const order = await env.DB.prepare("SELECT * FROM helloasso_orders WHERE order_id = 'HA-1'").first();
  assert.equal(order.payer_email, null);
  assert.equal(order.status, 'matched', 'la commande reste connue (anti-doublon)');
});

test('suppression définitive : une commande partagée avec une autre fiche garde son payeur', async () => {
  const { env, post } = await setup();
  const { row } = await seedWithFiles(env, { enfant_prenom: 'Aya', helloasso_order_id: 'HA-2' });
  await seedInscription(env.DB, { enfant_prenom: 'Bilal', helloasso_order_id: 'HA-2', paye: 1 });
  await env.DB.prepare("INSERT INTO helloasso_orders (organization_id, order_id, status, payer_email) VALUES (?, 'HA-2', 'matched', 'payeur@example.fr')").bind(DEMO_ORG_ID).run();
  await post({ action: 'delete', id: row.id, view: 'archive' });
  assert.equal((await env.DB.prepare("SELECT payer_email FROM helloasso_orders WHERE order_id = 'HA-2'").first()).payer_email, 'payeur@example.fr');
});

test('suppression définitive refusée hors corbeille, ou si R2 échoue (rien n’est effacé)', async () => {
  const { env, post } = await setup();
  const active = await seedInscription(env.DB, { enfant_prenom: 'Chloé' });
  let res = await post({ action: 'delete', id: active.id, view: 'archive' });
  assert.match(res.headers.get('Location'), /bulkError=/);
  assert.ok(await env.DB.prepare('SELECT id FROM inscriptions WHERE id = ?').bind(active.id).first());

  const { row, dossier } = await seedWithFiles(env, { enfant_prenom: 'Dina' });
  res = await post({ action: 'delete', id: row.id, view: 'archive' }, { DOSSIERS: { ...env.DOSSIERS, delete: async () => { throw new Error('panne'); } } });
  assert.match(res.headers.get('Location'), /bulkError=/);
  assert.ok(await env.DB.prepare('SELECT id FROM inscriptions WHERE id = ?').bind(row.id).first(), 'la fiche reste');
  assert.ok(env.DOSSIERS.store.has(dossier), 'le fichier reste');
});

test('suppression définitive partielle (sauvegarde en échec) : message honnête, fiche gardée, second essai complet', async () => {
  const { env, post } = await setup();
  const { row, dossier, photo } = await seedWithFiles(env, { enfant_prenom: 'Elsa' });
  const failingBackup = { ...env.DOSSIERS_BACKUP, delete: async () => { throw new Error('panne'); } };

  const res = await post({ action: 'delete', id: row.id, view: 'archive' }, { DOSSIERS_BACKUP: failingBackup });
  const message = decodeURIComponent(new URL(res.headers.get('Location'), 'https://x').searchParams.get('bulkError') || '');
  assert.match(message, /partie des fichiers/);
  assert.doesNotMatch(message, /rien n.a été effacé/);
  assert.ok(await env.DB.prepare('SELECT id FROM inscriptions WHERE id = ?').bind(row.id).first(), 'fiche gardée pour pouvoir réessayer');
  assert.equal(env.DOSSIERS.store.has(dossier), false, 'le principal est déjà supprimé');
  assert.ok(env.DOSSIERS_BACKUP.store.has(photo), 'la sauvegarde reste');

  await post({ action: 'delete', id: row.id, view: 'archive' });
  assert.equal(await env.DB.prepare('SELECT id FROM inscriptions WHERE id = ?').bind(row.id).first(), null);
  assert.equal(env.DOSSIERS_BACKUP.store.has(photo), false, 'second essai complet');
});
