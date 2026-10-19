// Pré-inscription U10 (liste d'intérêt) : plafond, doublons, âge, fermeture, isolation par organisation, admin.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../functions/api/preinscriptions.js';
import * as admin from '../functions/admin/preinscriptions.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getPreinscriptionConfig, setPreinscriptionConfig, publicState, ensurePreinscriptionsTable } from '../functions/_shared/preinscriptions.js';
import { buildPreinscriptionConfirmation, buildPreinscriptionGroupOpened } from '../functions/_shared/confirmation-email.js';
import { openPreinscriptionGroupIfFull } from '../functions/_shared/preinscription-opening.js';
import { getCategoriesConfig, setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_exemple_test';
const HOST = 'clubdemo.licyo.fr';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'exemple', 'Exemple')").bind(B).run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('exemple.test', ?)").bind(B).run();
  return env;
}

let ip = 0;
const child = (n, extra = {}) => ({
  enfantPrenom: `Enfant${n}`,
  enfantNom: 'Test',
  naissance: '2017-05-12',
  paysNaissance: 'France',
  villeNaissance: 'Argenteuil',
  tailleMaillot: '10 ans',
  parentPrenom: 'Parent',
  parentNom: 'Test',
  email: `p${n}@example.fr`,
  telephone: '0600000000',
  rgpd: true,
  ...extra,
});
const post = (env, body, host = HOST) => {
  const waits = [];
  return api
    .onRequestPost({
      request: new Request(`https://${host}/api/preinscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `203.0.113.${(ip++ % 250) + 1}` },
        body: JSON.stringify(body),
      }),
      env,
      waitUntil: (p) => waits.push(p),
    })
    .then(async (res) => {
      await Promise.all(waits);
      return { status: res.status, body: await res.json() };
    });
};
const state = async (env, host = HOST) => (await api.onRequestGet({ request: new Request(`https://${host}/api/preinscriptions`), env })).json();

test('configuration par défaut : U10, nés en 2017, 15 places, pour Sportville seulement', async () => {
  const env = await setup();
  assert.deepEqual(await getPreinscriptionConfig(env, A), { open: true, groupe: 'U10', label: 'U10', anneeMin: 2017, anneeMax: 2017, capacity: 15 });
  assert.equal(await getPreinscriptionConfig(env, B), null);
  const s = await state(env);
  assert.equal(s.remaining, 15);
  assert.equal(s.open, true);
  assert.equal((await state(env, 'exemple.test')).available, false);
});

test('plafond de 15 : la 15e ouvre le groupe (catégorie créée, familles invitées), la 16e est renvoyée vers l’inscription', async () => {
  const env = await setup();
  for (let i = 1; i <= 14; i++) assert.equal((await post(env, child(i))).status, 200, `enfant ${i}`);
  assert.equal((await getCategoriesConfig(env, A)).categories.some((c) => c.anneeMin === 2017), false, 'pas de catégorie avant le quota');
  assert.equal((await post(env, child(15))).status, 200);

  const categories = (await getCategoriesConfig(env, A)).categories;
  const u10 = categories.find((c) => c.label === 'U10');
  assert.ok(u10, 'catégorie U10 créée');
  assert.deepEqual([u10.anneeMin, u10.anneeMax, u10.active], [2017, 2017, true]);
  assert.deepEqual(categories.map((c) => c.label), ['U6 - U7', 'U8 - U9', 'U10'], 'les catégories existantes sont conservées');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions WHERE invited_at IS NOT NULL').first()).n, 15, 'les 15 familles sont invitées');

  const refused = await post(env, child(16));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.opened, true);
  const s = await state(env);
  assert.deepEqual([s.count, s.remaining, s.opened, s.open], [15, 0, true, false]);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 15);

  // Rejoué (réglages enregistrés, place libérée puis reprise) : ni seconde catégorie, ni seconde invitation.
  const again = await openPreinscriptionGroupIfFull(env, A, 'https://clubdemo.licyo.fr');
  assert.deepEqual([again.status, again.invited, again.created], ['opened', 0, false]);
  assert.equal((await getCategoriesConfig(env, A)).categories.filter((c) => c.anneeMin === 2017).length, 1);
});

test('ouverture : une catégorie qui couvre déjà les années est réactivée, jamais dupliquée', async () => {
  const env = await setup();
  const cfg = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...cfg, categories: [...cfg.categories, { id: 'u10-u11', label: 'U10 - U11', anneeMin: 2016, anneeMax: 2017, active: false }] }, { expectedVersion: cfg.configVersion });
  await setPreinscriptionConfig(env, A, { ...(await getPreinscriptionConfig(env, A)), capacity: 2 });
  await post(env, child(1));
  await post(env, child(2));
  const categories = (await getCategoriesConfig(env, A)).categories;
  assert.deepEqual(categories.filter((c) => c.anneeMin <= 2017 && c.anneeMax >= 2017).map((c) => [c.label, c.active]), [['U10 - U11', true]]);
});

