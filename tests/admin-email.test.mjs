// 2026-10-09 : écrire un e-mail depuis l'admin (/admin/email) : une famille ou un groupe, un e-mail par famille,
// aperçu avant envoi, essai envoyé au club, journal relié aux fiches, isolation par organisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import * as page from '../functions/admin/email.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const ORG_B = 'org_test_association';
const SITE = 'https://clubdemo.licyo.fr';
const VALIDE = { dossier_uploaded_at: '2026-10-01', dossier_status: 'valide', paye: 1, photo_uploaded_at: '2026-10-01', ville_naissance: 'Ville', pays_naissance: 'France' };

async function setup(t) {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'test-association', 'Test Association', 'cultural_association')").bind(ORG_B).run();
  await getCategoriesConfig(env, A);
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  const get = (qs = '') => page.onRequestGet({ request: new Request(`${SITE}/admin/email${qs}`, { headers: { Cookie: cookie } }), env });
  const post = (fields) =>
    page.onRequestPost({
      request: new Request(`${SITE}/admin/email`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) }),
      env,
    });
  return { env, sent, get, post };
}

async function seedFamilies(env) {
  const leo = await seedInscription(env.DB, { enfant_prenom: 'Léo', enfant_nom: 'Martin', parent_prenom: 'Nadia', email: 'nadia@example.fr' });
  // Frère de Léo : même famille, un seul e-mail.
  await seedInscription(env.DB, { enfant_prenom: 'Adam', enfant_nom: 'Martin', parent_prenom: 'Nadia', email: 'NADIA@example.fr', naissance: '2018-03-03' });
  const lina = await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Durand', parent_prenom: 'Karim', email: 'karim@example.fr', parent2_prenom: 'Sofia', parent2_nom: 'Durand', parent2_email: 'sofia@example.fr', ...VALIDE });
  await seedInscription(env.DB, { enfant_prenom: 'Ancien', enfant_nom: 'Archive', email: 'archive@example.fr', archived_at: '2026-09-01' });
  await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: 'Bob', enfant_nom: 'Autre', email: 'b@example.fr' });
  return { leo, lina };
}

const message = { subject: 'Entraînement décalé', message: 'Bonjour à tous.\n\nRendez-vous à 17h30. Infos : https://clubdemo.licyo.fr/entrainements', greet: '1' };

test('groupes : familles actives de l’organisation, dédoublonnées, sans archives ni autre organisation', async (t) => {
  const { env, get } = await setup(t);
  await seedFamilies(env);
  const html = await (await get()).text();
  assert.match(html, /Toutes les familles inscrites \(2\)/);
  assert.match(html, /à compléter \(1\)/);
  assert.match(html, /inscription complète\) \(1\)/);
  const resolved = await page.resolveFamilies(env, A, { groupe: 'actives' });
  assert.deepEqual(resolved.families.map((f) => f.children), [['Léo Martin', 'Adam Martin'], ['Lina Durand']]);
});

test('envoi à un groupe : aperçu, puis un e-mail par famille, chacune ne voit que ses adresses', async (t) => {
  const { env, sent, post } = await setup(t);
  const { leo, lina } = await seedFamilies(env);
  const preview = await (await post({ action: 'preview', groupe: 'actives', ...message })).text();
  assert.match(preview, /Envoyer à 2 familles/);
  assert.match(preview, /<iframe class="adm-email-preview"[^>]* sandbox srcdoc="/);
  assert.equal(sent.length, 0, 'rien n’est envoyé à l’aperçu');

  const done = await (await post({ action: 'send', groupe: 'actives', ...message })).text();
  assert.match(done, /envoyé à 2 familles/);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((b) => b.to.map((r) => r.email)), [['nadia@example.fr'], ['karim@example.fr', 'sofia@example.fr']]);
  assert.match(sent[0].textContent, /^Bonjour Nadia,\n\nBonjour à tous\./);
  assert.match(sent[1].textContent, /^Bonjour Karim et Sofia,/);
  assert.equal(sent[0].subject, 'Entraînement décalé');
  assert.match(sent[0].htmlContent, /<a href="https:\/\/clubdemo\.licyo\.fr\/entrainements"/);
  const logs = (await env.DB.prepare("SELECT kind, origin, inscription_id, organization_id FROM email_log ORDER BY id").all()).results.map((r) => ({ ...r }));
  assert.deepEqual(logs, [
    { kind: 'message_club', origin: 'manuel', inscription_id: leo.id, organization_id: A },
    { kind: 'message_club', origin: 'manuel', inscription_id: lina.id, organization_id: A },
  ]);
});

