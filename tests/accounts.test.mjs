// Phase 3 (2026-10-20) : comptes nominatifs, appartenances, rôles, permissions par route, invitations,
// réinitialisation, premier accès, journal d'audit, isolation entre clubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, isAuthed } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import {
  inviteMember,
  acceptInvitation,
  changeRole,
  revokeMember,
  requestPasswordReset,
  resetPassword,
  createFirstOwner,
  listMembers,
  listAudit,
  readToken,
  AccountError,
  normalizeEmail,
  passwordProblem,
  ROLES,
} from '../functions/_shared/accounts.js';
import { requiredPermission, hideForbiddenLinks } from '../functions/_shared/admin-access.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as utilisateurs from '../functions/admin/utilisateurs.js';
import * as parametres from '../functions/admin/parametres.js';
import * as inscriptions from '../functions/admin/inscriptions.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as dashboard from '../functions/admin/dashboard.js';
import * as journal from '../functions/admin/journal.js';
import * as invitation from '../functions/admin/invitation/[token].js';
import * as reinitialiser from '../functions/admin/reinitialiser/[token].js';
import * as premierAcces from '../functions/admin/premier-acces.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser, TEST_PASSWORD } from './helpers/accounts.mjs';

const SITE = 'https://clubdemo.licyo.fr';
const A = DEMO_ORG_ID;
const SAME = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
const STRONG = 'une phrase de passe solide';

async function env() {
  clearOrganizationCache();
  return { ...(await fixture()), BREVO_API_KEY: 'test' };
}

