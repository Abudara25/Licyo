// Console plateforme (phase 6, première version, 2026-10-20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, isAuthed, handleLogin } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { clearOrganizationCache, resolveOrganization } from '../functions/_shared/organization.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as plateforme from '../functions/admin/plateforme.js';
import * as invitation from '../functions/admin/invitation/[token].js';
import { getSportProfile } from '../functions/_shared/sport-profile.js';
import { slugify, normalizeDomain, isPlatformAdmin } from '../functions/_shared/platform.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const SITE = 'https://clubdemo.licyo.fr';

async function setup(t) {
  clearOrganizationCache();
  const env = { ...(await fixture()), BREVO_API_KEY: 'x', PLATFORM_ADMIN_EMAILS: ' Editeur@Licyo.example , autre@licyo.example' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response('{"messageId":"x"}', { status: 201 });
  });
  const editor = await testUser(env, DEMO_ORG_ID, 'owner', { email: 'editeur@licyo.example' });
  const plain = await testUser(env, DEMO_ORG_ID, 'owner', { email: 'responsable@club.example' });
  const cookieOf = async (u) => (await createSession(env, DEMO_ORG_ID, u)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, sent, editorCookie: await cookieOf(editor), plainCookie: await cookieOf(plain) };
}

function run(env, handler, request) {
  let i = 0;
  const next = async () => (i < adminMiddleware.length ? adminMiddleware[i++]({ request, env, params: {}, next, waitUntil() {} }) : handler({ request, env, params: {}, waitUntil() {} }));
  return next();
}
async function post(env, cookie, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set(CSRF_FIELD, await csrfTokenFor(new Request(SITE, { headers: { Cookie: cookie } })));
  return run(env, plateforme.onRequestPost, new Request(`${SITE}/admin/plateforme`, { method: 'POST', body, headers: { Cookie: cookie, Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } }));
}

test('utilitaires', () => {
  assert.equal(slugify('AS Tennis de Sportville !'), 'as-tennis-de-sportville');
  assert.equal(normalizeDomain('https://WWW.MonClub.fr/admin'), 'www.monclub.fr');
  assert.equal(normalizeDomain('pas un domaine'), null);
  assert.equal(isPlatformAdmin({ PLATFORM_ADMIN_EMAILS: 'a@b.fr' }, 'A@B.fr'), true);
  assert.equal(isPlatformAdmin({}, 'a@b.fr'), false);
});

test('accès : réservé aux administrateurs de la plateforme, même responsable d’un club', async (t) => {
  const { env, editorCookie, plainCookie } = await setup(t);
  assert.equal((await run(env, plateforme.onRequestGet, new Request(`${SITE}/admin/plateforme`, { headers: { Cookie: plainCookie } }))).status, 403);
  const page = await run(env, plateforme.onRequestGet, new Request(`${SITE}/admin/plateforme`, { headers: { Cookie: editorCookie } }));
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Club Démo/);
  assert.match(html, /clubdemo\.licyo\.fr/);
  assert.ok((await isAuthed(new Request(SITE, { headers: { Cookie: editorCookie } }), env)).platformAdmin);
});

test('créer un club : organisation, domaine, sport, invitation du responsable sur le domaine du club', async (t) => {
  const { env, sent, editorCookie } = await setup(t);
  await seedInscription(env.DB);
  const res = await post(env, editorCookie, { action: 'create', name: 'Judo Club Sportville', domain: 'judo.licyo.example', sport: 'judo', ownerEmail: 'presidente@judo.example' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Judo Club Sportville.*créé/);
  const org = await env.DB.prepare("SELECT * FROM organizations WHERE slug = 'judo-club-sportville'").first();
  assert.ok(org?.id.startsWith('org_'));
  assert.equal((await getSportProfile(env, org.id)).sport, 'judo');
  const mail = sent.at(-1);
  assert.deepEqual(mail.to, [{ email: 'presidente@judo.example' }]);
  const token = /https:\/\/judo\.licyo\.example\/admin\/invitation\/([A-Za-z0-9_-]+)/.exec(mail.textContent)?.[1];
  assert.ok(token, 'lien sur le domaine du club');
  assert.doesNotMatch(mail.htmlContent + mail.textContent, /FFF|Footclubs/, 'vocabulaire du judo');

  // Le domaine est résolu vers le nouveau club ; l'invitation y fonctionne et ouvre SON admin, sans les fiches du démo.
  clearOrganizationCache();
  assert.equal((await resolveOrganization(new Request('https://judo.licyo.example/'), env)).id, org.id);
  const accept = new FormData();
  accept.set('name', 'Claire Présidente');
  accept.set('password', 'une phrase de passe solide');
  accept.set('confirm', 'une phrase de passe solide');
  const ok = await invitation.onRequestPost({ request: new Request(`https://judo.licyo.example/admin/invitation/${token}`, { method: 'POST', body: accept }), env, params: { token } });
  assert.equal(ok.status, 303);
  const cookie = ok.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const admin = await isAuthed(new Request('https://judo.licyo.example/admin/dashboard', { headers: { Cookie: cookie } }), env);
  assert.equal(admin.organizationId, org.id);
  assert.equal(admin.role, 'owner');

  // Doublons refusés.
  const again = await post(env, editorCookie, { action: 'create', name: 'Autre', domain: 'judo.licyo.example', sport: 'judo', ownerEmail: 'x@judo.example' });
  assert.equal(again.status, 400);
  assert.match(await again.text(), /déjà rattaché/);
});

test('suspendre un club : son domaine et ses sessions ne répondent plus ; pas le club de connexion', async (t) => {
  const { env, editorCookie } = await setup(t);
  await post(env, editorCookie, { action: 'create', name: 'Tennis Club', domain: 'tennis.licyo.example', sport: 'tennis', ownerEmail: 'p@tennis.example' });
  const org = await env.DB.prepare("SELECT id FROM organizations WHERE slug = 'tennis-club'").first();
  const self = await post(env, editorCookie, { action: 'status', organizationId: DEMO_ORG_ID, status: 'suspended' });
  assert.equal(self.status, 400);
  assert.equal((await post(env, editorCookie, { action: 'status', organizationId: org.id, status: 'suspended' })).status, 200);
  clearOrganizationCache();
  assert.equal(await resolveOrganization(new Request('https://tennis.licyo.example/'), env), null);
  assert.equal((await post(env, editorCookie, { action: 'domain', organizationId: org.id, domain: 'www.tennis-club.example' })).status, 200);
  assert.equal((await post(env, editorCookie, { action: 'status', organizationId: org.id, status: 'active' })).status, 200);
  clearOrganizationCache();
  assert.equal((await resolveOrganization(new Request('https://www.tennis-club.example/'), env)).id, org.id);
});
