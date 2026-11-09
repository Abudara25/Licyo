// Isolation des données sur D1 : les règles de policies.ts remplacent la RLS Postgres.
// Exécuté sur une vraie base SQLite (node:sqlite) avec la migration réelle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../src/lib/db/client.ts';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import type { SecurityContext } from '../src/lib/db/policies.ts';

const ids = {
  superAdmin: '00000000-0000-4000-8000-000000000001',
  presA: '00000000-0000-4000-8000-000000000002',
  coachA: '00000000-0000-4000-8000-000000000003',
  presB: '00000000-0000-4000-8000-000000000004',
  parent: '00000000-0000-4000-8000-000000000005',
  stranger: '00000000-0000-4000-8000-000000000006',
  clubA: '10000000-0000-4000-8000-00000000000a',
  clubB: '10000000-0000-4000-8000-00000000000b',
  catA1: '20000000-0000-4000-8000-0000000000a1',
  catA2: '20000000-0000-4000-8000-0000000000a2',
  catB1: '20000000-0000-4000-8000-0000000000b1',
  famA: '30000000-0000-4000-8000-0000000000a1',
  famB: '30000000-0000-4000-8000-0000000000b1',
  memA1: '40000000-0000-4000-8000-0000000000a1',
  memA2: '40000000-0000-4000-8000-0000000000a2',
  memB1: '40000000-0000-4000-8000-0000000000b1',
  schA1: '50000000-0000-4000-8000-0000000000a1',
  schA2: '50000000-0000-4000-8000-0000000000a2',
};

function setup() {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  for (const [key, mail] of Object.entries({ superAdmin: 'sa', presA: 'pa', coachA: 'ca', presB: 'pb', parent: 'parent', stranger: 'x' })) {
    run(`INSERT INTO auth_users (id, email, email_confirmed_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`, ids[key as keyof typeof ids], `${mail}@test.fr`);
  }
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES (?, 'Club A', 'club-a', 'Paris', '75001', 'a@test.fr', 'active')`, ids.clubA);
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES (?, 'Club B', 'club-b', 'Lyon', '69001', 'b@test.fr', 'suspended')`, ids.clubB);
  run(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, NULL, 'SA', 'sa@test.fr', 'super_admin')`, crypto.randomUUID(), ids.superAdmin);
  run(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'PA', 'pa@test.fr', 'president')`, crypto.randomUUID(), ids.presA, ids.clubA);
  run(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role, assigned_category_ids) VALUES (?, ?, ?, 'CA', 'ca@test.fr', 'coach', ?)`, crypto.randomUUID(), ids.coachA, ids.clubA, JSON.stringify([ids.catA1]));
  run(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'PB', 'pb@test.fr', 'president')`, crypto.randomUUID(), ids.presB, ids.clubB);
  for (const [id, club] of [[ids.catA1, ids.clubA], [ids.catA2, ids.clubA], [ids.catB1, ids.clubB]]) {
    run(`INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price) VALUES (?, ?, 'Cat', 2010, 2015, 100)`, id, club);
  }
  const fam = `INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code) VALUES (?, ?, '2026-2027', 'P', 'N', ?, '0600000000', 'U', '0600000001', '1 rue', 'Paris', '75001')`;
  run(fam, ids.famA, ids.clubA, 'parent@test.fr');
  run(fam, ids.famB, ids.clubB, 'other@test.fr');
  const mem = `INSERT INTO members (id, club_id, family_id, category_id, season, first_name, last_name, birth_date, magic_action_token) VALUES (?, ?, ?, ?, '2026-2027', 'E', 'N', '2012-01-01', ?)`;
  run(mem, ids.memA1, ids.clubA, ids.famA, ids.catA1, crypto.randomUUID());
  run(mem, ids.memA2, ids.clubA, null, ids.catA2, crypto.randomUUID());
  run(mem, ids.memB1, ids.clubB, ids.famB, ids.catB1, crypto.randomUUID());
  run(`INSERT INTO schedules (id, club_id, category_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, 1, '18:00', '19:30')`, ids.schA1, ids.clubA, ids.catA1);
  run(`INSERT INTO schedules (id, club_id, category_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, 2, '18:00', '19:30')`, ids.schA2, ids.clubA, ids.catA2);
  run(`INSERT INTO family_access (club_id, family_id, user_id) VALUES (?, ?, ?)`, ids.clubA, ids.famA, ids.parent);

  const db = sqliteAdapter(raw);
  const as = (who: keyof typeof ids | 'anon' | 'service') => {
    const ctx: SecurityContext =
      who === 'anon' ? { role: 'anon' } : who === 'service' ? { role: 'service' } : { role: 'authenticated', userId: ids[who] };
    return makeClient(db, ctx);
  };
  return { raw, as };
}

