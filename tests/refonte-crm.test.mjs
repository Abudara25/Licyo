// Refonte du CRM (2026-11-13) : file « À traiter » (puces, retard, aperçu), bandeau de parcours des Adhérents,
// journal d'activité de la fiche.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, COOKIE_NAME } from '../functions/_shared/admin-auth.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { DEMO_ORG_ID as ORG } from '../functions/_shared/schema.js';
import { onRequestGet as todoGet, isLate } from '../functions/admin/a-traiter.js';
import { buildActivity, activitySection } from '../functions/_shared/activity.js';
import { journeyBanner } from '../functions/_shared/crm-ui.js';

async function admin() {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'test' };
  const cookie = (await createSession(env, ORG)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const get = async (path) => (await todoGet({ request: new Request(`https://club-exemple.example${path}`, { headers: { Cookie: cookie } }), env })).text();
  return { env, get };
}

test('À traiter : file groupée, puces par type, aperçu et filtre sans JavaScript', async () => {
  const { env, get } = await admin();
  await seedInscription(env.DB, { enfant_prenom: 'Dossier', enfant_nom: 'Exemple', naissance: '2019-03-03', categorie: 'U8', dossier_key: 'k', dossier_uploaded_at: '2026-09-01 10:00:00', telephone: '0600000000' });
  await seedInscription(env.DB, { enfant_prenom: 'Caisse', enfant_nom: 'Exemple', naissance: '2020-03-03', categorie: 'U7', mode_paiement: 'Espèces', created_at: '2026-09-01 10:00:00' });
  const all = await get('/admin/a-traiter');
  assert.match(all, /class="adm-chip is-active" aria-current="true">Tout <b>\d+<\/b>/);
  assert.match(all, /href="\/admin\/a-traiter\?type=dossiers" class="adm-chip">Dossiers <b>1<\/b>/);
  assert.match(all, /class="adm-q-section is-no" id="dossiers"/);
  assert.match(all, /class="adm-q-age is-late">[^<]*<span class="visually-hidden"> \(en retard\)/);
  assert.match(all, /<aside class="adm-peek adm-surface"[\s\S]*Dossier Exemple[\s\S]*06/);
  assert.match(all, /<template data-peek-template="1">/);
  assert.match(all, /admin-queue\.js/);
  const dossiers = await get('/admin/a-traiter?type=dossiers');
  assert.match(dossiers, /id="dossiers"/);
  assert.doesNotMatch(dossiers, /id="paiements"/);
  // Type inconnu : file complète, jamais d'erreur.
  assert.match(await get('/admin/a-traiter?type=%3Cscript%3E'), /id="paiements"/);
});

test('retard : 3 jours pour ce qui bloque, 7 pour le reste, jamais pour les tenues', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  assert.equal(isLate({ tone: 'no' }, '2026-11-09 12:00:00', now), true);
  assert.equal(isLate({ tone: 'no' }, '2026-11-11 12:00:00', now), false);
  assert.equal(isLate({ tone: 'wait' }, '2026-11-09 12:00:00', now), false);
  assert.equal(isLate({ tone: 'wait' }, '2026-11-01 12:00:00', now), true);
  assert.equal(isLate({ tone: 'neutral' }, '2026-01-01 12:00:00', now), false);
  assert.equal(isLate({ tone: 'no' }, null, now), false);
});

test('parcours de l’adhérent : six étapes cliquables, comptées depuis les étapes de licence et de tenue', () => {
  const counts = [
    { stage: 'a_demander', n: 2, missing: 0, tenue_a_commander: 2, tenue_a_remettre: 0, tenue_remise: 0 },
    { stage: 'refusee', n: 1, missing: 1, tenue_a_commander: 0, tenue_a_remettre: 1, tenue_remise: 0 },
    { stage: 'attente_fff', n: 3, missing: 0, tenue_a_commander: 1, tenue_a_remettre: 1, tenue_remise: 1 },
    { stage: 'validee', n: 4, missing: 0, tenue_a_commander: 0, tenue_a_remettre: 1, tenue_remise: 3 },
  ];
  const qs = (c) => `/admin/adherents?suivi=${c.suivi}`;
  const html = journeyBanner(counts, { suivi: 'pret_a_jouer' }, qs);
  const step = (n, label) => new RegExp(`<strong>${n}</strong><span>${label}</span>`);
  assert.match(html, step(2, 'Licence à demander'));
  assert.match(html, step(4, 'Licence en cours'));
  assert.match(html, /<em>1 refusée<\/em>/);
  assert.match(html, step(4, 'Licence validée'));
  assert.match(html, step(3, 'Tenue à commander'));
  assert.match(html, step(3, 'Tenue à remettre'));
  assert.match(html, step(3, 'Prêts à jouer'));
  // L'étape active se désélectionne au clic.
  assert.match(html, /href="\/admin\/adherents\?suivi=" class="adm-journey-step is-yes is-active" aria-current="true"><strong>3<\/strong><span>Prêts à jouer/);
  assert.equal(journeyBanner(null, {}, qs), '');
});

test('journal d’activité : étapes, versements et e-mails réunis, du plus récent au plus ancien, échappés', () => {
  const row = { created_at: '2026-09-01 10:00:00', mode_paiement: 'Chèque', dossier_uploaded_at: '2026-09-03 10:00:00', dossier_verified_at: '2026-09-04 10:00:00', tenue_commandee_at: '2026-10-01 10:00:00', taille_maillot: '8 ans' };
  const payments = [{ kind: 'versement', amount_cents: 6000, mode: 'Espèces', total_recu_cents: 6000, total_du_cents: 18000, paid_on: '2026-09-02', created_at: '2026-09-05 10:00:00' }];
  const emails = [
    { kind: 'confirmation', subject: 'Inscription <reçue>', ok: 1, created_at: '2026-09-01 10:01:00' },
    { kind: 'club_upload', subject: 'Dossier', ok: 0, error: 'refus', created_at: '2026-09-03 10:01:00' },
  ];
  const events = buildActivity(row, { payments, emails });
  assert.deepEqual(events.map((e) => e.title.split(' :')[0]), ['Tenue commandée', 'Dossier signé validé', 'Alerte club', 'Dossier signé déposé', 'Versement de 60 €', 'E-mail', 'Inscription reçue']);
  const failed = events.find((e) => e.title.startsWith('Alerte club'));
  assert.equal(failed.tone, 'no');
  const html = activitySection(events);
  assert.match(html, /Inscription &lt;reçue&gt;/);
  assert.doesNotMatch(html, /<reçue>/);
  assert.match(html, /class="adm-activity-month">septembre 2026/);
  assert.match(html, /class="adm-activity-month">octobre 2026/);
  assert.match(activitySection([]), /Rien n’est encore enregistré/);
});
