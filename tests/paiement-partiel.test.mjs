// Paiement en plusieurs fois (2026-11-09) : le club enregistre un versement (60 € sur 180 €), la fiche reste non
// payée, la famille reçoit le reçu et le reste à payer, les relances rappellent le solde un mois après ; le
// versement qui atteint le montant dû passe la fiche à « payé ».
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as list from '../functions/admin/inscriptions.js';
import * as depot from '../functions/depot/[token].js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { parseEuros, formatEuros, defaultDueCents, paymentBalance, isPartiallyPaid } from '../functions/_shared/payments.js';
import { isInscriptionComplete, familyHasActionPending } from '../functions/_shared/inscriptions-db.js';
import { runReminders } from '../functions/_shared/automations.js';
import { issueFamilyLink } from '../functions/_shared/family-links.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://club-exemple.example';

async function setup(t) {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const row = await seedInscription(env.DB, {
    mode_paiement: 'Carte bancaire', photo_uploaded_at: '2026-10-01 10:00:00', dossier_key: 'dossiers/x', dossier_uploaded_at: '2026-10-01 10:00:00',
    dossier_status: 'valide', ville_naissance: 'Ermont', pays_naissance: 'France', created_at: '2026-09-01 10:00:00', auto_reminders_sent: 2,
  });
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 }); });
  const versement = async (fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ action: 'versement', ...fields })) body.set(k, v);
    const waits = [];
    const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', headers: { Cookie: cookie }, body }), env, params: { id: String(row.id) }, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  const read = () => env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  const page = async (path) => (await (path === 'liste' ? list : fiche).onRequestGet({ request: new Request(`${HOST}/admin/inscriptions${path === 'liste' ? '' : `/${row.id}`}`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  return { env, row, sent, versement, read, page };
}

test('montants : saisie en euros, centimes entiers, affichage, montant dû par défaut', () => {
  assert.equal(parseEuros('60'), 6000);
  assert.equal(parseEuros('60,50'), 6050);
  assert.equal(parseEuros(' 60.5 € '), 6050);
  for (const bad of ['', '0', '-5', 'abc', '60,555', '100000']) assert.equal(parseEuros(bad), null, bad);
  assert.equal(formatEuros(6000), '60 €');
  assert.equal(formatEuros(6050), '60,50 €');
  assert.equal(defaultDueCents({}, 180), 18000);
  assert.equal(defaultDueCents({ pass_sport_code: 'X' }, 180), 13000, "Pass'Sport : 50 € de moins");
  assert.equal(paymentBalance({ paye: 0 }), null, 'aucun versement : rien ne change');
});

