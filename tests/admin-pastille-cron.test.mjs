// 2026-10-09 : pastille « dossiers à vérifier » des onglets admin, boutons Appeler / E-mail des fiches, alerte au club
// quand l'automatisation quotidienne échoue (un e-mail par jour au plus) et bandeau « automatisations à l'arrêt ».
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, adminBadges, adminShell, contactActions } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { getCategoriesConfig, getCronState, setCronState } from '../functions/_shared/settings-kv.js';
import { profilePage } from '../functions/_shared/crm-ui.js';
import * as dashboard from '../functions/admin/dashboard.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import { onRequestPost as cron, recordCronFailure } from '../functions/api/cron.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const ORG_B = 'org_test_association';
const SITE = 'https://clubdemo.licyo.fr';
const RECU = '2026-10-01 10:00:00';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', CRON_SECRET: 'secret-de-test' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'test-association', 'Test Association', 'cultural_association')").bind(ORG_B).run();
  await getCategoriesConfig(env, A);
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, cookie };
}

const get = (mod, env, cookie, path, params = {}) =>
  mod.onRequestGet({ request: new Request(`${SITE}${path}`, { headers: { Cookie: cookie } }), env, params }).then((r) => r.text());

const badgeCount = (html) => (html.match(/class="adm-badge"/g) || []).length;

test('pastille : dossiers à vérifier de l’organisation de la session seulement (fiches actives, ni validés, ni refusés)', async () => {
  const { env } = await setup();
  await seedInscription(env.DB, { enfant_prenom: 'Un', dossier_uploaded_at: RECU });
  await seedInscription(env.DB, { enfant_prenom: 'Deux', dossier_uploaded_at: RECU, dossier_status: 'a_verifier' });
  await seedInscription(env.DB, { enfant_prenom: 'Valide', dossier_uploaded_at: RECU, dossier_status: 'valide' });
  await seedInscription(env.DB, { enfant_prenom: 'Refuse', dossier_uploaded_at: RECU, dossier_status: 'refuse' });
  await seedInscription(env.DB, { enfant_prenom: 'Archive', dossier_uploaded_at: RECU, archived_at: '2026-10-02 10:00:00' });
  await seedInscription(env.DB, { enfant_prenom: 'SansDossier' });
  for (const n of [1, 2, 3]) await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: `B${n}`, email: `b${n}@example.fr`, dossier_uploaded_at: RECU });

  assert.deepEqual(await adminBadges(env, { organizationId: A }), { inscriptions: 2 });
  assert.deepEqual(await adminBadges(env, { organizationId: ORG_B }), { inscriptions: 3 });
  assert.deepEqual(await adminBadges(env, { organizationId: 'org_inconnue' }), {}, 'aucun dossier : pas de pastille');
});

test('pastille : une erreur de la requête ne casse jamais la page (pas de pastille)', async () => {
  const broken = { DB: { prepare: () => { throw new Error('D1 indisponible'); } } };
  assert.deepEqual(await adminBadges(broken, { organizationId: A }), {});
  const failing = { DB: { prepare: () => ({ bind: () => ({ first: async () => { throw new Error('D1'); } }) }) } };
  assert.deepEqual(await adminBadges(failing, { organizationId: A }), {});
});

test('pastille : barre du haut et barre du bas, texte pour lecteur d’écran, plafonnée à « 9+ », absente à 0', () => {
  const shell = (n) => adminShell({ active: 'dashboard', title: 'T', badges: n == null ? {} : { inscriptions: n } });
  assert.equal(badgeCount(shell()), 0);
  assert.equal(badgeCount(shell(0)), 0);
  assert.doesNotMatch(shell(0), /à vérifier/);

  const three = shell(3);
  assert.equal(badgeCount(three), 2, 'onglet du haut + onglet du bas');
  assert.equal((three.match(/<span class="visually-hidden"> \(3 dossiers à vérifier\)<\/span>/g) || []).length, 2);
  assert.match(three, /<span class="adm-badge" aria-hidden="true">3<\/span>/);
  assert.match(shell(1), /\(1 dossier à vérifier\)/);
  const many = shell(12);
  assert.match(many, /aria-hidden="true">9\+<\/span>/);
  assert.match(many, /\(12 dossiers à vérifier\)/, 'le nombre exact reste lu');
  // La pastille ne touche que l'onglet Inscriptions (pas la Corbeille, qui pointe aussi vers /admin/inscriptions).
  assert.match(three, /href="\/admin\/inscriptions" class="adm-tab">Inscriptions<span class="visually-hidden">/);
  assert.match(three, /href="\/admin\/inscriptions\?view=archive" class="">[^<]*<svg[\s\S]*?<\/svg>Corbeille<\/a>/, "Corbeille (menu Plus) sans pastille");
});

