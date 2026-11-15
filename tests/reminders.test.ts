// Relances automatiques (src/lib/reminders.ts, migration 0007) sur une vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { DEFAULT_POLICY, dueStep, missingDocuments, parseReminderPolicy, planClubReminders, runReminders, type PlannedReminder } from '../src/lib/reminders.ts';

const CLUB = '10000000-0000-4000-8000-00000000000a';
const CAT_Q = '20000000-0000-4000-8000-0000000000a1'; // questionnaire de santé
const CAT_C = '20000000-0000-4000-8000-0000000000a2'; // certificat exigé
const SEASON = '2026-2027';
const T0 = new Date('2026-10-01T08:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * 86400000);

const POLICY = { enabled: true, delaysDays: [3, 7], kinds: { documents: true, correction: true, payment: true } };

function setup(policy: unknown = POLICY) {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status, current_season, reminder_policy) VALUES (?, 'Club A', 'a', 'Paris', '75001', 'a@test.fr', 'active', ?, ?)`, CLUB, SEASON, JSON.stringify(policy));
  run(`INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price, medical_requirement) VALUES (?, ?, 'U11', 2015, 2017, 150, 'health_questionnaire')`, CAT_Q, CLUB);
  run(`INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price, medical_requirement) VALUES (?, ?, 'Compét', 2000, 2017, 200, 'medical_cert_competition')`, CAT_C, CLUB);
  const family = (email: string, total = 150, paid = 0, status = 'unpaid') => {
    const id = crypto.randomUUID();
    run(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code, final_total_amount, amount_paid, payment_status, created_at) VALUES (?, ?, ?, 'Paul', 'N', ?, '0600000000', 'U', '0600000001', '1 rue', 'Paris', '75001', ?, ?, ?, ?)`,
      id, CLUB, SEASON, email, total, paid, status, T0.toISOString());
    return id;
  };
  const member = (fam: string, opts: { cat?: string; status?: string; photo?: string | null; medical?: string | null; hq?: number; reason?: string } = {}) => {
    const id = crypto.randomUUID();
    run(`INSERT INTO members (id, club_id, family_id, category_id, season, first_name, last_name, birth_date, dossier_status, photo_storage_path, medical_doc_storage_path, health_questionnaire_passed, rejection_reason, magic_action_token, created_at) VALUES (?, ?, ?, ?, ?, 'Léa', 'N', '2016-01-01', ?, ?, ?, ?, ?, ?, ?)`,
      id, CLUB, fam, opts.cat ?? CAT_Q, SEASON, opts.status ?? 'pending_review', opts.photo === undefined ? 'p.jpg' : opts.photo, opts.medical ?? null, opts.hq ?? 1, opts.reason ?? null, crypto.randomUUID(), T0.toISOString());
    return id;
  };
  const club = () => raw.prepare('SELECT id, current_season, reminder_policy FROM clubs WHERE id = ?').get(CLUB) as { id: string; current_season: string; reminder_policy: string };
  return { raw, db: sqliteAdapter(raw), family, member, club };
}

test('réglages : désactivé par défaut, délais nettoyés (1 à 60 jours, triés, 3 au plus)', () => {
  assert.deepEqual(parseReminderPolicy(undefined), DEFAULT_POLICY);
  assert.equal(DEFAULT_POLICY.enabled, false);
  assert.deepEqual(parseReminderPolicy({ enabled: true, delaysDays: [14, 3, 3, 0, 90, 7, 21] }).delaysDays, [3, 7, 14]);
  assert.deepEqual(parseReminderPolicy({ delaysDays: [] }).delaysDays, [3, 7, 14]);
  assert.equal(parseReminderPolicy({ kinds: { payment: false } }).kinds.payment, false);
});

test('pièces manquantes : photo, et certificat seulement quand il est exigé', () => {
  const base = { photo_storage_path: 'p', medical_doc_storage_path: null, health_questionnaire_passed: 1 };
  assert.deepEqual(missingDocuments({ ...base, medical_requirement: 'health_questionnaire' }), []);
  assert.deepEqual(missingDocuments({ ...base, health_questionnaire_passed: 0, medical_requirement: 'health_questionnaire' }), ['certificat médical']);
  assert.deepEqual(missingDocuments({ ...base, photo_storage_path: null, medical_requirement: 'medical_cert_competition' }), ['photo d’identité', 'certificat médical']);
});

test('échéance : étape suivante après son délai, 2 jours au moins après la précédente, jamais au-delà de la dernière', () => {
  const base = T0.toISOString();
  assert.equal(dueStep({ now: at(2), base, delaysDays: [3, 7], sentSteps: 0, lastSentAt: null }), null);
  assert.equal(dueStep({ now: at(3), base, delaysDays: [3, 7], sentSteps: 0, lastSentAt: null }), 1);
  assert.equal(dueStep({ now: at(7), base, delaysDays: [3, 7], sentSteps: 1, lastSentAt: at(6).toISOString() }), null, 'écart minimal');
  assert.equal(dueStep({ now: at(8), base, delaysDays: [3, 7], sentSteps: 1, lastSentAt: at(6).toISOString() }), 2);
  assert.equal(dueStep({ now: at(30), base, delaysDays: [3, 7], sentSteps: 2, lastSentAt: at(8).toISOString() }), null);
});

