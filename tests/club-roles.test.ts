// Rôles de club détaillés (src/lib/permissions.ts) appliqués par les règles d'accès SQL (policies.ts).
// Base SQLite réelle avec toutes les migrations, dont 0002 (rôles élargis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeClient } from '../src/lib/db/client.ts';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import {
  CLUB_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_SCOPED_PERMISSIONS,
  isScopedRole,
  roleCan,
  rolesWith,
} from '../src/lib/permissions.ts';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CLUB = '10000000-0000-4000-8000-00000000000a';
const OTHER = '10000000-0000-4000-8000-00000000000b';
const CAT1 = '20000000-0000-4000-8000-0000000000a1';
const CAT2 = '20000000-0000-4000-8000-0000000000a2';
const FAM = '30000000-0000-4000-8000-0000000000a1';
const MEM1 = '40000000-0000-4000-8000-0000000000a1';
const MEM2 = '40000000-0000-4000-8000-0000000000a2';
const SCH1 = '50000000-0000-4000-8000-0000000000a1';
const SCH2 = '50000000-0000-4000-8000-0000000000a2';

const people = {
  president: U(1),
  vice_president: U(2),
  secretary: U(3),
  assistant_secretary: U(4),
  treasurer: U(5),
  assistant_treasurer: U(6),
  coach: U(7),
  team_manager: U(8),
  volunteer: U(9),
  coachWithoutCategory: U(10),
  otherPresident: U(11),
} as const;

function setup() {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  for (const [name, id] of Object.entries(people)) {
    run(`INSERT INTO auth_users (id, email, email_confirmed_at) VALUES (?, ?, '2026-01-01T00:00:00Z')`, id, `${name.toLowerCase()}@test.fr`);
  }
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES (?, 'Club A', 'club-a', 'Paris', '75001', 'a@test.fr', 'active')`, CLUB);
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status) VALUES (?, 'Club B', 'club-b', 'Lyon', '69001', 'b@test.fr', 'active')`, OTHER);
  const staff = `INSERT INTO staff_members (id, user_id, club_id, full_name, email, role, assigned_category_ids) VALUES (?, ?, ?, 'X', 'x@test.fr', ?, ?)`;
  for (const role of CLUB_ROLES) {
    run(staff, crypto.randomUUID(), people[role], CLUB, role, JSON.stringify(isScopedRole(role) ? [CAT1] : []));
  }
  run(staff, crypto.randomUUID(), people.coachWithoutCategory, CLUB, 'coach', '[]');
  run(staff, crypto.randomUUID(), people.otherPresident, OTHER, 'president', '[]');
  for (const id of [CAT1, CAT2]) {
    run(`INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price) VALUES (?, ?, 'Cat', 2010, 2015, 100)`, id, CLUB);
  }
  run(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code) VALUES (?, ?, '2026-2027', 'P', 'N', 'p@test.fr', '0600000000', 'U', '0600000001', '1 rue', 'Paris', '75001')`, FAM, CLUB);
  const mem = `INSERT INTO members (id, club_id, family_id, category_id, season, first_name, last_name, birth_date, magic_action_token) VALUES (?, ?, ?, ?, '2026-2027', 'E', 'N', '2012-01-01', ?)`;
  run(mem, MEM1, CLUB, FAM, CAT1, crypto.randomUUID());
  run(mem, MEM2, CLUB, FAM, CAT2, crypto.randomUUID());
  run(`INSERT INTO schedules (id, club_id, category_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, 1, '18:00', '19:30')`, SCH1, CLUB, CAT1);
  run(`INSERT INTO schedules (id, club_id, category_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, 2, '18:00', '19:30')`, SCH2, CLUB, CAT2);
  const db = sqliteAdapter(raw);
  const as = (who: keyof typeof people) => makeClient(db, { role: 'authenticated', userId: people[who] });
  return { raw, as };
}

test('matrice : chaque permission a au moins un rôle, le président a tout, seul le président gère les accès', () => {
  for (const p of PERMISSIONS) assert.ok(rolesWith(p).length > 0, p);
  for (const p of PERMISSIONS) assert.ok(roleCan('president', p), p);
  assert.deepEqual(rolesWith('club.admin'), ['president']);
  for (const p of PERMISSIONS) assert.ok(roleCan('super_admin', p), `super_admin : ${p}`);
  assert.equal(roleCan(null, 'members.read'), false);
  // Encadrement : aucune permission sur tout le club, seulement sur ses catégories.
  for (const r of ['coach', 'team_manager', 'volunteer'] as const) {
    assert.equal(ROLE_PERMISSIONS[r].length, 0, r);
    assert.ok(ROLE_SCOPED_PERMISSIONS[r].includes('attendance.take'), r);
  }
  assert.equal(ROLE_SCOPED_PERMISSIONS.volunteer.includes('events.manage'), false, 'un bénévole ne crée pas d’événement');
});

test('migration 0002 : les nouveaux rôles sont acceptés, un rôle inconnu refusé', () => {
  const { raw } = setup();
  const count = raw.prepare('SELECT count(*) AS n FROM staff_members WHERE club_id = ?').get(CLUB) as { n: number };
  assert.equal(count.n, CLUB_ROLES.length + 1);
  assert.throws(() =>
    raw.prepare(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'Z', 'z@test.fr', 'admin')`).run(crypto.randomUUID(), people.volunteer, OTHER),
  );
});

