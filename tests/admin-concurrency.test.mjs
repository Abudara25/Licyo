// Phase 2.1 : deux administrateurs sur /admin/categories, version de contrôle des formulaires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import * as categories from '../functions/admin/categories.js';
import { fixture } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;

async function setup() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const call = async (method, fields) => {
    let body;
    if (fields) {
      body = new FormData();
      for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
    }
    const handler = method === 'POST' ? categories.onRequestPost : categories.onRequestGet;
    const res = await handler({ request: new Request('https://clubdemo.licyo.fr/admin/categories', { method, body, headers: { Cookie: cookie } }), env });
    return { status: res.status, html: await res.text() };
  };
  return { env, get: () => call('GET'), post: (fields) => call('POST', fields) };
}
const versionIn = (html) => Number(/name="configVersion" value="(\d+)"/.exec(html)[1]);

test('chaque formulaire de la page porte la version de la configuration affichée', async () => {
  const { get } = await setup();
  const html = (await get()).html;
  const forms = html.match(/<form method="POST"/g).length;
  assert.equal(html.match(/name="configVersion"/g).length, forms, 'un champ de version par formulaire');
});

test('formulaire périmé : refusé (409) avec un message clair, la modification de l’autre est conservée', async () => {
  const { env, get, post } = await setup();
  const stale = versionIn((await get()).html);
  // Un autre administrateur enregistre entre-temps.
  assert.equal((await post({ action: 'save-saison', saison: '2026-2027', prix: 190, configVersion: stale })).status, 200);
  const refused = await post({ action: 'save-saison', saison: '2026-2027', prix: 250, configVersion: stale });
  assert.equal(refused.status, 409);
  assert.match(refused.html, /modifiés par quelqu’un d’autre/);
  assert.match(refused.html, /value="190"/, 'la page affiche la version à jour');
  assert.equal((await getCategoriesConfig(env, A)).prix, 190);
});

test('formulaire à jour : accepté, et la page suivante porte la nouvelle version', async () => {
  const { get, post } = await setup();
  const v1 = versionIn((await get()).html);
  const saved = await post({ action: 'save-saison', saison: '2026-2027', prix: 185, configVersion: v1 });
  assert.equal(saved.status, 200);
  assert.equal(versionIn(saved.html), v1 + 1);
  assert.equal((await post({ action: 'save-saison', saison: '2026-2027', prix: 186, configVersion: v1 + 1 })).status, 200);
});
