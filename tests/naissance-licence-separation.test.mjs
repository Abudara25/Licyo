// Lieu de naissance, numéro de licence FFF et séparation des listes de l'admin (2026-09-27) : une inscription
// incomplète reste dans Inscriptions (ou Réinscription pour un enfant déjà inscrit une saison précédente) ; complète,
// elle n'apparaît plus que dans Adhérents. Personnes FICTIVES uniquement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { reinscriptionIds } from '../functions/_shared/inscriptions-db.js';
import { onRequestPost as apiPost } from '../functions/api/inscriptions.js';
import { onRequestGet as listGet } from '../functions/admin/inscriptions.js';
import { onRequestGet as ficheGet, onRequestPost as fichePost } from '../functions/admin/inscriptions/[id].js';
import { onRequestGet as reinscriptionGet } from '../functions/admin/reinscription.js';
import { onRequestGet as depotGet } from '../functions/depot/[token].js';
import { onRequestPost as naissancePost } from '../functions/depot/[token]/naissance.js';
import { sendReminderEmail } from '../functions/_shared/confirmation-email.js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';
import { issueFamilyLink } from '../functions/_shared/family-links.js';

const COMPLETE = { paye: 1, dossier_uploaded_at: '2026-09-10 10:00:00', dossier_key: 'k', dossier_status: 'valide', photo_uploaded_at: '2026-09-10 10:00:00', photo_key: 'p', ville_naissance: 'Argenteuil', pays_naissance: 'France' };

async function authedEnv() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, cookie };
}
const get = (handler, env, cookie, path, params = {}) =>
  handler({ request: new Request(`https://clubdemo.licyo.fr${path}`, { headers: { Cookie: cookie } }), env, params });
const kid = (prenom, overrides = {}) => ({ enfant_prenom: prenom, enfant_nom: 'Fictif', email: `${prenom.toLowerCase()}@example.test`, ...overrides });

test('API : ville et pays de naissance enregistrés et nettoyés ; absents (page ancienne) = acceptés, NULL', async () => {
  const env = await fixture();
  const tasks = [];
  const submit = (data) =>
    apiPost({
      request: new Request('https://clubdemo.licyo.fr/api/inscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randomUUID() }, body: JSON.stringify(data),
      }),
      env, waitUntil: (t) => tasks.push(t),
    });
  assert.equal((await submit({ ...validData, villeNaissance: '  Argenteuil ', paysNaissance: 'France', cpNaissance: '95100' })).status, 200);
  assert.equal((await submit({ ...validData, enfantPrenom: 'Léo', cpNaissance: '951' })).status, 400, 'code postal de naissance : 5 chiffres');
  assert.equal((await submit({ ...validData, enfantPrenom: 'Noé' })).status, 200);
  assert.equal((await submit({ ...validData, enfantPrenom: 'Zoé', villeNaissance: 'x'.repeat(201) })).status, 400);
  await Promise.all(tasks);
  const { results } = await env.DB.prepare('SELECT cp_naissance, ville_naissance, pays_naissance, numero_licence FROM inscriptions ORDER BY id').all();
  assert.deepEqual(results.map((r) => ({ ...r })), [
    { cp_naissance: '95100', ville_naissance: 'Argenteuil', pays_naissance: 'France', numero_licence: null },
    { cp_naissance: null, ville_naissance: null, pays_naissance: null, numero_licence: null },
  ]);
});

