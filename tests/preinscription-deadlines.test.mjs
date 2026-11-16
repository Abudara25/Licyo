// Délai d'inscription après une invitation (2026-11-04) : échéance posée à l'invitation, rappel unique 2 jours
// avant, place libérée à l'échéance sans rien supprimer, adhésion finalisée = formulaire + dossier (non refusé) +
// paiement, invitations antérieures prolongées, isolation par organisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getCategoriesConfig, setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import {
  ensurePreinscriptionsTable,
  setPreinscriptionGroups,
  getPreinscriptionGroups,
  insertPreinscription,
  countPreinscriptions,
} from '../functions/_shared/preinscriptions.js';
import { inviteWaitingFamily } from '../functions/_shared/preinscription-opening.js';
import { runPreinscriptionDeadlines, missingSteps } from '../functions/_shared/preinscription-deadlines.js';
import { CRON_TASKS } from '../functions/api/cron.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const SITE = 'https://club-exemple.example';
const DAY = 86400000;
const GROUP = { open: true, groupe: 'U11', label: 'U11', anneeMin: 2016, anneeMax: 2016, capacity: 3, autoCategory: false, inviteDays: 7 };

async function setup() {
  const env = { ...(await fixture()), BREVO_API_KEY: 'test' };
  await setPreinscriptionGroups(env, A, [GROUP]);
  const cfg = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, { ...cfg, categories: [...cfg.categories, { id: 'u10-u11', label: 'U10 - U11', anneeMin: 2015, anneeMax: 2016, active: true }] }, { expectedVersion: cfg.configVersion });
  await ensurePreinscriptionsTable(env.DB);
  const ids = [];
  for (const n of [1, 2, 3]) {
    await insertPreinscription(env.DB, A, GROUP, {
      enfantPrenom: `Enfant${n}`, enfantNom: 'Test', naissance: '2016-03-03', villeNaissance: 'Ermont', paysNaissance: 'France',
      parentPrenom: 'P', parentNom: 'T', email: `p${n}@example.fr`, telephone: '0600000000', tailleMaillot: '10 ans',
    });
    ids.push((await env.DB.prepare('SELECT id FROM preinscriptions WHERE email = ?').bind(`p${n}@example.fr`).first()).id);
  }
  return { env, ids };
}

function captureMail() {
  const sent = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('brevo')) {
      sent.push(JSON.parse(init.body));
      return new Response('{"messageId":"m"}', { status: 201 });
    }
    return real(url, init);
  };
  return { sent, restore: () => (globalThis.fetch = real) };
}
const later = (days) => new Date(Date.now() + days * DAY);
const get = (env, id) => env.DB.prepare('SELECT * FROM preinscriptions WHERE id = ?').bind(id).first();

test('invitation : échéance = invitation + délai du groupe, annoncée dans l’e-mail', async () => {
  const { env, ids } = await setup();
  const mail = captureMail();
  try {
    assert.equal(await inviteWaitingFamily(env, A, SITE, ids[0]), 'invited');
    const row = await get(env, ids[0]);
    const gap = Date.parse(`${row.invite_deadline_at.replace(' ', 'T')}Z`) - Date.parse(`${row.invited_at.replace(' ', 'T')}Z`);
    assert.equal(gap, 7 * DAY);
    assert.match(mail.sent[0].textContent, /À faire avant le .* dossier signé déposé et la première cotisation réglée/);
  } finally {
    mail.restore();
  }
});

