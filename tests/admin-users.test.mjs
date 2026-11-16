// Comptes nominatifs du bureau (lot 1 Licyo) : invitation, connexion, rôles, garde-fous, isolation entre clubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, handleLogin, isAuthed, revokeAllSessions } from '../functions/_shared/admin-auth.js';
import {
  can,
  createInvite,
  findInvite,
  acceptInvite,
  revokeInvite,
  setUserRole,
  setUserStatus,
  listUsers,
  AdminUserError,
  ROLE_PERMISSIONS,
} from '../functions/_shared/admin-users.js';
import { requiredPermission, adminPermissionMiddleware } from '../functions/_shared/admin-permissions.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import * as comptes from '../functions/admin/comptes.js';
import * as invitation from '../functions/admin/invitation/[token].js';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_autre_club';
const SITE_A = 'https://club-exemple.example';
const SITE_B = 'https://autre-club.example';
const secret = () => `Mdp-${randomUUID()}`;

async function setup() {
  clearOrganizationCache();
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'autre-club', 'Autre club', 'cultural_association')").bind(B).run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('autre-club.example', ?)").bind(B).run();
  return env;
}

const cookieOf = (setCookies) => setCookies.find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
const req = (url, { cookie, method = 'GET', body } = {}) =>
  new Request(url, { method, body, headers: { 'CF-Connecting-IP': `198.51.100.${Math.floor(Math.random() * 200)}`, ...(cookie ? { Cookie: cookie } : {}) } });
const form = (fields) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, String(v));
  return f;
};

async function member(env, org, role, email = `${role}-${randomUUID().slice(0, 6)}@example.fr`) {
  const password = secret();
  const { token } = await createInvite(env.DB, org, { email, name: `Personne ${role}`, role });
  const user = await acceptInvite(env.DB, org, token, password, password);
  return { user, password, email };
}

test('invitation : lien à usage unique, mot de passe choisi, compte actif', async () => {
  const env = await setup();
  const { token } = await createInvite(env.DB, A, { email: ' Tresor@Example.FR ', name: '  Inès   Trésor ', role: 'treasurer' });
  assert.match(token, /^i[A-Za-z0-9_-]{43}$/);
  const stored = await env.DB.prepare('SELECT * FROM admin_user_invites WHERE organization_id = ?').bind(A).first();
  assert.equal(stored.email, 'tresor@example.fr');
  assert.equal(stored.name, 'Inès Trésor');
  assert.notEqual(stored.token_hash, token, 'seule l’empreinte du lien est enregistrée');

  await assert.rejects(() => acceptInvite(env.DB, A, token, 'court', 'court'), AdminUserError);
  const password = secret();
  await assert.rejects(() => acceptInvite(env.DB, A, token, password, `${password}x`), /correspondent pas/);
  const user = await acceptInvite(env.DB, A, token, password, password);
  assert.equal(user.role, 'treasurer');
  assert.notEqual(user.password_hash, password);
  assert.equal(await findInvite(env.DB, A, token), null, 'lien consommé');
  await assert.rejects(() => acceptInvite(env.DB, A, token, password, password), /plus valable/);
  await assert.rejects(() => createInvite(env.DB, A, { email: 'tresor@example.fr', name: 'X', role: 'secretary' }), /existe déjà/);
});

test('invitation : expirée, annulée ou remplacée ne sert plus ; jamais sur un autre club', async () => {
  const env = await setup();
  const now = Date.now();
  const old = await createInvite(env.DB, A, { email: 'a@example.fr', name: 'A', role: 'secretary' }, { now: now - 8 * 86_400_000 });
  assert.equal(await findInvite(env.DB, A, old.token), null, 'expirée après 7 jours');

  const first = await createInvite(env.DB, A, { email: 'b@example.fr', name: 'B', role: 'secretary' });
  const second = await createInvite(env.DB, A, { email: 'b@example.fr', name: 'B', role: 'secretary' });
  assert.equal(await findInvite(env.DB, A, first.token), null, 'remplacée par la nouvelle');
  assert.ok(await findInvite(env.DB, A, second.token));
  assert.equal(await findInvite(env.DB, B, second.token), null, 'le lien de A ne vaut rien chez B');

  const row = await findInvite(env.DB, A, second.token);
  await revokeInvite(env.DB, A, row.id);
  assert.equal(await findInvite(env.DB, A, second.token), null, 'annulée');
  await assert.rejects(() => createInvite(env.DB, A, { email: 'pas-une-adresse', name: 'X', role: 'secretary' }), /e-mail invalide/);
  await assert.rejects(() => createInvite(env.DB, A, { email: 'c@example.fr', name: 'X', role: 'super_admin' }), /Rôle inconnu/);
});