test('envois simultanés pour la dernière place : jamais plus que le plafond', async () => {
  const env = await setup();
  await setPreinscriptionConfig(env, A, { ...(await getPreinscriptionConfig(env, A)), capacity: 3 });
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => post(env, child(i))));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 3);
});

test('doublon (même enfant, accents et casse ignorés) refusé', async () => {
  const env = await setup();
  assert.equal((await post(env, child(1, { enfantPrenom: 'Éloïse' }))).status, 200);
  const dup = await post(env, child(1, { enfantPrenom: 'eloise', email: 'autre@example.fr' }));
  assert.equal(dup.status, 409);
  assert.equal(dup.body.duplicate, true);
});

test('âge, champs, consentement et fermeture contrôlés côté serveur', async () => {
  const env = await setup();
  assert.equal((await post(env, child(1, { naissance: '2018-01-01' }))).status, 400);
  assert.equal((await post(env, child(1, { naissance: '2017-02-30' }))).status, 400);
  assert.equal((await post(env, child(1, { rgpd: false }))).status, 400);
  assert.equal((await post(env, child(1, { email: 'pas-un-email' }))).status, 400);
  assert.equal((await post(env, child(1, { telephone: '' }))).status, 400);
  assert.equal((await post(env, child(1, { commentaire: 'x'.repeat(501) }))).status, 400);
  await setPreinscriptionConfig(env, A, { ...(await getPreinscriptionConfig(env, A)), open: false });
  const closed = await post(env, child(1));
  assert.equal(closed.status, 409);
  assert.equal(closed.body.closed, true);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 0);
});

test("organisation sans pré-inscription : rien n'est écrit ; organization_id du navigateur ignoré", async () => {
  const env = await setup();
  assert.equal((await post(env, child(1), 'exemple.test')).status, 404);
  assert.equal((await post(env, { ...child(2), organizationId: B, organization_id: B })).status, 200);
  const rows = (await env.DB.prepare('SELECT organization_id FROM preinscriptions').all()).results;
  assert.deepEqual(rows.map((r) => r.organization_id), [A]);
});

test('admin : compteur, liste échappée, CSV, suppression, réglages ; isolé par organisation', async () => {
  const env = await setup();
  await post(env, child(1, { enfantPrenom: '<script>x</script>', commentaire: '=HYPERLINK("x")' }));
  await post(env, child(2));
  const cookie = async (org) => (await createSession(env, org)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const cookieA = await cookie(A);
  const get = async (c, query = '') => admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions${query}`, { headers: { Cookie: c } }), env });

  const page = await (await get(cookieA)).text();
  assert.match(page, /2<small> \/ 15<\/small>/);
  assert.ok(!page.includes('<script>x</script>') && page.includes('&lt;script&gt;'));

  const csv = await (await get(cookieA, '?format=csv')).text();
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), 'formule neutralisée');

  // Une autre organisation ne voit rien.
  const pageB = await (await get(await cookie(B))).text();
  assert.ok(pageB.includes('Aucune pré-inscription') && !pageB.includes('Enfant2'));

  const form = (fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return admin.onRequestPost({ request: new Request(`https://${HOST}/admin/preinscriptions`, { method: 'POST', headers: { Cookie: cookieA }, body }), env });
  };
  const id = (await env.DB.prepare("SELECT id FROM preinscriptions WHERE enfant_prenom = 'Enfant2'").first()).id;
  assert.match((await form({ action: 'delete', id: String(id) })).headers.get('Location'), /msg=deleted/);
  assert.match((await form({ action: 'config', label: 'U10', capacity: '20', anneeMin: '2016', anneeMax: '2017' })).headers.get('Location'), /msg=saved/);
  const config = await getPreinscriptionConfig(env, A);
  assert.deepEqual([config.open, config.capacity, config.anneeMin], [false, 20, 2016]);
  assert.match((await form({ action: 'config', label: 'U10', capacity: '0', anneeMin: '2017', anneeMax: '2017' })).headers.get('Location'), /msg=invalid/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 1);
});