test('rappel unique 2 jours avant, puis place libérée à l’échéance (ligne conservée, famille et club prévenus)', async () => {
  const { env, ids } = await setup();
  const mail = captureMail();
  try {
    await inviteWaitingFamily(env, A, SITE, ids[0]);
    mail.sent.length = 0;
    assert.deepEqual(await runPreinscriptionDeadlines(env, A, SITE, { now: later(3) }), { completed: 0, reminded: 0, expired: 0, extended: 0 }, 'trop tôt');
    assert.equal((await runPreinscriptionDeadlines(env, A, SITE, { now: later(5.5) })).reminded, 1);
    assert.equal((await runPreinscriptionDeadlines(env, A, SITE, { now: later(6) })).reminded, 0, 'un seul rappel');
    assert.equal(mail.sent.length, 1);
    assert.match(mail.sent[0].subject, /Rappel : inscription de Enfant1 à finaliser/);
    assert.match(mail.sent[0].textContent, /le formulaire d'inscription, le dossier signé, la première cotisation/);

    assert.equal(await countPreinscriptions(env.DB, A, 'U11'), 3);
    mail.sent.length = 0;
    assert.equal((await runPreinscriptionDeadlines(env, A, SITE, { now: later(7.5) })).expired, 1);
    const row = await get(env, ids[0]);
    assert.ok(row.expired_at, 'place libérée');
    assert.equal(await countPreinscriptions(env.DB, A, 'U11'), 2, 'la place ne compte plus');
    assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM preinscriptions').first()).n, 3, 'rien supprimé');
    assert.ok(mail.sent.some((m) => /délai d'inscription dépassé pour Enfant1/.test(m.subject)), 'famille prévenue');
    assert.ok(mail.sent.some((m) => /1 place\(s\) libérée\(s\)/.test(m.subject)), 'club prévenu');
    assert.equal((await runPreinscriptionDeadlines(env, A, SITE, { now: later(9) })).expired, 0, 'une seule fois');
    assert.equal((await getPreinscriptionGroups(env, A))[0].fullNotifiedAt, null, 'liste d’attente : alerte réarmée');
  } finally {
    mail.restore();
  }
});

test('finalisée = formulaire + dossier non refusé + paiement : jamais libérée, même après l’échéance', async () => {
  const { env, ids } = await setup();
  const mail = captureMail();
  try {
    for (const id of ids.slice(0, 3)) await inviteWaitingFamily(env, A, SITE, id);
    await seedInscription(env.DB, { enfant_prenom: 'Enfant1', enfant_nom: 'TEST', naissance: '2016-03-03', dossier_uploaded_at: '2026-11-05 10:00:00', dossier_status: null, paye: 1 });
    await seedInscription(env.DB, { enfant_prenom: 'Enfant2', enfant_nom: 'Test', naissance: '2016-03-03', email: 'x2@example.fr', dossier_uploaded_at: '2026-11-05 10:00:00', dossier_status: 'refuse', paye: 1 });
    await seedInscription(env.DB, { enfant_prenom: 'Enfant3', enfant_nom: 'Test', naissance: '2016-03-03', email: 'x3@example.fr', paye: 0 });
    const s = await runPreinscriptionDeadlines(env, A, SITE, { now: later(8) });
    assert.equal(s.completed, 1);
    assert.equal(s.expired, 2, 'dossier refusé ou paiement absent : non finalisée');
    assert.ok((await get(env, ids[0])).completed_at);
    assert.equal((await get(env, ids[0])).expired_at, null);
  } finally {
    mail.restore();
  }
});

test('étapes manquantes', () => {
  assert.equal(missingSteps(null).length, 3);
  assert.deepEqual(missingSteps({ dossier_uploaded_at: 'x', dossier_status: 'a_verifier', paye: 0 }), ['la première cotisation']);
  assert.deepEqual(missingSteps({ dossier_uploaded_at: 'x', dossier_status: 'refuse', paye: 1 }), ['le dossier signé']);
  assert.deepEqual(missingSteps({ dossier_uploaded_at: 'x', paye: 1 }), []);
});

test('invitation antérieure sans échéance : délai complet accordé, pas de libération immédiate', async () => {
  const { env, ids } = await setup();
  await env.DB.prepare("UPDATE preinscriptions SET invited_at = '2026-09-01 10:00:00' WHERE id = ?").bind(ids[0]).run();
  const s = await runPreinscriptionDeadlines(env, A, SITE, { now: new Date() });
  assert.equal(s.extended, 1);
  assert.equal(s.expired, 0);
  assert.ok((await get(env, ids[0])).invite_deadline_at);
});

test('tâche du matin branchée, organisation isolée', async () => {
  const { env, ids } = await setup();
  assert.equal(typeof CRON_TASKS.preinscriptions, 'function');
  await inviteWaitingFamily(env, A, SITE, ids[0]);
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b', 'b', 'B')").run();
  await env.DB.prepare("UPDATE preinscriptions SET invite_deadline_at = '2000-01-01 00:00:00' WHERE id = ?").bind(ids[0]).run();
  assert.equal((await runPreinscriptionDeadlines(env, 'org_b', SITE)).expired, 0, 'aucune ligne de A traitée pour B');
});
