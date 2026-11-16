// Plusieurs groupes en pré-inscription (2026-11-04) : reprise de l'ancien réglage U10, ajout et suppression de
// groupes, années sans recouvrement, groupe choisi d'après l'année de naissance, plafond et ouverture par groupe,
// transfert depuis une fiche vers le bon groupe.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../functions/api/preinscriptions.js';
import * as admin from '../functions/admin/preinscriptions.js';
import * as transfer from '../functions/admin/inscriptions/[id]/preinscription.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { readSetting } from '../functions/_shared/settings-kv.js';
import { getPreinscriptionGroups, setPreinscriptionGroups, validateGroups, newGroupKey, groupForYear, MAX_GROUPS } from '../functions/_shared/preinscriptions.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://club-exemple.example';
const U10 = { open: true, groupe: 'U10', label: 'U10', anneeMin: 2017, anneeMax: 2017, capacity: 15 };
const U11 = { open: true, groupe: 'U11', label: 'U11', anneeMin: 2016, anneeMax: 2016, capacity: 2 };

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const postAdmin = (fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, String(v));
    return admin.onRequestPost({ request: new Request(`${HOST}/admin/preinscriptions`, { method: 'POST', body, headers: { Cookie: cookie } }), env });
  };
  const getAdmin = async (q = '') => (await admin.onRequestGet({ request: new Request(`${HOST}/admin/preinscriptions${q}`, { headers: { Cookie: cookie } }), env })).text();
  return { env, cookie, postAdmin, getAdmin };
}

let ip = 0;
const child = (n, naissance) => ({
  enfantPrenom: `Enfant${n}`, enfantNom: 'Test', naissance, paysNaissance: 'France', villeNaissance: 'Argenteuil', tailleMaillot: '10 ans',
  parentPrenom: 'Parent', parentNom: 'Test', email: `p${n}@example.fr`, telephone: '0600000000', rgpd: true,
});
async function post(env, body) {
  const waits = [];
  const res = await api.onRequestPost({
    request: new Request(`${HOST}/api/preinscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${(ip++ % 250) + 1}` }, body: JSON.stringify(body) }),
    env,
    waitUntil: (p) => waits.push(p),
  });
  await Promise.all(waits);
  return { status: res.status, body: await res.json() };
}

test('reprise de l’ancien réglage : le groupe U10 devient le premier groupe, rien à ressaisir', async () => {
  const { env } = await setup();
  assert.deepEqual(await getPreinscriptionGroups(env, A), [U10]);
  await setPreinscriptionGroups(env, A, []);
  assert.deepEqual(await getPreinscriptionGroups(env, A), [], 'liste vide enregistrée : aucun groupe, pas de valeur par défaut');
});

test('validation : clés uniques, années sans recouvrement, MAX_GROUPS au plus', () => {
  assert.ok(validateGroups([U10, U11]));
  assert.equal(validateGroups([U10, { ...U11, anneeMin: 2017 }]), null, 'années communes');
  assert.equal(validateGroups([U10, { ...U11, groupe: 'U10' }]), null, 'clé en double');
  const many = (n) => Array.from({ length: n }, (_, i) => ({ ...U11, groupe: `G${i}`, anneeMin: 2000 + i, anneeMax: 2000 + i }));
  assert.ok(MAX_GROUPS >= 20, 'beaucoup de groupes possibles');
  assert.equal(validateGroups(many(MAX_GROUPS)).length, MAX_GROUPS);
  assert.equal(validateGroups(many(MAX_GROUPS + 1)), null);
  assert.equal(newGroupKey('U12 - U13', [U10]), 'U12-U13');
  assert.equal(newGroupKey('u10', [U10]), 'U10-2');
  assert.equal(groupForYear([U10, U11], 2016).groupe, 'U11');
  assert.equal(groupForYear([U10, U11], 2015), null);
});

