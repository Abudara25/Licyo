// Connexion à l'espace admin par compte nominatif (phase 3, 2026-10-20) : e-mail + mot de passe d'un compte qui a une
// appartenance active au club du domaine. Plus de mot de passe partagé ni de secret ADMIN_PASSWORD.
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, isAuthed, createSession, destroySession, revokeUserSessions, handleLogin } from '../functions/_shared/admin-auth.js';
import { createD1, createKV } from './helpers/d1.mjs';
import { randomUUID } from 'node:crypto';
import { testUser, TEST_PASSWORD } from './helpers/accounts.mjs';

const env = { DB: createD1(), INSCRIPTION_STATUS: createKV(), ADMIN_PASSWORD: `ancien-secret-${randomUUID()}` };

const sessionCookie = (setCookies) => setCookies.find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
const requestWith = (cookie, ip = '203.0.113.7') =>
  new Request('https://clubdemo.licyo.fr/admin/inscriptions', { headers: { Cookie: cookie || '', 'CF-Connecting-IP': ip } });
const loginForm = (email, password) => {
  const form = new FormData();
  form.set('email', email);
  form.set('password', password);
  return form;
};

test('sessions : le cookie ne contient qu’un jeton, rattaché à un compte, révocable', async () => {
  assert.equal(await isAuthed(requestWith(''), env), null);
  assert.equal(await isAuthed(requestWith(`${COOKIE_NAME}=inventé`), env), null);
  assert.equal(await isAuthed(requestWith(`admin_auth=${env.ADMIN_PASSWORD}`), env), null, 'ancien cookie sans effet');
  await assert.rejects(createSession(env, DEMO_ORG_ID), /compte requis/, 'jamais de session sans compte');

  const userId = await testUser(env, DEMO_ORG_ID);
  const cookies = await createSession(env, DEMO_ORG_ID, userId);
  const cookie = sessionCookie(cookies);
  assert.ok(cookies.some((c) => c.startsWith('admin_auth=;') && c.includes('Max-Age=0')));
  const admin = await isAuthed(requestWith(`autre=1; ${cookie}`), env);
  assert.equal(admin.organizationId, DEMO_ORG_ID);
  assert.equal(admin.userId, userId);
  assert.equal(admin.role, 'owner');
  assert.ok(admin.permissions.includes('users.manage'));

  const cleared = await destroySession(requestWith(cookie), env);
  assert.ok(cleared.every((c) => c.includes('Max-Age=0')));
  assert.equal(await isAuthed(requestWith(cookie), env), null);

  const second = sessionCookie(await createSession(env, DEMO_ORG_ID, userId));
  const third = sessionCookie(await createSession(env, DEMO_ORG_ID, userId));
  const otherUser = await testUser(env, DEMO_ORG_ID, 'secretary');
  const other = sessionCookie(await createSession(env, DEMO_ORG_ID, otherUser));
  await revokeUserSessions(env, userId);
  assert.equal(await isAuthed(requestWith(second), env), null);
  assert.equal(await isAuthed(requestWith(third), env), null);
  assert.ok(await isAuthed(requestWith(other), env), 'les sessions des autres comptes restent ouvertes');
});

test('session sans compte (ouverte avant les comptes nominatifs) : n’ouvre plus rien', async () => {
  const now = Math.floor(Date.now() / 1000);
  const { sha256Hex } = await import('../functions/_shared/security.js');
  await env.DB.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at, organization_id) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex('ancienne-session'), now, now + 600, DEMO_ORG_ID)
    .run();
  assert.equal(await isAuthed(requestWith(`${COOKIE_NAME}=ancienne-session`), env), null);
});

test('appartenance retirée ou compte désactivé : la session se ferme à la requête suivante', async () => {
  const userId = await testUser(env, DEMO_ORG_ID, 'coach');
  const cookie = sessionCookie(await createSession(env, DEMO_ORG_ID, userId));
  assert.ok(await isAuthed(requestWith(cookie), env));
  await env.DB.prepare("UPDATE organization_memberships SET status = 'revoked' WHERE organization_id = ? AND user_id = ?").bind(DEMO_ORG_ID, userId).run();
  assert.equal(await isAuthed(requestWith(cookie), env), null);
  await env.DB.prepare("UPDATE organization_memberships SET status = 'active' WHERE organization_id = ? AND user_id = ?").bind(DEMO_ORG_ID, userId).run();
  assert.ok(await isAuthed(requestWith(cookie), env));
  await env.DB.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").bind(userId).run();
  assert.equal(await isAuthed(requestWith(cookie), env), null);
});

test('connexion : e-mail + mot de passe ; message identique pour toute erreur ; 5 échecs bloquent 15 minutes', async () => {
  await testUser(env, DEMO_ORG_ID, 'admin', { email: 'Responsable@Club.example' });
  // L'ancien secret partagé n'ouvre plus rien.
  const legacy = await handleLogin(requestWith('', '198.51.100.9'), env, loginForm('', env.ADMIN_PASSWORD));
  assert.equal(legacy.status, 401);

  const ok = await handleLogin(requestWith('', '198.51.100.1'), env, loginForm('  responsable@club.example ', TEST_PASSWORD));
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('Location'), '/admin/dashboard');
  const admin = await isAuthed(requestWith(sessionCookie(ok.headers.getSetCookie())), env);
  assert.equal(admin.role, 'admin', 'session rattachée au compte et à son rôle');

  const unknown = await handleLogin(requestWith('', '198.51.100.4'), env, loginForm('inconnu@club.example', TEST_PASSWORD));
  const wrong = await handleLogin(requestWith('', '198.51.100.5'), env, loginForm('responsable@club.example', 'mauvais-mot-de-passe'));
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.match(await unknown.text(), /Adresse e-mail ou mot de passe incorrect/);
  assert.match(await wrong.text(), /Adresse e-mail ou mot de passe incorrect/);

  for (let i = 0; i < 5; i++) {
    const res = await handleLogin(requestWith('', '198.51.100.2'), env, loginForm('x@club.example', 'faux'));
    assert.equal(res.status, 401);
  }
  const blocked = await handleLogin(requestWith('', '198.51.100.2'), env, loginForm('responsable@club.example', TEST_PASSWORD));
  assert.equal(blocked.status, 429);
  assert.match(await blocked.text(), /Trop de tentatives/);
  const other = await handleLogin(requestWith('', '198.51.100.3'), env, loginForm('responsable@club.example', TEST_PASSWORD));
  assert.equal(other.status, 302, 'une autre connexion n’est pas bloquée');
});

test('connexion : un compte sans accès à CE club ne peut pas y entrer', async () => {
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'club-b', 'Club B')").run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('club-b.example', 'org_b')").run();
  await testUser(env, 'org_b', 'owner', { email: 'b@club.example' });
  const res = await handleLogin(requestWith('', '198.51.100.20'), env, loginForm('b@club.example', TEST_PASSWORD));
  assert.equal(res.status, 401, 'responsable du club B refusé sur le domaine du club Démo');
});
