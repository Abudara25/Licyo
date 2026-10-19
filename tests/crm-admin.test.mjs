// Phase 3 : pages /admin/adherents, fiche adhérent et fiche contact (lecture seule), isolation entre
// organisations, absence de N+1 et comportement avec beaucoup d'adhésions. Personnes FICTIVES uniquement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { backfillOrganization, syncInscription, listMembers } from '../functions/_shared/crm.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import * as members from '../functions/admin/adherents.js';
import * as memberPage from '../functions/admin/adherents/[id].js';
import * as contactPage from '../functions/admin/contacts/[id].js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const B = 'org_asso_b';

async function setup() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'b', 'B')").bind(B).run();
  await getCategoriesConfig(env, A);
  const cookieFor = async (org) => (await createSession(env, org, await testUser(env, org))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const cookies = { A: await cookieFor(A), B: await cookieFor(B) };
  return { env, cookies };
}
// Inscription COMPLÈTE par défaut (dossier validé, payé, photo) : seules celles-là figurent dans Adhérents.
const COMPLETE = { paye: 1, dossier_uploaded_at: '2026-09-10 10:00:00', dossier_key: 'k', dossier_status: 'valide', photo_uploaded_at: '2026-09-10 10:00:00', photo_key: 'p', ville_naissance: 'Argenteuil', pays_naissance: 'France' };
const INCOMPLETE = { paye: 0, dossier_uploaded_at: null, dossier_key: null, dossier_status: null, photo_uploaded_at: null, photo_key: null };
const child = (n, overrides = {}) => ({
  ...COMPLETE,
  enfant_prenom: `Enfant${n}`, enfant_nom: `Fictif${n}`, naissance: '2018-03-04', categorie: 'U8 - U9',
  parent_prenom: `Parent${n}`, parent_nom: `Fictif${n}`, email: `parent${n}@example.test`, telephone: `06000000${String(n).padStart(2, '0')}`, ...overrides,
});
const names = (html) => [...html.matchAll(/<h3><a href="\/admin\/adherents\/[^"]+">([^<]+)<\/a><\/h3>/g)].map((m) => m[1]);

test('sans session : la page de connexion, aucun adhérent, aucune synchronisation possible', async () => {
  const { env } = await setup();
  await seedInscription(env.DB, child(1));
  await backfillOrganization(env, A, { dryRun: false });
  const anonymous = (path) => new Request(`https://clubdemo.licyo.fr${path}`);
  for (const [handler, path, params] of [[members, '/admin/adherents', {}], [memberPage, '/admin/adherents/1', { id: '1' }], [contactPage, '/admin/contacts/1', { id: '1' }]]) {
    const res = await handler.onRequestGet({ request: anonymous(path), env, params });
    assert.doesNotMatch(await res.text(), /Enfant1|Fictif1/, path);
  }
  const form = new FormData();
  form.set('action', 'sync');
  const post = await members.onRequestPost({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { method: 'POST', body: form }), env });
  assert.equal(post.status, 401);
});

