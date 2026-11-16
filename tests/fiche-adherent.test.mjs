// Fiche adhérent refaite (2026-10-14), devenue la fiche enfant unique le 2026-11-10 (functions/admin/inscriptions/[id].js) : prochaine étape, suivi de l'adhésion, saisie du n° de licence avec retour sur
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

const A = DEMO_ORG_ID;
const HOST = 'https://club-exemple.example';
const COMPLETE = {
  paye: 1, mode_paiement: 'HelloAsso', dossier_key: 'd', dossier_uploaded_at: '2026-09-20 10:00:00', dossier_status: 'valide',
  dossier_verified_at: '2026-09-21 09:00:00', photo_key: 'p', photo_uploaded_at: '2026-09-22 18:30:00', ville_naissance: 'Ermont', pays_naissance: 'France',
};

async function setup(overrides = {}) {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const row = await seedInscription(env.DB, { ...COMPLETE, enfant_prenom: 'Léa', enfant_nom: 'Durand', ...overrides });
  await backfillOrganization(env, A, { dryRun: false });
  const kid = await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'child'").first();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  // Fiche enfant unique (2026-11-10) : la fiche adhérent renvoie vers celle de l'inscription, qu'on lit ici.
  const get = async (query = '') => {
    const res = await memberPage.onRequestGet({ request: new Request(`${HOST}/admin/adherents/${kid.id}${query}`, { headers: { Cookie: cookie } }), env, params: { id: String(kid.id) } });
    if (res.status !== 302) return res.text();
    const location = res.headers.get('Location');
    const id = location.match(/inscriptions\/(\d+)/)[1];
    return (await fiche.onRequestGet({ request: new Request(`${HOST}${location}`, { headers: { Cookie: cookie } }), env, params: { id } })).text();
  };
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
  assert.match(html, /À faire pour Léa[\s\S]*Licence FFF : à demander/, 'inscription complète : seule la licence reste à faire');
  assert.match(html, /href="#tab-licence"/);
  assert.match(html, /N° de licence FFF<\/h2>/);
  assert.doesNotMatch(html, /Lieu de naissance à compléter/, 'lieu connu : pas d’étape');

  const body = new FormData();
  body.set('action', 'licence');
  body.set('numeroLicence', '2547896541');
  body.set('retour', `/admin/adherents/${kid.id}`);
  const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?licenceOk=1`);
  html = await get('?licenceOk=1');
  assert.match(html, /N° de licence enregistré/);
  assert.match(html, /value="2547896541"/);
});

test('licence : un retour hors fiche adhérent est ignoré (pas de redirection ouverte)', async () => {
  const { row, env, cookie } = await setup();
  for (const retour of ['https://evil.example/', '//evil.example', '/admin/adherents/1?x=1', '/admin/parametres']) {
    const body = new FormData();
    body.set('action', 'licence');
    body.set('numeroLicence', '123');
    body.set('retour', retour);
    const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
    assert.equal(res.headers.get('Location'), `/admin/inscriptions/${row.id}?licenceOk=1#licence`, retour);
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
  assert.match(html, /Où en est l'inscription/);
  assert.match(html, /À faire pour Léa[\s\S]*Paiement de l’adhésion à recevoir/);
  assert.match(html, /<a href="#tab-paiement" class="adm-step-chip is-todo"><span>Paiement<\/span><strong>À payer<\/strong>/);
  assert.match(html, /id="tab-historique"[\s\S]*<details class="adm-surface adm-fold adm-member-mails" id="emails" open>/, 'onglet Historique : e-mails dépliés');
  assert.match(html, /1 e-mail à la famille/);
});

test('« Modifier » depuis la fiche adhérent : formulaire puis retour sur la fiche adhérent', async () => {
  const { env, row, kid, cookie, get } = await setup();
  assert.ok((await get()).includes(`href="/admin/inscriptions/${row.id}?edit=1"`), 'Modifier depuis la fiche unique');
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
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?noteOk=1#note`);
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
  assert.match(html, new RegExp(`name="action" value="toggle-paye"><input type="hidden" name="id" value="${row.id}"><input type="hidden" name="redirectTo" value="/admin/inscriptions/${row.id}">`));
  assert.match(html, /value="bulk-reminder"/, 'Relancer dans le menu Plus');
  assert.match(html, /href="#versement"/, 'action principale : enregistrer un versement');
  const list = await import('../functions/admin/inscriptions.js');
  const body = new FormData();
  body.set('action', 'toggle-paye');
  body.set('id', String(row.id));
  body.set('redirectTo', `/admin/adherents/${kid.id}`);
  const res = await list.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions`, { method: 'POST', body, headers: { Cookie: cookie, Origin: HOST } }), env, waitUntil: () => {} });
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}`);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
  const complete = await (await setup()).get();
  assert.doesNotMatch(complete, /value="bulk-reminder"/, 'rien à relancer');
  assert.match(complete, /Marquer non payé/, 'payée : seulement « Marquer non payé », dans l’onglet Paiement');
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
  assert.doesNotMatch(await list('?suivi=licence_a_demander'), /<h3><a href="\/admin\/inscriptions\/\d+">Léa/);
  assert.match(await list(''), /Attente FFF/);
});

