// Phase 2b : édition des créneaux et des lieux depuis /admin/categories.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getPublicData, getAdminPublicData } from '../functions/_shared/public-data.js';
import { setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import * as categories from '../functions/admin/categories.js';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_test_association';

let shared;
const setup = () => (shared ??= createSetup());
async function createSetup() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'b', 'B')").bind(B).run();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const post = async (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
    const res = await categories.onRequestPost({ request: new Request('https://clubdemo.licyo.fr/admin/categories', { method: 'POST', body: form, headers: { Cookie: cookie } }), env });
    return { status: res.status, html: await res.text() };
  };
  const get = async () => (await categories.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/categories', { headers: { Cookie: cookie } }), env })).text();
  return { env, post, get };
}

test('la page affiche le créneau et le lieu réels de Sportville', async () => {
  const { get } = await setup();
  const html = await get();
  assert.match(html, /Horaires d'entraînement/);
  assert.match(html, /value="17:00"/);
  assert.match(html, /value="18:00"/);
  assert.match(html, /<option value="4" selected>Jeudi<\/option>/);
  assert.match(html, /value="Stade municipal"/);
});

test('ajouter, modifier puis supprimer un créneau', async () => {
  const { env, post } = await setup();
  const groups = (await getAdminPublicData(env, A)).groups;
  const location = (await getAdminPublicData(env, A)).locations[0];
  const u8 = groups.find((g) => g.slug === 'u8-u9');

  let res = await post({ action: 'add-schedule', weekday: 6, start: '10:00', end: '11:30', locationId: location.id, groupId: u8.id });
  assert.equal(res.status, 200);
  assert.match(res.html, /Modifications enregistrées/);
  let saturday = (await getPublicData(env, A)).schedules.find((s) => s.weekday === 6);
  assert.deepEqual([saturday.start_time, saturday.end_time, saturday.group_id, saturday.weekday_label], ['10:00', '11:30', u8.id, 'samedi']);

  await post({ action: 'save-schedule', id: saturday.id, weekday: 6, start: '10:30', end: '12:00', locationId: location.id, groupId: '' });
  saturday = (await getPublicData(env, A)).schedules.find((s) => s.id === saturday.id);
  assert.deepEqual([saturday.start_time, saturday.end_time, saturday.group_id], ['10:30', '12:00', null]);

  await post({ action: 'delete-schedule', id: saturday.id });
  assert.equal((await getPublicData(env, A)).schedules.some((s) => s.id === saturday.id), false);
});

test('créneau invalide refusé, rien d’enregistré', async () => {
  const { env, post } = await setup();
  const before = (await getPublicData(env, A)).schedules.length;
  for (const fields of [
    { weekday: 8, start: '10:00', end: '11:00' },
    { weekday: 2, start: '10h', end: '11:00' },
    { weekday: 2, start: '12:00', end: '11:00' },
  ]) {
    const res = await post({ action: 'add-schedule', ...fields });
    assert.equal(res.status, 400, JSON.stringify(fields));
  }
  assert.equal((await getPublicData(env, A)).schedules.length, before);
});

test('lieu ou groupe d’une autre organisation refusé ; créneau et lieu de B intouchables depuis A', async () => {
  const { env, post } = await setup();
  await setCategoriesConfig(env, B, { saison: '2026-2027', prix: 50, categories: [{ id: 'theatre', label: 'Théâtre', active: true }] });
  await env.DB.prepare("INSERT INTO locations (organization_id, name) VALUES (?, 'Salle de B')").bind(B).run();
  const locB = await env.DB.prepare('SELECT id FROM locations WHERE organization_id = ?').bind(B).first();
  const groupB = await env.DB.prepare('SELECT id FROM groups WHERE organization_id = ?').bind(B).first();
  await env.DB.prepare("INSERT INTO group_schedules (organization_id, location_id, weekday, start_time, end_time) VALUES (?, ?, 3, '14:00', '15:00')").bind(B, locB.id).run();
  const schB = await env.DB.prepare('SELECT id FROM group_schedules WHERE organization_id = ?').bind(B).first();

  assert.equal((await post({ action: 'add-schedule', weekday: 2, start: '10:00', end: '11:00', locationId: locB.id })).status, 400);
  assert.equal((await post({ action: 'add-schedule', weekday: 2, start: '10:00', end: '11:00', groupId: groupB.id })).status, 400);
  assert.equal((await post({ action: 'save-schedule', id: schB.id, weekday: 1, start: '08:00', end: '09:00' })).status, 400);
  await post({ action: 'delete-schedule', id: schB.id });
  await post({ action: 'delete-location', id: locB.id });
  await post({ action: 'save-location', id: locB.id, name: 'Piraté' });

  const b = await getPublicData(env, B);
  assert.deepEqual(b.schedules.map((s) => [s.weekday, s.start_time]), [[3, '14:00']]);
  assert.deepEqual(b.locations.map((l) => l.name), ['Salle de B']);
});

test('modifier le lieu : nom et adresse mis à jour, lien de carte recalculé', async () => {
  const { env, post } = await setup();
  const location = (await getAdminPublicData(env, A)).locations[0];
  await post({ action: 'save-location', id: location.id, name: 'Stade municipal', address: "1 rue du Stade, 00000 Sportville" });
  const updated = (await getPublicData(env, A)).locations[0];
  assert.equal(updated.address, "1 rue du Stade, 00000 Sportville");
  assert.match(updated.maps_url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=Stade%20municipal/);
  assert.equal((await post({ action: 'save-location', id: location.id, name: '' })).status, 400);
});