test('pastille : affichée sur les pages admin de la session (tableau de bord, fiche), jamais celle d’une autre organisation', async () => {
  const { env, cookie } = await setup();
  const row = await seedInscription(env.DB, { enfant_prenom: 'Un', dossier_uploaded_at: RECU });
  await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: 'B', email: 'b@example.fr', dossier_uploaded_at: RECU });
  const dash = await get(dashboard, env, cookie, '/admin/dashboard');
  assert.equal(badgeCount(dash), 2);
  assert.match(dash, /\(1 dossier à vérifier\)/);
  const page = await get(fiche, env, cookie, `/admin/inscriptions/${row.id}`, { id: String(row.id) });
  assert.match(page, /\(1 dossier à vérifier\)/);

  await env.DB.prepare("UPDATE inscriptions SET dossier_status = 'valide' WHERE id = ?").bind(row.id).run();
  assert.equal(badgeCount(await get(dashboard, env, cookie, '/admin/dashboard')), 0, 'plus rien à vérifier chez A');
});

test('Appeler (mobile) / E-mail (partout, via l’admin) : un bloc par responsable', async () => {
  assert.equal(contactActions({}), '');
  const one = contactActions({ phone: '06 12 34 56 78', email: 'a+b@example.fr', name: 'Samia <b>D</b>', inscriptionId: 7 });
  assert.match(one, /class="adm-card-actions adm-contact-actions"/);
  assert.match(one, /class="adm-btn adm-btn-ghost adm-touch-only" href="tel:0612345678"/, 'Appeler : mobile seulement');
  assert.ok(one.includes('class="adm-btn adm-btn-ghost" href="/admin/email?inscription=7&amp;destinataire=a%2Bb%40example.fr"'), 'E-mail : partout, écrit depuis l’admin');
  assert.doesNotMatch(one, /mailto:/);
  assert.ok(one.includes('Appeler<span class="visually-hidden"> Samia &lt;b&gt;D&lt;/b&gt;</span>'));
  assert.match(contactActions({ phone: '0600000000' }), /adm-contact-actions adm-touch-only/, 'sans e-mail : rien sur ordinateur');
  assert.doesNotMatch(contactActions({ email: 'a@example.fr' }), /href=/, 'sans fiche : pas de bouton E-mail');

  const { env, cookie } = await setup();
  const row = await seedInscription(env.DB, {
    telephone: '06 00 00 00 01', parent2_prenom: 'Sam', parent2_nom: 'Test', parent2_email: 'sam@example.fr', parent2_telephone: '0611111111',
  });
  const page = await get(fiche, env, cookie, `/admin/inscriptions/${row.id}`, { id: String(row.id) });
  assert.equal((page.match(/class="adm-card-actions adm-contact-actions"/g) || []).length, 2, 'responsable 1 et 2e responsable');
  assert.match(page, /href="tel:0600000001"/);
  assert.match(page, /href="tel:0611111111"/);
  assert.ok(page.includes(`href="/admin/email?inscription=${row.id}&amp;destinataire=parent%40example.fr"`));
  assert.ok(page.includes(`href="/admin/email?inscription=${row.id}&amp;destinataire=sam%40example.fr"`));
  assert.ok(page.includes('<dd>06 00 00 00 01</dd>'), 'numéro lisible en texte (ordinateur)');
  assert.doesNotMatch(page, /mailto:/, 'aucun lien mailto sur la fiche');
});

test('Appeler / E-mail : fiche adhérent, un bloc par responsable joignable, relié à son inscription', () => {
  const html = profilePage(
    {
      contact: { id: 1, first_name: 'Léa', last_name: 'Durand', birth_date: '2019-02-03' },
      memberships: [{ inscription_id: 41, email: 'samia@example.fr', parent2_email: null, is_current: 1, period_name: '2026-2027', status: 'active' }],
      guardians: [
        { id: 2, first_name: 'Samia', last_name: 'Durand', phone: '06 00 00 00 02', email: 'samia@example.fr', relationship_type: 'parent', is_primary: 1 },
        { id: 3, first_name: 'Karim', last_name: 'Durand', phone: null, email: null, relationship_type: 'parent', is_primary: 0 },
      ],
      dependents: [],
      duplicates: [],
      review: [],
    },
    { asMember: true }
  );
  assert.equal((html.match(/class="adm-card-actions adm-contact-actions"/g) || []).length, 1, 'rien pour un responsable sans coordonnées');
  assert.ok(html.includes('href="/admin/email?inscription=41&amp;destinataire=samia%40example.fr"'));
  assert.match(html, /href="tel:0600000002"/);
  assert.match(html, /<span class="adm-person-coord">samia@example.fr<\/span>/);
});