test('dossiers : lus par le bureau et la trésorerie, modifiés seulement par le secrétariat et la présidence', async () => {
  const { as } = setup();
  for (const r of ['president', 'vice_president', 'secretary', 'assistant_secretary', 'treasurer', 'assistant_treasurer'] as const) {
    assert.equal((await as(r).from('members').select('id')).data?.length, 2, `${r} lit les dossiers`);
  }
  for (const r of ['coach', 'team_manager', 'volunteer'] as const) {
    assert.equal((await as(r).from('members').select('id')).data?.length, 0, `${r} : pas de dossier complet`);
  }
  const write = (r: keyof typeof people) => as(r).from('members').update({ dossier_status: 'validated' }).eq('id', MEM1).select('id');
  assert.equal((await write('secretary')).data?.length, 1);
  assert.equal((await write('assistant_secretary')).data?.length, 1);
  assert.equal((await write('treasurer')).data?.length ?? 0, 0, 'le trésorier ne valide pas un dossier');
});

test('finances : échéances gérées par la trésorerie, lues par le secrétariat, jamais par l’encadrement', async () => {
  const { as } = setup();
  const add = (r: keyof typeof people) =>
    as(r).from('payment_installments').insert({ club_id: CLUB, family_id: FAM, amount: 50, payment_type: 'check' });
  assert.equal((await add('treasurer')).error, null);
  assert.equal((await add('assistant_treasurer')).error, null);
  assert.equal((await add('secretary')).error?.code, '42501', 'le secrétaire ne saisit pas de paiement');
  assert.equal((await add('coach')).error?.code, '42501');
  assert.equal((await as('secretary').from('payment_installments').select('id')).data?.length, 2, 'lecture des finances');
  assert.equal((await as('coach').from('payment_installments').select('id')).data?.length, 0);
});

test('encadrement : appel limité aux catégories rattachées ; sans catégorie, rien', async () => {
  const { as } = setup();
  for (const [i, r] of (['coach', 'team_manager', 'volunteer'] as const).entries()) {
    const roster = (await as(r).from('coach_roster').select('id')).data?.map((m) => m.id);
    assert.deepEqual(roster, [MEM1], r);
    const ok = await as(r).from('attendances').insert({ club_id: CLUB, schedule_id: SCH1, member_id: MEM1, session_date: `2026-11-0${i + 1}`, is_present: true });
    assert.equal(ok.error, null, `${r} : appel de sa catégorie`);
    const ko = await as(r).from('attendances').insert({ club_id: CLUB, schedule_id: SCH2, member_id: MEM2, session_date: '2026-11-10' });
    assert.equal(ko.error?.code, '42501', `${r} : appel hors catégorie refusé`);
  }
  assert.equal((await as('coachWithoutCategory').from('coach_roster').select('id')).data?.length, 0);
  // Le secrétariat (sport.manage) fait l'appel de toutes les catégories.
  const sec = await as('secretary').from('attendances').insert({ club_id: CLUB, schedule_id: SCH2, member_id: MEM2, session_date: '2026-11-11' });
  assert.equal(sec.error, null);
});

test('événements : créés par l’éducateur et le dirigeant d’équipe sur leurs catégories, jamais par le bénévole', async () => {
  const { as } = setup();
  const ev = (r: keyof typeof people, category: string) =>
    as(r).from('events').insert({ club_id: CLUB, category_id: category, event_type: 'competition', title: 'Match', event_date: '2026-12-01T10:00:00Z', location_text: 'Stade' });
  assert.equal((await ev('coach', CAT1)).error, null);
  assert.equal((await ev('team_manager', CAT1)).error, null);
  assert.equal((await ev('coach', CAT2)).error?.code, '42501');
  assert.equal((await ev('volunteer', CAT1)).error?.code, '42501');
});

