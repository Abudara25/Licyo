// Fiches adhérents permanentes (migration 0008, src/lib/people.ts) sur une vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { possibleDuplicates } from '../src/lib/people.ts';

const CLUB = '10000000-0000-4000-8000-00000000000a';
const OTHER = '10000000-0000-4000-8000-00000000000b';

function setup() {
  const raw = migratedDatabase();
  for (const [id, slug] of [[CLUB, 'a'], [OTHER, 'b']]) {
    raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email) VALUES (?, 'Club ' || ?, ?, 'Paris', '75001', 'a@t.fr')`).run(id, slug, slug);
  }
  const add = (club: string, season: string, first: string, last: string, birth: string, person: string | null = null) => {
    const id = crypto.randomUUID();
    raw.prepare(`INSERT INTO members (id, club_id, season, first_name, last_name, birth_date, magic_action_token, person_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, club, season, first, last, birth, crypto.randomUUID(), person);
    return (raw.prepare('SELECT person_id FROM members WHERE id = ?').get(id) as { person_id: string }).person_id;
  };
  return { raw, db: sqliteAdapter(raw), add };
}

test('rattachement : même prénom, nom et naissance → même personne, d’une saison à l’autre', () => {
  const { add } = setup();
  const p1 = add(CLUB, '2025-2026', 'Léa', 'MARTIN', '2015-01-01');
  assert.match(p1, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(add(CLUB, '2026-2027', ' léa ', 'Martin', '2015-01-01'), p1, 'casse et espaces ignorés');
  assert.notEqual(add(CLUB, '2026-2027', 'Léa', 'MARTIN', '2015-01-02'), p1, 'autre date de naissance : autre fiche');
  assert.notEqual(add(OTHER, '2026-2027', 'Léa', 'MARTIN', '2015-01-01'), p1, 'jamais entre deux clubs');
});

test('réinscription : le rattachement explicite est conservé même si l’orthographe change', () => {
  const { add } = setup();
  const p1 = add(CLUB, '2025-2026', 'Lea', 'MARTIN', '2015-01-01');
  assert.equal(add(CLUB, '2026-2027', 'Léa', 'MARTIN-DUPONT', '2015-01-01', p1), p1);
});

test('reprise de l’existant : la migration rattache les inscriptions déjà présentes', () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const files = readdirSync('migrations').filter((n) => n.endsWith('.sql')).sort();
  for (const f of files.filter((n) => n < '0008')) raw.exec(readFileSync(`migrations/${f}`, 'utf8'));
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email) VALUES (?, 'Club A', 'a', 'Paris', '75001', 'a@t.fr')`).run(CLUB);
  const ins = raw.prepare(`INSERT INTO members (id, club_id, season, first_name, last_name, birth_date, magic_action_token) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  ins.run('m1', CLUB, '2024-2025', 'Tom', 'NOEL', '2014-03-03', 't1');
  ins.run('m2', CLUB, '2025-2026', 'tom', 'NOEL', '2014-03-03', 't2');
  ins.run('m3', CLUB, '2025-2026', 'Zoé', 'NOEL', '2016-07-07', 't3');
  for (const f of files.filter((n) => n >= '0008')) raw.exec(readFileSync(`migrations/${f}`, 'utf8'));
  const rows = raw.prepare('SELECT id, person_id FROM members ORDER BY id').all() as { id: string; person_id: string }[];
  assert.ok(rows.every((r) => r.person_id));
  assert.equal(rows[0].person_id, rows[1].person_id);
  assert.notEqual(rows[0].person_id, rows[2].person_id);
  assert.equal((raw.prepare('SELECT count(*) AS n FROM people').get() as { n: number }).n, 2);
  assert.equal((raw.prepare('SELECT count(*) AS n FROM members').get() as { n: number }).n, 3, 'aucune inscription perdue');
});

test('doublons possibles : signalés (jamais fusionnés), dans le club seulement', async () => {
  const { db, add } = setup();
  const a = add(CLUB, '2026-2027', 'Léa', 'MARTIN', '2015-01-01');
  const b = add(CLUB, '2026-2027', 'Léa', 'MARTIN', '2015-10-01'); // date différente
  add(CLUB, '2026-2027', 'Noé', 'MARTIN', '2015-01-01'); // jumeau ?
  add(CLUB, '2026-2027', 'Léa', 'MARTINE', '2015-01-01'); // nom mal saisi ?
  add(OTHER, '2026-2027', 'Léa', 'MARTIN', '2015-10-01'); // autre club : ignoré
  const all = await possibleDuplicates(db, CLUB);
  assert.deepEqual(all.map((d) => d.reason).sort(), ['birth_differs', 'same_birth_and_first_name', 'same_birth_and_last_name']);
  const forA = await possibleDuplicates(db, CLUB, a);
  assert.equal(forA.length, 3);
  assert.ok(forA.some((d) => [d.a, d.b].includes(b)));
});

test('accès : fiches lues par le bureau du club, jamais par l’encadrement ni un autre club', async () => {
  const { raw, add } = setup();
  add(CLUB, '2026-2027', 'Léa', 'MARTIN', '2015-01-01');
  const u = { sec: '00000000-0000-4000-8000-000000000001', coach: '00000000-0000-4000-8000-000000000002', other: '00000000-0000-4000-8000-000000000003' };
  for (const [k, id] of Object.entries(u)) raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${k}@t.fr`);
  const staff = `INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', ?)`;
  raw.prepare(staff).run(crypto.randomUUID(), u.sec, CLUB, 'secretary');
  raw.prepare(staff).run(crypto.randomUUID(), u.coach, CLUB, 'coach');
  raw.prepare(staff).run(crypto.randomUUID(), u.other, OTHER, 'president');
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(u.sec).from('people').select('id')).data?.length, 1);
  assert.equal((await as(u.coach).from('people').select('id')).data?.length, 0);
  assert.equal((await as(u.other).from('people').select('id')).data?.length, 0);
});
