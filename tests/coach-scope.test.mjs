// Entraîneur limité à ses groupes (2026-10-20) : un compte sans la permission inscriptions.all ne voit que les inscrits
// des groupes qui lui sont attribués (Utilisateurs), et rien tant qu'aucun groupe ne l'est.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, isAuthed, inGroupScope } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as inscriptions from '../functions/admin/inscriptions.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as apercu from '../functions/admin/inscriptions/[id]/apercu.js';
import * as dashboard from '../functions/admin/dashboard.js';
import * as events from '../functions/admin/events.js';
import * as utilisateurs from '../functions/admin/utilisateurs.js';
import { listMembers, backfillOrganization } from '../functions/_shared/crm.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { normalizeGroupLabel, setGroupScope } from '../functions/_shared/accounts.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const SITE = 'https://clubdemo.licyo.fr';

function run(env, handler, request, params = {}) {
  let i = 0;
  const next = async () => (i < adminMiddleware.length ? adminMiddleware[i++]({ request, env, params, next, waitUntil() {} }) : handler({ request, env, params, waitUntil() {} }));
  return next();
}
const get = (env, cookie, handler, path, params) => run(env, handler, new Request(SITE + path, { headers: { Cookie: cookie } }), params);

async function setup() {
  clearOrganizationCache();
  const env = await fixture();
  const petit = await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Petitgroupe', categorie: 'U6 - U7', email: 'a@famille.example' });
  const grand = await seedInscription(env.DB, { enfant_prenom: 'Sami', enfant_nom: 'Grandgroupe', categorie: 'U8 - U9', naissance: '2018-05-01', email: 'b@famille.example' });
  const owner = await testUser(env, DEMO_ORG_ID, 'owner');
  const coach = await testUser(env, DEMO_ORG_ID, 'coach');
  const cookie = async (u) => (await createSession(env, DEMO_ORG_ID, u)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, petit, grand, owner, coach, ownerCookie: await cookie(owner), coachCookie: await cookie(coach) };
}

test('libellés comparés sans casse, espaces, tirets ni accents', () => {
  assert.equal(normalizeGroupLabel('U6 – U7'), normalizeGroupLabel('u6-u7'));
  assert.equal(normalizeGroupLabel('Débutants'), 'debutants');
  assert.equal(inGroupScope({ groupScope: null }, 'X'), true);
  assert.equal(inGroupScope({ groupScope: [] }, 'X'), false);
  assert.equal(inGroupScope({ groupScope: ['U6 - U7'] }, 'U6-U7'), true);
});

test('entraîneur sans groupe : ne voit aucun inscrit ; les autres rôles voient tout', async () => {
  const { env, petit, ownerCookie, coachCookie } = await setup();
  const coach = await isAuthed(new Request(SITE, { headers: { Cookie: coachCookie } }), env);
  assert.deepEqual(coach.groupScope, []);
  assert.equal((await isAuthed(new Request(SITE, { headers: { Cookie: ownerCookie } }), env)).groupScope, null);

  const list = await (await get(env, coachCookie, inscriptions.onRequestGet, '/admin/inscriptions')).text();
  assert.doesNotMatch(list, /Petitgroupe|Grandgroupe/);
  const all = await (await get(env, ownerCookie, inscriptions.onRequestGet, '/admin/inscriptions')).text();
  assert.match(all, /Petitgroupe/);
  assert.match(all, /Grandgroupe/);
  assert.equal((await get(env, coachCookie, fiche.onRequestGet, `/admin/inscriptions/${petit.id}`, { id: String(petit.id) })).status, 404);
});

test('groupes attribués par le responsable : listes, fiches, sous-pages et pages globales filtrées', async () => {
  const { env, petit, grand, coach, ownerCookie, coachCookie } = await setup();
  const body = new FormData();
  body.set('action', 'groups');
  body.set('userId', coach);
  body.append('groups', 'U6 - U7');
  body.set(CSRF_FIELD, await csrfTokenFor(new Request(SITE, { headers: { Cookie: ownerCookie } })));
  const saved = await run(env, utilisateurs.onRequestPost, new Request(`${SITE}/admin/utilisateurs`, { method: 'POST', body, headers: { Cookie: ownerCookie, Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } }));
  assert.equal(saved.status, 200);
  assert.match(await saved.text(), /Groupes enregistrés : U6 - U7/);

  const list = await (await get(env, coachCookie, inscriptions.onRequestGet, '/admin/inscriptions')).text();
  assert.match(list, /Petitgroupe/);
  assert.doesNotMatch(list, /Grandgroupe/);
  const csv = await (await get(env, coachCookie, inscriptions.onRequestGet, '/admin/inscriptions?format=csv')).text();
  assert.match(csv, /Petitgroupe/);
  assert.doesNotMatch(csv, /Grandgroupe/);

  assert.equal((await get(env, coachCookie, fiche.onRequestGet, `/admin/inscriptions/${petit.id}`, { id: String(petit.id) })).status, 200);
  assert.equal((await get(env, coachCookie, fiche.onRequestGet, `/admin/inscriptions/${grand.id}`, { id: String(grand.id) })).status, 404);
  assert.equal((await get(env, coachCookie, apercu.onRequestGet, `/admin/inscriptions/${grand.id}/apercu`, { id: String(grand.id) })).status, 404);
  assert.equal((await get(env, coachCookie, events.onRequestGet, '/admin/events')).status, 403, 'journal des e-mails : tous les groupes');

  const dash = await (await get(env, coachCookie, dashboard.onRequestGet, '/admin/dashboard')).text();
  assert.doesNotMatch(dash, /U8 - U9/, 'répartition limitée à ses groupes');

  // CRM : la liste des adhérents suit la même règle.
  await backfillOrganization(env, DEMO_ORG_ID, { dryRun: false });
  const scoped = await listMembers(env.DB, DEMO_ORG_ID, { groupScope: ['u6-u7'] });
  assert.deepEqual(scoped.rows.map((r) => r.inscription_id), [petit.id]);
  assert.equal((await listMembers(env.DB, DEMO_ORG_ID, { groupScope: [] })).total, 0);
  assert.equal((await listMembers(env.DB, DEMO_ORG_ID, {})).total, 2);

  // La page Utilisateurs n'est pas accessible à l'entraîneur.
  assert.equal((await get(env, coachCookie, utilisateurs.onRequestGet, '/admin/utilisateurs')).status, 403);
  // Un responsable n'est jamais limité, même si une valeur traîne en base.
  await setGroupScope(env.DB, DEMO_ORG_ID, (await env.DB.prepare("SELECT user_id FROM organization_memberships WHERE role = 'owner'").first()).user_id, ['X']);
  assert.equal((await isAuthed(new Request(SITE, { headers: { Cookie: ownerCookie } }), env)).groupScope, null);
});