test('connexion : e-mail et mot de passe du compte, sur le domaine de son club seulement', async () => {
  const env = await setup();
  const { password, email, user } = await member(env, A, 'secretary');
  const login = (site, fields) => handleLogin(req(`${site}/admin/inscriptions`, { method: 'POST' }), env, form(fields));

  assert.equal((await login(SITE_A, { email, password: 'faux-mot-de-passe' })).status, 401);
  assert.equal((await login(SITE_B, { email, password })).status, 401, 'le compte de A n’ouvre pas B');
  const ok = await login(SITE_A, { email: email.toUpperCase(), password });
  assert.equal(ok.status, 302);
  const admin = await isAuthed(req(`${SITE_A}/admin/a-traiter`, { cookie: cookieOf(ok.headers.getSetCookie()) }), env);
  assert.deepEqual({ org: admin.organizationId, userId: admin.userId, role: admin.role, shared: admin.shared }, { org: A, userId: user.id, role: 'secretary', shared: false });
  const [row] = await listUsers(env.DB, A);
  assert.ok(row.last_login_at, 'dernière connexion enregistrée');
});

test('mot de passe commun : toujours accepté, droits du président, révocation limitée à ses sessions', async () => {
  const env = await setup();
  const shared = await isAuthed(req(`${SITE_A}/admin/a-traiter`, { cookie: cookieOf(await createSession(env, A)) }), env);
  assert.equal(shared.shared, true);
  assert.equal(shared.role, 'president');
  assert.ok(can(shared, 'club.admin'));

  const { user } = await member(env, A, 'secretary');
  const named = cookieOf(await createSession(env, A, user.id));
  const sharedCookie = cookieOf(await createSession(env, A));
  await revokeAllSessions(env, A);
  assert.equal(await isAuthed(req(`${SITE_A}/admin/a-traiter`, { cookie: sharedCookie }), env), null);
  assert.ok(await isAuthed(req(`${SITE_A}/admin/a-traiter`, { cookie: named }), env), 'les comptes nominatifs restent connectés');
});

test('désactivation : connexions fermées aussitôt, plus de connexion possible ; réactivation', async () => {
  const env = await setup();
  const president = await member(env, A, 'president');
  const target = await member(env, A, 'treasurer');
  const cookie = cookieOf(await createSession(env, A, target.user.id));
  await setUserStatus(env.DB, A, target.user.id, 'disabled', { actorUserId: president.user.id });
  assert.equal(await isAuthed(req(`${SITE_A}/admin/a-traiter`, { cookie }), env), null);
  const login = await handleLogin(req(`${SITE_A}/admin/inscriptions`, { method: 'POST' }), env, form({ email: target.email, password: target.password }));
  assert.equal(login.status, 401);
  await setUserStatus(env.DB, A, target.user.id, 'active', { actorUserId: president.user.id });
  const again = await handleLogin(req(`${SITE_A}/admin/inscriptions`, { method: 'POST' }), env, form({ email: target.email, password: target.password }));
  assert.equal(again.status, 302);
});

test('garde-fous : toujours un président actif, personne ne modifie son propre accès', async () => {
  const env = await setup();
  const p1 = await member(env, A, 'president');
  const other = await member(env, A, 'secretary');
  await assert.rejects(() => setUserStatus(env.DB, A, p1.user.id, 'disabled', { actorUserId: p1.user.id }), /propre accès/);
  await assert.rejects(() => setUserRole(env.DB, A, p1.user.id, 'secretary', { actorUserId: other.user.id }), /au moins un président/);
  await assert.rejects(() => setUserStatus(env.DB, A, p1.user.id, 'disabled'), /au moins un président/, 'même avec le mot de passe commun');
  const p2 = await member(env, A, 'president');
  await setUserRole(env.DB, A, p1.user.id, 'vice_president', { actorUserId: p2.user.id });
  await assert.rejects(() => setUserRole(env.DB, B, p2.user.id, 'secretary'), /introuvable/, 'un compte de A est introuvable depuis B');
});