test('la liste affiche personne, période, groupe, statut et état du dossier lu dans l’inscription', async () => {
  const { env } = await setup();
  await seedInscription(env.DB, child(1, { numero_licence: '2547896321' }));
  await seedInscription(env.DB, child(2, { categorie: 'U6 - U7', naissance: '2020-01-01' }));
  await backfillOrganization(env, A, { dryRun: false });
  const res = await members.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { headers: { Cookie: (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0] } }), env });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual(names(html).sort(), ['Enfant1 Fictif1', 'Enfant2 Fictif2']);
  assert.match(html, /<p><strong>U8 - U9<\/strong> · né\(e\) le 04\/03\/2018<\/p>/, 'catégorie non répétée');
  const filtered = await (await members.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr/admin/adherents?age=${encodeURIComponent('U6 - U7')}`, { headers: { Cookie: (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0] } }), env })).text();
  assert.deepEqual(names(filtered), ['Enfant2 Fictif2'], 'filtre par catégorie regroupée');
  assert.match(html, /Adhésion <small>· 2026-2027<\/small>/);
  assert.match(html, /Validé/, 'dossier validé (source : inscription)');
  assert.match(html, /Payé/);
  assert.match(html, /Licence FFF<\/span><span class="adm-tag is-yes">N° 2547896321<\/span>/);
  assert.match(html, /Licence FFF<\/span><span class="adm-tag is-no">À demander<\/span>/);
  assert.match(html, /Tenue<\/span><span class="adm-tag is-no">À commander<\/span>/);
  assert.match(html, /<title>Adhérents/);
});

test('séparation : seule une inscription complète (dossier validé + paiement + photo + lieu de naissance) figure dans Adhérents', async () => {
  const { env, cookies } = await setup();
  await seedInscription(env.DB, child(1));
  await seedInscription(env.DB, child(2, INCOMPLETE));
  await seedInscription(env.DB, child(3, { dossier_status: 'a_verifier' }));
  await seedInscription(env.DB, child(4, { paye: 0 }));
  await seedInscription(env.DB, child(5, { photo_uploaded_at: null, photo_key: null }));
  await seedInscription(env.DB, child(6, { ville_naissance: null }));
  await backfillOrganization(env, A, { dryRun: false });
  const page = async () => (await members.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { headers: { Cookie: cookies.A } }), env })).text();
  assert.deepEqual(names(await page()), ['Enfant1 Fictif1']);
  assert.equal((await listMembers(env.DB, A, {})).total, 6, 'le CRM garde toutes les adhésions');
  await env.DB.prepare("UPDATE inscriptions SET paye = 1 WHERE enfant_prenom = 'Enfant4'").run();
  assert.deepEqual(names(await page()).sort(), ['Enfant1 Fictif1', 'Enfant4 Fictif4'], 'complète = passe dans Adhérents');
});

test('recherche insensible aux accents, filtres période / groupe / statut, et échappement', async () => {
  const { env, cookies } = await setup();
  await seedInscription(env.DB, child(1, { enfant_prenom: 'Léa', enfant_nom: 'Étoile' }));
  await seedInscription(env.DB, child(2, { enfant_prenom: '<img src=x onerror=alert(1)>', categorie: 'U6 - U7', naissance: '2020-01-01' }));
  await seedInscription(env.DB, child(3, { saison: '2027-2028', archived_at: '2027-10-01 10:00:00' }));
  await backfillOrganization(env, A, { dryRun: false });
  const list = async (query) => {
    const res = await members.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr/admin/adherents${query}`, { headers: { Cookie: cookies.A } }), env });
    return res.text();
  };
  assert.deepEqual(names(await list('?q=lea etoile')), ['Léa Étoile'], 'accents et casse ignorés, plusieurs termes');
  assert.deepEqual(names(await list('?groupe=U6 - U7')).length, 1);
  assert.deepEqual(names(await list('?statut=ended')), ['Enfant3 Fictif3']);
  const period = (await env.DB.prepare("SELECT id FROM periods WHERE slug = '2027-2028'").first()).id;
  assert.deepEqual(names(await list(`?periode=${period}`)), ['Enfant3 Fictif3']);
  const html = await list('');
  assert.doesNotMatch(html, /<img src=x/, 'nom saisi échappé');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(await list("?q=%25' OR 1=1--"), /Aucun adhérent ne correspond/, 'entrée hostile : simple recherche sans résultat');
  assert.match(await list('?periode=abc&statut=zzz&page=-5'), /Enfant/, 'paramètres invalides ignorés');
});

test('nouvelle inscription non synchronisée : bandeau, puis « Synchroniser maintenant »', async () => {
  const { env, cookies } = await setup();
  await seedInscription(env.DB, child(1));
  const page = async () => (await members.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { headers: { Cookie: cookies.A } }), env })).text();
  assert.match(await page(), /1 inscription ne figure pas encore dans le CRM/);
  const form = new FormData();
  form.set('action', 'sync');
  const res = await members.onRequestPost({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { method: 'POST', body: form, headers: { Cookie: cookies.A } }), env });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/admin/adherents?synced=1');
  const after = await page();
  assert.doesNotMatch(after, /ne figure pas encore/);
  assert.deepEqual(names(after), ['Enfant1 Fictif1']);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 1, 'inscriptions intactes');
});

