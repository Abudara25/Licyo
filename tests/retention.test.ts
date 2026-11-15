// Conservation RGPD (src/lib/retention.ts, migration 0012) sur une vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { addMonths, applyRetention, expiredSeasons, parseRetentionPolicy, previewRetention, runRetention, seasonEnd } from '../src/lib/retention.ts';
import { TASKS } from '../src/lib/scheduled.ts';

const CLUB = '10000000-0000-4000-8000-00000000000b';
const OTHER = '10000000-0000-4000-8000-00000000000c';
const CAT = '20000000-0000-4000-8000-0000000000b1';
const NOW = new Date('2026-12-15T03:00:00Z'); // saison 2025-2026 finie depuis 3,5 mois
const POLICY = parseRetentionPolicy({ enabled: true, documentsMonths: 3, membersYears: 3, preregistrationsMonths: 6 });
const path = (club: string, n: string) => `${club}/members/2023-2024/${n}.pdf`;

function setup() {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  for (const id of [CLUB, OTHER]) {
    run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, current_season, retention_policy) VALUES (?, 'Club', ?, 'Paris', '75001', 'c@t.fr', '2026-2027', ?)`, id, 'club-' + id.slice(-4), JSON.stringify({ enabled: id === CLUB }));
  }
  run(`INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price) VALUES (?, ?, 'U13', 2010, 2020, 100)`, CAT, CLUB);
  const member = (club: string, season: string, opts: { first?: string; photo?: string | null; medical?: string | null; extra?: string } = {}) => {
    const f = crypto.randomUUID();
    const m = crypto.randomUUID();
    run(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code) VALUES (?, ?, ?, 'Paul', 'Martin', 'paul@x.fr', '0600000000', 'Urgence', '0600000001', '1 rue', 'Paris', '75001')`, f, club, season);
    run(`INSERT INTO members (id, club_id, family_id, season, first_name, last_name, birth_date, photo_storage_path, medical_doc_storage_path, signature_data_url, magic_action_token) VALUES (?, ?, ?, ?, ?, 'Martin', '2014-05-17', ?, ?, 'data:image/png;base64,xx', ?)`, m, club, f, season, opts.first ?? 'Inès', opts.photo ?? null, opts.medical ?? null, crypto.randomUUID());
    if (opts.extra) run(`INSERT INTO member_documents (id, club_id, member_id, doc_key, storage_path) VALUES (?, ?, ?, 'autorisation', ?)`, crypto.randomUUID(), club, m, opts.extra);
    run(`INSERT INTO payment_installments (id, club_id, family_id, amount, payment_type, check_number, status) VALUES (?, ?, ?, 120, 'check', '0012345', 'cashed')`, crypto.randomUUID(), club, f);
    return { f, m };
  };
  const removed: string[] = [];
  const remover = (fail: string[] = []) => async (paths: string[]) => {
    removed.push(...paths);
    return new Set(paths.filter((p) => !fail.includes(p)));
  };
  return { raw, db: sqliteAdapter(raw), run, member, removed, remover };
}

test('politique : bornes, désactivée par défaut, pièces jamais gardées plus longtemps que les adhérents', () => {
  assert.deepEqual(parseRetentionPolicy({}), { enabled: false, documentsMonths: 3, membersYears: 3, preregistrationsMonths: 6 });
  assert.deepEqual(parseRetentionPolicy({ enabled: 'oui', documentsMonths: 99, membersYears: 0, preregistrationsMonths: 1.5 }), {
    enabled: false,
    documentsMonths: 12, // plafonné à membersYears (1 an)
    membersYears: 1,
    preregistrationsMonths: 6,
  });
  assert.equal(seasonEnd('2025-2026')?.toISOString(), '2026-08-31T23:59:59.000Z');
  assert.equal(seasonEnd('2025-2027'), null);
  assert.equal(addMonths(seasonEnd('2025-2026')!, 3).toISOString(), '2026-11-30T23:59:59.000Z', 'pas de débordement au 1er décembre');
  assert.equal(addMonths(seasonEnd('2025-2026')!, 36).toISOString(), '2029-08-31T23:59:59.000Z');
  assert.deepEqual(expiredSeasons(['2026-2027', '2025-2026', '2024-2025', 'n/a'], 3, NOW), ['2025-2026', '2024-2025']);
  assert.deepEqual(expiredSeasons(['2025-2026'], 4, NOW), [], 'fin + 4 mois = 31 décembre : pas encore');
});