test('versement de 60 € sur 180 € : non payé, reçu à la famille, solde affiché ; 120 € ensuite : payé', async (t) => {
  const { env, sent, versement, read, page } = await setup(t);
  assert.match((await versement({ montant: 'abc', du: '180' })).headers.get('Location'), /versementError=1/);
  assert.equal((await read()).montant_recu_cents, null, 'rien écrit');

  assert.match((await versement({ montant: '60', du: '180', modePaiement: 'Carte bancaire', notifier: 'on' })).headers.get('Location'), /versementOk=partiel/);
  let row = await read();
  assert.deepEqual([row.paye, row.montant_recu_cents, row.montant_du_cents, row.auto_reminders_sent], [0, 6000, 18000, 0], 'relances remises à zéro');
  assert.ok(row.last_reminder_at, "l'e-mail compte comme rappel");
  assert.ok(isPartiallyPaid(row));
  const mail = sent.find((b) => /reste 120 € à régler/.test(b.subject));
  assert.ok(mail, 'reçu envoyé');
  assert.match(mail.textContent, /Ce versement : 60 €/);
  assert.match(mail.textContent, /Reste à régler : 120 €/);
  assert.match(mail.textContent, /rappel un mois après ce paiement/);

  assert.match(await page('fiche'), /<strong>60 €<\/strong> sur 180 € · reste <strong>120 €<\/strong>/);
  // Premier versement : l'étape paiement compte, l'inscription est complète (Adhérents), le solde reste dû.
  assert.ok(isInscriptionComplete(row) && familyHasActionPending(row));
  assert.doesNotMatch(await page('liste'), /Léa Durand/, 'plus dans Inscriptions (« à compléter »)');
  const token = await issueFamilyLink(env.DB, A, row.id);
  const family = await (await depot.onRequestGet({ request: new Request(`${HOST}/depot/${token}`), env, params: { token } })).text();
  assert.match(family, /il reste <strong>120 €<\/strong>/);

  // Solde rappelé un mois après le versement, pas avant.
  const remind = (iso) => runReminders(env, A, HOST, new Date(iso));
  await env.DB.prepare("UPDATE inscriptions SET last_reminder_at = '2026-11-09 10:00:00', dernier_versement_at = '2026-11-09 10:00:00' WHERE id = ?").bind(row.id).run();
  assert.equal((await remind('2026-11-17T10:00:00Z')).sent, 0, '8 jours : trop tôt');
  assert.equal((await remind('2026-12-08T10:00:00Z')).sent, 0, '29 jours : trop tôt');
  sent.length = 0;
  assert.equal((await remind('2026-12-09T11:00:00Z')).sent, 1, 'un mois : rappel');
  assert.match(sent[0].textContent, /Vous avez déjà réglé 60 € sur 180 € : il reste 120 €/);

  assert.match((await versement({ montant: '120', du: '180', modePaiement: 'Espèces' })).headers.get('Location'), /versementOk=paye/);
  row = await read();
  assert.deepEqual([row.paye, row.montant_recu_cents, row.mode_paiement], [1, 18000, 'Espèces']);
  assert.equal(isPartiallyPaid(row), false);
  assert.match(await page('fiche'), /<strong>180 €<\/strong> sur 180 €/);
  assert.doesNotMatch(await page('fiche'), /Enregistrer un versement/, 'payé : plus de formulaire');
});

test('correction d’un versement saisi par erreur : totaux remplacés, statut recalculé, aucun e-mail', async (t) => {
  const { sent, versement, read, page } = await setup(t);
  const correct = (fields) => versement({ action: 'versement-correction', ...fields });
  await versement({ montant: '600', du: '180' });
  let row = await read();
  assert.equal(row.paye, 1, '600 € au lieu de 60 € : payée par erreur');
  assert.match(await page('fiche'), /Corriger montants ou date/);
  sent.length = 0;

  assert.match((await correct({ recu: 'abc', du: '180' })).headers.get('Location'), /correctionError=1/);
  assert.match((await correct({ recu: '60', du: '0' })).headers.get('Location'), /correctionError=1/);
  assert.equal((await read()).montant_recu_cents, 60000, 'rien écrit');

  assert.match((await correct({ recu: '60', du: '180' })).headers.get('Location'), /correctionOk=1/);
  row = await read();
  assert.deepEqual([row.paye, row.montant_recu_cents, row.montant_du_cents], [0, 6000, 18000]);
  assert.ok(row.complete_notified_at, 'toujours complète (acompte reçu) : « Dossier complet » ne repartira pas');
  assert.ok(isPartiallyPaid(row));
  assert.equal(sent.length, 0, 'aucun e-mail pour une correction');
  assert.match(await page('fiche'), /Enregistrer un versement/);

  assert.match((await correct({ recu: '0', du: '180' })).headers.get('Location'), /correctionOk=1/);
  row = await read();
  assert.deepEqual([row.paye, row.montant_recu_cents, row.dernier_versement_at], [0, null, null], 'rien reçu en fait');
  assert.equal(row.complete_notified_at, null, 'plus rien reçu : « Dossier complet » repartira au vrai paiement');
  assert.equal(paymentBalance(row), null);
});