test('fiche adhérent : identité, adhésion, responsables, dossier source, historique de plusieurs périodes', async () => {
  const { env, cookies } = await setup();
  await seedInscription(env.DB, child(1, { saison: '2026-2027', parent2_prenom: 'Second', parent2_nom: 'Fictif1', paye: 1 }));
  await seedInscription(env.DB, child(1, { saison: '2027-2028' }));
  await backfillOrganization(env, A, { dryRun: false });
  const kid = await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'child'").first();
  const res = await memberPage.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr/admin/adherents/${kid.id}`, { headers: { Cookie: cookies.A } }), env, params: { id: String(kid.id) } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Fiche adhérent/);
  assert.match(html, /Enfant1/);
  assert.match(html, /2026-2027/);
  assert.match(html, /2027-2028/);
  assert.match(html, /Responsable légal · principal/);
  assert.match(html, /href="\/admin\/contacts\/\d+"/, 'lien vers la fiche du responsable');
  assert.match(html, /Prochaine étape/);
  assert.match(html, /Suivi de l’adhésion|Licence FFF<\/h2>/, 'suivi, ou seul le bloc licence si l’inscription est complète');
  assert.match(html, /L’enfant/);
  assert.match(html, /E-mails envoyés/);
  assert.match(html, /<details class="adm-surface adm-fold">[\s\S]*Historique/, 'historique replié');
  assert.match(html, /href="\/admin\/inscriptions\/\d+"[^>]*>[\s\S]{0,400}Ouvrir l'inscription/);
  assert.match(html, /href="\/admin\/inscriptions\/\d+\?edit=1&amp;retour=\/admin\/adherents\/\d+"[^>]*>[\s\S]{0,400}Modifier<\/a>/, 'bouton Modifier en haut de la fiche');
  // Bouton « E-mail » du responsable, relié à son inscription (régression : les e-mails n'étaient pas lus en base).
  assert.match(html, /href="\/admin\/email\?inscription=\d+&amp;destinataire=parent1%40example\.test"/, 'E-mail du responsable');
  assert.match(html, /href="tel:0600000001"/, 'Appeler du responsable');
  assert.match(html, /Chronologie/);
  assert.equal([...html.matchAll(/Inscription reçue/g)].length, 2, 'un événement par inscription réelle, rien d’inventé');
  // Écritures possibles : n° de licence et note interne (inscription source, retour sur la fiche adhérent), et les
  // actions rapides (Marquer payé, Relancer) quand il manque quelque chose. Rien d'autre.
  const actions = [...html.matchAll(/<form method="POST" action="([^"]+)"[\s\S]*?name="action" value="([^"]+)"/g)].map((m) => `${m[1].replace(/\d+/, 'N')} ${m[2]}`);
  assert.ok(actions.every((a) => ['/admin/inscriptions/N licence', '/admin/inscriptions/N note', '/admin/inscriptions/N suivi-club', '/admin/inscriptions toggle-paye', '/admin/inscriptions bulk-reminder'].includes(a)), actions.join(', '));
  assert.equal([...html.matchAll(/<form/g)].length, actions.length);
  assert.match(html, /<form method="POST" action="\/admin\/inscriptions\/\d+"[^>]*id="licence">[\s\S]*name="action" value="licence"[\s\S]*name="retour" value="\/admin\/adherents\/\d+"/);
  assert.doesNotMatch(html, /Supprimer/);
});

test('fiche contact d’un responsable : enfants liés ; l’adhérent inexistant → 404 ; sans adhésion → redirection', async () => {
  const { env, cookies } = await setup();
  await seedInscription(env.DB, child(1));
  await backfillOrganization(env, A, { dryRun: false });
  const guardian = await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'guardian1'").first();
  const redirected = await memberPage.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr/admin/adherents/${guardian.id}`, { headers: { Cookie: cookies.A } }), env, params: { id: String(guardian.id) } });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get('Location'), `/admin/contacts/${guardian.id}`);
  const res = await contactPage.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr/admin/contacts/${guardian.id}`, { headers: { Cookie: cookies.A } }), env, params: { id: String(guardian.id) } });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Fiche contact/);
  assert.match(html, /Enfant1 Fictif1/);
  assert.match(html, /parent1@example\.test/);
  const missing = await contactPage.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/contacts/99999', { headers: { Cookie: cookies.A } }), env, params: { id: '99999' } });
  assert.equal(missing.status, 404);
  const junk = await contactPage.onRequestGet({ request: new Request('https://clubdemo.licyo.fr/admin/contacts/abc', { headers: { Cookie: cookies.A } }), env, params: { id: 'abc' } });
  assert.equal(junk.status, 404);
});

test('isolation : la session de A ne voit ni ne lit rien de B, même avec un identifiant connu', async () => {
  const { env, cookies } = await setup();
  await seedInscription(env.DB, child(1));
  await seedInscription(env.DB, { ...child(1), organization_id: B }); // mêmes personnes fictives chez B
  await syncInscription(env, A, 1);
  await syncInscription(env, B, 2);
  const contactB = await env.DB.prepare("SELECT id FROM contacts WHERE organization_id = ? AND created_from_role = 'child'").bind(B).first();
  const asA = async (handler, path, params) => handler.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr${path}`, { headers: { Cookie: cookies.A } }), env, params });
  assert.equal((await asA(memberPage, `/admin/adherents/${contactB.id}`, { id: String(contactB.id) })).status, 404);
  assert.equal((await asA(contactPage, `/admin/contacts/${contactB.id}`, { id: String(contactB.id) })).status, 404);
  const listA = await (await asA(members, '/admin/adherents', {})).text();
  assert.equal(names(listA).length, 1);
  assert.doesNotMatch(listA, new RegExp(`/admin/adherents/${contactB.id}"`));
  // Synchroniser côté A ne touche jamais aux inscriptions de B.
  await seedInscription(env.DB, { ...child(9), organization_id: B });
  const form = new FormData();
  form.set('action', 'sync');
  await members.onRequestPost({ request: new Request('https://clubdemo.licyo.fr/admin/adherents', { method: 'POST', body: form, headers: { Cookie: cookies.A } }), env });
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ?').bind(B).first()).n, 1, 'B inchangée par une action de A');
});