// Parcours licence FFF (2026-11-04) : étapes Footclubs, état de chaque pièce, « qui manque quoi », relance.
import { licenceStage, licenceMissing, LICENCE_STAGE_SQL, MISSING_SQL, LICENCE_DOCS, FOLLOWUP_STEPS, licenceReminderText } from '../functions/_shared/club-followup.js';

test('licence : étape et pièces manquantes identiques en JS et en SQL', async () => {
  const { env, row } = await setup();
  const steps = FOLLOWUP_STEPS.filter((s) => s.group === 'licence').map((s) => s.column);
  const docValues = ['', 'manquant', 'ok', 'refuse', 'club', 'non_requis'];
  let seen = new Set();
  for (let n = 0; n < 384; n += 1) {
    const r = { numero_licence: n % 7 === 3 ? 'A12' : null };
    steps.forEach((c, i) => { r[c] = (n >> i) & 1 ? '2026-11-01 10:00:00' : null; });
    LICENCE_DOCS.forEach((d, i) => { r[d.column] = docValues[(Math.floor(n / 32) + i) % docValues.length] || null; });
    const cols = Object.keys(r);
    await env.DB.prepare(`UPDATE inscriptions SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => r[c]), row.id).run();
    const db = await env.DB.prepare(`SELECT ${LICENCE_STAGE_SQL} AS stage, CASE WHEN ${MISSING_SQL} THEN 1 ELSE 0 END AS missing FROM inscriptions i WHERE id = ?`).bind(row.id).first();
    assert.equal(db.stage, licenceStage(r), JSON.stringify(r));
    if (db.stage !== 'validee') assert.equal(Boolean(db.missing), licenceMissing(r).length > 0, JSON.stringify(r));
    seen.add(db.stage);
  }
  assert.equal(seen.size, 7, [...seen].join(','));
});

test('licence : pièces enregistrées (liste fermée), manque affiché sur la fiche, la carte et en compteur', async () => {
  const { env, row, kid, cookie, get } = await setup();
  const body = new FormData();
  body.set('action', 'suivi-club');
  body.set('retour', `/admin/adherents/${kid.id}`);
  body.set('licenceDemandee', '1');
  body.set('licenceFamille', '1');
  body.set('docPhoto', 'ok');
  body.set('docIdentite', 'refuse');
  body.set('docSante', 'manquant');
  body.set('docCertificat', '<script>');
  await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  const r = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(r.licence_doc_photo, 'ok');
  assert.equal(r.licence_doc_identite, 'refuse');
  assert.equal(r.licence_doc_certificat, null, 'valeur hors liste ignorée');
  assert.equal(licenceStage(r), 'refusee');
  const html = await get();
  assert.match(html, /Pièce refusée : à corriger par la famille/);
  assert.ok(html.includes('Manque : <strong>pièce d&#39;identité</strong> (refusé, à corriger), <strong>questionnaire de santé</strong>'), 'manque sur la fiche');
  assert.ok(html.includes('<option value="refuse" selected>Refusé, à corriger</option>'));
  assert.ok(html.includes('modele=licence'));
  const members = await import('../functions/admin/adherents.js');
  const list = async (q) => (await members.onRequestGet({ request: new Request(`${HOST}/admin/adherents${q}`, { headers: { Cookie: cookie } }), env })).text();
  const all = await list('');
  assert.ok(all.includes('Manque : pièce d&#39;identité (refusé), questionnaire de santé'), 'manque sur la carte');
  assert.ok(all.includes('1 licence avec une pièce refusée'), 'À faire maintenant : pièce refusée');
  assert.match(all, /\d+ pièces? manquantes?/, 'À faire maintenant : pièces manquantes');
  assert.ok(all.includes('suivi=licence_refusee'));
  const card = '<h3><a href="/admin/inscriptions/';
  assert.ok((await list('?suivi=licence_refusee')).includes(card));
  assert.ok(!(await list('?suivi=licence_a_signer')).includes(card));
});

test('licence : relance notée à la main ou par l’e-mail prérempli', async () => {
  const { env, row, kid, cookie, get } = await setup({ licence_demandee_at: '2026-11-01 10:00:00', licence_doc_certificat: 'manquant' });
  const body = new FormData();
  body.set('action', 'licence-relance');
  body.set('retour', `/admin/adherents/${kid.id}`);
  const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', body, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  assert.equal(res.headers.get('Location'), `/admin/adherents/${kid.id}?relanceOk=1#suivi-club`);
  assert.ok((await env.DB.prepare('SELECT licence_relance_at FROM inscriptions WHERE id = ?').bind(row.id).first()).licence_relance_at);
  assert.match(await get('?relanceOk=1'), /Relance notée[\s\S]*Dernière relance le/);

  const text = licenceReminderText({ enfant_prenom: 'Léa', licence_doc_certificat: 'manquant' });
  assert.match(text.subject, /Licence FFF de Léa/);
  assert.match(text.message, /- Certificat médical/);
  const email = await import('../functions/admin/email.js');
  const page = await (await email.onRequestGet({ request: new Request(`${HOST}/admin/email?inscription=${row.id}&modele=licence`, { headers: { Cookie: cookie } }), env })).text();
  assert.match(page, /value="Licence FFF de Léa : document à fournir"/);
  assert.match(page, /name="modele" value="licence"/);
});
