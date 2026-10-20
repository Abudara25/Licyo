// Champs propres au club (2026-10-20) : définis dans Paramètres, demandés à l'inscription (contrôlés côté serveur),
// visibles sur la fiche, modifiables, exportés, repris dans la réinscription.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { normalizeDefinitions, validateValues, displayRows, setCustomFields, getCustomFields } from '../functions/_shared/custom-fields.js';
import { setSportProfile } from '../functions/_shared/sport-profile.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as parametres from '../functions/admin/parametres.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as liste from '../functions/admin/inscriptions.js';
import * as reinscription from '../functions/reinscription/[token].js';
import { onRequestGet as categoriesApi } from '../functions/api/categories.js';
import { onRequestPost as inscriptionsApi } from '../functions/api/inscriptions.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const SITE = 'https://clubdemo.licyo.fr';
const BELT = { key: 'grade', label: 'Ceinture actuelle', type: 'select', options: ['Blanche', 'Jaune', 'Orange'], required: true };

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

test('définitions et valeurs contrôlées', () => {
  const defs = normalizeDefinitions([
    BELT,
    { label: 'Ceinture actuelle', type: 'text' },
    { label: '<b>Classement</b>', type: 'text' },
    { label: 'Liste vide', type: 'select', options: ['Seule'] },
    { label: '', type: 'text' },
    ...Array.from({ length: 20 }, (_, i) => ({ label: `Champ ${i}`, type: 'text' })),
  ]);
  assert.equal(defs.length, 10);
  assert.equal(new Set(defs.map((d) => d.key)).size, 10, 'clés uniques');
  assert.doesNotMatch(defs[2].label, /[<>]/);
  assert.ok(!defs.some((d) => d.label === 'Liste vide'));
  assert.equal(validateValues([BELT], {}).error, 'Champ manquant : Ceinture actuelle');
  assert.equal(validateValues([BELT], { grade: 'Violette' }).error, 'Valeur invalide : Ceinture actuelle');
  assert.deepEqual(validateValues([BELT], { grade: 'Jaune', inconnu: 'x' }).values, { grade: 'Jaune' });
  assert.equal(validateValues([{ key: 'poids', label: 'Poids', type: 'number' }], { poids: 'abc' }).error, 'Nombre attendu : Poids');
  assert.deepEqual(displayRows([BELT], '{"grade":"Jaune","ancien":"x"}'), [{ key: 'grade', label: 'Ceinture actuelle', value: 'Jaune' }, { key: 'ancien', label: 'ancien', value: 'x' }]);
});

test('parcours complet : suggestions du sport, formulaire public, fiche, modification, CSV, réinscription', async () => {
  clearOrganizationCache();
  const env = await fixture();
  const owner = await testUser(env, DEMO_ORG_ID, 'owner');
  const cookie = (await createSession(env, DEMO_ORG_ID, owner)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  await setSportProfile(env, DEMO_ORG_ID, { sport: 'judo' });

  const suggested = await post(env, cookie, parametres.onRequestPost, '/admin/parametres', { action: 'custom-suggest' });
  assert.equal(suggested.status, 200);
  assert.deepEqual((await getCustomFields(env, DEMO_ORG_ID)).map((f) => f.key), ['grade']);
  const added = await post(env, cookie, parametres.onRequestPost, '/admin/parametres', { action: 'custom-add', label: 'Club précédent', type: 'text' });
  assert.match(await added.text(), /Champs du formulaire : 2/);
  const badSelect = await post(env, cookie, parametres.onRequestPost, '/admin/parametres', { action: 'custom-add', label: 'Niveau', type: 'select', options: 'Un seul' });
  assert.equal(badSelect.status, 400);

  const api = await (await categoriesApi({ request: new Request(`${SITE}/api/categories`), env })).json();
  assert.deepEqual(api.customFields.map((f) => f.label), ['Ceinture actuelle', 'Club précédent']);

  const submit = (customFields) =>
    inscriptionsApi({
      request: new Request(`${SITE}/api/inscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() }, body: JSON.stringify({ ...validData, customFields }) }),
      env,
      waitUntil() {},
    });
  assert.equal((await submit({})).status, 400, 'ceinture obligatoire');
  assert.equal((await submit({ grade: 'Rouge' })).status, 400, 'choix hors liste');
  assert.equal((await submit({ grade: 'Orange', club_precedent: 'Dojo Exemple', hack: '<script>' })).status, 200);
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(DEMO_ORG_ID).first();
  assert.deepEqual(JSON.parse(row.custom_fields), { grade: 'Orange', club_precedent: 'Dojo Exemple' });

  const page = await (await admin(env, fiche.onRequestGet, new Request(`${SITE}/admin/inscriptions/${row.id}`, { headers: { Cookie: cookie } }), { id: String(row.id) })).text();
  assert.match(page, /Ceinture actuelle/);
  assert.match(page, /Dojo Exemple/);

  const edit = await (await admin(env, fiche.onRequestGet, new Request(`${SITE}/admin/inscriptions/${row.id}?edit=1`, { headers: { Cookie: cookie } }), { id: String(row.id) })).text();
  assert.match(edit, /name="cf_grade"/);
  const fields = {
    enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance, categorie: row.categorie, tailleMaillot: '', modePaiement: row.mode_paiement,
    parentPrenom: row.parent_prenom, parentNom: row.parent_nom, email: row.email, telephone: row.telephone || '0600000000', cf_grade: 'Jaune', cf_club_precedent: '',
  };
  const saved = await post(env, cookie, fiche.onRequestPost, `/admin/inscriptions/${row.id}`, fields, { id: String(row.id) });
  assert.ok([200, 302, 303].includes(saved.status), `enregistré (${saved.status})`);
  const after = await env.DB.prepare('SELECT custom_fields, taille_maillot FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual(JSON.parse(after.custom_fields), { grade: 'Jaune' });
  assert.equal(after.taille_maillot, '', 'taille facultative dans Modifier');

  const csv = await (await admin(env, liste.onRequestGet, new Request(`${SITE}/admin/inscriptions?format=csv`, { headers: { Cookie: cookie } }))).text();
  assert.match(csv.split('\r\n')[0], /"Ceinture actuelle","Club précédent"/);
  assert.match(csv, /"Jaune"/);

  await env.DB.prepare("UPDATE inscriptions SET reinscription_token = 'tok-cf-1', reinscription_token_expires_at = datetime('now', '+10 days'), saison = '2025-2026' WHERE id = ?").bind(row.id).run();
  const re = await (await reinscription.onRequestGet({ request: new Request(`${SITE}/reinscription/tok-cf-1`), env, params: { token: 'tok-cf-1' } })).text();
  assert.match(re, /data-custom-field="grade"/);
  assert.match(re, /<option value="Jaune" selected>Jaune<\/option>/);
});
