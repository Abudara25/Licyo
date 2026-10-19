// Fiche adhérent refaite (2026-10-14) : prochaine étape, suivi de l'adhésion, saisie du n° de licence avec retour sur
// la fiche, e-mails envoyés à la famille (journal email_log), jamais ceux d'une autre organisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { backfillOrganization } from '../functions/_shared/crm.js';
import { listEmailsForInscriptions } from '../functions/_shared/email-log.js';
import * as memberPage from '../functions/admin/adherents/[id].js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://clubdemo.licyo.fr';
const COMPLETE = {
  paye: 1, mode_paiement: 'HelloAsso', dossier_key: 'd', dossier_uploaded_at: '2026-09-20 10:00:00', dossier_status: 'valide',
  dossier_verified_at: '2026-09-21 09:00:00', photo_key: 'p', photo_uploaded_at: '2026-09-22 18:30:00', ville_naissance: 'Ermont', pays_naissance: 'France',
};

async function setup(overrides = {}) {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const row = await seedInscription(env.DB, { ...COMPLETE, enfant_prenom: 'Léa', enfant_nom: 'Durand', ...overrides });
  await backfillOrganization(env, A, { dryRun: false });
  const kid = await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'child'").first();
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const get = async (query = '') =>
    (await memberPage.onRequestGet({ request: new Request(`${HOST}/admin/adherents/${kid.id}${query}`, { headers: { Cookie: cookie } }), env, params: { id: String(kid.id) } })).text();
  return { env, row, kid, cookie, get };
}

