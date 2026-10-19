// Photo de l'enfant à refaire (2026-10-08) : demandée depuis la fiche, la photo ne compte plus comme reçue, la famille
// reçoit les consignes (fond blanc, visage seul) et voit « À refaire » ; une nouvelle photo rétablit l'étape.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as verification from '../functions/admin/inscriptions/[id]/photo-verification.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as depot from '../functions/depot/[token].js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { isInscriptionComplete, familyHasActionPending, isPhotoToRedo } from '../functions/_shared/inscriptions-db.js';
import { buildPhotoRefusedEmail } from '../functions/_shared/confirmation-email.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { issueFamilyLink } from '../functions/_shared/family-links.js';
import { testUser } from './helpers/accounts.mjs';

const A = DEMO_ORG_ID;
const HOST = 'https://clubdemo.licyo.fr';

async function setup() {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  const cookie = (await createSession(env, A, await testUser(env, A))).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const row = await seedInscription(env.DB, {
    photo_key: 'photos/x', photo_content_type: 'image/jpeg', photo_uploaded_at: '2026-10-01 10:00:00',
    dossier_key: 'dossiers/x', dossier_uploaded_at: '2026-10-01 10:00:00', dossier_status: 'valide', paye: 1,
    ville_naissance: 'Ermont', pays_naissance: 'France', complete_notified_at: '2026-10-02 10:00:00',
  });
  return { env, cookie, row };
}

const refuse = (env, cookie, id, fields) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const value of [].concat(v)) body.append(k, value);
  return verification.onRequestPost({ request: new Request(`${HOST}/admin/inscriptions/${id}/photo-verification`, { method: 'POST', headers: { Cookie: cookie }, body }), env, params: { id: String(id) }, waitUntil: () => {} });
};

test('demander une nouvelle photo : étape « à refaire », e-mail de consignes, complet retiré', async (t) => {
  const { env, cookie, row } = await setup();
  assert.equal(isInscriptionComplete(row), true);
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 }); });

  // Sans motif ni précision : refusé.
  assert.match((await refuse(env, cookie, row.id, { action: 'refuser', notifier: 'on' })).headers.get('Location'), /photoError=/);

  const res = await refuse(env, cookie, row.id, { action: 'refuser', motifs: ['fond', 'cadrage', 'inconnu'], commentaire: '<b>devant un mur blanc</b>', notifier: 'on' });
  assert.match(res.headers.get('Location'), /photoRefus=mail#photo-enfant$/);
  const after = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(after.photo_uploaded_at, null);
  assert.equal(after.photo_key, 'photos/x', 'fichier conservé');
  assert.equal(after.photo_refus_motifs, 'fond,cadrage');
  assert.equal(after.complete_notified_at, null);
  assert.ok(isPhotoToRedo(after) && !isInscriptionComplete(after) && familyHasActionPending(after));

  const mail = sent.find((b) => /Photo de Léa à refaire/.test(b.subject));
  assert.ok(mail, 'e-mail envoyé');
  assert.match(mail.textContent, /fond blanc/);
  assert.match(mail.textContent, /Uniquement le visage/);
  assert.match(mail.htmlContent, /#photo/);
  assert.ok(mail.htmlContent.includes('&lt;b&gt;devant un mur blanc&lt;/b&gt;') && !mail.htmlContent.includes('<b>devant'));

  // Fiche admin : « Nouvelle photo demandée », étiquette « À refaire ».
  const page = await (await fiche.onRequestGet({ request: new Request(`${HOST}/admin/inscriptions/${row.id}`, { headers: { Cookie: cookie } }), env, params: { id: String(row.id) } })).text();
  assert.match(page, /Nouvelle photo demandée le/);
  assert.match(page, /À refaire/);

  // Espace famille : « À refaire » et motifs.
  const link = await issueFamilyLink(env.DB, after.organization_id, after.id);
  const family = await (await depot.onRequestGet({ request: new Request(`${HOST}/depot/${link}`), env, params: { token: link } })).text();
  assert.match(family, /La photo envoyée ne convient pas/);
  assert.match(family, /Le fond n&#39;est pas blanc|Le fond n'est pas blanc/);
  assert.match(family, /Envoyer la nouvelle photo/);
});

test('famille non prévenue : aucun e-mail ; nouvelle photo : étape rétablie', async (t) => {
  const { env, cookie, row } = await setup();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { sent.push(init); return new Response('{}', { status: 201 }); });
  const res = await refuse(env, cookie, row.id, { action: 'refuser', motifs: 'floue' });
  assert.match(res.headers.get('Location'), /photoRefus=sans/);
  assert.equal(sent.length, 0);
  // Nouvelle photo enregistrée (même écriture que photo-storage) : reçue de nouveau, plus « à refaire ».
  await env.DB.prepare("UPDATE inscriptions SET photo_uploaded_at = datetime('now') WHERE id = ?").bind(row.id).run();
  const back = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(isPhotoToRedo(back), false);
  assert.equal(isInscriptionComplete(back), true);
});

test('e-mail de photo à refaire : consignes complètes, sans motif inconnu', () => {
  const mail = buildPhotoRefusedEmail({ enfant_prenom: 'Léa', enfant_nom: 'Durand', parent_prenom: 'Samia', upload_token: 't', family_link: 'flien', photo_refus_motifs: 'personne' }, HOST);
  assert.match(mail.subject, /Photo de Léa à refaire/);
  assert.match(mail.text, /Une autre personne/);
  assert.match(mail.text, /https:\/\/clubdemo\.licyo\.fr\/depot\/flien#photo/);
  assert.doesNotMatch(mail.text, /depot\/t[#\s]/, 'jamais le jeton interne');
});
