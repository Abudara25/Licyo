// Présences (2026-10-20) : séances proposées d'après le planning, appel des inscrits du groupe, entraîneur limité à
// ses groupes, bilan par enfant sur la fiche, isolation entre clubs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as presences from '../functions/admin/presences.js';
import * as appel from '../functions/admin/presences/[id].js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import { setGroupScope } from '../functions/_shared/accounts.js';
import { todaySuggestions, todayParis, createSession as createAttendance, saveMarks, attendanceSummary, getSession } from '../functions/_shared/attendance.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const SITE = 'https://clubdemo.licyo.fr';
function admin(env, handler, request, params = {}) {
  let i = 0;
  const next = async () => (i < adminMiddleware.length ? adminMiddleware[i++]({ request, env, params, next, waitUntil() {} }) : handler({ request, env, params, waitUntil() {} }));
  return next();
}
async function post(env, cookie, handler, path, fields, params) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set(CSRF_FIELD, await csrfTokenFor(new Request(SITE, { headers: { Cookie: cookie } })));
  return admin(env, handler, new Request(SITE + path, { method: 'POST', body, headers: { Cookie: cookie, Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } }), params);
}
const cookieFor = async (env, user) => (await createSession(env, DEMO_ORG_ID, user)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];

async function setup() {
  clearOrganizationCache();
  const env = await fixture();
  await getCategoriesConfig(env, DEMO_ORG_ID); // groupes et créneau de référence du club de démo (jeudi 17h)
  const lina = await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Aubry', categorie: 'U6 - U7', email: 'a@f.example' });
  const noa = await seedInscription(env.DB, { enfant_prenom: 'Noa', enfant_nom: 'Bernard', categorie: 'U6 - U7', email: 'b@f.example' });
  const sami = await seedInscription(env.DB, { enfant_prenom: 'Sami', enfant_nom: 'Grand', categorie: 'U8 - U9', naissance: '2018-05-01', email: 'c@f.example' });
  const archived = await seedInscription(env.DB, { enfant_prenom: 'Ancien', enfant_nom: 'Archivé', categorie: 'U6 - U7', email: 'd@f.example', archived_at: '2026-01-01 00:00:00' });
  return { env, lina, noa, sami, archived };
}

test('planning : séances du jour proposées par groupe (créneau commun), sans doublon ni groupe hors champ', async () => {
  const { env } = await setup();
  const thursday = new Date('2026-10-22T10:00:00Z');
  assert.equal(todayParis(thursday).weekday, 4);
  const all = await todaySuggestions(env.DB, DEMO_ORG_ID, null, thursday);
  assert.deepEqual(all.map((s) => s.groupLabel), ['U6 - U7', 'U8 - U9']);
  assert.deepEqual((await todaySuggestions(env.DB, DEMO_ORG_ID, ['U8-U9'], thursday)).map((s) => s.groupLabel), ['U8 - U9']);
  assert.deepEqual(await todaySuggestions(env.DB, DEMO_ORG_ID, null, new Date('2026-10-21T10:00:00Z')), [], 'mercredi : rien au planning');
  await createAttendance(env.DB, DEMO_ORG_ID, { groupLabel: 'U6 - U7', date: '2026-10-22', startTime: all[0].startTime });
  assert.deepEqual((await todaySuggestions(env.DB, DEMO_ORG_ID, null, thursday)).map((s) => s.groupLabel), ['U8 - U9'], 'déjà créée');
});