test('une seule famille depuis sa fiche ; la fiche d’une autre organisation est introuvable', async (t) => {
  const { env, sent, get, post } = await setup(t);
  const { lina } = await seedFamilies(env);
  const form = await (await get(`?inscription=${lina.id}`)).text();
  assert.match(form, /Famille de Lina Durand/);
  assert.doesNotMatch(form, /id="email-groupe"/);
  await post({ action: 'send', inscription: String(lina.id), ...message });
  assert.deepEqual(sent.map((b) => b.to.map((r) => r.email)), [['karim@example.fr', 'sofia@example.fr']]);
  const other = await env.DB.prepare('SELECT id FROM inscriptions WHERE organization_id = ?').bind(ORG_B).first();
  assert.equal((await get(`?inscription=${other.id}`)).status, 404);
  assert.equal((await post({ action: 'send', inscription: String(other.id), ...message })).status, 404);
  assert.equal(sent.length, 1);
});

test('essai : part seulement aux adresses du club ; champs contrôlés et échappés', async (t) => {
  const { env, sent, post } = await setup(t);
  await seedFamilies(env);
  const res = await (await post({ action: 'test', groupe: 'actives', ...message })).text();
  assert.match(res, /Essai envoyé à contact@clubdemo\.licyo\.fr/);
  assert.deepEqual(sent.map((b) => b.to.map((r) => r.email)), [['contact@clubdemo.licyo.fr']]);

  assert.equal((await post({ action: 'send', groupe: 'actives', subject: '', message: 'x' })).status, 400);
  assert.equal((await post({ action: 'send', groupe: 'actives', subject: 'x', message: '' })).status, 400);
  assert.equal((await post({ action: 'send', groupe: 'inconnu', ...message })).status, 400);
  assert.equal(sent.length, 1);

  const hostile = await (await post({ action: 'preview', groupe: 'actives', subject: '<script>alert(1)</script>', message: '<img src=x onerror=alert(1)>' })).text();
  assert.doesNotMatch(hostile, /<script>alert|<img src=x/);
  await post({ action: 'send', groupe: 'actives', subject: 'Objet\r\nBcc: pirate@example.fr', message: '<b>gras</b>' });
  assert.ok(sent.slice(1).every((b) => b.subject === 'Objet Bcc: pirate@example.fr' && !/<b>gras/.test(b.htmlContent)));
});

test('bouton « E-mail » d’un responsable : un seul destinataire, le second responsable n’est pas en copie', async (t) => {
  const { env, sent, get, post } = await setup(t);
  const { lina } = await seedFamilies(env);
  const form = await (await get(`?inscription=${lina.id}&destinataire=${encodeURIComponent('SOFIA@example.fr')}`)).text();
  assert.ok(form.includes('Sofia Durand (sofia@example.fr), responsable de Lina Durand'));
  assert.ok(form.includes('name="destinataire" value="SOFIA@example.fr"'));
  await post({ action: 'send', inscription: String(lina.id), destinataire: 'sofia@example.fr', ...message });
  assert.deepEqual(sent.map((b) => b.to.map((r) => r.email)), [['sofia@example.fr']]);
  assert.ok(sent[0].textContent.startsWith('Bonjour Sofia,'));
  await post({ action: 'send', inscription: String(lina.id), destinataire: 'karim@example.fr', ...message });
  assert.deepEqual(sent[1].to.map((r) => r.email), ['karim@example.fr']);
  assert.ok(sent[1].textContent.startsWith('Bonjour Karim,'));
  // Adresse qui n'est pas celle d'un responsable de la fiche : refusée, rien n'est envoyé.
  assert.equal((await get(`?inscription=${lina.id}&destinataire=pirate%40example.fr`)).status, 404);
  assert.equal((await post({ action: 'send', inscription: String(lina.id), destinataire: 'pirate@example.fr', ...message })).status, 404);
  assert.equal(sent.length, 2);
});

