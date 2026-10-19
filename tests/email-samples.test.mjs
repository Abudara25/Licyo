// 2026-10-09 : exemples d’e-mails (outil technique, plus proposé dans /admin/parametres depuis le 2026-10-14) : un exemplaire de chaque e-mail, données fictives, tout vers
// l'adresse de test, aucune écriture hors du journal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { sendEmailSamples } from '../functions/_shared/email-samples.js';
import { EMAIL_KINDS } from '../functions/_shared/email-log.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const TO = 'test-exemples@example.fr';

async function setup(t) {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  await getCategoriesConfig(env, A);
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  return { env, sent };
}

test('exemples : un e-mail par type, tous vers l’adresse de test, objet préfixé, aucune vraie fiche touchée', async (t) => {
  const { env, sent } = await setup(t);
  const real = await seedInscription(env.DB, { email: 'vraie.famille@example.fr' });
  const before = JSON.stringify(await env.DB.prepare('SELECT * FROM inscriptions').all());

  const results = await sendEmailSamples(env, A, 'https://clubdemo.licyo.fr', TO);
  assert.deepEqual(results.filter((r) => !r.ok), [], 'tous partis');
  assert.equal(sent.length, results.length);
  for (const body of sent) {
    assert.deepEqual(body.to, [{ email: TO }]);
    assert.match(body.subject, /^\[Exemple\] /);
    assert.doesNotMatch(JSON.stringify(body), /vraie\.famille|contact@clubdemo\.licyo\.fr"\}\]/);
  }
  assert.equal(JSON.stringify(await env.DB.prepare('SELECT * FROM inscriptions').all()), before, 'aucune écriture dans les inscriptions');
  const logs = (await env.DB.prepare('SELECT kind, origin, inscription_id FROM email_log').all()).results;
  assert.ok(logs.every((l) => l.origin === 'manuel' && l.inscription_id === null));
  const kinds = new Set(logs.map((l) => l.kind));
  for (const kind of Object.keys(EMAIL_KINDS)) assert.ok(kinds.has(kind), `type « ${kind} » couvert`);
  assert.ok(real.id > 0);
  // Aucune précision saisie : la ligne « Précision du club » n'apparaît pas (refus du dossier, photo à refaire).
  for (const body of sent.filter((b) => /refus|à refaire|corriger/i.test(b.subject + b.textContent))) {
    assert.doesNotMatch(body.htmlContent + body.textContent, /Précision du club/);
  }
});

test('refus du dossier ou de la photo : « Précision du club » seulement si le club en a écrit une', async (t) => {
  const { env, sent } = await setup(t);
  const { sendDossierRefusedEmail, sendPhotoRefusedEmail } = await import('../functions/_shared/confirmation-email.js');
  const { sampleRow } = await import('../functions/_shared/email-samples.js');
  const row = sampleRow(A, TO);
  for (const commentaire of ['', '   ']) {
    await sendDossierRefusedEmail(env, { ...row, dossier_status: 'refuse', dossier_refus_motifs: 'signature', dossier_refus_commentaire: commentaire }, 'https://clubdemo.licyo.fr');
    await sendPhotoRefusedEmail(env, { ...row, photo_refused_at: '2026-10-02', photo_refus_motifs: 'fond', photo_refus_commentaire: commentaire }, 'https://clubdemo.licyo.fr');
  }
  assert.equal(sent.length, 4);
  for (const body of sent) assert.doesNotMatch(body.htmlContent + body.textContent, /Précision du club/);
  sent.length = 0;
  await sendDossierRefusedEmail(env, { ...row, dossier_status: 'refuse', dossier_refus_motifs: 'signature', dossier_refus_commentaire: 'Page 2 manquante' }, 'https://clubdemo.licyo.fr');
  assert.match(sent[0].textContent, /Précision du club : Page 2 manquante/);
});
