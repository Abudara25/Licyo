// Console fondateur (lot 2 Licyo) : hôte, démarrage, connexion, droits par rôle, CSRF, organisations, journal,
// séparation stricte avec l'admin des clubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as auth from '../functions/_shared/platform-auth.js';
import * as data from '../functions/_shared/platform-data.js';
import { acceptInvite } from '../functions/_shared/admin-users.js';
import { createSession, isAuthed } from '../functions/_shared/admin-auth.js';
import { resolveOrganization, clearOrganizationCache } from '../functions/_shared/organization.js';
import { onRequest as guard, platformPermission } from '../functions/platform/_middleware.js';
import * as dashboard from '../functions/platform/index.js';
import * as orgDetail from '../functions/platform/organisations/[id].js';
import * as nouvelle from '../functions/platform/organisations/nouvelle.js';
import * as equipe from '../functions/platform/equipe.js';
import * as demarrage from '../functions/platform/demarrage.js';
import * as connexion from '../functions/platform/connexion.js';
import { fixture } from './helpers/inscriptions.mjs';

const BOOT = 'b'.repeat(32);
const OWNER = 'fondateur@example.fr';
const CONSOLE = 'https://console.licyo.example';
const pw = () => `Phrase-${randomUUID()}`;

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), PLATFORM_HOSTNAMES: 'console.licyo.example', PLATFORM_BOOTSTRAP_TOKEN: BOOT, PLATFORM_OWNER_EMAIL: OWNER };
  const password = pw();
  const owner = await auth.bootstrapOwner(env, { token: BOOT, email: OWNER, name: 'Fondateur Test', password, confirm: password });
  return { env, owner, password };
}

const cookieOf = (setCookies) => setCookies[0].split(';')[0];
const req = (url, { cookie, method = 'GET', body, headers = {} } = {}) =>
  new Request(url, { method, body, headers: { 'CF-Connecting-IP': `192.0.2.${Math.floor(Math.random() * 250)}`, ...(cookie ? { Cookie: cookie } : {}), ...headers } });
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, String(v));
  return f;
};

// Passe par le middleware, comme en production, puis par la page.
async function call(env, mod, url, { cookie, method = 'GET', fields, params = {} } = {}) {
  let body;
  if (fields) {
    const csrf = cookie ? await auth.platformCsrfToken(req(url, { cookie })) : null;
    body = form({ ...fields, ...(csrf && fields._csrf === undefined ? { _csrf: csrf } : {}) });
  }
  const context = { request: req(url, { cookie, method, body }), env, params, data: {} };
  context.next = () => mod[method === 'GET' ? 'onRequestGet' : 'onRequestPost'](context);
  return guard(context);
}

async function operatorCookie(env, owner, role) {
  const { token } = await auth.inviteOperator(env.DB, owner, { name: `Personne ${role}`, email: `${role}-${randomUUID().slice(0, 6)}@example.fr`, role });
  const password = pw();
  const op = await auth.acceptOperatorInvite(env.DB, token, password, password);
  return { op, cookie: cookieOf(await auth.createPlatformSession(env, op.id)) };
}

test('hôte : la console n’existe que sur les hôtes déclarés et en local', async () => {
  const { env, owner } = await setup();
  const cookie = cookieOf(await auth.createPlatformSession(env, owner.id));
  assert.equal((await call(env, dashboard, 'https://club-exemple.example/platform', { cookie })).status, 404, 'jamais sur le domaine d’un club');
  assert.equal((await call(env, dashboard, `${CONSOLE}/platform`, { cookie })).status, 200);
  assert.equal((await call(env, dashboard, 'http://localhost:8788/platform', { cookie })).status, 200);
});

test('démarrage : une seule fois, avec le secret et l’adresse du propriétaire', async () => {
  clearOrganizationCache();
  const env = { ...(await fixture()), PLATFORM_BOOTSTRAP_TOKEN: BOOT, PLATFORM_OWNER_EMAIL: OWNER };
  const password = pw();
  await assert.rejects(() => auth.bootstrapOwner(env, { token: 'mauvais', email: OWNER, name: 'X', password, confirm: password }), /invalide/);
  await assert.rejects(() => auth.bootstrapOwner(env, { token: BOOT, email: 'autre@example.fr', name: 'X', password, confirm: password }), /propriétaire déclaré/);
  await assert.rejects(() => auth.bootstrapOwner(env, { token: BOOT, email: OWNER, name: 'X', password: 'court', confirm: 'court' }), /au moins/);
  const owner = await auth.bootstrapOwner(env, { token: BOOT, email: OWNER, name: 'Fondateur', password, confirm: password });
  assert.equal(owner.role, 'owner');
  await assert.rejects(() => auth.bootstrapOwner(env, { token: BOOT, email: OWNER, name: 'Bis', password, confirm: password }), /existe déjà/);
  // La page de démarrage disparaît ensuite (404).
  const res = await demarrage.onRequestGet({ request: req(`http://localhost/platform/demarrage?jeton=${BOOT}`), env });
  assert.equal(res.status, 404);
  // Sans secret configuré : jamais disponible.
  assert.equal(auth.bootstrapConfigured({ PLATFORM_OWNER_EMAIL: OWNER }), false);
});

