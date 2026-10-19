import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCategoriesConfig,
  setCategoriesConfig,
  getNotificationEmail,
  setNotificationEmail,
  getAutomationsConfig,
  setAutomationsConfig,
  getInscriptionStatus,
  setInscriptionStatus,
  getCronState,
  setCronState,
  DEFAULT_CATEGORIES_CONFIG,
  DEFAULT_NOTIFICATION_EMAIL,
} from '../functions/_shared/settings-kv.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { createKV } from './helpers/d1.mjs';

const A = DEMO_ORG_ID;
const B = 'org_test_association';
const categories = [{ id: 'u6-u7', label: 'U6 - U7', anneeMin: 2020, anneeMax: 2021, active: true }];

test('getCategoriesConfig : jamais de saison vide', async () => {
  assert.equal((await getCategoriesConfig({ INSCRIPTION_STATUS: createKV() }, A)).saison, DEFAULT_CATEGORIES_CONFIG.saison);

  for (const stored of [{ categories }, { categories, saison: '' }, { categories, saison: '   ' }]) {
    const config = await getCategoriesConfig({ INSCRIPTION_STATUS: createKV({ [`org:${A}:categories_config`]: JSON.stringify(stored) }) }, A);
    assert.equal(config.saison, DEFAULT_CATEGORIES_CONFIG.saison);
    assert.equal(config.prix, DEFAULT_CATEGORIES_CONFIG.prix);
    assert.deepEqual(config.categories, categories);
  }

  const saved = await getCategoriesConfig(
    { INSCRIPTION_STATUS: createKV({ [`org:${A}:categories_config`]: JSON.stringify({ categories, saison: '2027-2028', prix: 200 }) }) },
    A
  );
  assert.equal(saved.saison, '2027-2028');
  assert.equal(saved.prix, 200);
});

test('KV : organisation requise, jamais de lecture globale implicite', async () => {
  const env = { INSCRIPTION_STATUS: createKV() };
  await assert.rejects(getCategoriesConfig(env), /organisation requise/);
  await assert.rejects(setNotificationEmail(env, undefined, 'x@example.fr'), /organisation requise/);
});

test('KV : les réglages de A et de B sont séparés dans les deux sens', async () => {
  const env = { INSCRIPTION_STATUS: createKV() };
  await setCategoriesConfig(env, A, { categories, saison: '2026-2027', prix: 180 });
  await setNotificationEmail(env, A, 'club-a@example.fr');
  await setAutomationsConfig(env, A, { autoReminders: false });
  await setInscriptionStatus(env, A, 'closed');
  await setCronState(env, A, { lastSummary: '2026-09-21' });

  // B ne voit rien de A, ni les valeurs par défaut de Sportville (catégories, liens HelloAsso, e-mail).
  const configB = await getCategoriesConfig(env, B);
  assert.deepEqual(configB.categories, []);
  assert.ok(!JSON.stringify(configB).includes('helloasso'));
  assert.equal(await getNotificationEmail(env, B), '');
  assert.equal((await getAutomationsConfig(env, B)).autoReminders, true);
  assert.equal(await getInscriptionStatus(env, B), null);
  assert.deepEqual(await getCronState(env, B), {});

  await setNotificationEmail(env, B, 'club-b@example.fr');
  await setInscriptionStatus(env, B, 'open');
  assert.equal(await getNotificationEmail(env, A), 'club-a@example.fr', 'A intact');
  assert.equal(await getInscriptionStatus(env, A), 'closed', 'A intact');
  assert.equal(await getNotificationEmail(env, B), 'club-b@example.fr');
});

test('KV : aucune clé globale lue ni écrite ; valeurs de démo pour le club de démo seulement', async () => {
  const env = {
    INSCRIPTION_STATUS: createKV({
      notification_email: 'ancienne@clubdemo.licyo.fr',
      inscription_status: 'closed',
      categories_config: JSON.stringify({ categories, saison: '2025-2026' }),
    }),
  };
  assert.equal(await getNotificationEmail(env, A), DEFAULT_NOTIFICATION_EMAIL, 'ancienne clé globale ignorée');
  assert.equal(await getInscriptionStatus(env, A), null);
  assert.notEqual((await getCategoriesConfig(env, A)).saison, '2025-2026');
  assert.equal(await getNotificationEmail(env, B), '', 'jamais la valeur de démo pour un autre club');
  await setNotificationEmail(env, A, 'nouvelle@clubdemo.licyo.fr');
  assert.equal(env.INSCRIPTION_STATUS.store.get(`org:${A}:notification_email`), 'nouvelle@clubdemo.licyo.fr');
  assert.equal(env.INSCRIPTION_STATUS.store.get('notification_email'), 'ancienne@clubdemo.licyo.fr', 'clé globale jamais écrite');
  assert.equal(DEFAULT_NOTIFICATION_EMAIL, 'contact@clubdemo.licyo.fr');
});
