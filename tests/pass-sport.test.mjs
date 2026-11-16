// Code Pass'Sport : format « 26-XXXX-XXXX » remis en forme, 50 € déduits du montant à régler partout (2026-11-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { formatPassSportCode, normalizePassSportCode } from '../functions/_shared/pass-sport.js';
import { amountDueCents, passSportDueChange } from '../functions/_shared/payments.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { issueFamilyLink } from '../functions/_shared/family-links.js';
import { onRequestPost as apiPost } from '../functions/api/inscriptions.js';
import { onRequestGet as depotGet } from '../functions/depot/[token].js';
import { onRequestPost as passSportPost } from '../functions/depot/[token]/pass-sport.js';
import { onRequestPost as fichePost } from '../functions/admin/inscriptions/[id].js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';

test('format : majuscules, tirets, caractères parasites retirés, 10 caractères au plus', () => {
  assert.equal(formatPassSportCode('26ab12cd34'), '26-AB12-CD34');
  assert.equal(formatPassSportCode(' 26 ab-12 cd.34 '), '26-AB12-CD34');
  assert.equal(formatPassSportCode('26-ab12-cd34XYZ'), '26-AB12-CD34');
  assert.equal(formatPassSportCode('26'), '26');
  assert.equal(formatPassSportCode('26a'), '26-A');
  assert.equal(formatPassSportCode('26abcd1'), '26-ABCD-1');
  assert.equal(formatPassSportCode('26éàbc'), '26-EABC');
  assert.equal(normalizePassSportCode(''), '');
  assert.equal(normalizePassSportCode('  '), '');
  assert.equal(normalizePassSportCode('26ab12cd34'), '26-AB12-CD34');
  for (const bad of ['26ab12cd3', 'AB12CD3456', '2', 'XXXXXXXXXX']) assert.equal(normalizePassSportCode(bad), null, bad);
});

test('format : le script du navigateur applique la même règle', () => {
  const source = readFileSync(new URL('../assets/js/pass-sport.js', import.meta.url), 'utf8');
  const listeners = {};
  const input = {
    value: '', selectionStart: null, attrs: {}, validity: '',
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(type, fn) { listeners[type] = fn; },
    setCustomValidity(msg) { this.validity = msg; },
    setSelectionRange() {},
  };
  vm.runInNewContext(source, { document: { readyState: 'complete', activeElement: null, querySelectorAll: () => [input] } });
  for (const [typed, expected] of [['26ab12cd34', '26-AB12-CD34'], ['26 ab', '26-AB'], ['26-AB12-CD34ZZ', '26-AB12-CD34']]) {
    input.value = typed;
    listeners.input();
    assert.equal(input.value, expected);
    assert.equal(input.value, formatPassSportCode(typed));
  }
  assert.equal(input.validity, '');
  input.value = '26ab';
  listeners.input();
  assert.notEqual(input.validity, '', 'code incomplet signalé');
  assert.equal(input.attrs.autocapitalize, 'characters');
});

test('montant dû : tarif moins 50 € avec un code ; montant enregistré prioritaire ; ajout ou retrait après coup', () => {
  assert.equal(amountDueCents({ pass_sport_code: '26-AB12-CD34' }, 180), 13000);
  assert.equal(amountDueCents({}, 180), 18000);
  assert.equal(amountDueCents({ montant_du_cents: 9000, pass_sport_code: 'x' }, 180), 9000);
  assert.equal(amountDueCents({}, null), null);
  assert.equal(passSportDueChange({ montant_du_cents: null }, '26-AB12-CD34'), null, 'sans montant enregistré : rien à recalculer');
  assert.equal(passSportDueChange({ montant_du_cents: 18000, pass_sport_code: 'A' }, 'B'), null);
  assert.deepEqual(passSportDueChange({ montant_du_cents: 18000, montant_recu_cents: 6000, paye: 0 }, '26-AB12-CD34'), { du: 13000, paye: 0 });
  assert.deepEqual(passSportDueChange({ montant_du_cents: 18000, montant_recu_cents: 13000, paye: 0 }, '26-AB12-CD34'), { du: 13000, paye: 1 });
  assert.deepEqual(passSportDueChange({ montant_du_cents: 13000, montant_recu_cents: 13000, paye: 1, pass_sport_code: '26-AB12-CD34' }, ''), { du: 18000, paye: 0 });
});