test('connexion : identifiants opérateur ; sans session, redirection vers la connexion', async () => {
  const { env, password } = await setup();
  assert.equal((await call(env, dashboard, `${CONSOLE}/platform`)).status, 303);
  const bad = await connexion.onRequestPost({ request: req(`${CONSOLE}/platform/connexion`, { method: 'POST', body: form({ email: OWNER, password: 'faux' }) }), env });
  assert.equal(bad.status, 401);
  const ok = await connexion.onRequestPost({ request: req(`${CONSOLE}/platform/connexion`, { method: 'POST', body: form({ email: OWNER.toUpperCase(), password }) }), env });
  assert.equal(ok.status, 303);
  const cookie = cookieOf(ok.headers.getSetCookie());
  assert.match(ok.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Strict; Path=\/platform/);
  assert.equal((await call(env, dashboard, `${CONSOLE}/platform`, { cookie })).status, 200);
});

test('séparation : un compte de club n’ouvre pas la console, un opérateur n’ouvre pas l’admin d’un club', async () => {
  const { env, owner } = await setup();
  const clubCookie = cookieOf(await createSession(env, 'org_demo'));
  assert.equal((await call(env, dashboard, `${CONSOLE}/platform`, { cookie: clubCookie })).status, 303);
  const opCookie = cookieOf(await auth.createPlatformSession(env, owner.id));
  assert.equal(await isAuthed(req('https://club-exemple.example/admin/a-traiter', { cookie: opCookie }), env), null);
});

test('CSRF : avec une session, tout envoi exige le jeton et la même origine', async () => {
  const { env, owner } = await setup();
  const cookie = cookieOf(await auth.createPlatformSession(env, owner.id));
  const org = (await data.listOrganizations(env.DB))[0];
  const url = `${CONSOLE}/platform/organisations/${org.id}`;
  const noToken = await call(env, orgDetail, url, { cookie, method: 'POST', fields: { action: 'suspend', _csrf: 'faux' }, params: { id: org.id } });
  assert.equal(noToken.status, 403);
  const foreign = { request: req(url, { cookie, method: 'POST', body: form({ action: 'suspend' }), headers: { Origin: 'https://ailleurs.example' } }), env, params: { id: org.id }, data: {} };
  foreign.next = () => orgDetail.onRequestPost(foreign);
  assert.equal((await guard(foreign)).status, 403);
  assert.equal((await env.DB.prepare('SELECT status FROM organizations WHERE id = ?').bind(org.id).first()).status, 'active', 'rien n’a changé');
  // Les formulaires des pages reçoivent le jeton.
  const page = await (await call(env, orgDetail, url, { cookie, params: { id: org.id } })).text();
  assert.match(page, /name="_csrf" value="[0-9a-f]{64}"/);
});

test('organisation : création avec domaine et accès du président, site résolu, lien sur le domaine du club', async () => {
  const { env, owner } = await setup();
  const cookie = cookieOf(await auth.createPlatformSession(env, owner.id));
  const res = await call(env, nouvelle, `${CONSOLE}/platform/organisations/nouvelle`, {
    cookie,
    method: 'POST',
    fields: { name: 'Rugby Club Les Pins', sport: 'rugby', domain: 'https://www.rc-pins.example/', presidentName: 'Ana Président', presidentEmail: 'ana@example.fr' },
  });
  assert.equal(res.status, 200);
  const body = await res.text();
  const link = body.match(/https:\/\/www\.rc-pins\.example\/admin\/invitation\/(i[A-Za-z0-9_-]{43})/);
  assert.ok(link, 'lien du président affiché, sur le domaine du club');
  const org = (await data.listOrganizations(env.DB)).find((o) => o.name === 'Rugby Club Les Pins');
  assert.equal(org.domain, 'www.rc-pins.example');
  assert.equal(org.sport, 'rugby');
  clearOrganizationCache();
  assert.equal((await resolveOrganization(req('https://www.rc-pins.example/'), env)).id, org.id);
  // Le président active son compte : il est président de CE club.
  const password = pw();
  const president = await acceptInvite(env.DB, org.id, link[1], password, password);
  assert.equal(president.role, 'president');
  // Doublons refusés.
  await assert.rejects(() => data.createOrganization(env, owner, { name: 'Autre', sport: 'rugby', domain: 'www.rc-pins.example', presidentName: 'X', presidentEmail: 'x@example.fr' }), /déjà attribué/);
  await assert.rejects(() => data.createOrganization(env, owner, { name: 'Rugby Club Les Pins', sport: 'rugby', domain: 'autre.example', presidentName: 'X', presidentEmail: 'x@example.fr' }), /identifiant court/);
  await assert.rejects(() => data.createOrganization(env, owner, { name: 'Sans sport', sport: 'tennis', domain: 'z.example', presidentName: 'X', presidentEmail: 'x@example.fr' }), /sport/);
});