const log = (env, organizationId, inscriptionId, kind, subject, ok = 1, error = null) =>
  env.DB.prepare('INSERT INTO email_log (organization_id, kind, origin, inscription_id, recipients, subject, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(organizationId, kind, 'auto', inscriptionId, 'parent@example.fr', subject, ok, error)
    .run();

test('e-mails envoyés : ceux de la famille, en clair, échecs signalés, alertes club distinguées, contenu échappé', async () => {
  const { env, row, get } = await setup();
  await log(env, A, row.id, 'confirmation', 'Inscription bien reçue');
  await log(env, A, row.id, 'relance', 'Rappel <script>', 0, 'Boîte pleine');
  await log(env, A, row.id, 'club_depot', 'Photo reçue');
  const html = await get();
  assert.match(html, /E-mails envoyés/);
  assert.match(html, /<details class="adm-surface adm-fold adm-member-mails" id="emails" open>/, 'replié, mais ouvert s’il y a un échec');
  assert.match(html, /Confirmation d’inscription/);
  assert.match(html, /« Inscription bien reçue »/);
  assert.match(html, /<span class="adm-tag is-no">Échec<\/span>/);
  assert.match(html, /Boîte pleine/);
  assert.match(html, /Alerte club/);
  assert.match(html, /2 e-mails à la famille/);
  assert.match(html, /1 en échec/);
  assert.ok(html.includes('Rappel &lt;script&gt;'));
  assert.doesNotMatch(html, /Rappel <script>/);
});

test('e-mails : jamais ceux d’une autre organisation, même avec le même n° d’inscription', async () => {
  const { env, row, get } = await setup();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_autre', 'autre', 'Autre')").run();
  await log(env, 'org_autre', row.id, 'confirmation', 'Secret autre club');
  assert.deepEqual(await listEmailsForInscriptions(env.DB, A, [row.id]), []);
  assert.doesNotMatch(await get(), /Secret autre club/);
  assert.match(await get(), /Aucun e-mail enregistré/);
});

test('prochaine étape : dossier complet sans licence → saisir la licence ; puis « Tout est en ordre »', async () => {
  const { get, row, env, cookie, kid } = await setup();
  let html = await get();
  assert.match(html, /Licence FFF à enregistrer/);
  assert.match(html, /href="#licence"/);
  assert.doesNotMatch(html, /Suivi de l’adhésion/, 'inscription complète : plus de suivi, seulement la licence');
  assert.match(html, /Licence FFF<\/h2>/);
  assert.doesNotMatch(html, /<h3>Lieu de naissance<\/h3>/, 'pas d’étape lieu de naissance (champ obligatoire du formulaire)');

  const body = new FormData();
  body.set('action', 'licence');
  body.set('numeroLicence', '2547896541');
  body.set('retour', `/admin/adherents/${kid.id}`);
  const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?licenceOk=1`);
  html = await get('?licenceOk=1');
  assert.match(html, /N° de licence enregistré/);
  assert.match(html, /Tout est en ordre/);
  assert.doesNotMatch(html, /Suivi de l’adhésion/);
});

test('licence : un retour hors fiche adhérent est ignoré (pas de redirection ouverte)', async () => {
  const { row, env, cookie } = await setup();
  for (const retour of ['https://evil.example/', '//evil.example', '/admin/adherents/1?x=1', '/admin/parametres']) {
    const body = new FormData();
    body.set('action', 'licence');
    body.set('numeroLicence', '123');
    body.set('retour', retour);
    const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
    assert.equal(res.headers.get('Location'), `/admin/inscriptions/${row.id}?savedOk=1`, retour);
  }
});

test('dossier à vérifier : la prochaine étape mène à l’aperçu du dossier', async () => {
  const { get, row } = await setup({ dossier_status: null });
  const html = await get();
  assert.match(html, /Dossier signé à vérifier/);
  assert.ok(html.includes(`href="/admin/inscriptions/${row.id}/apercu"`));
});

test('incomplète : suivi de l’adhésion affiché, replié ; e-mails sans échec repliés', async () => {
  const { get, env, row } = await setup({ paye: 0 });
  await log(env, A, row.id, 'confirmation', 'Inscription bien reçue');
  const html = await get();
  assert.match(html, /<details class="adm-surface adm-fold adm-parcours">[\s\S]*Suivi de l’adhésion[\s\S]*3 \/ 5 étapes/);
  assert.match(html, /<details class="adm-surface adm-fold adm-member-mails" id="emails">/);
  assert.match(html, /1 e-mail à la famille/, 'résumé visible replié');
});

test('« Modifier » depuis la fiche adhérent : formulaire puis retour sur la fiche adhérent', async () => {
  const { env, row, kid, cookie, get } = await setup();
  assert.ok((await get()).includes(`href="/admin/inscriptions/${row.id}?edit=1&amp;retour=/admin/adherents/${kid.id}"`));
  const form = await (await fiche.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${row.id}?edit=1&retour=/admin/adherents/${kid.id}`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  assert.ok(form.includes(`<input type="hidden" name="retour" value="/admin/adherents/${kid.id}">`));
  assert.ok(form.includes(`<a href="/admin/adherents/${kid.id}" class="adm-btn adm-btn-ghost">Annuler</a>`));
  const hostile = await (await fiche.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${row.id}?edit=1&retour=https://evil.example/`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  assert.doesNotMatch(hostile, /evil\.example/);
  assert.equal((await get('?savedOk=1')).includes('Fiche mise à jour.'), true);
});

test('copier : un bouton par téléphone et par e-mail du responsable', async () => {
  const { get } = await setup({ telephone: '0600000009' });
  const html = await get();
  assert.match(html, /<button type="button" class="adm-copy-btn" data-copy="0600000009"[^>]*aria-label="Copier le téléphone"/);
  assert.match(html, /<button type="button" class="adm-copy-btn" data-copy="parent@example\.fr"[^>]*aria-label="Copier l’e-mail"/);
});

test('note interne : masquée par défaut, enregistrée sur l’inscription, retour sur la fiche, contenu échappé, bornée', async () => {
  const { get, env, row, kid, cookie } = await setup();
  let html = await get();
  assert.match(html, /<details class="adm-note">/, 'repliée (masquée) par défaut');
  assert.match(html, /Ajouter une note/);
  const post = async (note) => {
    const body = new FormData();
    body.set('action', 'note');
    body.set('noteInterne', note);
    body.set('retour', `/admin/adherents/${kid.id}`);
    return fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  };
  let res = await post('Allergie <b>arachide</b>\r\nVient avec le grand-père');
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?noteOk=1`);
  assert.equal((await env.DB.prepare('SELECT note_interne FROM inscriptions WHERE id = ?').bind(row.id).first()).note_interne, 'Allergie <b>arachide</b>\nVient avec le grand-père');
  html = await get('?noteOk=1');
  assert.match(html, /Note enregistrée/);
  assert.match(html, /<details class="adm-note">/, 'toujours masquée après l’enregistrement');
  assert.match(html, /Afficher la note/);
  assert.ok(html.includes('Allergie &lt;b&gt;arachide&lt;/b&gt;'));
  assert.doesNotMatch(html, /<b>arachide/);
  res = await post('x'.repeat(2001));
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?noteError=1#note`);
  assert.equal((await env.DB.prepare('SELECT note_interne FROM inscriptions WHERE id = ?').bind(row.id).first()).note_interne.length, 49, 'note inchangée');
  res = await post('   ');
  assert.equal((await env.DB.prepare('SELECT note_interne FROM inscriptions WHERE id = ?').bind(row.id).first()).note_interne, null, 'vide = effacée');
});

test('actions rapides : Marquer payé et Relancer quand il manque quelque chose, retour sur la fiche adhérent', async () => {
  const { get, kid, row, env, cookie } = await setup({ paye: 0 });
  const html = await get();
  assert.match(html, new RegExp(`name="action" value="toggle-paye"><input type="hidden" name="id" value="${row.id}"><input type="hidden" name="redirectTo" value="/admin/adherents/${kid.id}">`));
  assert.match(html, /value="bulk-reminder"/);
  const list = await import('../functions/admin/inscriptions.js');
  const body = new FormData();
  body.set('action', 'toggle-paye');
  body.set('id', String(row.id));
  body.set('redirectTo', `/admin/adherents/${kid.id}`);
  const res = await list.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions`, { method: 'POST', body, headers: { Cookie: cookie, Origin: HOST } }), env, waitUntil: () => {} });
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}`);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
  const complete = await (await setup()).get();
  assert.doesNotMatch(complete, /value="toggle-paye"|value="bulk-reminder"/, 'rien à faire : pas d’action rapide');
});