const submit = (env, data) =>
  apiPost({
    request: new Request('https://club-exemple.example/api/inscriptions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': randomUUID() }, body: JSON.stringify(data),
    }),
    env, waitUntil: () => {},
  });

test('API : code mal formé refusé sans écriture, code tapé en minuscules enregistré au bon format', async () => {
  const env = await fixture();
  const refused = await submit(env, { ...validData, passSportCode: '26-AB12' });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /26-XXXX-XXXX/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 0);
  assert.equal((await submit(env, { ...validData, passSportCode: '26ab12cd34' })).status, 200);
  assert.equal((await env.DB.prepare('SELECT pass_sport_code FROM inscriptions').first()).pass_sport_code, '26-AB12-CD34');
});

async function familyPage(env, row) {
  const token = await issueFamilyLink(env.DB, row.organization_id, row.id);
  const page = async (query = '') => (await depotGet({ request: new Request(`https://club-exemple.example/depot/${token}${query}`), env, params: { token } })).text();
  const add = (code) => {
    const form = new FormData();
    form.set('passSportCode', code);
    return passSportPost({
      request: new Request(`https://club-exemple.example/depot/${token}/pass-sport`, { method: 'POST', body: form, headers: { Origin: 'https://club-exemple.example' } }),
      env, params: { token }, waitUntil: () => {},
    });
  };
  return { page, add };
}

test('espace famille : la famille ajoute son code, le montant à régler baisse de 50 €', async () => {
  const env = await fixture();
  const row = await seedInscription(env.DB, { mode_paiement: 'Espèces' });
  const { page, add } = await familyPage(env, row);
  let html = await page();
  assert.match(html, /J'ai un code Pass'Sport|J&#39;ai un code Pass/);
  assert.match(html, /action="\/depot\/[^"]+\/pass-sport"/);

  assert.match((await add('26-AB')).headers.get('Location'), /passSportError=/);
  assert.equal((await env.DB.prepare('SELECT pass_sport_code FROM inscriptions WHERE id = ?').bind(row.id).first()).pass_sport_code, null);

  assert.match((await add('26ab12cd34')).headers.get('Location'), /passSportOk=1#paiement$/);
  assert.equal((await env.DB.prepare('SELECT pass_sport_code FROM inscriptions WHERE id = ?').bind(row.id).first()).pass_sport_code, '26-AB12-CD34');
  html = await page();
  assert.match(html, /26-AB12-CD34/);
  assert.match(html, /50 € déduits/);
});

test('espace famille : versement commencé, le montant dû suit ; un code ne peut pas solder seul ni modifier une fiche payée', async () => {
  const env = await fixture();
  const partial = await seedInscription(env.DB, { mode_paiement: 'Espèces', montant_du_cents: 18000, montant_recu_cents: 6000, paye: 0 });
  let f = await familyPage(env, partial);
  assert.match((await f.add('26ab12cd34')).headers.get('Location'), /passSportOk=1/);
  let saved = await env.DB.prepare('SELECT montant_du_cents, paye FROM inscriptions WHERE id = ?').bind(partial.id).first();
  assert.deepEqual({ ...saved }, { montant_du_cents: 13000, paye: 0 });
  assert.match(await f.page(), /il reste <strong>70 €<\/strong>/);

  const almost = await seedInscription(env.DB, { enfant_prenom: 'Noé', mode_paiement: 'Espèces', montant_du_cents: 18000, montant_recu_cents: 13000, paye: 0 });
  f = await familyPage(env, almost);
  assert.match((await f.add('26ab12cd34')).headers.get('Location'), /passSportError=/);
  saved = await env.DB.prepare('SELECT montant_du_cents, paye, pass_sport_code FROM inscriptions WHERE id = ?').bind(almost.id).first();
  assert.deepEqual({ ...saved }, { montant_du_cents: 18000, paye: 0, pass_sport_code: null });

  const paid = await seedInscription(env.DB, { enfant_prenom: 'Lou', paye: 1 });
  f = await familyPage(env, paid);
  assert.match((await f.add('26ab12cd34')).headers.get('Location'), /passSportError=/);
});

test('fiche admin : code ajouté après un versement = montant dû réduit de 50 € et fiche payée si le total est atteint', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const row = await seedInscription(env.DB, { mode_paiement: 'Espèces', montant_du_cents: 18000, montant_recu_cents: 13000, paye: 0 });
  const save = (code) => {
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...validData, modePaiement: 'Espèces', naissance: row.naissance, passSportCode: code })) {
      if (v === false) continue;
      form.set(k, v === true ? 'on' : String(v));
    }
    return fichePost({
      request: new Request(`https://club-exemple.example/admin/inscriptions/${row.id}`, { method: 'POST', body: form, headers: { Cookie: cookie } }),
      env, params: { id: String(row.id) }, waitUntil: () => {},
    });
  };
  assert.equal((await save('26-AB')).status, 400);
  assert.equal((await save('26ab12cd34')).status, 302);
  let saved = await env.DB.prepare('SELECT pass_sport_code, montant_du_cents, paye FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual({ ...saved }, { pass_sport_code: '26-AB12-CD34', montant_du_cents: 13000, paye: 1 });
  // Code retiré (non valable) : les 50 € redeviennent dus.
  assert.equal((await save('')).status, 302);
  saved = await env.DB.prepare('SELECT pass_sport_code, montant_du_cents, paye FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual({ ...saved }, { pass_sport_code: null, montant_du_cents: 18000, paye: 0 });
});