test('suspension : site et admin du club fermés aussitôt, réactivation, journal', async () => {
  const { env, owner } = await setup();
  const { id } = await data.createOrganization(env, owner, { name: 'Boxe Test', sport: 'boxe', domain: 'boxe-test.example', presidentName: 'P', presidentEmail: 'p@example.fr' });
  const clubCookie = cookieOf(await createSession(env, id));
  await data.setOrganizationStatus(env, owner, id, 'suspended');
  clearOrganizationCache();
  assert.equal(await resolveOrganization(req('https://boxe-test.example/'), env), null, 'site fermé');
  assert.equal(await isAuthed(req('https://boxe-test.example/admin/a-traiter', { cookie: clubCookie }), env), null, 'bureau déconnecté');
  await data.setOrganizationStatus(env, owner, id, 'active');
  clearOrganizationCache();
  assert.equal((await resolveOrganization(req('https://boxe-test.example/'), env)).id, id);
  const actions = (await auth.auditEntries(env.DB, { organizationId: id })).map((a) => a.action);
  assert.deepEqual(actions.slice(0, 3), ['org.reactivate', 'org.suspend', 'org.president_invite']);
  // Domaines : on ne retire jamais le dernier.
  await assert.rejects(() => data.removeDomain(env, owner, id, 'boxe-test.example'), /au moins un domaine/);
  await data.addDomain(env, owner, id, 'www.boxe-test.example');
  await data.removeDomain(env, owner, id, 'boxe-test.example');
});

test('droits : commercial crée sans suspendre ; support renvoie l’accès sans suspendre ; équipe réservée au propriétaire', async () => {
  const { env, owner } = await setup();
  const org = (await data.listOrganizations(env.DB))[0];
  const url = `${CONSOLE}/platform/organisations/${org.id}`;
  const sales = await operatorCookie(env, owner, 'sales');
  const support = await operatorCookie(env, owner, 'support');
  const admin = await operatorCookie(env, owner, 'admin');

  assert.equal((await call(env, orgDetail, url, { cookie: sales.cookie, method: 'POST', fields: { action: 'suspend' }, params: { id: org.id } })).status, 403);
  assert.equal((await call(env, nouvelle, `${CONSOLE}/platform/organisations/nouvelle`, { cookie: sales.cookie })).status, 200);
  assert.equal((await call(env, orgDetail, url, { cookie: support.cookie, method: 'POST', fields: { action: 'suspend' }, params: { id: org.id } })).status, 403);
  const resend = await call(env, orgDetail, url, { cookie: support.cookie, method: 'POST', fields: { action: 'president-invite', name: 'Prés', email: 'pres@example.fr' }, params: { id: org.id } });
  assert.equal(resend.status, 200);
  assert.equal((await call(env, nouvelle, `${CONSOLE}/platform/organisations/nouvelle`, { cookie: support.cookie })).status, 403);
  for (const who of [sales, support, admin]) assert.equal((await call(env, equipe, `${CONSOLE}/platform/equipe`, { cookie: who.cookie })).status, 403);
  assert.equal((await call(env, orgDetail, url, { cookie: admin.cookie, method: 'POST', fields: { action: 'suspend' }, params: { id: org.id } })).status, 200);

  assert.equal(platformPermission('GET', '/platform/inconnue'), 'team.manage', 'route inconnue : propriétaire seulement');
  assert.equal(platformPermission('POST', '/platform/organisations/x', 'domain-add'), 'orgs.manage');
});

test('équipe : propriétaire protégé, rôle Propriétaire non délégable, désactivation = déconnexion', async () => {
  const { env, owner } = await setup();
  await assert.rejects(() => auth.inviteOperator(env.DB, owner, { name: 'X', email: 'x@example.fr', role: 'owner' }), /ne se délègue pas/);
  const admin = await operatorCookie(env, owner, 'admin');
  await assert.rejects(() => auth.setOperatorStatus(env.DB, admin.op, owner.id, 'disabled'), /protégé/);
  await assert.rejects(() => auth.setOperatorStatus(env.DB, owner, owner.id, 'disabled'), /propre accès/);
  await auth.setOperatorStatus(env.DB, owner, admin.op.id, 'disabled');
  assert.equal((await call(env, dashboard, `${CONSOLE}/platform`, { cookie: admin.cookie })).status, 303, 'session fermée');
  const used = await auth.inviteOperator(env.DB, owner, { name: 'Y', email: 'y@example.fr', role: 'sales' });
  const password = pw();
  await auth.acceptOperatorInvite(env.DB, used.token, password, password);
  await assert.rejects(() => auth.acceptOperatorInvite(env.DB, used.token, password, password), /plus valable/);
});
