import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { buildTodo } from '../functions/_shared/todo.js';
import { reminderDueAt } from '../functions/_shared/reminder-policy.js';
import { clubPracticalInfo } from '../functions/_shared/club-practical.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { getPublicData, saveSchedule, saveLocation } from '../functions/_shared/public-data.js';
import { sendFollowUpEmail, sendReminderEmail } from '../functions/_shared/confirmation-email.js';
import { DEMO_ORG_ID as ORG } from '../functions/_shared/schema.js';

const now = Date.parse('2026-11-12T12:00:00Z');
const base = { id: 1, enfant_prenom: 'Enfant', enfant_nom: 'Fictif', created_at: '2026-09-01 12:00:00', montant_du_cents: 18000, montant_recu_cents: 6000, paye: 0, dernier_versement_at: '2026-10-20 12:00:00', mode_paiement: 'Carte bancaire', infos_famille_requises: 1 };

test('À traiter : le solde suit la même échéance que le cron et les raccourcis visent la bonne action', () => {
  const list = (row) => buildTodo([row], { now });
  assert.equal(reminderDueAt(base), Date.parse('2026-11-19T12:00:00Z'));
  assert.ok(!list(base).some((s) => s.key === 'relances'), 'aucune relance prématurée après un acompte');
  assert.equal(list(base).find((s) => s.key === 'paiements').items[0].actions[0].href, '/admin/inscriptions/1#versement');
  const due = { ...base, dernier_versement_at: '2026-10-01 12:00:00' };
  const item = list(due).find((s) => s.key === 'relances').items[0];
  assert.match(item.detail, /coordonnées et autorisations/);
  assert.match(item.detail, /solde de 120/);
  assert.equal(item.actions[0].href, '/admin/inscriptions/1#relancer');
  assert.equal(reminderDueAt({ ...due, auto_reminders_sent: 2 }, { automatic: true }), null);
  assert.notEqual(reminderDueAt({ ...due, auto_reminders_sent: 2 }), null, 'relance manuelle encore possible');
  assert.equal(reminderDueAt({ ...due, archived_at: '2026-11-01' }), null);
});

test('À traiter : invitations éducateurs et photos manquantes, sans inclure les fiches complètes ou retirées', () => {
  const educateurs = [
    { id: 1, prenom: 'Encadrant', nom: 'Fictif' },
    { id: 2, prenom: 'Autre', nom: 'Fictif', submitted_at: '2026-11-01' },
    { id: 3, submitted_at: '2026-11-01', photo_uploaded_at: '2026-11-01' },
    { id: 4, archived_at: '2026-11-01' },
  ];
  const items = buildTodo([], { educateurs }).find((s) => s.key === 'educateurs').items;
  assert.deepEqual(items.map((i) => i.id), [1, 2]);
  assert.equal(items[0].actions[0].href, '/admin/educateurs/1#lien');
  assert.equal(items[1].actions[0].href, '/admin/educateurs/2#photo');
});

test('suivi par e-mail : lieu de naissance, coordonnées et solde ne disparaissent pas', async (t) => {
  const env = { ...(await fixture()), BREVO_API_KEY: 'test' };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"messageId":"test"}', { status: 201 }); });
  const { id, ...fields } = base;
  const row = await seedInscription(env.DB, { ...fields, email: 'coherence@example.invalid' });
  await sendFollowUpEmail(env, row, 'https://club-exemple.example', { step: 'photo' });
  const received = sent.find((m) => m.to.some((p) => p.email === row.email) && /photo reçue/.test(m.subject));
  assert.ok(received);
  for (const text of [received.textContent, received.htmlContent]) {
    assert.match(text, /Coordonnées et autorisations/);
    assert.match(text, /Lieu de naissance/);
    assert.match(text, /Il reste :[\s\S]*solde de 120/);
  }
  await sendFollowUpEmail(env, row, 'https://club-exemple.example', { complete: true });
  const complete = sent.find((m) => m.to.some((p) => p.email === row.email) && /Dossier complet/.test(m.subject));
  assert.ok(complete);
  assert.match(complete.textContent, /Il reste 120 € à régler/);
  assert.doesNotMatch(complete.textContent, /toutes les étapes de l'inscription.*validées/);
});

test('horaires et lieu administrés : mêmes valeurs dans les relances et le suivi, aucune ancienne valeur après retrait', async (t) => {
  const env = { ...(await fixture()), BREVO_API_KEY: 'test' };
  const row = await seedInscription(env.DB, { paye: 1 });
  await getCategoriesConfig(env, ORG);
  const data = await getPublicData(env, ORG);
  await saveLocation(env, ORG, data.locations[0].id, { name: 'Terrain de démonstration', address: 'Adresse fictive', mapsUrl: '' });
  assert.deepEqual(await saveSchedule(env, ORG, data.schedules[0].id, { weekday: 6, start: '10:30', end: '11:30', locationId: data.locations[0].id, groupId: null }), {});
  const practical = await clubPracticalInfo(env, row);
  assert.match(practical.schedule, /samedi, 10h30 – 11h30/);
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => { sent.push(JSON.parse(init.body)); return new Response('{"messageId":"test"}', { status: 201 }); });
  await sendFollowUpEmail(env, row, 'https://club-exemple.example', { step: 'paiement' });
  await sendReminderEmail(env, { ...row, paye: 0 }, 'https://club-exemple.example');
  for (const mail of sent) for (const text of [mail.textContent, mail.htmlContent]) {
    assert.match(text, /samedi, 10h30 – 11h30/);
    assert.match(text, /Terrain de démonstration/);
    assert.doesNotMatch(text, /jeudi.*17h/);
  }
  await env.DB.prepare('UPDATE group_schedules SET is_public = 0 WHERE organization_id = ?').bind(ORG).run();
  assert.equal((await clubPracticalInfo(env, row)).schedule, '');
});