async function sessionFor(e, role, org = A, opts = {}) {
  const userId = await testUser(e, org, role, opts);
  const cookie = (await createSession(e, org, userId)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const token = await csrfTokenFor(new Request(SITE, { headers: { Cookie: cookie } }));
  return { userId, cookie, token, actor: { userId, role } };
}

async function run(handler, request, e, params = {}) {
  const chain = adminMiddleware;
  let index = 0;
  const next = async () => (index < chain.length ? chain[index++]({ request, env: e, params, waitUntil: () => {}, next }) : handler({ request, env: e, params, waitUntil: () => {} }));
  return next();
}

const get = (path, cookie) => new Request(`${SITE}${path}`, { headers: { Cookie: cookie || '' } });
function post(path, fields, { cookie = '', token = null } = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  if (token) body.set(CSRF_FIELD, token);
  return new Request(`${SITE}${path}`, { method: 'POST', body, headers: { ...SAME, Cookie: cookie } });
}

function mockMail(t) {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  return sent;
}

const linkToken = (mail, kind) => new RegExp(`/admin/${kind}/([A-Za-z0-9_-]+)`).exec(mail.textContent)?.[1];

// ---------------------------------------------------------------------------------------------

test('utilitaires : e-mail normalisé, mot de passe trop simple refusé, rôles cohérents', () => {
  assert.equal(normalizeEmail('  Jean.Dupont@Club.FR '), 'jean.dupont@club.fr');
  assert.equal(normalizeEmail('pas-une-adresse'), null);
  assert.equal(normalizeEmail('a@b.c<script>'), null);
  assert.match(passwordProblem('court'), /au moins/);
  assert.match(passwordProblem('aaaaaaaaaaaa'), /trop simple/);
  assert.match(passwordProblem('jean@club.fr', { email: 'jean@club.fr' }), /adresse e-mail/);
  assert.equal(passwordProblem(STRONG), null);
  for (const role of Object.values(ROLES)) assert.ok(Array.isArray(role.permissions));
  assert.deepEqual(ROLES.volunteer.permissions, []);
  assert.ok(!ROLES.secretary.permissions.includes('finance.write'));
  assert.ok(!ROLES.treasurer.permissions.includes('inscriptions.write'));
});

test('permissions par route', () => {
  assert.equal(requiredPermission('GET', '/admin/dashboard'), null);
  assert.equal(requiredPermission('GET', '/admin/compte'), null);
  assert.equal(requiredPermission('GET', '/admin/'), null, 'CMS statique');
  assert.equal(requiredPermission('GET', '/admin/invitation/abc'), null);
  assert.equal(requiredPermission('GET', '/admin/utilisateurs'), 'users.manage');
  assert.equal(requiredPermission('GET', '/admin/parametres'), 'settings.manage');
  assert.equal(requiredPermission('POST', '/admin/categories'), 'settings.manage');
  assert.equal(requiredPermission('GET', '/admin/email'), 'emails.send');
  assert.equal(requiredPermission('GET', '/admin/inscriptions/12'), 'inscriptions.read');
  assert.equal(requiredPermission('POST', '/admin/inscriptions/12'), 'inscriptions.write');
  assert.equal(requiredPermission('POST', '/admin/inscriptions', 'toggle-paye'), 'finance.write');
  assert.equal(requiredPermission('GET', '/admin/nouvelle-page-future'), 'settings.manage', 'par défaut : prudence');
});

test('invitation complète : e-mail, lien unique, choix du mot de passe, session ouverte, journal', async (t) => {
  const e = await env();
  const sent = mockMail(t);
  const owner = await sessionFor(e, 'owner');
  const res = await run(utilisateurs.onRequestPost, post('/admin/utilisateurs', { action: 'invite', email: 'Nouvelle.Secretaire@Club.example', role: 'secretary' }, owner), e);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Invitation envoyée à nouvelle\.secretaire@club\.example/);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, [{ email: 'nouvelle.secretaire@club.example' }]);
  const token = linkToken(sent[0], 'invitation');
  assert.ok(token);

  const members = await listMembers(e.DB, A);
  assert.equal(members.find((m) => m.email === 'nouvelle.secretaire@club.example').status, 'invited');

  // Page publique d'invitation : nom + mot de passe.
  const page = await run(invitation.onRequestGet, get(`/admin/invitation/${token}`), e, { token });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Secrétaire/);

  const mismatch = await run(invitation.onRequestPost, post(`/admin/invitation/${token}`, { name: 'Nina Martin', password: STRONG, confirm: 'autre chose ici' }), e, { token });
  assert.equal(mismatch.status, 400);
  const accepted = await run(invitation.onRequestPost, post(`/admin/invitation/${token}`, { name: 'Nina Martin', password: STRONG, confirm: STRONG }), e, { token });
  assert.equal(accepted.status, 303);
  const cookie = accepted.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const admin = await isAuthed(get('/admin/dashboard', cookie), e);
  assert.equal(admin.role, 'secretary');
  assert.equal(admin.user.name, 'Nina Martin');

  // Lien à usage unique.
  const again = await run(invitation.onRequestGet, get(`/admin/invitation/${token}`), e, { token });
  assert.equal(again.status, 410);
  const actions = (await listAudit(e.DB, A)).map((r) => r.action);
  assert.ok(actions.includes('utilisateur.invitation'));
  assert.ok(actions.includes('utilisateur.invitation-acceptee'));
});

test('invitation d’un compte qui existe déjà dans un autre club : confirmation par son mot de passe', async () => {
  const e = await env();
  await e.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'club-b', 'Club B')").run();
  const existing = await testUser(e, 'org_b', 'owner', { email: 'multi@club.example' });
  const owner = await sessionFor(e, 'owner');
  const { token } = await inviteMember(e.DB, A, { email: 'multi@club.example', role: 'coach', actor: owner.actor });
  await assert.rejects(acceptInvitation(e.DB, A, token, { password: 'mauvais mot de passe' }), (err) => err instanceof AccountError && err.code === 'password');
  const ok = await acceptInvitation(e.DB, A, token, { password: TEST_PASSWORD });
  assert.equal(ok.userId, existing, 'un seul compte pour deux clubs');
  const rows = await e.DB.prepare("SELECT organization_id, role FROM organization_memberships WHERE user_id = ? AND status = 'active' ORDER BY organization_id").bind(existing).all();
  assert.deepEqual(rows.results.map((r) => [r.organization_id, r.role]), [['org_b', 'owner'], [A, 'coach']]);
});