test('fiche admin : Pass\'Sport non déduit d\'un montant dû au tarif plein (130 € reçus sur 180 €) → bouton, fiche payée', async () => {
  const { onRequestGet: ficheGet } = await import('../functions/admin/inscriptions/[id].js');
  const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const row = await seedInscription(env.DB, { pass_sport_code: '26-AB12-CD34', mode_paiement: 'Carte bancaire', montant_du_cents: 18000, montant_recu_cents: 13000, paye: 0 });
  const page = async () => (await ficheGet({ request: new Request(`https://club-exemple.example/admin/inscriptions/${row.id}`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  let html = await page();
  assert.match(html, /Déduire les 50 € du Pass'Sport/);
  assert.match(html, /pas encore déduit/);
  const tasks = [];
  const form = new FormData();
  form.set('action', 'passsport-deduire');
  const res = await fichePost({
    request: new Request(`https://club-exemple.example/admin/inscriptions/${row.id}`, { method: 'POST', body: form, headers: { Cookie: cookie } }),
    env, params: { id: String(row.id) }, waitUntil: (t) => tasks.push(t),
  });
  await Promise.allSettled(tasks);
  assert.equal(res.status, 302);
  const saved = await env.DB.prepare('SELECT montant_du_cents, montant_recu_cents, paye FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.deepEqual({ ...saved }, { montant_du_cents: 13000, montant_recu_cents: 13000, paye: 1 });
  const entry = await env.DB.prepare('SELECT kind, total_du_cents, prev_du_cents FROM payment_entries WHERE inscription_id = ?').bind(row.id).first();
  assert.deepEqual({ ...entry }, { kind: 'correction', total_du_cents: 13000, prev_du_cents: 18000 });
  html = await page();
  assert.doesNotMatch(html, /Déduire les 50 € du Pass'Sport/);
  // Rejoué : rien ne change.
  form.set('action', 'passsport-deduire');
  await fichePost({ request: new Request(`https://club-exemple.example/admin/inscriptions/${row.id}`, { method: 'POST', body: form, headers: { Cookie: cookie } }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  assert.equal((await env.DB.prepare('SELECT montant_du_cents FROM inscriptions WHERE id = ?').bind(row.id).first()).montant_du_cents, 13000);
});