test('cartes de pré-inscription : « E-mail » écrit depuis l’admin à la famille ; pré-inscription d’une autre organisation introuvable', async (t) => {
  const { env, sent, get, post } = await setup(t);
  const { ensurePreinscriptionsTable } = await import('../functions/_shared/preinscriptions.js');
  await ensurePreinscriptionsTable(env.DB);
  const insert = (org, email) =>
    env.DB.prepare("INSERT INTO preinscriptions (organization_id, groupe, enfant_prenom, enfant_nom, naissance, parent_prenom, parent_nom, email, telephone, parent2_prenom, parent2_nom, parent2_email, dedup_key) VALUES (?, 'U10', 'Noé', 'Petit', '2017-04-04', 'Inès', 'Petit', ?, '0600000000', 'Marc', 'Petit', 'marc@example.fr', ?)").bind(org, email, `test-${org}`).run();
  const mine = (await insert(A, 'ines@example.fr')).meta.last_row_id;
  const other = (await insert(ORG_B, 'b@example.fr')).meta.last_row_id;
  const form = await (await get(`?preinscription=${mine}`)).text();
  assert.ok(form.includes('Famille de Noé Petit (pré-inscription)'));
  assert.ok(form.includes('href="/admin/preinscriptions"'));
  await post({ action: 'send', preinscription: String(mine), ...message });
  assert.deepEqual(sent.map((b) => b.to.map((r) => r.email)), [['ines@example.fr', 'marc@example.fr']]);
  assert.ok(sent[0].textContent.startsWith('Bonjour Inès et Marc,'));
  assert.equal((await get(`?preinscription=${other}`)).status, 404);
  assert.equal((await post({ action: 'send', preinscription: String(other), ...message })).status, 404);
  assert.equal(sent.length, 1);
});

test('cartes des listes : « Appeler » (mobile) et « E-mail » à la famille via l’admin (partout) ; rien dans la corbeille', async (t) => {
  const { env } = await setup(t);
  const { familyActions } = await import('../functions/_shared/admin-auth.js');
  const html = familyActions({ phone: '06 00 00 00 01', inscriptionId: 12, child: 'Léa <b>' });
  assert.ok(html.includes('class="adm-btn adm-btn-ghost adm-touch-only" href="tel:0600000001"'));
  assert.ok(html.includes('class="adm-btn adm-btn-ghost" href="/admin/email?inscription=12"'));
  assert.ok(html.includes('(famille de Léa &lt;b&gt;)'));
  assert.equal(familyActions({ phone: '0600000000', inscriptionId: null }), '', 'sans inscription : rien');
  assert.doesNotMatch(familyActions({ inscriptionId: 3 }), /tel:/);

  const { leo } = await seedFamilies(env);
  const archived = await env.DB.prepare("SELECT id FROM inscriptions WHERE organization_id = ? AND archived_at IS NOT NULL").bind(A).first();
  const list = await import('../functions/admin/inscriptions.js');
  const { COOKIE_NAME: C, createSession: cs } = await import('../functions/_shared/admin-auth.js');
  const cookie = (await cs(env, A, await testUser(env, A))).find((c) => c.startsWith(`${C}=`)).split(';')[0];
  const page = (qs) => list.onRequestGet({ request: new Request(`${SITE}/admin/inscriptions${qs}`, { headers: { Cookie: cookie } }), env }).then((r) => r.text());
  assert.ok((await page('')).includes(`href="/admin/email?inscription=${leo.id}"`));
  assert.doesNotMatch(await page('?view=archive'), new RegExp(`/admin/email\?inscription=${archived.id}"`));
});