test('jetons rattachés au club : un lien d’invitation du club A ne vaut rien sur le domaine de B', async () => {
  const e = await env();
  await e.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'club-b', 'Club B')").run();
  await e.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('club-b.example', 'org_b')").run();
  const owner = await sessionFor(e, 'owner');
  const { token } = await inviteMember(e.DB, A, { email: 'x@club.example', role: 'coach', actor: owner.actor });
  assert.ok(await readToken(e.DB, A, token, 'invite'));
  assert.equal(await readToken(e.DB, 'org_b', token, 'invite'), null);
  assert.equal(await readToken(e.DB, A, token, 'reset'), null, 'usage différent');
  const res = await invitation.onRequestGet({ request: new Request(`https://club-b.example/admin/invitation/${token}`), env: e, params: { token } });
  assert.equal(res.status, 410);
});

test('rôles : un administrateur ne touche pas aux responsables ; le dernier responsable ne peut pas partir', async () => {
  const e = await env();
  const owner = await sessionFor(e, 'owner');
  const adminUser = await sessionFor(e, 'admin');
  const target = await testUser(e, A, 'secretary');

  await assert.rejects(inviteMember(e.DB, A, { email: 'boss@club.example', role: 'owner', actor: adminUser.actor }), (err) => err.code === 'forbidden');
  await assert.rejects(changeRole(e.DB, A, { userId: owner.userId, role: 'coach', actor: adminUser.actor }), (err) => err.code === 'forbidden');
  await assert.rejects(revokeMember(e.DB, A, { userId: owner.userId, actor: adminUser.actor }), (err) => err.code === 'forbidden');
  await changeRole(e.DB, A, { userId: target, role: 'treasurer', actor: adminUser.actor });
  assert.equal((await listMembers(e.DB, A)).find((m) => m.id === target).role, 'treasurer');

  // Dernier responsable : ni rétrogradé ni retiré, même par un autre responsable.
  await assert.rejects(changeRole(e.DB, A, { userId: owner.userId, role: 'admin', actor: owner.actor }), (err) => err.code === 'last-owner');
  const second = await testUser(e, A, 'owner', { email: 'second@club.example' });
  await changeRole(e.DB, A, { userId: owner.userId, role: 'admin', actor: { userId: second, role: 'owner' } });
  await assert.rejects(revokeMember(e.DB, A, { userId: second, actor: { userId: owner.userId, role: 'owner' } }), (err) => err.code === 'last-owner');

  // Retrait : sessions fermées immédiatement.
  const coach = await sessionFor(e, 'coach');
  assert.ok(await isAuthed(get('/admin/dashboard', coach.cookie), e));
  await revokeMember(e.DB, A, { userId: coach.userId, actor: { userId: second, role: 'owner' } });
  assert.equal(await isAuthed(get('/admin/dashboard', coach.cookie), e), null);
  assert.equal(await e.DB.prepare('SELECT COUNT(*) AS n FROM admin_sessions WHERE organization_id = ? AND user_id = ?').bind(A, coach.userId).first().then((r) => r.n), 0);
});

test('page Utilisateurs : on ne peut ni changer son propre rôle ni retirer son propre accès', async () => {
  const e = await env();
  const owner = await sessionFor(e, 'owner');
  const self = await run(utilisateurs.onRequestPost, post('/admin/utilisateurs', { action: 'revoke', userId: owner.userId }, owner), e);
  assert.equal(self.status, 400);
  const role = await run(utilisateurs.onRequestPost, post('/admin/utilisateurs', { action: 'role', userId: owner.userId, role: 'coach' }, owner), e);
  assert.equal(role.status, 400);
});