test('planification : pièces, correction, paiement ; une seule relance par adresse et par exécution', async () => {
  const { db, family, member, club } = setup();
  const f1 = family('a@x.fr', 150, 150, 'paid');
  member(f1, { photo: null }); // pièces
  const f2 = family('b@x.fr', 150, 150, 'paid');
  member(f2, { status: 'needs_correction', reason: 'Photo floue' });
  const f3 = family('c@x.fr', 200, 50, 'partial');
  member(f3); // dossier complet, mais reste à payer
  const f4 = family('d@x.fr', 150, 150, 'paid');
  member(f4); // rien à relancer
  const plan = await planClubReminders(db, club(), at(3));
  assert.deepEqual(plan.map((p) => [p.recipient, p.kind, p.step]).sort(), [['a@x.fr', 'documents', 1], ['b@x.fr', 'correction', 1], ['c@x.fr', 'payment', 1]]);
  assert.equal(plan.find((p) => p.kind === 'payment')?.amountDue, 150);
  // Même famille, deux motifs : une seule relance ce jour-là.
  const f5 = family('e@x.fr', 150, 0, 'unpaid');
  member(f5, { photo: null });
  assert.equal((await planClubReminders(db, club(), at(3))).filter((p) => p.recipient === 'e@x.fr').length, 1);
});

test('paiement : les chèques déjà remis ne déclenchent pas de relance', async () => {
  const { db, raw, family, member, club } = setup();
  const f = family('a@x.fr', 150, 0, 'unpaid');
  member(f);
  raw.prepare(`INSERT INTO payment_installments (id, club_id, family_id, amount, payment_type) VALUES (?, ?, ?, 150, 'check')`).run(crypto.randomUUID(), CLUB, f);
  assert.equal((await planClubReminders(db, club(), at(10))).length, 0);
});

test('correction : délai compté depuis l’e-mail de demande du bureau', async () => {
  const { db, raw, family, member, club } = setup();
  const f = family('a@x.fr', 150, 150, 'paid');
  member(f, { status: 'needs_correction' });
  raw.prepare(`INSERT INTO email_log (id, club_id, kind, recipient, subject, provider, status, created_at) VALUES (?, ?, 'correction_demandee', 'a@x.fr', 'S', 'platform', 'sent', ?)`).run(crypto.randomUUID(), CLUB, at(20).toISOString());
  assert.equal((await planClubReminders(db, club(), at(22))).length, 0, '2 jours après la demande : trop tôt');
  assert.equal((await planClubReminders(db, club(), at(23))).length, 1);
});

test('envoi : jamais deux fois la même relance ; échec = réessai à l’exécution suivante', async () => {
  const { db, raw, family, member } = setup();
  member(family('a@x.fr', 150, 150, 'paid'), { photo: null });
  const sent: PlannedReminder[] = [];
  assert.match(await runReminders(db, at(3), async (r) => void sent.push(r)), /envoyees=1/);
  assert.match(await runReminders(db, at(3), async (r) => void sent.push(r)), /envoyees=0/, 'rejouée le même jour : rien de plus');
  assert.match(await runReminders(db, at(4), async (r) => void sent.push(r)), /envoyees=0/, 'étape 2 pas encore due');
  assert.deepEqual(sent.map((r) => r.step), [1]);
  assert.equal((raw.prepare('SELECT count(*) AS n FROM reminder_log').get() as { n: number }).n, 1);
});

test('envoi : étapes successives puis arrêt ; panne d’envoi sans trace', async () => {
  const { db, raw, family, member } = setup();
  member(family('a@x.fr', 150, 150, 'paid'), { photo: null });
  const steps: number[] = [];
  const ok = async (r: PlannedReminder) => void steps.push(r.step);
  await runReminders(db, at(3), ok);
  await runReminders(db, at(7), ok);
  await runReminders(db, at(30), ok);
  assert.deepEqual(steps, [1, 2], 'deux étapes configurées, puis plus rien');

  const other = setup();
  other.member(other.family('b@x.fr', 150, 150, 'paid'), { photo: null });
  assert.match(await runReminders(other.db, at(3), async () => { throw new Error('panne'); }), /echecs=1/);
  assert.equal((other.raw.prepare('SELECT count(*) AS n FROM reminder_log').get() as { n: number }).n, 0, 'libérée pour réessayer');
  assert.match(await runReminders(other.db, at(4), ok), /envoyees=1/);
  void raw;
});

test('club sans relances activées : aucun envoi ; journal lu par le bureau seulement', async () => {
  const { db, raw, family, member } = setup({ ...POLICY, enabled: false });
  member(family('a@x.fr', 150, 0, 'unpaid'), { photo: null });
  assert.match(await runReminders(db, at(30), async () => assert.fail('aucun envoi attendu')), /clubs=0/);
  raw.prepare(`INSERT INTO reminder_log (id, club_id, target_type, target_id, kind, step, recipient) VALUES (?, ?, 'member', 'm', 'documents', 1, 'a@x.fr')`).run(crypto.randomUUID(), CLUB);
  const users = { sec: '00000000-0000-4000-8000-000000000001', coach: '00000000-0000-4000-8000-000000000002' };
  for (const [k, id] of Object.entries(users)) raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${k}@t.fr`);
  raw.prepare(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', 'secretary')`).run(crypto.randomUUID(), users.sec, CLUB);
  raw.prepare(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', 'coach')`).run(crypto.randomUUID(), users.coach, CLUB);
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(users.sec).from('reminder_log').select('id')).data?.length, 1);
  assert.equal((await as(users.coach).from('reminder_log').select('id')).data?.length, 0);
});