test('pièces : supprimées puis vérifiées ; saison en cours intacte ; fichier réutilisé détaché sans être supprimé', async () => {
  const { raw, db, member, removed, remover } = setup();
  const old = member(CLUB, '2025-2026', { photo: path(CLUB, 'a'), medical: path(CLUB, 'b'), extra: path(CLUB, 'c') });
  const current = member(CLUB, '2026-2027', { photo: path(CLUB, 'shared') });
  const reused = member(CLUB, '2025-2026', { photo: path(CLUB, 'shared') }); // même photo reprise à la réinscription
  assert.equal((await previewRetention(db, CLUB, POLICY, NOW)).pieces, 4);
  const done = await applyRetention(db, CLUB, POLICY, NOW, remover());
  assert.equal(done.pieces, 4);
  assert.deepEqual(removed.sort(), [path(CLUB, 'a'), path(CLUB, 'b'), path(CLUB, 'c')], 'la photo partagée n’est pas supprimée');
  const m = (id: string) => raw.prepare('SELECT photo_storage_path p, medical_doc_storage_path d, first_name, anonymized_at FROM members WHERE id = ?').get(id) as Record<string, unknown>;
  assert.deepEqual({ ...m(old.m) }, { p: null, d: null, first_name: 'Inès', anonymized_at: null }, 'pièces retirées, adhérent encore conservé');
  assert.equal(m(reused.m).p, null);
  assert.equal(m(current.m).p, path(CLUB, 'shared'));
  assert.equal((raw.prepare('SELECT count(*) n FROM member_documents').get() as { n: number }).n, 0);
});

test('suppression non confirmée : le chemin reste, l’adhérent n’est pas anonymisé, nouvel essai ensuite', async () => {
  const { raw, db, member, remover } = setup();
  const old = member(CLUB, '2022-2023', { photo: path(CLUB, 'a'), medical: path(CLUB, 'b') });
  const first = await applyRetention(db, CLUB, POLICY, NOW, remover([path(CLUB, 'b')]));
  assert.equal(first.echecsFichiers, 1);
  assert.equal(first.adherents, 0, 'pièce encore présente : pas d’anonymisation');
  const row = () => raw.prepare('SELECT photo_storage_path p, medical_doc_storage_path d, anonymized_at a FROM members WHERE id = ?').get(old.m) as Record<string, unknown>;
  assert.deepEqual({ ...row(), a: row().a === null }, { p: null, d: path(CLUB, 'b'), a: true });
  const second = await applyRetention(db, CLUB, POLICY, NOW, remover());
  assert.equal(second.adherents, 1);
  assert.equal(row().d, null);
});

test('anonymisation : noms, coordonnées, signature effacés ; montants, accès et personne traités ; rejouable', async () => {
  const { raw, db, run, member, remover } = setup();
  const old = member(CLUB, '2022-2023');
  const recent = member(CLUB, '2024-2025', { first: 'Léa' }); // fin 31/08/2025 + 3 ans : conservée
  run(`INSERT INTO auth_users (id, email) VALUES ('00000000-0000-4000-8000-0000000000f1', 'paul@x.fr')`);
  run(`INSERT INTO family_access (club_id, family_id, user_id) VALUES (?, ?, '00000000-0000-4000-8000-0000000000f1')`, CLUB, old.f);
  raw.prepare(`UPDATE people SET created_at = '2023-01-01T00:00:00Z'`).run();
  const preview = await previewRetention(db, CLUB, POLICY, NOW);
  assert.deepEqual([preview.adherents, preview.familles], [1, 1]);
  const done = await applyRetention(db, CLUB, POLICY, NOW, remover());
  assert.deepEqual([done.adherents, done.familles, done.personnes], [1, 1, 1]);
  const m = raw.prepare('SELECT first_name, last_name, birth_date, signature_data_url, person_id FROM members WHERE id = ?').get(old.m);
  assert.deepEqual({ ...(m as object) }, { first_name: 'Ancien', last_name: 'adhérent', birth_date: '2014-01-01', signature_data_url: null, person_id: null });
  const f = raw.prepare('SELECT payer_email, payer_phone, address, final_total_amount FROM family_registrations WHERE id = ?').get(old.f);
  assert.deepEqual({ ...(f as object) }, { payer_email: '', payer_phone: '', address: '', final_total_amount: 0 });
  const p = raw.prepare('SELECT amount, check_number FROM payment_installments WHERE family_id = ?').get(old.f);
  assert.deepEqual({ ...(p as object) }, { amount: 120, check_number: null }, 'montant gardé, numéro de chèque effacé');
  assert.equal((raw.prepare('SELECT count(*) n FROM family_access').get() as { n: number }).n, 0);
  assert.equal((raw.prepare('SELECT first_name FROM members WHERE id = ?').get(recent.m) as { first_name: string }).first_name, 'Léa');
  const again = await applyRetention(db, CLUB, POLICY, NOW, remover());
  assert.deepEqual([again.adherents, again.familles, again.personnes, again.pieces], [0, 0, 0, 0]);
});