test('historique des versements : chaque versement et correction, versements antérieurs, effacé avec la fiche', async (t) => {
  const { env, row, versement, page } = await setup(t);
  // Versement saisi avant l'historique (cumul seul).
  await env.DB.prepare('UPDATE inscriptions SET montant_recu_cents = 2000, montant_du_cents = 18000 WHERE id = ?').bind(row.id).run();
  await versement({ montant: '40', du: '180', modePaiement: 'Espèces' });
  await versement({ montant: '500', du: '180', modePaiement: 'Chèque' }); // erreur : payée
  await versement({ montant: '10', du: '180' }); // refusée : déjà payée, aucune trace
  await versement({ action: 'versement-correction', recu: '110', du: '180' });
  const entries = (await env.DB.prepare('SELECT kind, amount_cents, mode, total_recu_cents FROM payment_entries WHERE organization_id = ? AND inscription_id = ? ORDER BY id').bind(A, row.id).all()).results;
  assert.deepEqual(entries.map((e) => ({ ...e })), [
    { kind: 'versement', amount_cents: 4000, mode: 'Espèces', total_recu_cents: 6000 },
    { kind: 'versement', amount_cents: 50000, mode: 'Chèque', total_recu_cents: 56000 },
    { kind: 'correction', amount_cents: null, mode: null, total_recu_cents: 11000 },
  ]);
  const html = await page('fiche');
  assert.match(html, /Historique des versements <small>\(4\)<\/small>/);
  assert.match(html, /\+ 40 €<\/strong> <small>· Espèces/);
  assert.match(html, /<strong>Correction<\/strong><br><small>total 110 € sur 180 €/);
  assert.match(html, /Avant l’historique<\/span><span class="adm-line-value"><strong>20 €/);
  assert.ok(html.indexOf('Correction</strong>') < html.indexOf('+ 40 €'), 'plus récent en premier');

  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now'), archive_motif = 'doublon' WHERE id = ?").bind(row.id).run();
  const { deleteInscriptionPermanently } = await import('../functions/_shared/inscription-deletion.js');
  const { createR2 } = await import('./helpers/d1.mjs');
  assert.deepEqual(await deleteInscriptionPermanently({ ...env, DOSSIERS: createR2(), DOSSIERS_BACKUP: createR2() }, A, row.id), { ok: true });
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM payment_entries WHERE inscription_id = ?').bind(row.id).first()).n, 0);
});