test('licence FFF : nom, prénom, naissance, ville et e-mails copiables ; pays affiché sans copie (menu déroulant FFF)', async () => {
  const { get } = await setup({ parent2_prenom: 'Karim', parent2_nom: 'Durand', parent2_email: 'karim@example.fr' });
  const html = await get();
  for (const value of ['Durand', 'Léa', '29/02/2020', 'Ermont']) {
    assert.ok(html.includes(`class="adm-copy-btn" data-copy="${value}"`), value);
  }
  assert.doesNotMatch(html, /<dt>E-mail Karim<\/dt>/, 'e-mails : dans la carte des responsables seulement');
  assert.ok(html.includes('data-copy="karim@example.fr"'), 'second responsable copiable dans sa carte');
  assert.match(html, /<dt>Pays de naissance<\/dt><dd><span class="adm-person-coord">France<\/span><\/dd>/);
  assert.doesNotMatch(html, /data-copy="France"/);
});

test('suivi licence et tenue : cases cochées = date du jour gardée, décochées = vide, filtre et état dans la liste', async () => {
  const { get, env, row, kid, cookie } = await setup();
  let html = await get();
  assert.match(html, /Suivi licence et tenue/);
  assert.match(html, /name="licenceDemandee" value="1">/);
  const post = async (fields) => {
    const body = new FormData();
    body.set('action', 'suivi-club');
    body.set('retour', `/admin/adherents/${kid.id}`);
    for (const f of fields) body.set(f, '1');
    return fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  };
  const read = () => env.DB.prepare('SELECT licence_demandee_at, licence_verif_at, tenue_commandee_at, tenue_remise_at FROM inscriptions WHERE id = ?').bind(row.id).first();
  let res = await post(['licenceDemandee', 'tenueCommandee']);
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?suiviOk=1#suivi-club`);
  let r = await read();
  assert.ok(r.licence_demandee_at && r.tenue_commandee_at);
  assert.equal(r.licence_verif_at, null);
  await env.DB.prepare("UPDATE inscriptions SET licence_demandee_at = '2026-10-01 08:00:00' WHERE id = ?").bind(row.id).run();
  await post(['licenceDemandee', 'licenceVerif']);
  r = await read();
  assert.equal(r.licence_demandee_at, '2026-10-01 08:00:00', 'date d’origine conservée');
  assert.ok(r.licence_verif_at);
  assert.equal(r.tenue_commandee_at, null, 'décochée = vide');
  html = await get('?suiviOk=1');
  assert.match(html, /Suivi enregistré/);
  assert.match(html, /name="licenceVerif" value="1" checked>/);
  const members = await import('../functions/admin/adherents.js');
  const list = async (q) => (await members.onRequestGet({ request: new Request(`${HOST}/admin/adherents${q}`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(await list('?suivi=licence_en_cours'), /Léa/);
  assert.doesNotMatch(await list('?suivi=licence_a_demander'), /<h3><a href="\/admin\/adherents\/\d+">Léa/);
  assert.match(await list(''), /En vérification FFF/);
});