test('pas de N+1 : le nombre de requêtes de la liste ne dépend pas du nombre d’adhérents', async (t) => {
  const { env } = await setup();
  const measure = async () => {
    const prepare = env.DB.prepare.bind(env.DB);
    let calls = 0;
    const mock = t.mock.method(env.DB, 'prepare', (sql) => {
      calls += 1;
      return prepare(sql);
    });
    await listMembers(env.DB, A, {});
    mock.mock.restore();
    return calls;
  };
  const seed = async (from, to) => {
    for (let n = from; n <= to; n++) await seedInscription(env.DB, child(n));
    await backfillOrganization(env, A, { dryRun: false });
  };
  await seed(1, 20);
  const small = await measure();
  await seed(21, 120);
  const large = await measure();
  assert.equal(small, large);
  assert.ok(large <= 3, `${large} requêtes`);
});

test('volumétrie : quelques milliers d’adhésions, pagination et recherche restent rapides', async () => {
  const { env } = await setup();
  const period = (await env.DB.prepare("INSERT INTO periods (organization_id, slug, name, is_current) VALUES (?, '2026-2027', '2026-2027', 1)").bind(A).run()).meta.last_row_id;
  const statements = [];
  for (let n = 1; n <= 3000; n++) {
    statements.push(env.DB.prepare('INSERT INTO contacts (organization_id, first_name, last_name, search_name) VALUES (?, ?, ?, ?)').bind(A, `Prenom${n}`, `Nom${n % 97}`, `prenom${n} nom${n % 97}`));
  }
  await env.DB.batch(statements);
  await env.DB.prepare("INSERT INTO memberships (organization_id, contact_id, period_id, source) SELECT organization_id, id, ?, 'test' FROM contacts WHERE organization_id = ?").bind(period, A).run();
  const started = Date.now();
  const first = await listMembers(env.DB, A, {});
  const search = await listMembers(env.DB, A, { q: 'prenom2999' });
  const last = await listMembers(env.DB, A, { page: 120 });
  assert.deepEqual([first.total, first.rows.length, search.total, last.rows.length], [3000, 25, 1, 25]);
  assert.ok(Date.now() - started < 3000, 'temps raisonnable');
});