test('pré-inscriptions closes et opérations importées ; autre club et club non activé intacts', async () => {
  const { raw, db, run, member, remover } = setup();
  const prereg = (club: string, status: string, updated: string, season = '2026-2027') =>
    run(`INSERT INTO preregistrations (id, club_id, category_id, season, first_name, last_name, birth_date, contact_name, email, phone, status, updated_at, invite_token_hash, invite_expires_at) VALUES (?, ?, ?, ?, 'A', 'B', '2015-01-01', 'C', 'a@x.fr', '0600000000', ?, ?, ?, ?)`,
      crypto.randomUUID(), club, CAT, season, status, updated, status === 'invited' ? crypto.randomUUID() : null, status === 'invited' ? '2027-01-01' : null);
  prereg(CLUB, 'declined', '2026-01-10T00:00:00Z'); // close depuis 11 mois
  prereg(CLUB, 'declined', '2026-11-01T00:00:00Z'); // close récemment
  prereg(CLUB, 'waiting', '2026-11-01T00:00:00Z');
  prereg(CLUB, 'waiting', '2025-09-01T00:00:00Z', '2025-2026'); // saison finie depuis plus de 6 mois ? non (3,5 mois)
  prereg(CLUB, 'waiting', '2024-09-01T00:00:00Z', '2024-2025'); // saison finie depuis 15 mois
  const tx = (date: string) =>
    run(`INSERT INTO financial_transactions (id, club_id, source, dedup_key, occurred_on, amount_cents, payer_name, payer_email, label, payment_type) VALUES (?, ?, 'bank', ?, ?, 1000, 'Paul Martin', 'paul@x.fr', 'VIR PAUL', 'transfer')`, crypto.randomUUID(), CLUB, crypto.randomUUID(), date);
  tx('2023-06-01');
  tx('2024-01-01');
  const otherOld = member(OTHER, '2020-2021', { photo: path(OTHER, 'z') });
  const out = await runRetention(db, NOW, remover());
  assert.match(out, /clubs=1 /, 'seul le club qui a activé sa politique');
  assert.equal((raw.prepare('SELECT count(*) n FROM preregistrations').get() as { n: number }).n, 3);
  const txs = raw.prepare('SELECT occurred_on, payer_name FROM financial_transactions ORDER BY occurred_on').all() as { occurred_on: string; payer_name: string | null }[];
  assert.deepEqual(txs.map((t) => t.payer_name), [null, 'Paul Martin']);
  assert.equal((raw.prepare('SELECT photo_storage_path p FROM members WHERE id = ?').get(otherOld.m) as { p: string }).p, path(OTHER, 'z'));
  const log = raw.prepare('SELECT trigger, detail FROM retention_runs WHERE club_id = ?').get(CLUB) as { trigger: string; detail: string };
  assert.equal(log.trigger, 'auto');
  assert.equal(JSON.parse(log.detail).preinscriptions, 2);
});

test('journaux techniques purgés à 13 mois ; désinscriptions newsletter gardées', async () => {
  const { raw, db, run } = setup();
  run(`INSERT INTO reminder_log (id, club_id, target_type, target_id, kind, step, recipient, sent_at) VALUES ('r1', ?, 'member', 'x', 'documents', 1, 'a@x.fr', '2025-01-01T00:00:00Z')`, CLUB);
  run(`INSERT INTO newsletters (id, club_id, subject, body, status, send_at, updated_at) VALUES ('n1', ?, 'S', 'B', 'sent', '2024-12-31T00:00:00Z', '2025-01-01T00:00:00Z')`, CLUB);
  run(`INSERT INTO newsletter_deliveries (id, newsletter_id, club_id, email, unsubscribe_token_hash, status) VALUES ('d1', 'n1', ?, 'a@x.fr', 'h', 'sent')`, CLUB);
  run(`INSERT INTO newsletter_unsubscribes (club_id, email, created_at) VALUES (?, 'a@x.fr', '2020-01-01T00:00:00Z')`, CLUB);
  const purge = TASKS.find((t) => t.name === 'purge')!;
  assert.match(await purge.run(db, NOW), /relances=1 newsletter=1/);
  assert.equal((raw.prepare('SELECT count(*) n FROM newsletter_unsubscribes').get() as { n: number }).n, 1);
});

test('accès au journal : présidence seulement', async () => {
  const { raw } = setup();
  raw.prepare(`INSERT INTO retention_runs (id, club_id, trigger, detail) VALUES ('j1', ?, 'manual', '{}')`).run(CLUB);
  const u = { president: '00000000-0000-4000-8000-000000000011', secretary: '00000000-0000-4000-8000-000000000012' };
  for (const [role, id] of Object.entries(u)) {
    raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${role}@t.fr`);
    raw.prepare(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', ?)`).run(crypto.randomUUID(), id, CLUB, role);
  }
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(u.president).from('retention_runs').select('id')).data?.length, 1);
  assert.equal((await as(u.secretary).from('retention_runs').select('id')).data?.length, 0);
});
