// Consolidation phase 2.1 : bootstrap, concurrence, cache, double écriture D1/KV.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getCategoriesConfig, setCategoriesConfig, rebuildCategoriesCopy } from '../functions/_shared/settings-kv.js';
import {
  getPublicData, getCachedPublicData, saveLocation, saveSchedule, clearPublicDataCache, ConfigConflictError, getAdminPublicData,
} from '../functions/_shared/public-data.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_test_association';
const count = async (db, table, org = A) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id = ?`).bind(org).first()).n;

async function setup() {
  clearPublicDataCache();
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'b', 'B')").bind(B).run();
  return env;
}

test('bootstrap Sportville simultané : un seul lieu, un seul créneau, deux groupes, un tarif', async () => {
  const env = await setup();
  await Promise.all([getCategoriesConfig(env, A), getCategoriesConfig(env, A), getCategoriesConfig(env, A), getCategoriesConfig(env, A)]);
  assert.equal(await count(env.DB, 'locations'), 1);
  assert.equal(await count(env.DB, 'group_schedules'), 1);
  assert.equal(await count(env.DB, 'groups'), 2);
  assert.equal(await count(env.DB, 'prices'), 1);
  const data = await getPublicData(env, A);
  assert.equal(data.locations[0].name, 'Stade municipal');
  assert.deepEqual(data.schedules.map((s) => [s.weekday, s.start_time, s.end_time, s.location_id === data.locations[0].id]), [[4, '17:00', '18:00', true]]);
});

test('le bootstrap ne remplace jamais ce que l’administrateur a modifié ensuite', async () => {
  const env = await setup();
  await getCategoriesConfig(env, A);
  const admin = await getAdminPublicData(env, A);
  await saveLocation(env, A, admin.locations[0].id, { name: 'Gymnase Jean Moulin', address: '1 rue X, 00000 Sportville' });
  await env.DB.prepare('DELETE FROM group_schedules WHERE organization_id = ?').bind(A).run();
  await Promise.all([getCategoriesConfig(env, A), getCategoriesConfig(env, A)]);
  assert.equal((await getAdminPublicData(env, A)).locations[0].name, 'Gymnase Jean Moulin');
  assert.equal(await count(env.DB, 'group_schedules'), 0, 'créneau supprimé ne revient pas');
  assert.equal(await count(env.DB, 'locations'), 1);
});

test('supprimer tous les groupes est respecté : les groupes par défaut ne ressuscitent pas', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...config, categories: [] }, { expectedVersion: config.configVersion });
  const after = await getCategoriesConfig(env, A);
  assert.deepEqual(after.categories, []);
  assert.equal((await getPublicData(env, A)).groups.length, 0);
  assert.equal(await count(env.DB, 'groups'), 0);
});

test('base déjà en production (groupes sans marqueur) : le marqueur est posé, la suppression ultérieure est respectée', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  await env.DB.prepare("UPDATE organizations SET settings = '{}' WHERE id = ?").bind(A).run(); // état d'avant ce correctif
  await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...config, categories: [] });
  assert.deepEqual((await getCategoriesConfig(env, A)).categories, []);
});

test('deux administrateurs : la seconde modification, faite sur une version périmée, est refusée sans rien effacer', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  const version = config.configVersion;
  await setCategoriesConfig(env, A, { ...config, prix: 190 }, { expectedVersion: version });
  await assert.rejects(
    setCategoriesConfig(env, A, { ...config, categories: [config.categories[0]], prix: 200 }, { expectedVersion: version }),
    ConfigConflictError
  );
  const now = await getCategoriesConfig(env, A);
  assert.equal(now.prix, 190, 'la première modification est conservée');
  assert.equal(now.categories.length, 2, 'aucune catégorie supprimée par la seconde');
  assert.equal(now.configVersion, version + 1);
});

test('deux enregistrements simultanés sur la même version : un seul est appliqué', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  const results = await Promise.allSettled([
    setCategoriesConfig(env, A, { ...config, prix: 191 }, { expectedVersion: config.configVersion }),
    setCategoriesConfig(env, A, { ...config, prix: 192 }, { expectedVersion: config.configVersion }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.ok(results.find((r) => r.status === 'rejected').reason instanceof ConfigConflictError);
});

test('modifier ou supprimer un groupe ne touche à aucune inscription existante', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  const row = await seedInscription(env.DB, { categorie: 'U6 - U7' });
  const before = JSON.stringify(await env.DB.prepare('SELECT * FROM inscriptions ORDER BY id').all());
  await setCategoriesConfig(env, A, { ...config, categories: [{ ...config.categories[1], label: 'U8 - U9 renommé' }] });
  assert.equal(JSON.stringify(await env.DB.prepare('SELECT * FROM inscriptions ORDER BY id').all()), before);
  assert.equal((await env.DB.prepare('SELECT categorie FROM inscriptions WHERE id = ?').bind(row.id).first()).categorie, 'U6 - U7');
});

test('panne du KV après succès de D1 : la modification est enregistrée, la copie se reconstruit depuis D1', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  const put = env.INSCRIPTION_STATUS.put;
  env.INSCRIPTION_STATUS.put = async () => { throw new Error('KV indisponible'); };
  await setCategoriesConfig(env, A, { ...config, prix: 195 }); // ne lève pas : D1 a réussi
  assert.equal((await getCategoriesConfig(env, A)).prix, 195, 'D1 à jour');
  assert.equal(JSON.parse(env.INSCRIPTION_STATUS.store.get(`org:${A}:categories_config`) ?? '{"prix":null}').prix ?? null, null, 'KV pas à jour');
  assert.equal(console.warn.mock.calls.length, 1, 'désynchronisation journalisée');
  assert.doesNotMatch(String(console.warn.mock.calls[0].arguments[0]), /@|Léa|Durand/, 'pas de donnée personnelle');

  env.INSCRIPTION_STATUS.put = put; // KV rétabli
  assert.equal(await rebuildCategoriesCopy(env, A), true);
  assert.equal(JSON.parse(env.INSCRIPTION_STATUS.store.get(`org:${A}:categories_config`)).prix, 195);
  assert.equal(env.INSCRIPTION_STATUS.store.get('categories_config'), undefined, 'aucune clé globale');
});

test('la lecture ne dépend plus du KV : D1 fait foi même si le KV est en retard', async () => {
  const env = await setup();
  const config = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...config, prix: 210 });
  env.INSCRIPTION_STATUS.store.set(`org:${A}:categories_config`, JSON.stringify({ ...config, prix: 1 }));
  assert.equal((await getCategoriesConfig(env, A)).prix, 210);
});

test('cache : une modification invalide le cache de SON organisation seulement', async () => {
  const env = await setup();
  await getCategoriesConfig(env, A);
  await saveLocation(env, B, null, { name: 'Salle B', address: '2 rue B' });
  const first = await getCachedPublicData(env, A);
  const firstB = await getCachedPublicData(env, B);
  assert.equal(await getCachedPublicData(env, A), first, 'servi depuis le cache');

  const location = (await getAdminPublicData(env, A)).locations[0];
  await saveLocation(env, A, location.id, { name: 'Nouveau stade', address: '3 rue C' });
  const fresh = await getCachedPublicData(env, A);
  assert.notEqual(fresh, first);
  assert.equal(fresh.locations[0].name, 'Nouveau stade');
  assert.equal(await getCachedPublicData(env, B), firstB, 'cache de B intact');
});

test('un créneau propre à un groupe inactif ou non public n’est pas publié', async () => {
  const env = await setup();
  await getCategoriesConfig(env, A);
  const { groups } = await getAdminPublicData(env, A);
  await saveSchedule(env, A, null, { weekday: 6, start: '10:00', end: '11:00', groupId: groups[0].id });
  assert.equal((await getPublicData(env, A)).schedules.length, 2);
  await env.DB.prepare('UPDATE groups SET is_public = 0 WHERE id = ?').bind(groups[0].id).run();
  assert.deepEqual((await getPublicData(env, A)).schedules.map((s) => s.weekday), [4], 'groupe non public : son créneau disparaît');
  await env.DB.prepare('UPDATE groups SET is_public = 1, is_active = 0 WHERE id = ?').bind(groups[0].id).run();
  assert.deepEqual((await getPublicData(env, A)).schedules.map((s) => s.weekday), [4], 'groupe inactif : son créneau disparaît');
});

test('un créneau identique est refusé proprement par l’admin ; supprimer un lieu ne crée pas de doublon exact', async () => {
  const env = await setup();
  await getCategoriesConfig(env, A);
  assert.match((await saveSchedule(env, A, null, { weekday: 4, start: '17:00', end: '18:00', locationId: (await getAdminPublicData(env, A)).locations[0].id })).error ?? '', /existe déjà/);
  await saveLocation(env, A, null, { name: 'Autre lieu', address: 'ailleurs' });
  const { locations } = await getAdminPublicData(env, A);
  assert.equal(locations.length, 2);
});

test('le service programmé reconstruit chaque jour la copie KV de chaque club depuis D1', async () => {
  const { onRequestPost } = await import('../functions/api/cron.js');
  const { clearOrganizationCache } = await import('../functions/_shared/organization.js');
  clearOrganizationCache();
  const env = { ...(await setup()), CRON_SECRET: 'secret-de-test' };
  const config = await getCategoriesConfig(env, A);
  env.INSCRIPTION_STATUS.store.delete(`org:${A}:categories_config`);
  env.INSCRIPTION_STATUS.store.delete('categories_config');
  const response = await onRequestPost({
    request: new Request('https://clubdemo.licyo.fr/api/cron', { method: 'POST', headers: { Authorization: 'Bearer secret-de-test' } }),
    env,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).mirror, 'à jour');
  assert.equal(JSON.parse(env.INSCRIPTION_STATUS.store.get(`org:${A}:categories_config`)).prix, config.prix);
});