test('alerte cron : un e-mail au club au plus une fois par jour, sans donnée personnelle', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { env } = await setup();
  env.BREVO_API_KEY = 'cle-de-test';
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });

  const day1 = new Date('2026-10-10T07:00:05Z');
  await recordCronFailure(env, A, { step: 'automations', error: { name: 'TaskError' }, siteUrl: SITE, now: day1 });
  await recordCronFailure(env, A, { step: 'crm', error: { name: 'TaskError' }, siteUrl: SITE, now: new Date('2026-10-10T07:30:00Z') });
  assert.equal(sent.length, 1, 'un seul e-mail le même jour');
  const [mail] = sent;
  assert.deepEqual(mail.to, [{ email: 'contact@clubdemo.licyo.fr' }]);
  assert.match(mail.subject, /automatisation quotidienne a échoué/);
  assert.match(mail.textContent, /Étape en échec : Relances et récapitulatif du lundi/);
  assert.match(mail.textContent, /https:\/\/clubdemo\.licyo\.fr\/admin\/parametres/);
  assert.match(mail.htmlContent, /samedi 10 octobre 2026 à 09:00/);
  const state = await getCronState(env, A);
  assert.equal(state.lastFailureAlertAt, day1.toISOString());
  assert.equal(state.lastFailure.step, 'crm', 'chaque échec reste noté');
  const logged = await env.DB.prepare("SELECT kind, organization_id FROM email_log WHERE kind = 'club_cron'").all();
  assert.deepEqual(logged.results.map((r) => ({ ...r })), [{ kind: 'club_cron', organization_id: A }]);

  await recordCronFailure(env, A, { step: 'organisation', error: new Error('x'), siteUrl: SITE, now: new Date('2026-10-11T07:00:00Z') });
  assert.equal(sent.length, 2, 'nouvel e-mail le lendemain');
  assert.match(sent[1].textContent, /Connexion à la base de données/);
});

test('alerte cron : envoi refusé par Brevo = nouvelle tentative au prochain échec', async (t) => {
  const { env } = await setup();
  env.BREVO_API_KEY = 'cle-de-test';
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return calls === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  await recordCronFailure(env, A, { step: 'crm', error: { name: 'TaskError' }, siteUrl: SITE, now: new Date('2026-10-10T07:00:00Z') });
  assert.equal((await getCronState(env, A)).lastFailureAlertAt, undefined);
  await recordCronFailure(env, A, { step: 'crm', error: { name: 'TaskError' }, siteUrl: SITE, now: new Date('2026-10-10T08:00:00Z') });
  assert.equal(calls, 2);
  assert.equal((await getCronState(env, A)).lastFailureAlertAt, '2026-10-10T08:00:00.000Z');
});

test('alerte cron : déclenchée par /api/cron quand une tâche échoue, sans le message d’erreur', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { env } = await setup();
  env.BREVO_API_KEY = 'cle-de-test';
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  const request = () => new Request(`${SITE}/api/cron`, { method: 'POST', headers: { Authorization: 'Bearer secret-de-test' } });
  const tasks = { automations: async () => { throw new Error('Brevo sonia@example.test'); } };
  assert.equal((await cron({ request: request(), env, tasks })).status, 500);
  assert.equal((await cron({ request: request(), env, tasks })).status, 500);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(JSON.stringify(sent[0]), /sonia/);
});

test('tableau de bord : bandeau si le dernier passage réussi date de plus de 36 h', async () => {
  const now = new Date('2026-10-10T12:00:00Z');
  assert.equal(dashboard.cronStaleSince({}, now), null, 'aucun passage connu : rien');
  assert.equal(dashboard.cronStaleSince({ lastRun: '2026-10-10T07:00:00Z' }, now), null);
  assert.equal(dashboard.cronStaleSince({ lastRun: '2026-10-09T00:00:01Z' }, now), null, '35 h 59 : rien');
  assert.ok(dashboard.cronStaleSince({ lastRun: '2026-10-08T23:59:00Z' }, now) instanceof Date, 'plus de 36 h : bandeau');

  const { env, cookie } = await setup();
  const banner = /Automatisations à l'arrêt/;
  assert.doesNotMatch(await get(dashboard, env, cookie, '/admin/dashboard'), banner);
  await setCronState(env, A, { lastRun: new Date(Date.now() - 2 * 3600 * 1000).toISOString() });
  assert.doesNotMatch(await get(dashboard, env, cookie, '/admin/dashboard'), banner);
  await setCronState(env, A, { lastRun: new Date(Date.now() - 40 * 3600 * 1000).toISOString() });
  const page = await get(dashboard, env, cookie, '/admin/dashboard');
  assert.match(page, banner);
  assert.match(page, /href="\/admin\/parametres">.*Voir les paramètres/);
});