test('chèques : 3 au plus jusqu’à septembre, 2 ensuite ; mois d’encaissement ; parts égales', async () => {
  const { maxChequesFor, chequeMonths, splitCents } = await import('../functions/_shared/payments.js');
  assert.equal(maxChequesFor(new Date('2026-09-30T12:00:00Z')), 3);
  assert.equal(maxChequesFor(new Date('2026-10-01T12:00:00Z')), 2);
  assert.equal(maxChequesFor(new Date('2027-06-15T12:00:00Z')), 3);
  assert.deepEqual(chequeMonths(3, new Date('2026-11-20T12:00:00Z')), ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(splitCents(12000, 2), [6000, 6000]);
  assert.deepEqual(splitCents(10000, 3), [3334, 3333, 3333]);
});

test('paiement par chèques : solde après 60 € en carte, fiche payée, encaissement interne sans e-mail, À traiter', async (t) => {
  const { env, row, sent, versement, read, page } = await setup(t);
  const { maxChequesFor } = await import('../functions/_shared/payments.js');
  const max = maxChequesFor();
  await versement({ montant: '60', du: '180' });
  sent.length = 0;
  assert.match(await page('fiche'), /Paiement par chèques/);

  assert.match((await versement({ action: 'cheques', nombre: String(max + 1), du: '180' })).headers.get('Location'), /chequesError=/, 'trop de chèques');
  assert.match((await versement({ action: 'cheques', nombre: '2', du: '180', montant1: '50', montant2: '50' })).headers.get('Location'), /chequesError=/, 'somme ≠ reste');
  assert.equal((await read()).paye, 0);

  assert.match((await versement({ action: 'cheques', nombre: '2', du: '180', numero1: '1234567' })).headers.get('Location'), /chequesOk=1/);
  const after = await read();
  assert.deepEqual([after.paye, after.mode_paiement, after.montant_recu_cents], [1, 'Chèque', 18000]);
  const cheques = (await env.DB.prepare('SELECT rang, montant_cents, numero, encaisse_at FROM cheques WHERE organization_id = ? AND inscription_id = ? ORDER BY rang').bind(A, row.id).all()).results;
  assert.deepEqual(cheques.map((c) => ({ ...c })), [
    { rang: 1, montant_cents: 6000, numero: '1234567', encaisse_at: null },
    { rang: 2, montant_cents: 6000, numero: null, encaisse_at: null },
  ]);
  let html = await page('fiche');
  assert.match(html, /Chèque 1\/2<br><small>60 € · n° 1234567/);
  assert.match(html, /la famille n’est pas prévenue/);

  // À traiter : le chèque du mois en cours est à encaisser.
  const { buildTodo } = await import('../functions/_shared/todo.js');
  const { chequesToCash } = await import('../functions/_shared/payments.js');
  const todo = buildTodo([after], { cheques: await chequesToCash(env.DB, A) });
  assert.equal(todo.find((s) => s.key === 'cheques').items.length, 1, 'seul le chèque de ce mois-ci');

  const first = (await env.DB.prepare('SELECT id FROM cheques WHERE inscription_id = ? AND rang = 1').bind(row.id).first()).id;
  sent.length = 0;
  await versement({ action: 'cheque-encaisse', cheque: String(first) });
  assert.ok((await env.DB.prepare('SELECT encaisse_at FROM cheques WHERE id = ?').bind(first).first()).encaisse_at);
  assert.equal(sent.length, 0, 'aucun e-mail à l’encaissement');
  assert.equal(buildTodo([after], { cheques: await chequesToCash(env.DB, A) }).find((s) => s.key === 'cheques'), undefined);
  html = await page('fiche');
  assert.match(html, /Encaissé le/);
  await versement({ action: 'cheque-encaisse', cheque: String(first) });
  assert.equal((await env.DB.prepare('SELECT encaisse_at FROM cheques WHERE id = ?').bind(first).first()).encaisse_at, null, 'annulation');
});

test('fiche marquée « Payé » alors que seuls 60 € ont été reçus : montant indiqué, non payée, rappel un mois après', async (t) => {
  const { env, row, sent, versement, read, page } = await setup(t);
  await env.DB.prepare("UPDATE inscriptions SET paye = 1, last_reminder_at = '2026-09-20 10:00:00' WHERE id = ?").bind(row.id).run();
  let html = await page('fiche');
  assert.doesNotMatch(html, /Enregistrer un versement/, 'payée : pas de versement');
  assert.match(html, /Paiement incomplet \?<\/summary>/);
  assert.match(html, /id="correction-recu" name="recu" inputmode="decimal" value="180"/, 'prérempli avec le tarif');

  assert.match((await versement({ action: 'versement-correction', recu: '60', du: '180' })).headers.get('Location'), /correctionOk=1/);
  const after = await read();
  assert.deepEqual([after.paye, after.montant_recu_cents, after.montant_du_cents, after.last_reminder_at, after.auto_reminders_sent], [0, 6000, 18000, null, 0]);
  assert.ok(after.dernier_versement_at, 'le délai d’un mois part de maintenant');
  assert.equal(sent.length, 0, 'aucun e-mail tout de suite');
  html = await page('fiche');
  assert.match(html, /reste <strong>120 €<\/strong>/);
  assert.match(html, /Enregistrer un versement/);
  assert.match(html, /Paiement par chèques/);

  const now = Date.parse(`${after.dernier_versement_at.replace(' ', 'T')}Z`);
  assert.equal((await runReminders(env, A, HOST, new Date(now + 2 * 86400000))).sent, 0, 'pas de rappel immédiat');
  assert.equal((await runReminders(env, A, HOST, new Date(now + 31 * 86400000))).sent, 1, 'rappel un mois après');
});

test('date du paiement : saisie par le club, rappel un mois après elle, refusée dans le futur, affichée et envoyée', async (t) => {
  const { parsePaymentDate, todayParis } = await import('../functions/_shared/payments.js');
  const now = new Date('2026-11-09T10:00:00Z');
  assert.equal(parsePaymentDate('', now), '2026-11-09', 'vide = aujourd’hui');
  assert.equal(parsePaymentDate('2026-11-05', now), '2026-11-05');
  for (const bad of ['2026-11-10', '2025-10-01', '2026-02-30', '05/11/2026']) assert.equal(parsePaymentDate(bad, now), null, bad);

  const { env, row, sent, versement, read, page } = await setup(t);
  const daysAgo = (n) => todayParis(new Date(Date.now() - n * 86400000));
  const future = todayParis(new Date(Date.now() + 2 * 86400000));
  assert.match((await versement({ montant: '60', du: '180', datePaiement: future })).headers.get('Location'), /versementError=1/);
  assert.equal((await read()).montant_recu_cents, null, 'rien écrit');

  const paidOn = daysAgo(10);
  await versement({ montant: '60', du: '180', datePaiement: paidOn, notifier: 'on' });
  const after = await read();
  assert.equal(after.dernier_versement_at, `${paidOn} 12:00:00`);
  const entry = await env.DB.prepare('SELECT paid_on FROM payment_entries WHERE inscription_id = ?').bind(row.id).first();
  assert.equal(entry.paid_on, paidOn);
  assert.match(await page('fiche'), /Payé le \d{2}\/\d{2}\/\d{4}<br><small>saisi le/);
  assert.match(sent.find((m) => /reste 120 €/.test(m.subject)).textContent, /versement de 60 € du \d{1,2} \S+ \d{4}/);

  const paidMs = Date.parse(`${paidOn}T12:00:00Z`);
  assert.equal((await runReminders(env, A, HOST, new Date(paidMs + 29 * 86400000))).sent, 0, '29 jours après le paiement');
  assert.equal((await runReminders(env, A, HOST, new Date(paidMs + 30 * 86400000 + 3600000))).sent, 1, 'un mois après le paiement, pas après la saisie');
});


test('date saisie par erreur : corrigée depuis « Corriger montants ou date », le rappel repart de la bonne date', async (t) => {
  const { todayParis } = await import('../functions/_shared/payments.js');
  const { env, row, versement, read } = await setup(t);
  await versement({ montant: '60', du: '180' }); // date du jour par erreur
  const real = todayParis(new Date(Date.now() - 20 * 86400000));
  assert.match((await versement({ action: 'versement-correction', recu: '60', du: '180', datePaiement: real })).headers.get('Location'), /correctionOk=1/);
  const after = await read();
  assert.equal(after.dernier_versement_at, `${real} 12:00:00`);
  assert.deepEqual([after.paye, after.montant_recu_cents], [0, 6000], 'montants inchangés');
  const entry = await env.DB.prepare("SELECT paid_on FROM payment_entries WHERE inscription_id = ? AND kind = 'correction'").bind(row.id).first();
  assert.equal(entry.paid_on, real);
  const paidMs = Date.parse(`${real}T12:00:00Z`);
  assert.equal((await runReminders(env, A, HOST, new Date(paidMs + 30 * 86400000 + 3600000))).sent, 1, 'un mois après la date corrigée');
});

test('suppression d’un versement saisi par erreur : total, statut et date recalculés ; chèques ; pas avant une correction', async (t) => {
  const { env, row, sent, versement, read, page } = await setup(t);
  const entries = async () => (await env.DB.prepare('SELECT id, amount_cents, mode, kind FROM payment_entries WHERE inscription_id = ? ORDER BY id').bind(row.id).all()).results;
  const remove = (entree) => versement({ action: 'versement-suppression', entree: String(entree) });

  await versement({ montant: '60', du: '180', datePaiement: '' });
  await versement({ montant: '120', du: '180' }); // erreur : il n'a rien versé de plus
  assert.equal((await read()).paye, 1);
  let html = await page('fiche');
  assert.equal((html.match(/name="action" value="versement-suppression"/g) || []).length, 2);
  sent.length = 0;

  const [first, second] = await entries();
  assert.match((await remove(second.id)).headers.get('Location'), /suppressionOk=1/);
  let after = await read();
  assert.deepEqual([after.paye, after.montant_recu_cents], [0, 6000], 'retour à 60 € sur 180 €');
  assert.ok(isPartiallyPaid(after) && isInscriptionComplete(after), 'reste adhérent avec un acompte');
  assert.deepEqual((await entries()).map((e) => e.id), [first.id]);
  assert.equal(sent.length, 0, 'aucun e-mail');

  // Chèques : les chèques non encaissés partent avec le versement ; refus si l'un est encaissé.
  await versement({ action: 'cheques', nombre: '1', du: '180' });
  const cheque = (await entries()).find((e) => String(e.mode).startsWith('Chèques'));
  const chequeId = (await env.DB.prepare('SELECT id FROM cheques WHERE inscription_id = ?').bind(row.id).first()).id;
  await versement({ action: 'cheque-encaisse', cheque: String(chequeId) });
  assert.match((await remove(cheque.id)).headers.get('Location'), /suppressionError=/);
  await versement({ action: 'cheque-encaisse', cheque: String(chequeId) });
  assert.match((await remove(cheque.id)).headers.get('Location'), /suppressionOk=1/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM cheques WHERE inscription_id = ?').bind(row.id).first()).n, 0);
  assert.deepEqual([(await read()).montant_recu_cents, (await read()).paye], [6000, 0]);

  // Après une correction, les versements plus anciens ne se suppriment plus.
  await versement({ action: 'versement-correction', recu: '60', du: '180' });
  assert.match((await remove(first.id)).headers.get('Location'), /suppressionError=/);
  html = await page('fiche');
  assert.doesNotMatch(html, /value="versement-suppression"/);
  assert.match(html, /antérieur à une correction ne se supprime pas/);

  // Tout supprimer : plus rien de reçu.
  await versement({ montant: '60', du: '180' });
  const last = (await entries()).at(-1);
  await remove(last.id);
  after = await read();
  assert.equal(after.montant_recu_cents, 6000, 'retour au total de la correction');
});

test('suppression d’une correction : retour exact à l’état d’avant, ancienne correction sans état, seulement la plus récente', async (t) => {
  const { env, row, sent, versement, read, page } = await setup(t);
  const entries = async () => (await env.DB.prepare('SELECT id, kind FROM payment_entries WHERE inscription_id = ? ORDER BY id').bind(row.id).all()).results;
  const undo = (entree) => versement({ action: 'correction-suppression', entree: String(entree) });

  // Fiche marquée payée sans montant, puis « Paiement incomplet ? » 60/180 : l'annulation la remet payée sans montant.
  await env.DB.prepare('UPDATE inscriptions SET paye = 1 WHERE id = ?').bind(row.id).run();
  await versement({ action: 'versement-correction', recu: '60', du: '180' });
  let html = await page('fiche');
  assert.match(html, /value="correction-suppression"/);
  assert.match(html, /aucun montant enregistré, fiche « Payé »/);
  sent.length = 0;
  let [corr] = await entries();
  assert.match((await undo(corr.id)).headers.get('Location'), /annulationOk=1/);
  let after = await read();
  assert.deepEqual([after.paye, after.montant_recu_cents, after.montant_du_cents], [1, null, null]);
  assert.equal((await entries()).length, 0);
  assert.equal(sent.length, 0, 'aucun e-mail');

  // Versement puis correction : seule la correction (la plus récente) est annulable, retour au versement.
  await env.DB.prepare('UPDATE inscriptions SET paye = 0 WHERE id = ?').bind(row.id).run();
  await versement({ montant: '60', du: '180' });
  await versement({ action: 'versement-correction', recu: '100', du: '180' });
  const [first, second] = await entries();
  assert.match((await undo(first.id)).headers.get('Location'), /suppressionError=/, 'pas un versement');
  await undo(second.id);
  after = await read();
  assert.deepEqual([after.paye, after.montant_recu_cents, after.montant_du_cents], [0, 6000, 18000]);
  html = await page('fiche');
  assert.match(html, /value="versement-suppression"/, 'le versement redevient supprimable');

  // Correction enregistrée avant cette version (sans état) et sans ligne précédente : aucun montant, non payée.
  await versement({ action: 'versement-correction', recu: '60', du: '180' });
  const legacy = (await entries()).at(-1);
  await env.DB.prepare('UPDATE payment_entries SET prev_recu_cents = NULL, prev_du_cents = NULL, prev_paye = NULL, prev_dernier_versement_at = NULL WHERE id = ?').bind(legacy.id).run();
  await env.DB.prepare('DELETE FROM payment_entries WHERE id = ?').bind(first.id).run();
  await undo(legacy.id);
  after = await read();
  assert.deepEqual([after.paye, after.montant_recu_cents, after.dernier_versement_at], [0, null, null]);
  assert.match(await page('fiche'), /Enregistrer un versement/);
});

test('modification d’un versement : montant, date et mode ; totaux décalés, statut et date recalculés, aucun e-mail sauf payé', async (t) => {
  const { env, row, sent, versement, read, page } = await setup(t);
  const { todayParis } = await import('../functions/_shared/payments.js');
  const modify = (entree, fields) => versement({ action: 'versement-modification', entree: String(entree), ...fields });
  await versement({ montant: '60', du: '180' });
  await versement({ montant: '20', du: '180' });
  const [first, second] = (await env.DB.prepare('SELECT * FROM payment_entries WHERE inscription_id = ? ORDER BY id').bind(row.id).all()).results;
  assert.match(await page('fiche'), /value="versement-modification"/);
  sent.length = 0;

  const day = todayParis(new Date(Date.now() - 3 * 86400000));
  assert.match((await modify(first.id, { montant: 'abc', datePaiement: day, modePaiement: 'Espèces' })).headers.get('Location'), /modificationError=1/);
  assert.match((await modify(first.id, { montant: '50', datePaiement: day, modePaiement: 'Espèces' })).headers.get('Location'), /modificationOk=1/);
  let after = await read();
  assert.deepEqual([after.montant_recu_cents, after.paye], [7000, 0], '60 → 50 : total 70 €');
  const rows = (await env.DB.prepare('SELECT amount_cents, mode, paid_on, total_recu_cents FROM payment_entries WHERE inscription_id = ? ORDER BY id').bind(row.id).all()).results;
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { amount_cents: 5000, mode: 'Espèces', paid_on: day, total_recu_cents: 5000 },
    { amount_cents: 2000, mode: 'Carte bancaire', paid_on: null, total_recu_cents: 7000 },
  ]);
  assert.equal(sent.length, 0, 'aucun e-mail');

  // Le plus récent porte la date du dernier paiement ; le passer à 130 € rend la fiche payée (e-mail « paiement reçu »).
  assert.match((await modify(second.id, { montant: '130', datePaiement: day, modePaiement: 'Chèque' })).headers.get('Location'), /modificationOk=1/);
  after = await read();
  assert.deepEqual([after.montant_recu_cents, after.paye, after.dernier_versement_at, after.mode_paiement], [18000, 1, `${day} 12:00:00`, 'Chèque']);
  assert.ok(sent.length >= 1, 'e-mail « paiement reçu »');
});