test('permissions appliquées par le middleware : 403 et rien n’est modifié', async () => {
  const e = await env();
  const row = await seedInscription(e.DB);
  const secretary = await sessionFor(e, 'secretary');
  const coach = await sessionFor(e, 'coach');
  const treasurer = await sessionFor(e, 'treasurer');
  const volunteer = await sessionFor(e, 'volunteer');

  assert.equal((await run(parametres.onRequestGet, get('/admin/parametres', secretary.cookie), e)).status, 403);
  assert.equal((await run(utilisateurs.onRequestGet, get('/admin/utilisateurs', secretary.cookie), e)).status, 403);
  assert.equal((await run(inscriptions.onRequestGet, get('/admin/inscriptions', volunteer.cookie), e)).status, 403);
  assert.equal((await run(inscriptions.onRequestGet, get('/admin/inscriptions', coach.cookie), e)).status, 200, 'consultation');

  // Entraîneur : aucune modification.
  const coachPay = await run(inscriptions.onRequestPost, post('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id) }, coach), e);
  assert.equal(coachPay.status, 403);
  // Secrétaire : gère les dossiers mais n'enregistre pas les paiements.
  const secPay = await run(inscriptions.onRequestPost, post('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id) }, secretary), e);
  assert.equal(secPay.status, 403);
  assert.equal((await e.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 0);
  // Trésorier : enregistre le paiement.
  const tresPay = await run(inscriptions.onRequestPost, post('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id), redirectTo: '/admin/inscriptions' }, treasurer), e);
  assert.ok(tresPay.status < 400);
  assert.equal((await e.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
  // Bénévole : tableau de bord ouvert.
  assert.equal((await run(dashboard.onRequestGet, get('/admin/dashboard', volunteer.cookie), e)).status, 200);
});

test('secrétaire qui modifie une fiche : le statut de paiement n’est jamais changé', async () => {
  const e = await env();
  const row = await seedInscription(e.DB);
  const secretary = await sessionFor(e, 'secretary');
  const fields = {
    enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance, categorie: row.categorie,
    tailleMaillot: row.taille_maillot, parentPrenom: row.parent_prenom, parentNom: row.parent_nom, email: row.email,
    telephone: '0600000000', modePaiement: 'HelloAsso', autorisation: 'on', rgpd: 'on', paye: '1',
  };
  const res = await run(fiche.onRequestPost, post(`/admin/inscriptions/${row.id}`, fields, secretary), e, { id: String(row.id) });
  assert.ok(res.status < 500);
  assert.equal((await e.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 0);
});

test('navigation : liens interdits retirés, menu du compte inséré', async () => {
  const e = await env();
  const secretary = await sessionFor(e, 'secretary', A, { name: 'Nina Martin' });
  const html = await (await run(dashboard.onRequestGet, get('/admin/dashboard', secretary.cookie), e)).text();
  assert.doesNotMatch(html, /href="\/admin\/parametres"/);
  assert.doesNotMatch(html, /href="\/admin\/utilisateurs"/);
  assert.match(html, /href="\/admin\/inscriptions"/);
  assert.match(html, /class="adm-account"/);
  assert.match(html, /Nina Martin/);
  assert.match(html, /Secrétaire/);
  const owner = await sessionFor(e, 'owner');
  const ownerHtml = await (await run(dashboard.onRequestGet, get('/admin/dashboard', owner.cookie), e)).text();
  assert.match(ownerHtml, /href="\/admin\/utilisateurs"/);
  // hideForbiddenLinks seul : un lien vers une page interdite disparaît, son texte avec.
  const out = hideForbiddenLinks('<p><a href="/admin/parametres?x=1" class="a">Réglages</a> <a href="/admin/dashboard">Accueil</a></p>', { permissions: [] });
  assert.equal(out, '<p> <a href="/admin/dashboard">Accueil</a></p>');
});

test('journal d’audit : chaque formulaire accepté est noté, sans contenu', async () => {
  const e = await env();
  const row = await seedInscription(e.DB);
  const treasurer = await sessionFor(e, 'treasurer');
  await run(inscriptions.onRequestPost, post('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id), redirectTo: '/admin/inscriptions' }, treasurer), e);
  const log = await listAudit(e.DB, A);
  const entry = log.find((r) => r.action === '/admin/inscriptions:toggle-paye');
  assert.ok(entry);
  assert.equal(entry.user_id, treasurer.userId);
  assert.doesNotMatch(JSON.stringify(log), /Durand|parent@example/);
  const owner = await sessionFor(e, 'owner');
  const page = await run(journal.onRequestGet, get('/admin/journal', owner.cookie), e);
  assert.equal(page.status, 200);
  assert.equal((await run(journal.onRequestGet, get('/admin/journal', treasurer.cookie), e)).status, 403);
});

test('mot de passe oublié → lien 1 heure → nouveau mot de passe → toutes les sessions fermées', async () => {
  const e = await env();
  const user = await sessionFor(e, 'secretary', A, { email: 'reset@club.example' });
  assert.equal(await requestPasswordReset(e.DB, A, 'inconnu@club.example'), null);
  const { token } = await requestPasswordReset(e.DB, A, 'RESET@club.example');
  assert.equal((await run(reinitialiser.onRequestGet, get(`/admin/reinitialiser/${token}`), e, { token })).status, 200);
  const weak = await run(reinitialiser.onRequestPost, post(`/admin/reinitialiser/${token}`, { password: 'court', confirm: 'court' }), e, { token });
  assert.equal(weak.status, 400);
  const done = await run(reinitialiser.onRequestPost, post(`/admin/reinitialiser/${token}`, { password: STRONG, confirm: STRONG }), e, { token });
  assert.equal(done.status, 200);
  assert.match(await done.text(), /Mot de passe enregistré/);
  assert.equal(await isAuthed(get('/admin/dashboard', user.cookie), e), null, 'ancienne session fermée');
  await assert.rejects(resetPassword(e.DB, A, token, STRONG), (err) => err.code === 'token', 'lien à usage unique');
  // Expiré : refusé.
  const second = await requestPasswordReset(e.DB, A, 'reset@club.example');
  await e.DB.prepare('UPDATE user_tokens SET expires_at = 1 WHERE organization_id = ? AND used_at IS NULL').bind(A).run();
  assert.equal((await run(reinitialiser.onRequestGet, get(`/admin/reinitialiser/${second.token}`), e, { token: second.token })).status, 410);
});

test('premier accès : protégé par le secret de plateforme, une seule fois', async () => {
  const e = await env();
  assert.equal((await run(premierAcces.onRequestGet, get('/admin/premier-acces'), e)).status, 503, 'désactivé sans SETUP_SECRET');
  e.SETUP_SECRET = 'code-de-mise-en-service';
  assert.equal((await run(premierAcces.onRequestGet, get('/admin/premier-acces'), e)).status, 200);
  const fields = { setup: 'faux', name: 'Abdallah Test', email: 'resp@club.example', password: STRONG, confirm: STRONG };
  assert.equal((await run(premierAcces.onRequestPost, post('/admin/premier-acces', fields), e)).status, 403);
  const ok = await run(premierAcces.onRequestPost, post('/admin/premier-acces', { ...fields, setup: 'code-de-mise-en-service' }), e);
  assert.equal(ok.status, 303);
  const cookie = ok.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  assert.equal((await isAuthed(get('/admin/dashboard', cookie), e)).role, 'owner');
  // Seconde fois : refusé, même avec le bon code.
  assert.equal((await run(premierAcces.onRequestGet, get('/admin/premier-acces'), e)).status, 409);
  const twice = await run(premierAcces.onRequestPost, post('/admin/premier-acces', { ...fields, email: 'autre@club.example', setup: 'code-de-mise-en-service' }), e);
  assert.equal(twice.status, 409);
  await assert.rejects(createFirstOwner(e.DB, A, { email: 'x@club.example', name: 'X Y', password: STRONG }), (err) => err.code === 'exists');
});
