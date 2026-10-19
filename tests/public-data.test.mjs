// Phase 2a : groupes, lieux, créneaux et tarifs en D1, source de vérité des catégories et du tarif.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCategoriesConfig, setCategoriesConfig, DEFAULT_CATEGORIES_CONFIG } from '../functions/_shared/settings-kv.js';
import { getPublicData, readGroupsConfig } from '../functions/_shared/public-data.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_test_association';

async function setup() {
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'b', 'B')").bind(B).run();
  return env;
}

test('premier accès : catégories et tarif importés du KV, lieu et créneau réels de Sportville', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  assert.deepEqual(config.categories, DEFAULT_CATEGORIES_CONFIG.categories, 'mêmes catégories qu’avant, même ordre');
  assert.equal(config.prix, 180);
  assert.equal(config.saison, '2026-2027');

  const data = await getPublicData(env, A);
  assert.deepEqual(data.groups.map((g) => [g.slug, g.birth_year_min, g.birth_year_max]), [['u6-u7', 2020, 2021], ['u8-u9', 2018, 2019]]);
  assert.deepEqual(data.schedules.map((s) => [s.weekday_label, s.start_time, s.end_time, s.group_id]), [['jeudi', '17:00', '18:00', null]]);
  assert.equal(data.locations[0].name, 'Stade municipal');
  assert.deepEqual(data.prices.map((p) => [p.slug, p.amount_cents]), [['adhesion-saison', 18000]]);

  await getCategoriesConfig(env, A);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM group_schedules WHERE organization_id = ?').bind(A).first()).n, 1, 'import une seule fois');
});

test('catégories personnalisées déjà enregistrées dans le KV : importées telles quelles', async () => {
  const env = await setup();
  const custom = { saison: '2026-2027', prix: 200, categories: [{ id: 'u10-u11', label: 'U10 - U11', anneeMin: 2016, anneeMax: 2017, active: true }] };
  await env.INSCRIPTION_STATUS.put('categories_config', JSON.stringify(custom)); // ancienne clé globale
  const config = await getCategoriesConfig(env, A);
  assert.deepEqual(config.categories.map((c) => c.id), ['u10-u11']);
  assert.equal(config.prix, 200);
});

test('D1 est la source de vérité ; l’admin écrit en D1 puis dans le KV', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  const next = {
    ...config,
    prix: 190,
    categories: [
      { ...config.categories[1], label: 'U8 - U9 (renommé)' },
      { id: 'u10-u11', label: 'U10 - U11', anneeMin: 2016, anneeMax: 2017, helloAssoUrl: '', helloAssoWidgetUrl: '', active: false },
    ],
  };
  await setCategoriesConfig(env, A, next);
  const read = await getCategoriesConfig(env, A);
  assert.deepEqual(read.categories.map((c) => [c.id, c.label, c.active]), [['u8-u9', 'U8 - U9 (renommé)', true], ['u10-u11', 'U10 - U11', false]], 'ajout, modification, suppression, ordre');
  assert.equal(read.prix, 190);
  assert.equal(JSON.parse(env.INSCRIPTION_STATUS.store.get(`org:${A}:categories_config`)).prix, 190, 'KV tenu à jour (retour arrière)');

  // Une modification faite directement en D1 est celle qui s'applique.
  await env.DB.prepare("UPDATE prices SET amount_cents = 17500 WHERE organization_id = ? AND slug = 'adhesion-saison'").bind(A).run();
  assert.equal((await getCategoriesConfig(env, A)).prix, 175);
  // Les groupes inactifs ne sont pas publics.
  assert.deepEqual((await getPublicData(env, A)).groups.map((g) => g.slug), ['u8-u9']);
});

test('D1 indisponible : repli sur la configuration KV, sans erreur', async () => {
  const env = await setup();
  const broken = { ...env, DB: { prepare: () => { throw new Error('D1 indisponible'); }, batch: async () => { throw new Error('D1 indisponible'); } } };
  const config = await getCategoriesConfig(broken, A);
  assert.deepEqual(config.categories, DEFAULT_CATEGORIES_CONFIG.categories);
  assert.equal(config.prix, 180);
});

test('données publiques séparées par organisation', async () => {
  const env = await setup();
  await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, B, { saison: '2026-2027', prix: 90, categories: [{ id: 'theatre', label: 'Atelier théâtre', active: true }] });

  const a = await getPublicData(env, A);
  const b = await getPublicData(env, B);
  assert.deepEqual(a.groups.map((g) => g.slug), ['u6-u7', 'u8-u9']);
  assert.deepEqual(b.groups.map((g) => g.slug), ['theatre']);
  assert.deepEqual(b.schedules, [], 'aucun créneau ni lieu de Sportville pour B');
  assert.deepEqual(b.locations, []);
  assert.deepEqual(b.prices.map((p) => p.amount_cents), [9000]);
  assert.deepEqual((await readGroupsConfig(env, A)).categories.map((c) => c.id), ['u6-u7', 'u8-u9'], 'A intacte');
  // Même slug dans deux organisations : aucune collision.
  await setCategoriesConfig(env, B, { saison: '2026-2027', prix: 90, categories: [{ id: 'u6-u7', label: 'Éveil', active: true }] });
  assert.equal((await readGroupsConfig(env, A)).categories[0].label, 'U6 - U7');
  await assert.rejects(getPublicData(env, undefined), /organisation requise/);
});
