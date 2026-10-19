// 2026-10-10 : déconnexion de l'espace admin après inactivité (expiration glissante, alerte côté navigateur).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, SESSION_IDLE_SECONDS, createSession, isAuthed, adminHead, loginPage } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import * as sessionPage from '../functions/admin/session.js';
import * as logout from '../functions/admin/logout.js';
import { fixture } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const SITE = 'https://clubdemo.licyo.fr';
const nowS = () => Math.floor(Date.now() / 1000);

async function setup() {
  const env = await fixture();
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const req = (path = '/admin/dashboard', headers = {}) => new Request(`${SITE}${path}`, { headers: { Cookie: cookie, ...headers } });
  const expiresAt = async () => (await env.DB.prepare('SELECT expires_at FROM admin_sessions').first()).expires_at;
  const setTimes = (created, expires) => env.DB.prepare('UPDATE admin_sessions SET created_at = ?, expires_at = ?').bind(created, expires).run();
  return { env, req, expiresAt, setTimes };
}

test('une nouvelle session expire après 30 minutes sans activité', async () => {
  const { env, req, expiresAt, setTimes } = await setup();
  assert.ok(Math.abs((await expiresAt()) - (nowS() + SESSION_IDLE_SECONDS)) <= 2);
  assert.equal((await isAuthed(req(), env))?.organizationId, A);
  await setTimes(nowS() - 3600, nowS() - 1);
  assert.equal(await isAuthed(req(), env), null, 'inactive depuis plus de 30 min : refusée');
});

test('chaque page prolonge la session (au plus une écriture par minute), sans dépasser 14 jours', async () => {
  const { env, req, expiresAt, setTimes } = await setup();
  await setTimes(nowS() - 600, nowS() + 300);
  await isAuthed(req(), env);
  assert.ok(Math.abs((await expiresAt()) - (nowS() + SESSION_IDLE_SECONDS)) <= 2, 'prolongée');
  const before = await expiresAt();
  await isAuthed(req(), env);
  assert.equal(await expiresAt(), before, 'pas de nouvelle écriture dans la minute');
  await setTimes(nowS() - 14 * 24 * 3600 + 120, nowS() + 60);
  await isAuthed(req(), env);
  assert.ok((await expiresAt()) <= nowS() + 120, 'plafond de 14 jours après la connexion');
});

test('les sessions de 14 jours ouvertes avant la mise en place sont ramenées à 30 minutes', async () => {
  const { env, req, expiresAt, setTimes } = await setup();
  await setTimes(nowS() - 60, nowS() + 13 * 24 * 3600);
  const res = await sessionPage.onRequestGet({ request: req('/admin/session'), env });
  assert.ok((await res.json()).remaining <= SESSION_IDLE_SECONDS);
  assert.ok((await expiresAt()) <= nowS() + SESSION_IDLE_SECONDS);
});

test('GET /admin/session : lit sans prolonger ; ?prolonger=1 prolonge ; jamais depuis un autre site', async () => {
  const { env, req, expiresAt, setTimes } = await setup();
  await setTimes(nowS() - 1700, nowS() + 100);
  const read = await (await sessionPage.onRequestGet({ request: req('/admin/session'), env })).json();
  assert.equal(read.authenticated, true);
  assert.ok(read.remaining <= 100 && read.remaining >= 98);
  assert.ok((await expiresAt()) <= nowS() + 100, 'la lecture ne prolonge pas');
  await sessionPage.onRequestGet({ request: req('/admin/session?prolonger=1', { 'Sec-Fetch-Site': 'cross-site' }), env });
  assert.ok((await expiresAt()) <= nowS() + 100, 'autre site : rien');
  const extended = await (await sessionPage.onRequestGet({ request: req('/admin/session?prolonger=1', { 'Sec-Fetch-Site': 'same-origin' }), env })).json();
  assert.ok(extended.remaining >= SESSION_IDLE_SECONDS - 2);
  await setTimes(nowS() - 3600, nowS() - 1);
  assert.equal((await sessionPage.onRequestGet({ request: req('/admin/session'), env })).status, 401);
});

test('déconnexion par le minuteur : session fermée, écran de connexion avec le message', async () => {
  const { env, req } = await setup();
  const res = await logout.onRequestGet({ request: req('/admin/logout?inactif=1', { 'Sec-Fetch-Site': 'same-origin' }), env });
  assert.equal(res.headers.get('Location'), '/admin/inscriptions?inactif=1');
  assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_sessions').first().then((r) => r.n), 0);
  assert.equal((await logout.onRequestGet({ request: req('/admin/logout'), env })).headers.get('Location'), '/admin/inscriptions');
  assert.match(loginPage(), /id="login-inactif" hidden/);
});

test('toutes les pages admin chargent le minuteur avec les durées du serveur', () => {
  const head = adminHead('Test');
  assert.match(head, /<script src="\/assets\/js\/admin-session\.js\?v=[^"]+" defer><\/script>/);
  assert.match(head, new RegExp(`data-idle-seconds="${SESSION_IDLE_SECONDS}" data-warning-seconds="120"`));
});
