// Pré-inscriptions et liste d'attente (src/lib/waitlist.ts, migration 0006) sur une vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import {
  clubAvailability,
  completeInvitation,
  findInvitation,
  issueInvitation,
  publicStateOf,
  queuePosition,
  runWaitlistMaintenance,
  setPreregistrationStatus,
} from '../src/lib/waitlist.ts';

const CLUB = '10000000-0000-4000-8000-00000000000a';
const OTHER = '10000000-0000-4000-8000-00000000000b';
const CAT = '20000000-0000-4000-8000-0000000000a1';
const SEASON = '2026-2027';
const NOW = new Date('2026-11-15T10:00:00Z');

function setup(capacity = 2, opts: { mode?: string; auto?: boolean } = {}) {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status, current_season) VALUES (?, 'Club A', 'a', 'Paris', '75001', 'a@test.fr', 'active', ?)`, CLUB, SEASON);
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status, current_season) VALUES (?, 'Club B', 'b', 'Lyon', '69001', 'b@test.fr', 'active', ?)`, OTHER, SEASON);
  run(
    `INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price, max_capacity, registration_mode, auto_invite) VALUES (?, ?, 'U11', 2015, 2017, 150, ?, ?, ?)`,
    CAT, CLUB, capacity, opts.mode ?? 'open', opts.auto ? 1 : 0,
  );
  const member = (status = 'validated') =>
    run(`INSERT INTO members (id, club_id, category_id, season, first_name, last_name, birth_date, dossier_status, magic_action_token) VALUES (?, ?, ?, ?, 'E', 'N', '2016-01-01', ?, ?)`,
      crypto.randomUUID(), CLUB, CAT, SEASON, status, crypto.randomUUID());
  let n = 0;
  const request = (email: string) => {
    const id = crypto.randomUUID();
    n++;
    run(`INSERT INTO preregistrations (id, club_id, category_id, season, first_name, last_name, birth_date, contact_name, email, phone, created_at) VALUES (?, ?, ?, ?, ?, 'N', '2016-05-01', 'Parent', ?, '0600000000', ?)`,
      id, CLUB, CAT, SEASON, `P${n}`, email, new Date(NOW.getTime() - (100 - n) * 60000).toISOString());
    return id;
  };
  const status = (id: string) => (raw.prepare('SELECT status FROM preregistrations WHERE id = ?').get(id) as { status: string }).status;
  return { raw, db: sqliteAdapter(raw), member, request, status };
}

const avail = async (db: ReturnType<typeof sqliteAdapter>, mode = 'open', capacity = 2) =>
  (await clubAvailability(db, CLUB, SEASON, [{ id: CAT, max_capacity: capacity, registration_mode: mode as 'open' }])).get(CAT)!;

test('état public : ouvert, complet → liste d’attente, pré-inscription, fermé', () => {
  assert.equal(publicStateOf('open', 3), 'open');
  assert.equal(publicStateOf('open', 0), 'waitlist');
  assert.equal(publicStateOf('preregistration', 10), 'preregistration');
  assert.equal(publicStateOf('closed', 10), 'closed');
});

test('places : dossiers actifs et invitations en cours occupent une place ; refus et essais non', async () => {
  const { db, member, request } = setup(3);
  member('validated');
  member('rejected');
  member('trial_requested');
  const r1 = request('a@x.fr');
  request('b@x.fr');
  let a = await avail(db, 'open', 3);
  assert.deepEqual([a.occupied, a.invited, a.waiting, a.remaining, a.publicState], [1, 0, 2, 2, 'open']);
  await issueInvitation(db, CLUB, r1, NOW);
  a = await avail(db, 'open', 3);
  assert.deepEqual([a.invited, a.waiting, a.remaining], [1, 1, 1], 'l’invitation réserve une place');
});

test('rang : ordre d’arrivée parmi les demandes en attente', async () => {
  const { db, request } = setup();
  const r1 = request('a@x.fr');
  const r2 = request('b@x.fr');
  const r3 = request('c@x.fr');
  assert.deepEqual([await queuePosition(db, r1), await queuePosition(db, r2), await queuePosition(db, r3)], [1, 2, 3]);
  await setPreregistrationStatus(db, CLUB, r1, 'cancelled', NOW);
  assert.deepEqual([await queuePosition(db, r1), await queuePosition(db, r2)], [null, 1]);
});