test('un lien vers un formulaire replié de la fiche l’ouvre (admin-nav.js)', async () => {
  const { readFile } = await import('node:fs/promises');
  const js = await readFile(new URL('../assets/js/admin-nav.js', import.meta.url), 'utf8');
  assert.match(js, /openTargetedDetails/);
  assert.match(js, /details\.open = true/);
});

test('deux versements enregistrés en même temps : le second n’écrase pas le premier (rien d’enregistré, message)', async (t) => {
  const { env, row, versement, read } = await setup(t);
  // Les deux requêtes lisent la fiche avant que l'une d'elles n'écrive.
  const prepare = env.DB.prepare.bind(env.DB);
  let reads = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  t.mock.method(env.DB, 'prepare', (sql) => {
    const statement = prepare(sql);
    if (!/^SELECT \* FROM inscriptions WHERE organization_id = \? AND id = \?$/.test(sql)) return statement;
    const wrap = (s) => ({ ...s, bind: (...args) => wrap(s.bind(...args)), first: async () => {
      const snapshot = await s.first();
      if (++reads <= 2) { if (reads === 2) release(); await gate; }
      return snapshot;
    } });
    return wrap(statement);
  });
  const [a, b] = await Promise.all([versement({ montant: '60', du: '180' }), versement({ montant: '40', du: '180' })]);
  const locations = [a, b].map((r) => r.headers.get('Location'));
  assert.equal(locations.filter((l) => /versementOk=partiel/.test(l)).length, 1, 'un seul enregistré');
  assert.equal(locations.filter((l) => /conflit=1/.test(l)).length, 1, 'l’autre refusé');
  const after = await read();
  const entries = (await env.DB.prepare('SELECT amount_cents, total_recu_cents FROM payment_entries WHERE inscription_id = ?').bind(row.id).all()).results;
  assert.equal(entries.length, 1, 'une seule ligne d’historique');
  assert.equal(after.montant_recu_cents, entries[0].amount_cents, 'total = le versement enregistré');
});