test('accès des membres : seul le président les gère ; jamais dans un autre club', async () => {
  const { as } = setup();
  const invite = (r: keyof typeof people, club = CLUB) =>
    as(r).from('staff_members').insert({ user_id: people.volunteer, club_id: club, full_name: 'N', email: 'n@test.fr', role: 'volunteer' });
  assert.equal((await invite('vice_president')).error?.code, '42501');
  assert.equal((await invite('secretary')).error?.code, '42501');
  assert.equal((await invite('president', OTHER)).error?.code, '42501', 'jamais dans le club B');
  const promote = await as('president').from('staff_members').update({ role: 'super_admin', club_id: null }).eq('user_id', people.volunteer).select('id');
  assert.ok(promote.error || (promote.data?.length ?? 0) === 0, 'jamais de super_admin depuis un club');
});

test('isolation : aucun rôle du club A ne lit le club B', async () => {
  const { as } = setup();
  for (const r of CLUB_ROLES) {
    const { data } = await as(r).from('clubs').select('id');
    assert.deepEqual(data?.map((c) => c.id), [CLUB], r);
  }
});

// --- Droits personnalisés par personne (staff_members.permissions, migration 0004) ------------------------------

test('droits personnalisés : la liste de la personne remplace ceux de son rôle', async () => {
  const { raw, as } = setup();
  const set = (who: keyof typeof people, grants: string[] | null) =>
    raw.prepare('UPDATE staff_members SET permissions = ? WHERE user_id = ?').run(grants === null ? null : JSON.stringify(grants), people[who]);
  // Un éducateur à qui l'administrateur confie la lecture des dossiers.
  set('coach', ['members.read', 'attendance.take']);
  assert.equal((await as('coach').from('members').select('id')).data?.length, 2);
  assert.equal((await as('coach').from('members').update({ dossier_status: 'validated' }).eq('id', MEM1).select('id')).data?.length ?? 0, 0, 'lecture seule');
  // Il n'a plus « événements » : création refusée même sur sa catégorie.
  const ev = await as('coach').from('events').insert({ club_id: CLUB, category_id: CAT1, event_type: 'competition', title: 'M', event_date: '2026-12-01T10:00:00Z' });
  assert.equal(ev.error?.code, '42501');
  // Une secrétaire sans accès aux dossiers (seulement le site).
  set('secretary', ['content.write']);
  assert.equal((await as('secretary').from('members').select('id')).data?.length, 0);
  assert.equal((await as('secretary').from('payment_installments').select('id')).data?.length, 0);
  // Retour aux droits du rôle.
  set('secretary', null);
  assert.equal((await as('secretary').from('members').select('id')).data?.length, 2);
  // Un bénévole à qui l'on donne l'appel de tout le club.
  set('volunteer', ['sport.manage']);
  const roster = (await as('volunteer').from('coach_roster').select('id')).data?.map((m) => m.id).sort();
  assert.deepEqual(roster, [MEM1, MEM2].sort());
  // Valeur invalide refusée par la base.
  assert.throws(() => raw.prepare(`UPDATE staff_members SET permissions = '{}' WHERE user_id = ?`).run(people.coach));
});

test('droits : calculs, normalisation et avertissements affichés à l’administrateur', async () => {
  const { defaultGrants, effectiveGrants, normalizeGrants, grantWarnings, isScopedOnly, GRANT_INFO, ALL_GRANTS } = await import('../src/lib/permissions.ts');
  assert.deepEqual(effectiveGrants('coach', null), ['attendance.take', 'events.manage']);
  assert.deepEqual(effectiveGrants('coach', ['finance.read', 'inconnu']), ['finance.read']);
  assert.deepEqual(effectiveGrants('volunteer', []), [], 'liste vide = aucun droit, pas ceux du rôle');
  assert.deepEqual(normalizeGrants(['stats.read', 'club.admin', 'stats.read', 42]), ['club.admin', 'stats.read']);
  assert.ok(defaultGrants('president').includes('club.admin'));
  assert.equal(isScopedOnly(['attendance.take']), true);
  assert.equal(isScopedOnly(['attendance.take', 'stats.read']), false);
  for (const g of ALL_GRANTS) assert.ok(GRANT_INFO[g].label && GRANT_INFO[g].description, g);
  assert.equal(grantWarnings(['content.write'], false).length, 0);
  assert.match(grantWarnings(['members.read'], false).join(' '), /RGPD/);
  assert.match(grantWarnings(['club.admin'], false).join(' '), /modifier tous les droits/);
  assert.match(grantWarnings(['attendance.take'], false).join(' '), /Aucune catégorie/);
  assert.equal(grantWarnings(['attendance.take'], true).length, 0);
});