test('visiteur : seuls les clubs publics, aucune donnée privée', async () => {
  const { as } = setup();
  const anon = as('anon');
  const { data: clubs } = await anon.from('public_clubs').select('slug');
  assert.deepEqual(clubs?.map((c) => c.slug), ['club-a'], 'club suspendu invisible');
  assert.equal((await anon.from('clubs').select('*')).data?.length, 0, 'table interne clubs fermée');
  assert.equal((await anon.from('members').select('*')).data?.length, 0);
  assert.equal((await anon.from('family_registrations').select('*')).data?.length, 0);
  const { data: cats } = await anon.from('categories').select('id');
  assert.deepEqual(cats?.map((c) => c.id).sort(), [ids.catA1, ids.catA2], 'contenu public du seul club public');
});

test('président A : lit et modifie son club, jamais le club B', async () => {
  const { as, raw } = setup();
  const pa = as('presA');
  const { data: members } = await pa.from('members').select('id');
  assert.deepEqual(members?.map((m) => m.id).sort(), [ids.memA1, ids.memA2]);
  assert.equal((await pa.from('members').select('*').eq('club_id', ids.clubB)).data?.length, 0);

  await pa.from('members').update({ first_name: 'Pirate' }).eq('id', ids.memB1);
  const b1 = raw.prepare('SELECT first_name FROM members WHERE id = ?').get(ids.memB1) as { first_name: string };
  assert.equal(b1.first_name, 'E', 'mise à jour inter-club sans effet');

  await pa.from('members').delete().eq('id', ids.memB1);
  assert.ok(raw.prepare('SELECT 1 FROM members WHERE id = ?').get(ids.memB1), 'suppression inter-club sans effet');

  const insert = await pa.from('categories').insert({ club_id: ids.clubB, name: 'Intrus', min_birth_year: 2000, max_birth_year: 2001, annual_price: 1 });
  assert.equal(insert.error?.code, '42501', 'insertion dans un autre club refusée');

  const move = await pa.from('categories').update({ club_id: ids.clubB }).eq('id', ids.catA1);
  assert.equal(move.error?.code, '42501', 'déplacement vers un autre club refusé');
});

test('président : colonnes sensibles du club non modifiables', async () => {
  const { as } = setup();
  const pa = as('presA');
  assert.equal((await pa.from('clubs').update({ name: 'Club A renommé' }).eq('id', ids.clubA)).error, null);
  const stripe = await pa.from('clubs').update({ stripe_customer_id: 'cus_x' }).eq('id', ids.clubA);
  assert.equal(stripe.error?.code, '42501');
  const status = await pa.from('clubs').update({ status: 'active' }).eq('id', ids.clubB);
  assert.equal(status.error?.code, '42501');
});

test('président : ne peut pas créer de super_admin', async () => {
  const { as } = setup();
  const res = await as('presA').from('staff_members').insert({ user_id: ids.stranger, club_id: null, full_name: 'X', email: 'x@test.fr', role: 'super_admin' });
  assert.ok(res.error, 'refusé');
});

test('entraîneur : seulement ses catégories, sans dossiers complets', async () => {
  const { as } = setup();
  const coach = as('coachA');
  const { data: roster } = await coach.from('coach_roster').select('id');
  assert.deepEqual(roster?.map((r) => r.id), [ids.memA1]);
  assert.equal((await coach.from('members').select('*')).data?.length, 0, 'table complète réservée au bureau');
  const ok = await coach.from('attendances').upsert(
    { club_id: ids.clubA, schedule_id: ids.schA1, member_id: ids.memA1, session_date: '2026-11-09', is_present: true },
    { onConflict: 'schedule_id,member_id,session_date' },
  );
  assert.equal(ok.error, null, 'appel de sa catégorie');
  const ko = await coach.from('attendances').insert({ club_id: ids.clubA, schedule_id: ids.schA2, member_id: ids.memA2, session_date: '2026-11-09' });
  assert.equal(ko.error?.code, '42501', 'appel hors de ses catégories refusé');
});