test('fiche avec versements : ni « Marquer payé / non payé » ni le champ « Paiement reçu » de Modifier ne changent le statut', async (t) => {
  const { env, row, versement, read, page } = await setup(t);
  await versement({ montant: '60', du: '180' });
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const toggle = async () => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ action: 'toggle-paye', id: String(row.id), redirectTo: `/admin/inscriptions/${row.id}` })) body.set(k, v);
    return list.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions`, { method: 'POST', headers: { Cookie: cookie }, body }), env, waitUntil: () => {} });
  };
  // Solde en cours : « Marquer payé » refusé, la carte propose d'enregistrer un versement.
  assert.match((await toggle()).headers.get('Location'), /bulkError=/);
  assert.equal((await read()).paye, 0);
  assert.doesNotMatch(await page('fiche'), /value="toggle-paye"/);

  const edit = async (paye) => {
    const current = await read();
    const body = new FormData();
    const fields = {
      enfantPrenom: current.enfant_prenom, enfantNom: current.enfant_nom, naissance: current.naissance, categorie: current.categorie,
      tailleMaillot: current.taille_maillot || '6 ans', modePaiement: current.mode_paiement, parentPrenom: current.parent_prenom,
      parentNom: current.parent_nom, email: current.email, telephone: current.telephone || '0600000000', autorisation: 'on', rgpd: 'on', paye,
    };
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    return fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', headers: { Cookie: cookie }, body }), env, params: { id: String(row.id) }, waitUntil: () => {} });
  };
  assert.match((await edit('1')).headers.get('Location'), /savedOk=1/);
  assert.equal((await read()).paye, 0, '« Payé » ignoré : il reste 120 €');
  const form = await (await fiche.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${row.id}?edit=1`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  assert.doesNotMatch(form, /name="paye"/);
  assert.match(form, /calculé d'après les versements/);

  // Payée par versements : « Marquer non payé » refusé (on supprime ou corrige un versement).
  await versement({ montant: '120', du: '180' });
  assert.equal((await read()).paye, 1);
  assert.match((await toggle()).headers.get('Location'), /bulkError=/);
  await edit('0');
  const after = await read();
  assert.deepEqual([after.paye, after.montant_recu_cents], [1, 18000]);
});

test('fiche sans versement : « Marquer payé » et le champ de Modifier fonctionnent comme avant', async (t) => {
  const { env, row, read } = await setup(t);
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const body = new FormData();
  for (const [k, v] of Object.entries({ action: 'toggle-paye', id: String(row.id) })) body.set(k, v);
  await list.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions`, { method: 'POST', headers: { Cookie: cookie }, body }), env, waitUntil: () => {} });
  assert.equal((await read()).paye, 1);
});