test('invitation : lien valable pour ce club seulement, puis clos après inscription', async () => {
  const { db, raw, request, status, member } = setup();
  const r1 = request('a@x.fr');
  const token = await issueInvitation(db, CLUB, r1, NOW);
  assert.ok(token && token.length >= 40);
  assert.equal(await issueInvitation(db, CLUB, r1, NOW), null, 'déjà invitée : pas de second lien');
  assert.equal(await issueInvitation(db, OTHER, request('z@x.fr'), NOW), null, 'jamais pour un autre club');
  const stored = raw.prepare('SELECT invite_token_hash FROM preregistrations WHERE id = ?').get(r1) as { invite_token_hash: string };
  assert.notEqual(stored.invite_token_hash, token, 'seule l’empreinte est stockée');
  assert.equal((await findInvitation(db, CLUB, token!, NOW))?.id, r1);
  assert.equal(await findInvitation(db, OTHER, token!, NOW), null);
  assert.equal(await findInvitation(db, CLUB, token!, new Date(NOW.getTime() + 8 * 86400000)), null, 'expiré après 7 jours');
  member();
  const memberId = (raw.prepare('SELECT id FROM members LIMIT 1').get() as { id: string }).id;
  await completeInvitation(db, r1, memberId, NOW);
  assert.equal(status(r1), 'registered');
  assert.equal(await findInvitation(db, CLUB, token!, NOW), null, 'lien inutilisable après inscription');
});

test('doublon : une seule demande active par personne, catégorie et saison', async () => {
  const { raw, request } = setup();
  request('a@x.fr');
  assert.throws(() =>
    raw.prepare(`INSERT INTO preregistrations (id, club_id, category_id, season, first_name, last_name, birth_date, contact_name, email, phone) VALUES (?, ?, ?, ?, 'p1', 'N', '2016-05-01', 'P', 'a@x.fr', '0600000000')`)
      .run(crypto.randomUUID(), CLUB, CAT, SEASON),
  );
});

test('tâche planifiée : expire les liens dépassés, invite les suivants seulement en mode automatique', async () => {
  const manual = setup(1);
  const m1 = manual.request('a@x.fr');
  await issueInvitation(manual.db, CLUB, m1, new Date(NOW.getTime() - 8 * 86400000));
  const sent: string[] = [];
  const detail = await runWaitlistMaintenance(manual.db, NOW, async (row) => void sent.push(row.email));
  assert.equal(manual.status(m1), 'expired');
  assert.match(detail, /expirees=1 invitees=0/);
  assert.equal(sent.length, 0, 'sans invitation automatique, personne n’est invité');

  const auto = setup(2, { auto: true });
  auto.member();
  const a1 = auto.request('a@x.fr');
  const a2 = auto.request('b@x.fr');
  const out = await runWaitlistMaintenance(auto.db, NOW, async (row) => void sent.push(row.email));
  assert.match(out, /invitees=1/);
  assert.deepEqual(sent, ['a@x.fr'], 'une place libre : seule la première personne');
  assert.deepEqual([auto.status(a1), auto.status(a2)], ['invited', 'waiting']);

  // E-mail impossible : la place n'est pas bloquée, la demande garde son rang.
  const failing = setup(1, { auto: true });
  const f1 = failing.request('a@x.fr');
  const res = await runWaitlistMaintenance(failing.db, NOW, async () => {
    throw new Error('panne');
  });
  assert.match(res, /echecs=1/);
  assert.equal(failing.status(f1), 'waiting');
  assert.equal(await queuePosition(failing.db, f1), 1);
});

test('accès : demandes lues par le bureau du club, jamais par l’encadrement ni un autre club', async () => {
  const { raw, request } = setup();
  request('a@x.fr');
  const users = { sec: '00000000-0000-4000-8000-000000000001', coach: '00000000-0000-4000-8000-000000000002', other: '00000000-0000-4000-8000-000000000003' };
  for (const [k, id] of Object.entries(users)) raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${k}@t.fr`);
  const staff = `INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', ?)`;
  raw.prepare(staff).run(crypto.randomUUID(), users.sec, CLUB, 'secretary');
  raw.prepare(staff).run(crypto.randomUUID(), users.coach, CLUB, 'coach');
  raw.prepare(staff).run(crypto.randomUUID(), users.other, OTHER, 'president');
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(users.sec).from('preregistrations').select('id')).data?.length, 1);
  assert.equal((await as(users.coach).from('preregistrations').select('id')).data?.length, 0);
  assert.equal((await as(users.other).from('preregistrations').select('id')).data?.length, 0);
  assert.equal((await makeClient(sqliteAdapter(raw), { role: 'anon' }).from('preregistrations').select('id')).data?.length ?? 0, 0);
});