test('famille : uniquement son dossier', async () => {
  const { as } = setup();
  const parent = as('parent');
  assert.deepEqual((await parent.from('members').select('id')).data?.map((m) => m.id), [ids.memA1]);
  assert.deepEqual((await parent.from('family_registrations').select('id')).data?.map((f) => f.id), [ids.famA]);
  const stranger = as('stranger');
  assert.equal((await stranger.from('members').select('id')).data?.length, 0);
  assert.equal((await stranger.from('family_access').select('*')).data?.length, 0);
});

test('super_admin : voit tous les clubs', async () => {
  const { as } = setup();
  const { data } = await as('superAdmin').from('members').select('id');
  assert.equal(data?.length, 3);
});

test('base : une ligne ne référence jamais un objet d’un autre club', async () => {
  const { as } = setup();
  const res = await as('service').from('schedules').insert({ club_id: ids.clubA, category_id: ids.catB1, day_of_week: 3, start_time: '10:00', end_time: '11:00' });
  assert.equal(res.error?.code, '23503');
});

test('upsert : l’identifiant existant est conservé', async () => {
  const { as, raw } = setup();
  const before = raw.prepare('SELECT id FROM staff_members WHERE user_id = ? AND club_id = ?').get(ids.presA, ids.clubA) as { id: string };
  const res = await as('service').from('staff_members').upsert(
    { user_id: ids.presA, club_id: ids.clubA, full_name: 'PA2', email: 'pa@test.fr', role: 'president' },
    { onConflict: 'user_id,club_id' },
  );
  assert.equal(res.error, null);
  const after = raw.prepare('SELECT id, full_name FROM staff_members WHERE user_id = ? AND club_id = ?').get(ids.presA, ids.clubA) as { id: string; full_name: string };
  assert.equal(after.id, before.id);
  assert.equal(after.full_name, 'PA2');
});

test('conversions : JSON, booléens, single/maybeSingle, or, not in, count', async () => {
  const { as } = setup();
  const svc = as('service');
  const { data: club } = await svc.from('clubs').select('*').eq('id', ids.clubA).single();
  assert.equal(typeof club?.enabled_modules, 'object');
  assert.equal(club?.accepts_pass_sport, true);
  assert.deepEqual(club?.nearby_cities, []);
  assert.equal((await svc.from('clubs').select('*').eq('id', ids.stranger).maybeSingle()).data, null);
  assert.equal((await svc.from('clubs').select('*').single()).error?.code, 'PGRST116');
  const { data: either } = await svc.from('members').select('id').eq('club_id', ids.clubA).or(`category_id.eq.${ids.catA1},family_id.is.null`);
  assert.equal(either?.length, 2);
  const { count } = await svc.from('members').select('id', { count: 'exact', head: true }).not('club_id', 'in', `(${ids.clubB})`);
  assert.equal(count, 2);
});

test('rpc : création de club par un compte confirmé, atomique', async () => {
  const { as, raw } = setup();
  const res = await as('stranger').rpc<string>('provision_club', {
    payload: { name: 'Nouveau club', slug: 'nouveau', sport: 'judo', template: 'heritage', city: 'Nice', postalCode: '06000', memberCount: 120, ownerName: 'Moi' },
  });
  assert.equal(res.error, null);
  const staff = raw.prepare("SELECT role FROM staff_members WHERE club_id = ?").get(res.data) as { role: string };
  assert.equal(staff.role, 'president');
  const dup = await as('stranger').rpc('provision_club', {
    payload: { name: 'Doublon', slug: 'nouveau', sport: 'judo', template: 'club', city: 'Nice', postalCode: '06000', memberCount: 1, ownerName: 'Moi' },
  });
  assert.equal(dup.error?.code, '23505');
  assert.equal((await as('anon').rpc('provision_club', { payload: {} })).error?.code, 'P0001');
});