test('droits : chaque rôle a ses permissions ; route inconnue réservée au président', () => {
  assert.equal(can({ role: 'treasurer' }, 'finance.write'), true);
  assert.equal(can({ role: 'treasurer' }, 'members.write'), false);
  assert.equal(can({ role: 'secretary' }, 'finance.write'), false);
  assert.equal(can({ role: 'vice_president' }, 'club.admin'), false);
  assert.equal(can({ role: 'inconnu' }, 'members.read'), false);
  assert.equal(can(null, 'members.read'), false);
  for (const perms of Object.values(ROLE_PERMISSIONS)) assert.ok(perms.includes('members.read'));

  assert.equal(requiredPermission('GET', '/admin/inscriptions/12'), 'members.read');
  assert.equal(requiredPermission('POST', '/admin/inscriptions/12', 'versement'), 'finance.write');
  assert.equal(requiredPermission('POST', '/admin/inscriptions/12', 'note'), 'members.write');
  assert.equal(requiredPermission('POST', '/admin/inscriptions', 'bulk-export'), 'members.read');
  assert.equal(requiredPermission('POST', '/admin/parametres', 'password'), 'club.admin');
  assert.equal(requiredPermission('POST', '/admin/parametres', 'automations'), 'settings.manage');
  assert.equal(requiredPermission('GET', '/admin/comptes'), 'club.admin');
  assert.equal(requiredPermission('GET', '/admin/invitation/abc'), null);
  assert.equal(requiredPermission('GET', '/admin/nouvelle-page'), 'club.admin');
  assert.equal(requiredPermission('GET', '/admin/inscriptionsX'), 'club.admin', 'préfixe exact, pas de faux ami');
});

test('middleware : refus 403 sans exécuter la page ; autorisé, la page s’exécute', async () => {
  const env = await setup();
  const treasurer = await member(env, A, 'treasurer');
  const cookie = cookieOf(await createSession(env, A, treasurer.user.id));
  let ran = 0;
  const next = async () => {
    ran += 1;
    return new Response('page');
  };
  const call = (path, method = 'GET', body) => adminPermissionMiddleware({ request: req(`${SITE_A}${path}`, { cookie, method, body }), env, next });
  assert.equal((await call('/admin/comptes')).status, 403);
  assert.equal((await call('/admin/inscriptions/1', 'POST', form({ action: 'note' }))).status, 403);
  assert.equal(ran, 0, 'aucune page exécutée');
  assert.equal((await call('/admin/inscriptions/1', 'POST', form({ action: 'versement' }))).status, 200);
  assert.equal((await call('/admin/helloasso')).status, 200);
  assert.equal(ran, 2);
  // Sans session : la page affiche elle-même la connexion.
  const anonymous = await adminPermissionMiddleware({ request: req(`${SITE_A}/admin/comptes`), env, next });
  assert.equal(anonymous.status, 200);
});

test('page Comptes : invitation créée par le président, lien affiché ; refusée au trésorier', async () => {
  const env = await setup();
  const president = await member(env, A, 'president');
  const cookie = cookieOf(await createSession(env, A, president.user.id));
  const res = await comptes.onRequestPost({ request: req(`${SITE_A}/admin/comptes`, { cookie, method: 'POST', body: form({ action: 'invite', name: 'Sam Secrétaire', email: 'sam@example.fr', role: 'secretary' }) }), env });
  assert.equal(res.status, 200);
  const body = await res.text();
  const link = body.match(/https:\/\/club-exemple\.example\/admin\/invitation\/(i[A-Za-z0-9_-]{43})/);
  assert.ok(link, 'lien d’invitation affiché');
  assert.match(body, /Aucun e-mail n’est parti/);

  // La personne invitée active son compte depuis le lien, sur le domaine du club.
  const page = await invitation.onRequestGet({ request: req(link[0]), env, params: { token: link[1] } });
  assert.equal(page.status, 200);
  assert.equal((await invitation.onRequestGet({ request: req(`${SITE_B}/admin/invitation/${link[1]}`), env, params: { token: link[1] } })).status, 410);
  const password = secret();
  const accepted = await invitation.onRequestPost({ request: req(link[0], { method: 'POST', body: form({ password, confirm: password }) }), env, params: { token: link[1] } });
  assert.equal(accepted.status, 303);
  const sam = await isAuthed(req(`${SITE_A}/admin/a-traiter`, { cookie: cookieOf(accepted.headers.getSetCookie()) }), env);
  assert.equal(sam.role, 'secretary');

  const treasurer = await member(env, A, 'treasurer');
  const tCookie = cookieOf(await createSession(env, A, treasurer.user.id));
  assert.equal((await comptes.onRequestGet({ request: req(`${SITE_A}/admin/comptes`, { cookie: tCookie }), env })).status, 403);
});