test("état public : aucun nom, et l'e-mail ne présente jamais la pré-inscription comme une inscription", () => {
  const s = publicState({ open: true, groupe: 'U10', label: 'U10', anneeMin: 2017, anneeMax: 2017, capacity: 15 }, 4);
  assert.deepEqual(Object.keys(s).sort(), ['anneeMax', 'anneeMin', 'available', 'capacity', 'closed', 'count', 'full', 'label', 'open', 'opened', 'remaining'].sort());
  const mail = buildPreinscriptionConfirmation(child(1), { label: 'U10', capacity: 15, anneeMin: 2017, anneeMax: 2017 }, 'https://clubdemo.licyo.fr');
  assert.match(mail.text, /pas encore une inscription/);
  assert.match(mail.html, /rien à payer/);
  const invite = buildPreinscriptionGroupOpened({ enfant_prenom: 'Lou', enfant_nom: 'Test', parent_prenom: 'Sam', email: 'p@example.fr' }, { label: 'U10', capacity: 15, anneeMin: 2017, anneeMax: 2017 }, 'https://clubdemo.licyo.fr');
  assert.match(invite.subject, /groupe U10 ouvre/);
  assert.match(invite.text, /https:\/\/clubdemo\.licyo\.fr\/inscription/);
  assert.match(invite.text, /n'était pas une inscription/);
});

test('lieu de naissance : obligatoire, borné, naissance à l’étranger acceptée, stocké et exporté', async () => {
  const env = await setup();
  for (const bad of [{ paysNaissance: '' }, { villeNaissance: '   ' }, { villeNaissance: 'x'.repeat(101) }, { paysNaissance: 'France' }, { villeNaissance: 42 }]) {
    assert.equal((await post(env, child(1, bad))).status, 400, JSON.stringify(bad));
  }
  await ensurePreinscriptionsTable(env.DB);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 0);
  assert.equal((await post(env, child(2, { paysNaissance: '  Maroc ', villeNaissance: 'Casablanca' }))).status, 200);
  const row = await env.DB.prepare('SELECT ville_naissance, pays_naissance FROM preinscriptions').first();
  assert.deepEqual({ ...row }, { ville_naissance: 'Casablanca', pays_naissance: 'Maroc' });

  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const res = await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions?format=csv`, { headers: { Cookie: cookie } }), env });
  const csv = await res.text();
  assert.match(csv, /"Ville de naissance";"Pays de naissance"/);
  assert.match(csv, /"Casablanca";"Maroc"/);
});

test('anciennes pré-inscriptions (table sans les colonnes) : colonnes ajoutées, fiche consultable et complétable', async () => {
  const env = await setup();
  // Table telle que créée à la première mise en ligne, avec une ligne existante.
  await env.DB.prepare(`CREATE TABLE preinscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, organization_id TEXT NOT NULL REFERENCES organizations(id), groupe TEXT NOT NULL,
    enfant_prenom TEXT NOT NULL, enfant_nom TEXT NOT NULL, naissance TEXT NOT NULL, parent_prenom TEXT NOT NULL,
    parent_nom TEXT NOT NULL, email TEXT NOT NULL, telephone TEXT NOT NULL, commentaire TEXT, dedup_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')))`).run();
  await env.DB.prepare(`INSERT INTO preinscriptions (organization_id, groupe, enfant_prenom, enfant_nom, naissance, parent_prenom, parent_nom, email, telephone, dedup_key)
    VALUES (?, 'U10', 'Ancien', 'Dossier', '2017-01-02', 'P', 'D', 'a@example.fr', '0600000000', 'ancien|dossier|2017-01-02')`).bind(A).run();

  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const page = await (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(page, /Ancien Dossier/);
  assert.equal((page.match(/À compléter<\/span>/g) || []).length, 2, 'lieu de naissance et tenue à compléter');
  const columns = (await env.DB.prepare('PRAGMA table_info(preinscriptions)').all()).results.map((c) => c.name);
  assert.ok(columns.includes('ville_naissance') && columns.includes('pays_naissance'));

  const id = (await env.DB.prepare('SELECT id FROM preinscriptions').first()).id;
  const form = (fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return admin.onRequestPost({ request: new Request(`https://${HOST}/admin/preinscriptions`, { method: 'POST', headers: { Cookie: cookie }, body }), env });
  };
  assert.match((await form({ action: 'birthplace', id: String(id), paysNaissance: '', villeNaissance: 'X', tailleMaillot: '10 ans' })).headers.get('Location'), /birthplaceInvalid/);
  assert.match((await form({ action: 'birthplace', id: String(id), paysNaissance: 'France', villeNaissance: 'Ermont', tailleMaillot: 'XXL' })).headers.get('Location'), /sizeInvalid/);
  assert.match((await form({ action: 'birthplace', id: String(id), paysNaissance: 'France', villeNaissance: '<b>Ermont</b>', tailleMaillot: '10 ans' })).headers.get('Location'), /msg=birthplace$/);
  assert.equal((await env.DB.prepare('SELECT taille_maillot FROM preinscriptions WHERE id = ?').bind(id).first()).taille_maillot, '10 ans');
  const after = await (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions`, { headers: { Cookie: cookie } }), env })).text();
  assert.ok(after.includes('&lt;b&gt;Ermont&lt;/b&gt;') && !after.includes('<b>Ermont</b>'));
});

test('second responsable légal facultatif : contrôlé, stocké, affiché, exporté, destinataire de la confirmation', async (t) => {
  const env = { ...(await setup()), BREVO_API_KEY: 'cle-de-test' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  // Rempli à moitié : prénom et nom exigés ; e-mail invalide refusé.
  assert.equal((await post(env, child(1, { parent2Email: 'b@example.fr' }))).status, 400);
  assert.equal((await post(env, child(1, { parent2Prenom: 'Sam', parent2Nom: 'Test', parent2Email: 'pas-un-email' }))).status, 400);
  // Absent : accepté, rien de stocké.
  assert.equal((await post(env, child(2))).status, 200);
  // Complet : stocké et destinataire de la confirmation.
  sent.length = 0;
  assert.equal((await post(env, child(3, { parent2Prenom: 'Sam', parent2Nom: '<b>Test</b>', parent2Email: 'sam@example.fr', parent2Telephone: '0611111111' }))).status, 200);
  const rows = (await env.DB.prepare('SELECT enfant_prenom, parent2_prenom, parent2_email FROM preinscriptions ORDER BY id').all()).results.map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { enfant_prenom: 'Enfant2', parent2_prenom: null, parent2_email: null },
    { enfant_prenom: 'Enfant3', parent2_prenom: 'Sam', parent2_email: 'sam@example.fr' },
  ]);
  const family = sent.find((b) => /Pré-inscription U10 de/.test(b.subject));
  assert.deepEqual(family.to.map((r) => r.email), ['p3@example.fr', 'sam@example.fr']);
  assert.match(family.textContent, /^Bonjour Parent et Sam,/);

  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const page = await (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions`, { headers: { Cookie: cookie } }), env })).text();
  assert.ok(page.includes('Sam &lt;b&gt;Test&lt;/b&gt;') && page.includes('2e responsable') && !page.includes('<b>Test</b>'));
  assert.match(page, /href="\/admin\/email\?groupe=preinscriptions"/);
  assert.match(page, /data-copy="p2@example\.fr, p3@example\.fr, sam@example\.fr"/);
  const csv = await (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions?format=csv`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(csv, /"E-mail 2e responsable"/);
  assert.match(csv, /"sam@example\.fr";"0611111111"/);
});

test('âge hors du groupe : message « trop jeune » / « trop âgé(e) » côté serveur', async () => {
  const env = await setup();
  const young = await post(env, child(1, { naissance: '2019-03-03' }));
  assert.equal(young.status, 400);
  assert.equal(young.body.age, 'young');
  assert.match(young.body.error, /trop jeune pour le groupe U10/);
  const old = await post(env, child(2, { naissance: '2015-03-03' }));
  assert.equal(old.body.age, 'old');
  assert.match(old.body.error, /trop âgé\(e\)/);
});

test('admin : transfert d’une inscription vers la pré-inscription (copie, corbeille, refus hors âge, doublon, plafond)', async () => {
  const { seedInscription } = await import('./helpers/inscriptions.mjs');
  const transfer = await import('../functions/admin/inscriptions/[id]/preinscription.js');
  const fiche = await import('../functions/admin/inscriptions/[id].js');
  const env = await setup();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const run = (id) => transfer.onRequestPost({ request: new Request(`https://${HOST}/admin/inscriptions/${id}/preinscription`, { method: 'POST', headers: { Cookie: cookie } }), env, params: { id: String(id) }, waitUntil: () => {} });
  const page = async (id) => (await fiche.onRequestGet({ request: new Request(`https://${HOST}/admin/inscriptions/${id}`, { headers: { Cookie: cookie } }), env, params: { id: String(id) } })).text();

  const u10 = await seedInscription(env.DB, { enfant_prenom: 'Lou', naissance: '2017-06-01', categorie: 'U8 - U9', ville_naissance: 'Ermont', pays_naissance: 'France', telephone: '0600000000', parent2_prenom: 'Sam', parent2_nom: 'Durand', parent2_email: 'sam@example.fr' });
  const u8 = await seedInscription(env.DB, { enfant_prenom: 'Noé', naissance: '2018-06-01', categorie: 'U8 - U9', email: 'noe@example.fr' });

  // Bloc proposé seulement pour l'année du groupe.
  assert.match(await page(u10.id), /Transférer en pré-inscription U10/);
  assert.doesNotMatch(await page(u8.id), /Transférer en pré-inscription/);
  assert.match((await run(u8.id)).headers.get('Location'), /transfertError=/);

  const res = await run(u10.id);
  assert.equal(res.headers.get('Location'), '/admin/preinscriptions?msg=transfert');
  const pre = { ...(await env.DB.prepare('SELECT * FROM preinscriptions').first()) };
  assert.deepEqual([pre.enfant_prenom, pre.naissance, pre.ville_naissance, pre.parent2_email, pre.taille_maillot], ['Lou', '2017-06-01', 'Ermont', 'sam@example.fr', '6 ans']);
  assert.match(pre.commentaire, new RegExp(`inscription n° ${u10.id}`));
  const archived = await env.DB.prepare('SELECT archived_at, archive_motif FROM inscriptions WHERE id = ?').bind(u10.id).first();
  assert.ok(archived.archived_at);
  assert.equal(archived.archive_motif, 'preinscription');
  // Plus dans la corbeille (l'enfant n'est qu'à un endroit) ; fiche d'origine accessible depuis la carte U10.
  const list = await import('../functions/admin/inscriptions.js');
  const corbeille = await (await list.onRequestGet({ request: new Request(`https://${HOST}/admin/inscriptions?view=archive`, { headers: { Cookie: cookie } }), env })).text();
  assert.doesNotMatch(corbeille, /Lou Durand/);
  const u10Page = await (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(u10Page, new RegExp(`href="/admin/inscriptions/${u10.id}"[^>]*>.*Fiche d'inscription d'origine`));
  // Fiche déjà à la corbeille : refus, rien de dupliqué.
  assert.match((await run(u10.id)).headers.get('Location'), /transfertError=/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 1);

  // Liste pleine : refus, l'inscription reste active.
  await setPreinscriptionConfig(env, A, { ...(await getPreinscriptionConfig(env, A)), capacity: 1 });
  const other = await seedInscription(env.DB, { enfant_prenom: 'Zoé', naissance: '2017-02-02', email: 'zoe@example.fr' });
  assert.match((await run(other.id)).headers.get('Location'), /places/);
  assert.equal((await env.DB.prepare('SELECT archived_at FROM inscriptions WHERE id = ?').bind(other.id).first()).archived_at, null);
});

