// Une session admin ne vaut que tant que son organisation existe et est active (audit phase 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession, isAuthed } from '../functions/_shared/admin-auth.js';
import { fixture } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

async function sessionFor(env, organizationId) {
  const cookie = (await createSession(env, organizationId, await testUser(env, organizationId))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return new Request('https://clubdemo.licyo.fr/admin/inscriptions', { headers: { Cookie: cookie } });
}

test('session admin : organisation active acceptée, suspendue ou absente refusée', async () => {
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'b', 'B')").run();
  const request = await sessionFor(env, 'org_b');
  assert.equal((await isAuthed(request, env))?.organizationId, 'org_b', 'active');

  await env.DB.prepare("UPDATE organizations SET status = 'suspended' WHERE id = 'org_b'").run();
  assert.equal(await isAuthed(request, env), null, 'suspendue');

  await env.DB.prepare("UPDATE organizations SET status = 'active' WHERE id = 'org_b'").run();
  assert.ok(await isAuthed(request, env), 'réactivée');

  // Une clé étrangère empêche normalement de supprimer une organisation qui a des sessions : on simule
  // une base incohérente (restauration partielle) où l'organisation a disparu quand même.
  await env.DB.prepare('PRAGMA foreign_keys = OFF').run();
  await env.DB.prepare("DELETE FROM organizations WHERE id = 'org_b'").run();
  await env.DB.prepare('PRAGMA foreign_keys = ON').run();
  assert.equal(await isAuthed(request, env), null, 'absente');
});
