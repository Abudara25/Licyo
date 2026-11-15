// Socle de fiabilité : tâches planifiées (verrou, indépendance, purge), Turnstile, journal des e-mails (migration 0005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { RETENTION, TASKS, runScheduledTasks, runTask, sameSecret } from '../src/lib/scheduled.ts';
import { verifyTurnstile } from '../src/lib/security/turnstile.ts';

const NOW = new Date('2026-11-15T03:17:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

function seed() {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES ('c1', 'Club', 'club', 'Paris', '75001', 'a@test.fr', 'active')`);
  const mail = `INSERT INTO email_log (id, club_id, kind, recipient, subject, provider, status, created_at) VALUES (?, 'c1', 'test', 'p@test.fr', 'S', 'platform', 'sent', ?)`;
  run(mail, 'old', daysAgo(RETENTION.emailLogDays + 1));
  run(mail, 'recent', daysAgo(10));
  run(`INSERT INTO rate_limits (bucket, window_start, hits) VALUES ('a', ?, 1), ('b', ?, 1)`, daysAgo(5), daysAgo(0));
  run(`INSERT INTO auth_users (id, email) VALUES ('00000000-0000-4000-8000-000000000001', 'u@test.fr')`);
  run(`INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ('s-old', '00000000-0000-4000-8000-000000000001', ?), ('s-ok', '00000000-0000-4000-8000-000000000001', ?)`, daysAgo(1), daysAgo(-10));
  return { raw, db: sqliteAdapter(raw) };
}

test('purge : applique les durées de conservation, garde le récent', async () => {
  const { raw, db } = seed();
  const results = await runScheduledTasks(db, NOW);
  assert.deepEqual(results.map((r) => r.status), ['ok', 'ok']);
  assert.match(results[0].detail, /emails=1 .*limites=1 .*sessions=1/);
  const ids = (sql: string) => (raw.prepare(sql).all() as { id: string }[]).map((r) => r.id);
  assert.deepEqual(ids('SELECT id FROM email_log'), ['recent']);
  assert.deepEqual(ids('SELECT token_hash AS id FROM auth_sessions'), ['s-ok']);
  const runs = raw.prepare("SELECT task, status FROM scheduled_runs ORDER BY task").all();
  assert.deepEqual(runs.map((r) => (r as { status: string }).status), ['ok', 'ok']);
});

test('verrou : un même créneau ne lance la tâche qu’une fois', async () => {
  const { db } = seed();
  await runScheduledTasks(db, NOW);
  const again = await runScheduledTasks(db, new Date(NOW.getTime() + 3600000));
  assert.deepEqual(again.map((r) => r.status), ['skipped', 'skipped']);
  const nextDay = await runScheduledTasks(db, new Date(NOW.getTime() + 86400000));
  assert.deepEqual(nextDay.map((r) => r.status), ['ok', 'ok']);
});

test('indépendance : une tâche en échec n’empêche pas les suivantes et reste tracée', async () => {
  const { raw, db } = seed();
  const failing = { name: 'casse', slot: () => 'x', run: async () => { throw new Error('panne\nsimulée'); } };
  const results = await runScheduledTasks(db, NOW, [failing, ...TASKS]);
  assert.deepEqual(results.map((r) => r.status), ['failed', 'ok', 'ok']);
  const row = raw.prepare("SELECT status, detail FROM scheduled_runs WHERE task = 'casse'").get() as { status: string; detail: string };
  assert.equal(row.status, 'failed');
  assert.equal(row.detail, 'panne simulée');
});

test('exécution interrompue : marquée en échec après 2 heures', async () => {
  const { raw, db } = seed();
  raw.prepare(`INSERT INTO scheduled_runs (id, task, slot, started_at) VALUES ('r1', 'purge', '2026-11-14', ?)`).run(daysAgo(1));
  await runTask(db, TASKS[1], NOW);
  assert.equal((raw.prepare("SELECT status FROM scheduled_runs WHERE id = 'r1'").get() as { status: string }).status, 'failed');
});

test('secret du cron : comparaison stricte, 32 caractères minimum', () => {
  const secret = 'x'.repeat(40);
  assert.equal(sameSecret(secret, secret), true);
  assert.equal(sameSecret(`${secret}y`, secret), false);
  assert.equal(sameSecret('', secret), false);
  assert.equal(sameSecret('court', 'court'), false, 'secret trop court refusé');
});

test('Turnstile : sans clé désactivé ; jeton exigé ; réponse du service respectée ; panne = refus', async () => {
  assert.deepEqual(await verifyTurnstile({ secret: undefined, token: '' }), { ok: true, skipped: true });
  assert.deepEqual(await verifyTurnstile({ secret: 's', token: '' }), { ok: false, reason: 'missing-token' });
  let sent: FormData | null = null;
  const fake = (success: boolean) => (async (_url: string, init: RequestInit) => {
    sent = init.body as FormData;
    return new Response(JSON.stringify({ success }), { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await verifyTurnstile({ secret: 's', token: 'tok', ip: '1.2.3.4', fetchImpl: fake(true) }), { ok: true, skipped: false });
  assert.equal(sent!.get('remoteip'), '1.2.3.4');
  assert.equal(sent!.get('response'), 'tok');
  assert.deepEqual(await verifyTurnstile({ secret: 's', token: 'tok', fetchImpl: fake(false) }), { ok: false, reason: 'rejected' });
  const down = (async () => { throw new Error('réseau'); }) as unknown as typeof fetch;
  assert.deepEqual(await verifyTurnstile({ secret: 's', token: 'tok', fetchImpl: down }), { ok: false, reason: 'unavailable' });
});

test('journal des e-mails : lu par le bureau du club seulement, jamais écrit par un utilisateur', async () => {
  const { raw } = seed();
  const ids = {
    sec: '00000000-0000-4000-8000-000000000002',
    coach: '00000000-0000-4000-8000-000000000003',
    other: '00000000-0000-4000-8000-000000000004',
  };
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES ('c2', 'Autre', 'autre', 'Lyon', '69001', 'b@test.fr', 'active')`).run();
  for (const [k, id] of Object.entries(ids)) raw.prepare(`INSERT INTO auth_users (id, email) VALUES (?, ?)`).run(id, `${k}@test.fr`);
  const staff = `INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@test.fr', ?)`;
  raw.prepare(staff).run(crypto.randomUUID(), ids.sec, 'c1', 'secretary');
  raw.prepare(staff).run(crypto.randomUUID(), ids.coach, 'c1', 'coach');
  raw.prepare(staff).run(crypto.randomUUID(), ids.other, 'c2', 'president');
  const as = (userId: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId });
  assert.equal((await as(ids.sec).from('email_log').select('id')).data?.length, 2);
  assert.equal((await as(ids.coach).from('email_log').select('id')).data?.length, 0);
  assert.equal((await as(ids.other).from('email_log').select('id')).data?.length, 0, 'jamais un autre club');
  const forged = await as(ids.sec).from('email_log').insert({ club_id: 'c1', kind: 'test', recipient: 'x@test.fr', subject: 'faux', provider: 'platform', status: 'sent' });
  assert.equal(forged.error?.code, '42501');
});