test('appel : inscrits actifs du groupe, statuts enregistrés, bilan sur la fiche ; entraîneur limité ; autre club isolé', async () => {
  const { env, lina, noa, sami, archived } = await setup();
  const coach = await testUser(env, DEMO_ORG_ID, 'coach');
  await setGroupScope(env.DB, DEMO_ORG_ID, coach, ['U6 - U7']);
  const coachCookie = await cookieFor(env, coach);

  // Création par l'entraîneur : son groupe oui, l'autre non.
  const created = await post(env, coachCookie, presences.onRequestPost, '/admin/presences', { action: 'create', group: 'U6 - U7', date: '2026-10-22', time: '17:00' });
  assert.equal(created.status, 303);
  const id = Number(created.headers.get('Location').split('/').pop());
  const again = await post(env, coachCookie, presences.onRequestPost, '/admin/presences', { action: 'create', group: 'U6 - U7', date: '2026-10-22', time: '17:00' });
  assert.equal(Number(again.headers.get('Location').split('/').pop()), id, 'double clic : même séance');
  assert.equal((await post(env, coachCookie, presences.onRequestPost, '/admin/presences', { action: 'create', group: 'U8 - U9', date: '2026-10-22' })).status, 403);

  const page = await (await admin(env, appel.onRequestGet, new Request(`${SITE}/admin/presences/${id}`, { headers: { Cookie: coachCookie } }), { id: String(id) })).text();
  assert.match(page, /Lina Aubry/);
  assert.match(page, /Noa Bernard/);
  assert.doesNotMatch(page, /Sami Grand|Ancien Archivé/);

  const saved = await post(env, coachCookie, appel.onRequestPost, `/admin/presences/${id}`, { action: 'save', [`m_${lina.id}`]: 'present', [`m_${noa.id}`]: 'excused', [`m_${sami.id}`]: 'present', [`m_${archived.id}`]: 'present' }, { id: String(id) });
  assert.equal(saved.status, 303);
  const { results } = await env.DB.prepare('SELECT inscription_id, status FROM attendance_marks WHERE organization_id = ? ORDER BY inscription_id').bind(DEMO_ORG_ID).all();
  assert.deepEqual(results.map((r) => [r.inscription_id, r.status]), [[lina.id, 'present'], [noa.id, 'excused']], 'hors groupe et archivés ignorés');
  assert.equal((await env.DB.prepare('SELECT status FROM attendance_sessions WHERE id = ?').bind(id).first()).status, 'done');
  assert.equal((await post(env, coachCookie, appel.onRequestPost, `/admin/presences/${id}`, { action: 'save', [`m_${lina.id}`]: 'hacked' }, { id: String(id) })).status, 400);

  // Séance d'un autre groupe : introuvable pour l'entraîneur.
  const other = await createAttendance(env.DB, DEMO_ORG_ID, { groupLabel: 'U8 - U9', date: '2026-10-22' });
  assert.equal((await admin(env, appel.onRequestGet, new Request(`${SITE}/admin/presences/${other.id}`, { headers: { Cookie: coachCookie } }), { id: String(other.id) })).status, 404);

  // Bilan sur la fiche (vue du responsable).
  assert.deepEqual(await attendanceSummary(env.DB, DEMO_ORG_ID, lina.id), { total: 1, present: 1, excused: 0 });
  const owner = await testUser(env, DEMO_ORG_ID, 'owner');
  const fichePage = await (await admin(env, fiche.onRequestGet, new Request(`${SITE}/admin/inscriptions/${lina.id}`, { headers: { Cookie: await cookieFor(env, owner) } }), { id: String(lina.id) })).text();
  assert.match(fichePage, /1 sur 1 séance/);

  // Rôles sans droit d'appel : consultation seulement ; bénévole : aucun accès.
  const treasurer = await cookieFor(env, await testUser(env, DEMO_ORG_ID, 'treasurer'));
  assert.equal((await admin(env, appel.onRequestGet, new Request(`${SITE}/admin/presences/${id}`, { headers: { Cookie: treasurer } }), { id: String(id) })).status, 200);
  assert.equal((await post(env, treasurer, appel.onRequestPost, `/admin/presences/${id}`, { action: 'save' }, { id: String(id) })).status, 403);
  const volunteer = await cookieFor(env, await testUser(env, DEMO_ORG_ID, 'volunteer'));
  assert.equal((await admin(env, presences.onRequestGet, new Request(`${SITE}/admin/presences`, { headers: { Cookie: volunteer } }))).status, 403);

  // Isolation : la séance n'existe pas pour une autre organisation ; un statut ne s'applique qu'aux inscrits du club.
  assert.equal(await getSession(env.DB, 'org_autre', id), null);
  const session = await getSession(env.DB, DEMO_ORG_ID, id);
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_autre', 'autre', 'Autre')").run();
  const foreign = await seedInscription(env.DB, { organization_id: 'org_autre', categorie: 'U6 - U7', email: 'e@f.example' });
  await saveMarks(env.DB, DEMO_ORG_ID, session, { [foreign.id]: 'present' });
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM attendance_marks WHERE inscription_id = ?').bind(foreign.id).first()).n, 0);
});