test('admin : ajout d’un groupe, recouvrement refusé, onglets, suppression d’un groupe vide seulement', async () => {
  const { env, postAdmin, getAdmin } = await setup();
  let res = await postAdmin({ action: 'add-group', label: 'U11', anneeMin: 2016, anneeMax: 2016, capacity: 2, open: 1 });
  assert.equal(res.headers.get('Location'), '/admin/preinscriptions?groupe=U11&msg=groupAdded');
  res = await postAdmin({ action: 'add-group', label: 'U9 bis', anneeMin: 2017, anneeMax: 2018, capacity: 5, open: 1 });
  assert.equal(res.headers.get('Location'), '/admin/preinscriptions?msg=groupInvalid');
  assert.deepEqual((await getPreinscriptionGroups(env, A)).map((g) => g.groupe), ['U10', 'U11']);
  assert.ok(JSON.parse(await readSetting(env, A, 'preinscription_config')).groupe === 'U10', 'ancien réglage = premier groupe (retour arrière)');

  const page = await getAdmin('?groupe=U11');
  assert.match(page, /Pré-inscriptions U11/);
  assert.match(page, /aria-label="Groupes en pré-inscription"/);
  assert.match(page, /Supprimer ce groupe/);

  await post(env, child(1, '2016-04-04'));
  res = await postAdmin({ action: 'delete-group', groupe: 'U11' });
  assert.equal(res.headers.get('Location'), '/admin/preinscriptions?groupe=U11&msg=groupNotEmpty');
  res = await postAdmin({ action: 'config', groupe: 'U11', label: 'U11', anneeMin: 2016, anneeMax: 2016, capacity: 3, open: 1 });
  assert.equal((await getPreinscriptionGroups(env, A)).find((g) => g.groupe === 'U11').capacity, 3);
  assert.equal((await getPreinscriptionGroups(env, A)).find((g) => g.groupe === 'U10').capacity, 15, 'autre groupe inchangé');
});

test('public : le groupe vient de l’année de naissance ; plafond et ouverture propres à chaque groupe', async () => {
  const { env } = await setup();
  await setPreinscriptionGroups(env, A, [U10, U11]);
  const s = await (await api.onRequestGet({ request: new Request(`${HOST}/api/preinscriptions`), env })).json();
  assert.deepEqual(s.groups.map((g) => [g.groupe, g.remaining]), [['U10', 15], ['U11', 2]]);

  assert.equal((await post(env, child(1, '2016-01-01'))).status, 200);
  assert.equal((await post(env, child(2, '2017-01-01'))).status, 200);
  const r = await post(env, child(3, '2016-02-02'));
  assert.equal(r.status, 200, 'dernière place U11');
  const rows = (await env.DB.prepare('SELECT groupe FROM preinscriptions ORDER BY id').all()).results.map((x) => x.groupe);
  assert.deepEqual(rows, ['U11', 'U10', 'U11']);

  const groups = await getPreinscriptionGroups(env, A);
  assert.ok(groups.find((g) => g.groupe === 'U11').openedAt, 'U11 complet : ouvert');
  assert.equal(groups.find((g) => g.groupe === 'U10').openedAt, null, 'U10 inchangé');
  assert.ok((await getCategoriesConfig(env, A)).categories.some((c) => c.label === 'U11'));

  const opened = await post(env, child(4, '2016-03-03'));
  assert.equal(opened.status, 409);
  assert.equal(opened.body.opened, true);
  assert.equal(opened.body.groupe, 'U11');
  const none = await post(env, child(5, '2014-01-01'));
  assert.equal(none.status, 400);
  assert.match(none.body.error, /trop âgé\(e\) pour les groupes en pré-inscription \(U10, U11\)/);
});