test('fiche : numéro de licence saisi, refusé s’il est invalide, affiché ; lieu de naissance modifiable', async () => {
  const { env, cookie } = await authedEnv();
  const row = await seedInscription(env.DB, { ville_naissance: 'Argenteuil', pays_naissance: 'France' });
  const post = (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return fichePost({ request: new Request(`https://clubdemo.licyo.fr/admin/inscriptions/${row.id}`, { method: 'POST', body: form, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  };
  const licence = async () => (await env.DB.prepare('SELECT numero_licence FROM inscriptions WHERE id = ?').bind(row.id).first()).numero_licence;

  assert.equal((await post({ action: 'licence', numeroLicence: ' 2547896321 ' })).headers.get('Location'), `/admin/inscriptions/${row.id}?savedOk=1`);
  assert.equal(await licence(), '2547896321');
  assert.match((await post({ action: 'licence', numeroLicence: '<script>' })).headers.get('Location'), /licenceError=1/);
  assert.equal(await licence(), '2547896321', 'valeur invalide : rien n’est écrit');

  const html = await (await get(ficheGet, env, cookie, `/admin/inscriptions/${row.id}`, { id: String(row.id) })).text();
  assert.match(html, /Argenteuil, France/);
  assert.match(html, /2547896321/);

  // Formulaire complet sans les nouveaux champs (ancien onglet resté ouvert) : valeurs conservées.
  const base = { ...validData, autorisation: 'on', rgpd: 'on', naissance: row.naissance };
  await post(base);
  const kept = await env.DB.prepare('SELECT ville_naissance, pays_naissance, numero_licence FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual({ ...kept }, { ville_naissance: 'Argenteuil', pays_naissance: 'France', numero_licence: '2547896321' });
  assert.equal((await post({ ...base, cpNaissance: 'abc' })).status, 400, 'code postal invalide refusé');
  await post({ ...base, cpNaissance: '95100' });
  assert.equal((await env.DB.prepare('SELECT cp_naissance FROM inscriptions WHERE id = ?').bind(row.id).first()).cp_naissance, '95100');
  await post({ ...base, villeNaissance: 'Casablanca', paysNaissance: 'Maroc', cpNaissance: '', numeroLicence: '' });
  const edited = await env.DB.prepare('SELECT ville_naissance, pays_naissance, numero_licence FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual({ ...edited }, { ville_naissance: 'Casablanca', pays_naissance: 'Maroc', numero_licence: null });
});

test('réinscription = fiche de la saison en cours d’un enfant déjà inscrit une saison précédente', () => {
  const rows = [
    { id: 1, saison: '2025-2026', dedup_key: 'a' },
    { id: 2, saison: '2026-2027', dedup_key: 'a' },
    { id: 3, saison: '2026-2027', dedup_key: 'b' },
    { id: 4, saison: '2025-2026', dedup_key: 'c' },
  ];
  assert.deepEqual([...reinscriptionIds(rows, '2026-2027')], [2]);
});

test('listes : Inscriptions = incomplètes hors réinscriptions ; complètes → Adhérents ; réinscriptions → Réinscription', async () => {
  const { env, cookie } = await authedEnv();
  await seedInscription(env.DB, kid('Nouveau'));
  await seedInscription(env.DB, kid('Complet', { ...COMPLETE, ville_naissance: 'Argenteuil', numero_licence: '111' }));
  await seedInscription(env.DB, kid('Revenant', { saison: '2025-2026', archived_at: '2026-07-01 10:00:00' }));
  await seedInscription(env.DB, kid('Revenant'));
  await seedInscription(env.DB, kid('Fidele', { saison: '2025-2026', archived_at: '2026-07-01 10:00:00' }));
  await seedInscription(env.DB, kid('Fidele', COMPLETE));

  const list = await (await get(listGet, env, cookie, '/admin/inscriptions')).text();
  assert.match(list, /Nouveau Fictif/);
  for (const name of ['Complet', 'Revenant', 'Fidele']) assert.doesNotMatch(list, new RegExp(`${name} Fictif`), name);
  assert.match(list, /Adhérents<\/a> \(2\)/);
  assert.match(list, /Réinscription<\/a> \(1\)/);

  const oldTab = await get(listGet, env, cookie, '/admin/inscriptions?etat=complet');
  assert.equal(oldTab.status, 302);
  assert.equal(oldTab.headers.get('Location'), '/admin/adherents');

  const csv = await (await get(listGet, env, cookie, '/admin/inscriptions?etat=complet&format=csv')).text();
  assert.match(csv.split('\r\n')[0], /"Ville de naissance","Pays de naissance","N° licence FFF"/);
  assert.match(csv, /Complet Fictif/);
  assert.match(csv, /Fidele Fictif/);
  assert.doesNotMatch(csv, /Nouveau Fictif|Revenant Fictif/);

  const reinsc = await (await get(reinscriptionGet, env, cookie, '/admin/reinscription')).text();
  const pending = reinsc.slice(reinsc.indexOf('id="a-finaliser"'), reinsc.indexOf('À réinscrire (saison précédente)'));
  assert.match(pending, /Revenant Fictif/);
  assert.doesNotMatch(pending, /Fidele Fictif|Nouveau Fictif/, 'réinscription complète = Adhérents');
});

test('espace famille : le lieu de naissance manquant bloque « complet », la famille le saisit, l’inscription devient complète', async () => {
  const env = await fixture();
  const DONE = { ...COMPLETE, ville_naissance: null, pays_naissance: null };
  const row = await seedInscription(env.DB, kid('Sans', DONE));
  const token = await issueFamilyLink(env.DB, row.organization_id, row.id);
  const page = async () => (await depotGet({ request: new Request(`https://clubdemo.licyo.fr/depot/${token}`), env, params: { token } })).text();
  const post = (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    return naissancePost({
      request: new Request(`https://clubdemo.licyo.fr/depot/${token}/naissance`, { method: 'POST', body: form, headers: { Origin: 'https://clubdemo.licyo.fr' } }),
      env, params: { token }, waitUntil: () => {},
    });
  };

  let html = await page();
  assert.match(html, /3 étapes validées sur 4/);
  assert.match(html, /id="naissance"/);
  assert.match(html, /action="\/depot\/[^"]+\/naissance"/);
  assert.doesNotMatch(html, /Dossier complet, merci/);

  assert.match((await post({ paysNaissance: 'France', cpNaissance: '951', villeNaissance: 'Argenteuil' })).headers.get('Location'), /naissanceError=/);
  assert.match((await post({ paysNaissance: 'France', cpNaissance: '95100', villeNaissance: '' })).headers.get('Location'), /naissanceError=/);
  assert.equal((await env.DB.prepare('SELECT ville_naissance FROM inscriptions WHERE id = ?').bind(row.id).first()).ville_naissance, null, 'rien écrit');

  assert.match((await post({ paysNaissance: ' France ', cpNaissance: '95100', villeNaissance: 'Argenteuil' })).headers.get('Location'), /naissanceOk=1#naissance$/);
  const saved = await env.DB.prepare('SELECT cp_naissance, ville_naissance, pays_naissance FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual({ ...saved }, { cp_naissance: '95100', ville_naissance: 'Argenteuil', pays_naissance: 'France' });
  html = await page();
  assert.match(html, /4 étapes validées sur 4/);
  assert.match(html, /Dossier complet, merci/);
  assert.match(html, /95100 Argenteuil, France/);

  assert.match((await post({ paysNaissance: 'Maroc', villeNaissance: 'Casablanca' })).headers.get('Location'), /naissanceError=/, 'complète : correction par le club');
});

test('relance : le lieu de naissance manquant est réclamé, lien direct vers l’espace famille', async (t) => {
  const env = { ...(await fixture()), BREVO_API_KEY: 'test' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    sent.push({ url: String(url), body: String(opts?.body || '') });
    return new Response('{"messageId":"x"}', { status: 201 });
  });
  const row = await seedInscription(env.DB, kid('Relance', { ...COMPLETE, ville_naissance: null }));
  assert.equal(await sendReminderEmail(env, row, 'https://clubdemo.licyo.fr'), true);
  const payload = JSON.parse(sent.find((s) => s.url.includes('brevo.com')).body);
  assert.match(payload.textContent, /Lieu de naissance/);
  assert.match(payload.textContent, /\/depot\/f[A-Za-z0-9_-]{43}#naissance/);
  assert.doesNotMatch(payload.textContent, new RegExp(row.upload_token), 'jamais le jeton interne');
  assert.match(payload.textContent, /3 sur 4 déjà validées/);
});
