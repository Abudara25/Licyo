// Exemption de paiement (2026-11-13) : « les enfants des dirigeants ne paient pas les frais de licence au club ».
// Décidée par le club sur la fiche, motif interne jamais montré à la famille ; la fiche est réglée sans montant.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as list from '../functions/admin/inscriptions.js';
import * as depot from '../functions/depot/[token].js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID as A } from '../functions/_shared/schema.js';
import { readExemption, exemptionLabel } from '../functions/_shared/payments.js';
import { isInscriptionComplete, familyHasActionPending } from '../functions/_shared/inscriptions-db.js';
import { issueFamilyLink } from '../functions/_shared/family-links.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const HOST = 'https://club-exemple.example';

async function setup(t, overrides = {}) {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const row = await seedInscription(env.DB, {
    mode_paiement: 'Espèces', photo_uploaded_at: '2026-10-01 10:00:00', dossier_key: 'dossiers/x', dossier_uploaded_at: '2026-10-01 10:00:00',
    dossier_status: 'valide', ville_naissance: 'Ermont', pays_naissance: 'France', created_at: '2026-09-01 10:00:00', ...overrides,
  });
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 }); });
  const post = async (fields) => {
    const body = new FormData();
    for (const [k, v] of Object.entries(fields)) body.set(k, v);
    const waits = [];
    const res = await fiche.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { method: 'POST', headers: { Cookie: cookie }, body }), env, params: { id: String(row.id) }, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  const read = () => env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  const page = async () => (await fiche.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  const csv = async () => (await list.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions?etat=complet&format=csv`, { headers: { Cookie: cookie } }), env })).text();
  return { env, row, sent, post, read, page, csv };
}

test('motif : liste fermée, « Autre » exige une précision, texte nettoyé et borné', () => {
  assert.deepEqual(readExemption({ motif: 'dirigeant' }), { motif: 'dirigeant', commentaire: null });
  assert.equal(readExemption({ motif: 'gratuit' }), null);
  assert.equal(readExemption({ motif: 'autre', commentaire: '  ' }), null);
  assert.deepEqual(readExemption({ motif: 'autre', commentaire: ' Fils du\nprésident ' }), { motif: 'autre', commentaire: 'Fils du président' });
  assert.equal(readExemption({ motif: 'dirigeant', commentaire: 'x'.repeat(201) }), null);
  assert.equal(exemptionLabel({ paiement_exempte: 'dirigeant', paiement_exempte_commentaire: 'Karim' }), 'Enfant de dirigeant (Karim)');
  assert.equal(exemptionLabel({}), '');
});

test('exempter : fiche réglée sans montant, complète, sans relance ni e-mail « paiement reçu » ; famille sans motif', async (t) => {
  const { env, row, sent, post, read, page, csv } = await setup(t);
  assert.match((await post({ action: 'exemption', motif: 'autre' })).headers.get('Location'), /exemptionError=/);
  assert.equal((await read()).paye, 0, 'rien écrit');

  assert.match((await post({ action: 'exemption', motif: 'dirigeant', commentaire: 'Karim <b>' })).headers.get('Location'), /exemptionOk=1#exemption/);
  const after = await read();
  assert.equal(after.paye, 1);
  assert.equal(after.paiement_exempte, 'dirigeant');
  assert.equal(after.montant_recu_cents, null);
  assert.ok(isInscriptionComplete(after), 'dernière étape : la fiche devient complète');
  assert.equal(familyHasActionPending(after), false, 'plus de relance');
  assert.ok(!sent.some((m) => /paiement reçu/i.test(m.subject || '')), 'pas d’e-mail « paiement reçu »');
  const mails = sent.map((m) => JSON.stringify(m)).join(' ');
  assert.doesNotMatch(mails, /dirigeant|Karim/i, 'motif jamais dans un e-mail famille');

  const html = await page();
  assert.match(html, /Exempté de paiement/);
  assert.ok(html.includes('Enfant de dirigeant (Karim &lt;b&gt;)') && !html.includes('Karim <b>'));
  assert.match(html, /value="exemption-retrait"/);
  assert.doesNotMatch(html, /value="toggle-paye"/, 'pas de bascule payé / non payé sur une fiche exemptée');

  const token = await issueFamilyLink(env.DB, A, row.id);
  const family = await (await depot.onRequestGet({ request: new Request(`${HOST}/depot/${token}`), env, params: { token } })).text();
  assert.match(family, /Aucun paiement à régler/);
  assert.doesNotMatch(family, /dirigeant|Karim|exempt/i, 'la famille ne voit pas le motif');

  assert.match(await csv(), /"Exemption de paiement"[\s\S]*Enfant de dirigeant \(Karim <b>\)/);

  // Bascule « Marquer non payé » refusée côté serveur aussi.
  const body = new FormData();
  for (const [k, v] of Object.entries({ action: 'toggle-paye', id: String(row.id), redirectTo: `/admin/inscriptions/${row.id}` })) body.set(k, v);
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  await list.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions`, { method: 'POST', headers: { Cookie: cookie }, body }), env, waitUntil: () => {} });
  assert.equal((await read()).paye, 1);

  // Retrait : le paiement est de nouveau demandé.
  assert.match((await post({ action: 'exemption-retrait' })).headers.get('Location'), /exemptionRemoved=1/);
  const back = await read();
  assert.equal(back.paye, 0);
  assert.equal(back.paiement_exempte, null);
  assert.equal(back.complete_notified_at, null);
});

test('refusée si un versement est déjà enregistré', async (t) => {
  const { post, read } = await setup(t, { montant_recu_cents: 6000, montant_du_cents: 18000 });
  assert.match((await post({ action: 'exemption', motif: 'dirigeant' })).headers.get('Location'), /exemptionError=/);
  const row = await read();
  assert.equal(row.paiement_exempte, null);
  assert.equal(row.montant_recu_cents, 6000);
});
