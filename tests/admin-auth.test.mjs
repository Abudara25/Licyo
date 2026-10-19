import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COOKIE_NAME,
  verifyAdminPassword,
  setAdminPasswordHash,
  isAuthed,
  createSession,
  destroySession,
  revokeAllSessions,
  handleLogin,
} from '../functions/_shared/admin-auth.js';
import { hashPassword, isPasswordHash } from '../functions/_shared/security.js';
import { createD1, createKV } from './helpers/d1.mjs';
import { randomUUID } from 'node:crypto';

// Valeurs tirées à chaque exécution : aucun mot de passe écrit en dur, même factice.
const ADMIN_SECRET = `Demo-${randomUUID()}`;
const NEW_SECRET = randomUUID();
const LEGACY_SECRET = randomUUID();
const WRONG_SECRET = randomUUID();

// Un seul environnement pour tout le fichier : les tables sont créées une fois par module.
const env = { DB: createD1(), INSCRIPTION_STATUS: createKV(), ADMIN_PASSWORD: ADMIN_SECRET };

const sessionCookie = (setCookies) => setCookies.find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
const requestWith = (cookie, ip = '203.0.113.7') =>
  new Request('https://clubdemo.licyo.fr/admin/inscriptions', { headers: { Cookie: cookie || '', 'CF-Connecting-IP': ip } });
const loginForm = (password) => {
  const form = new FormData();
  form.set('password', password);
  return form;
};

test('mot de passe : secret Cloudflare, puis KV haché, puis ancienne valeur en clair migrée', async () => {
  const org = DEMO_ORG_ID;
  assert.equal(await verifyAdminPassword(env, org, ADMIN_SECRET), true);
  assert.equal(await verifyAdminPassword(env, org, ADMIN_SECRET.toLowerCase()), false);
  assert.equal(await verifyAdminPassword(env, org, ''), false);

  await setAdminPasswordHash(env, org, await hashPassword(NEW_SECRET));
  assert.equal(await verifyAdminPassword(env, org, NEW_SECRET), true);
  assert.equal(await verifyAdminPassword(env, org, ADMIN_SECRET), false);
  assert.ok(isPasswordHash(await env.INSCRIPTION_STATUS.get(`org:${org}:admin_password`)), 'clé propre à l’organisation');

  // Ancienne clé globale en clair (avant le hachage et avant le multi-organisation) : reprise puis hachée.
  await env.INSCRIPTION_STATUS.delete(`org:${org}:admin_password`);
  await env.INSCRIPTION_STATUS.put('admin_password', LEGACY_SECRET);
  assert.equal(await verifyAdminPassword(env, org, LEGACY_SECRET), true);
  assert.ok(isPasswordHash(await env.INSCRIPTION_STATUS.get(`org:${org}:admin_password`)));
  assert.ok(isPasswordHash(await env.INSCRIPTION_STATUS.get('admin_password')), 'ancienne clé tenue à jour (retour arrière possible)');
  assert.equal(await verifyAdminPassword(env, org, LEGACY_SECRET), true);

  await env.INSCRIPTION_STATUS.delete(`org:${org}:admin_password`);
  await env.INSCRIPTION_STATUS.delete('admin_password');
});

test('sessions : le cookie ne contient qu’un jeton, révocable', async () => {
  assert.equal(await isAuthed(requestWith(''), env), null);
  assert.equal(await isAuthed(requestWith(`${COOKIE_NAME}=inventé`), env), null);
  // l'ancien cookie contenant le mot de passe n'ouvre plus rien
  assert.equal(await isAuthed(requestWith(`admin_auth=${ADMIN_SECRET}`), env), null);

  const cookies = await createSession(env, DEMO_ORG_ID);
  const cookie = sessionCookie(cookies);
  assert.ok(!cookie.includes(ADMIN_SECRET));
  assert.ok(cookies.some((c) => c.startsWith('admin_auth=;') && c.includes('Max-Age=0')));
  assert.deepEqual(await isAuthed(requestWith(`autre=1; ${cookie}`), env), { organizationId: DEMO_ORG_ID });

  const cleared = await destroySession(requestWith(cookie), env);
  assert.ok(cleared.every((c) => c.includes('Max-Age=0')));
  assert.equal(await isAuthed(requestWith(cookie), env), null);

  const second = sessionCookie(await createSession(env, DEMO_ORG_ID));
  const third = sessionCookie(await createSession(env, DEMO_ORG_ID));
  await revokeAllSessions(env, DEMO_ORG_ID);
  assert.equal(await isAuthed(requestWith(second), env), null);
  assert.equal(await isAuthed(requestWith(third), env), null);
});

test('connexion : 5 échecs bloquent la connexion 15 minutes, par adresse IP', async () => {
  const ok = await handleLogin(requestWith('', '198.51.100.1'), env, loginForm(ADMIN_SECRET));
  assert.equal(ok.status, 302);
  const cookie = sessionCookie(ok.headers.getSetCookie());
  assert.deepEqual(await isAuthed(requestWith(cookie), env), { organizationId: DEMO_ORG_ID }, 'session rattachée à l’organisation du domaine');

  for (let i = 0; i < 5; i++) {
    const res = await handleLogin(requestWith('', '198.51.100.2'), env, loginForm(WRONG_SECRET));
    assert.equal(res.status, 401);
  }
  const blocked = await handleLogin(requestWith('', '198.51.100.2'), env, loginForm(ADMIN_SECRET));
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /Trop de tentatives/);

  // une autre connexion n'est pas bloquée
  const other = await handleLogin(requestWith('', '198.51.100.3'), env, loginForm(ADMIN_SECRET));
  assert.equal(other.status, 302);
});