test('fiche : transfert vers le groupe de l’année de naissance', async () => {
  const { env, cookie } = await setup();
  await setPreinscriptionGroups(env, A, [U10, U11]);
  const row = await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Test', naissance: '2016-06-06', ville_naissance: 'Ermont', pays_naissance: 'France' });
  const res = await transfer.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}/preinscription`, { method: 'POST', headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  assert.equal(res.headers.get('Location'), '/admin/preinscriptions?groupe=U11&msg=transfert');
  assert.equal((await env.DB.prepare('SELECT groupe FROM preinscriptions').first()).groupe, 'U11');
});

// Liste d'attente (2026-11-04) : case « Créer automatiquement une catégorie » décochée. Club déjà établi qui libère
// des places dans une catégorie existante : rien n'est créé, le club est prévenu une fois et invite chaque famille.
test("liste d'attente : groupe complet = alerte au club, aucune catégorie, aucune invitation ; invitation à la main", async () => {
  const { env, postAdmin, getAdmin } = await setup();
  const sent = [];
  env.BREVO_API_KEY = 'test';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('brevo')) {
      sent.push(JSON.parse(init.body));
      return new Response('{"messageId":"m"}', { status: 201 });
    }
    return realFetch(url, init);
  };
  try {
    const WAIT = { ...U11, autoCategory: false };
    await setPreinscriptionGroups(env, A, [U10, WAIT]);
    const before = (await getCategoriesConfig(env, A)).categories.length;
    assert.equal((await post(env, child(1, '2016-03-03'))).status, 200);
    assert.ok(sent.some((m) => /liste d'attente du groupe U11/.test(m.textContent)), 'confirmation famille : liste d’attente');
    sent.length = 0;
    assert.equal((await post(env, child(2, '2016-04-04'))).status, 200);
    const cats = (await getCategoriesConfig(env, A)).categories;
    assert.equal(cats.length, before, 'aucune catégorie créée');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions WHERE invited_at IS NOT NULL').first()).n, 0, 'aucune famille invitée');
    assert.equal(sent.filter((m) => /Liste d'attente U11 complète/.test(m.subject)).length, 1, 'une alerte club');
    const g = (await getPreinscriptionGroups(env, A)).find((x) => x.groupe === 'U11');
    assert.ok(g.fullNotifiedAt && !g.openedAt, 'groupe non ouvert, alerte notée');

    // Aucune catégorie active pour 2016 : pas de bouton, invitation refusée.
    let page = await getAdmin('?groupe=U11');
    assert.match(page, /Liste complète/);
    assert.match(page, /Aucune catégorie d'inscription active ne couvre ces années/);
    assert.doesNotMatch(page, /name="action" value="invite"/);
    const id = (await env.DB.prepare("SELECT id FROM preinscriptions WHERE groupe = 'U11' ORDER BY id LIMIT 1").first()).id;
    assert.match((await postAdmin({ action: 'invite', id })).headers.get('Location'), /msg=inviteNoCategory/);

    // Catégorie existante couvrant 2016 : bouton présent, une seule invitation même en double clic.
    const cfg = await getCategoriesConfig(env, A);
    const { setCategoriesConfig } = await import('../functions/_shared/settings-kv.js');
    await setCategoriesConfig(env, A, { ...cfg, categories: [...cfg.categories, { id: 'u10-u11', label: 'U10 - U11', anneeMin: 2015, anneeMax: 2016, active: true }] }, { expectedVersion: cfg.configVersion });
    page = await getAdmin('?groupe=U11');
    assert.match(page, /name="action" value="invite"/);
    sent.length = 0;
    assert.match((await postAdmin({ action: 'invite', id })).headers.get('Location'), /msg=invited/);
    assert.match((await postAdmin({ action: 'invite', id })).headers.get('Location'), /msg=inviteAlready/);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Une place pour Enfant1 en U11/);

    // Place libérée : l'alerte pourra repartir à la prochaine liste complète.
    await postAdmin({ action: 'delete', id });
    assert.equal((await getPreinscriptionGroups(env, A)).find((x) => x.groupe === 'U11').fullNotifiedAt, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('case « Créer automatiquement une catégorie » : décochée par défaut pour un nouveau groupe, cochée pour U10', async () => {
  const { env, postAdmin, getAdmin } = await setup();
  const page = await getAdmin();
  assert.match(page, /name="autoCategory" value="1" checked/, 'U10 : comportement d’origine');
  assert.match(page, /id="nouveau-groupe"[\s\S]*name="autoCategory" value="1">/, 'nouveau groupe : décochée');
  await postAdmin({ action: 'add-group', label: 'U12', capacity: 5, anneeMin: 2015, anneeMax: 2015, open: 1 });
  assert.equal((await getPreinscriptionGroups(env, A)).find((g) => g.groupe === 'U12').autoCategory, false);
  await postAdmin({ action: 'config', groupe: 'U12', label: 'U12', capacity: 5, anneeMin: 2015, anneeMax: 2015, open: 1, autoCategory: 1 });
  assert.equal((await getPreinscriptionGroups(env, A)).find((g) => g.groupe === 'U12').autoCategory, true);
});