test('taille de tenue : obligatoire, liste fermée, stockée, exportée, reprise au transfert', async () => {
  const env = await setup();
  assert.equal((await post(env, child(1, { tailleMaillot: '' }))).status, 400);
  assert.equal((await post(env, child(1, { tailleMaillot: 'XXL' }))).status, 400);
  assert.equal((await post(env, child(1, { tailleMaillot: '12 ans' }))).status, 200);
  assert.equal((await env.DB.prepare('SELECT taille_maillot FROM preinscriptions').first()).taille_maillot, '12 ans');
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const csv = await (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions?format=csv`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(csv, /"Pays de naissance";"Taille de tenue"/);
  assert.match(csv, /"France";"12 ans"/);
});

test('doublon inscription + pré-inscription : refusé à la saisie, signalé, et retiré en un clic depuis la fiche', async () => {
  const { seedInscription } = await import('./helpers/inscriptions.mjs');
  const transfer = await import('../functions/admin/inscriptions/[id]/preinscription.js');
  const fiche = await import('../functions/admin/inscriptions/[id].js');
  const env = await setup();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const page = async (id) => (await fiche.onRequestGet({ request: new Request(`https://${HOST}/admin/inscriptions/${id}`, { headers: { Cookie: cookie } }), env, params: { id: String(id) } })).text();
  const u10Page = async () => (await admin.onRequestGet({ request: new Request(`https://${HOST}/admin/preinscriptions`, { headers: { Cookie: cookie } }), env })).text();

  // 1. Enfant déjà inscrit (inscription active) : la pré-inscription publique est refusée.
  const active = await seedInscription(env.DB, { enfant_prenom: 'Élise', enfant_nom: 'Martin', naissance: '2017-05-12', categorie: 'U8 - U9', email: 'e@example.fr' });
  const refused = await post(env, child(1, { enfantPrenom: 'elise', enfantNom: 'MARTIN' }));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.alreadyRegistered, true);
  await ensurePreinscriptionsTable(env.DB);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 0);

  // 2. Doublon déjà présent (comme en production) : signalé des deux côtés.
  await env.DB.prepare(`INSERT INTO preinscriptions (organization_id, groupe, enfant_prenom, enfant_nom, naissance, parent_prenom, parent_nom, email, telephone, dedup_key)
    VALUES (?, 'U10', 'Élise', 'Martin', '2017-05-12', 'P', 'M', 'e@example.fr', '0600000000', 'elise|martin|2017-05-12')`).bind(A).run();
  assert.match(await page(active.id), /Doublon.*Retirer des inscriptions/s);
  assert.match(await u10Page(), new RegExp(`Aussi dans les inscriptions : <a[^>]*href="/admin/inscriptions/${active.id}"`));

  // 3. Retrait en un clic : fiche retirée (conservée), rien de dupliqué dans la liste, lien d'origine sur la carte.
  const res = await transfer.onRequestPost({ request: new Request(`https://${HOST}/admin/inscriptions/${active.id}/preinscription`, { method: 'POST', headers: { Cookie: cookie } }), env, params: { id: String(active.id) }, waitUntil: () => {} });
  assert.equal(res.headers.get('Location'), '/admin/preinscriptions?msg=retire');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 1);
  const row = await env.DB.prepare('SELECT archived_at, archive_motif FROM inscriptions WHERE id = ?').bind(active.id).first();
  assert.ok(row.archived_at);
  assert.equal(row.archive_motif, 'preinscription');
  const after = await u10Page();
  assert.doesNotMatch(after, /Aussi dans les inscriptions/);
  assert.match(after, new RegExp(`href="/admin/inscriptions/${active.id}"[^>]*>.*Fiche d'inscription d'origine`));
});
