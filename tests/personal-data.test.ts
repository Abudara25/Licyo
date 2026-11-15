// Export et effacement à la demande d'une personne (src/lib/personal-data.ts) sur une vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { erasePerson, exportPerson } from '../src/lib/personal-data.ts';

const CLUB = '10000000-0000-4000-8000-00000000000d';
const OTHER = '10000000-0000-4000-8000-00000000000e';
const NOW = new Date('2026-11-15T12:00:00Z');
const file = (n: string) => `${CLUB}/members/2026-2027/${n}.pdf`;

function setup() {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  for (const id of [CLUB, OTHER]) run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, current_season) VALUES (?, 'Club Test', ?, 'Paris', '75001', 'club@t.fr', '2026-2027')`, id, 'c-' + id.slice(-3));
  const family = (club: string, season: string, email: string) => {
    const id = crypto.randomUUID();
    run(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code, final_total_amount, amount_paid) VALUES (?, ?, ?, 'Paul', 'Martin', ?, '0600000000', 'Urgence', '0600000001', '1 rue', 'Paris', '75001', 200, 200)`, id, club, season, email);
    run(`INSERT INTO payment_installments (id, club_id, family_id, amount, payment_type, check_number, status) VALUES (?, ?, ?, 200, 'check', '0012345', 'cashed')`, crypto.randomUUID(), club, id);
    return id;
  };
  const member = (club: string, family: string, season: string, first: string, photo: string | null = null) => {
    const id = crypto.randomUUID();
    run(`INSERT INTO members (id, club_id, family_id, season, first_name, last_name, birth_date, photo_storage_path, signature_data_url, magic_action_token, extra_fields) VALUES (?, ?, ?, ?, ?, 'Martin', ?, ?, 'data:image/png;base64,xx', ?, '{"taille":"M"}')`, id, club, family, season, first, first === 'Inès' ? '2014-05-17' : '2016-02-02', photo, crypto.randomUUID());
    return id;
  };
  const personOf = (memberId: string) => (raw.prepare('SELECT person_id FROM members WHERE id = ?').get(memberId) as { person_id: string }).person_id;
  const removed: string[] = [];
  const remover = (fail: string[] = []) => async (paths: string[]) => {
    removed.push(...paths);
    return new Set(paths.filter((p) => !fail.includes(p)));
  };
  return { raw, db: sqliteAdapter(raw), run, family, member, personOf, removed, remover };
}

test('export : toutes les saisons, dossiers, règlements, envois ; sans jeton interne ni autre club', async () => {
  const { db, run, family, member, personOf } = setup();
  const f1 = family(CLUB, '2025-2026', 'paul@x.fr');
  const f2 = family(CLUB, '2026-2027', 'paul@x.fr');
  const m1 = member(CLUB, f1, '2025-2026', 'Inès', file('a'));
  member(CLUB, f2, '2026-2027', 'Inès');
  run(`INSERT INTO email_log (id, club_id, kind, recipient, subject, provider, status) VALUES ('e1', ?, 'confirmation', 'paul@x.fr', 'Inscription reçue', 'log', 'logged')`, CLUB);
  const otherFamily = family(OTHER, '2026-2027', 'paul@x.fr');
  member(OTHER, otherFamily, '2026-2027', 'Inès');
  const data = await exportPerson(db, CLUB, personOf(m1), NOW);
  assert.ok(data);
  assert.equal(data.personne.prenom, 'Inès');
  assert.deepEqual(data.inscriptions.map((i) => i.saison), ['2025-2026', '2026-2027']);
  assert.equal(data.inscriptions[0].pieces_deposees.photo, true);
  assert.equal(data.inscriptions[0].signature_enregistree, true);
  assert.deepEqual(data.inscriptions[0].reponses_au_formulaire, { taille: 'M' });
  assert.equal(data.dossiers_familiaux.length, 2);
  assert.equal(data.dossiers_familiaux[0].reglements[0].amount, 200);
  assert.equal(data.emails_envoyes.length, 1);
  const json = JSON.stringify(data);
  assert.ok(!json.includes('magic_action_token') && !json.includes('base64') && !json.includes(file('a')), 'ni jeton, ni signature, ni chemin de fichier');
  assert.equal(await exportPerson(db, OTHER, personOf(m1), NOW), null, 'personne d’un autre club : rien');
});

test('effacement : pièces vérifiées, fiches anonymisées, montants gardés, personne supprimée', async () => {
  const { raw, db, run, family, member, personOf, removed, remover } = setup();
  const f = family(CLUB, '2026-2027', 'paul@x.fr');
  const m = member(CLUB, f, '2026-2027', 'Inès', file('a'));
  const pid = personOf(m);
  run(`INSERT INTO email_log (id, club_id, kind, recipient, subject, provider, status) VALUES ('e1', ?, 'confirmation', 'paul@x.fr', 'S', 'log', 'logged')`, CLUB);
  run(`INSERT INTO email_log (id, club_id, kind, recipient, subject, provider, status) VALUES ('e2', ?, 'confirmation', 'autre@x.fr', 'S', 'log', 'logged')`, CLUB);
  const done = await erasePerson(db, CLUB, pid, NOW, remover());
  assert.deepEqual(
    { ...done, journaux: undefined },
    { pieces: 1, echecsFichiers: 0, adherents: 1, familles: 1, famillesPartagees: 0, preinscriptions: 0, journaux: undefined, personneSupprimee: true },
  );
  assert.deepEqual(removed, [file('a')]);
  const row = raw.prepare('SELECT first_name, photo_storage_path, signature_data_url, extra_fields FROM members WHERE id = ?').get(m);
  assert.deepEqual({ ...(row as object) }, { first_name: 'Ancien', photo_storage_path: null, signature_data_url: null, extra_fields: '{}' });
  assert.equal((raw.prepare('SELECT amount FROM payment_installments WHERE family_id = ?').get(f) as { amount: number }).amount, 200);
  assert.deepEqual((raw.prepare('SELECT id FROM email_log ORDER BY id').all() as { id: string }[]).map((r) => r.id), ['e2']);
  assert.equal(raw.prepare('SELECT 1 FROM people WHERE id = ?').get(pid), undefined);
  assert.equal(await erasePerson(db, CLUB, pid, NOW, remover()), null, 'déjà effacée');
});

test('frère ou sœur conservé : dossier familial et historique d’envois gardés', async () => {
  const { raw, db, run, family, member, personOf, remover } = setup();
  const f = family(CLUB, '2026-2027', 'paul@x.fr');
  const ines = member(CLUB, f, '2026-2027', 'Inès');
  const leo = member(CLUB, f, '2026-2027', 'Léo');
  run(`INSERT INTO email_log (id, club_id, kind, recipient, subject, provider, status) VALUES ('e1', ?, 'confirmation', 'paul@x.fr', 'S', 'log', 'logged')`, CLUB);
  const done = await erasePerson(db, CLUB, personOf(ines), NOW, remover());
  assert.equal(done?.familles, 0);
  assert.equal(done?.famillesPartagees, 1);
  assert.equal((raw.prepare('SELECT payer_email FROM family_registrations WHERE id = ?').get(f) as { payer_email: string }).payer_email, 'paul@x.fr');
  assert.equal((raw.prepare('SELECT first_name FROM members WHERE id = ?').get(leo) as { first_name: string }).first_name, 'Léo');
  assert.equal((raw.prepare('SELECT count(*) n FROM email_log').get() as { n: number }).n, 1);
});

test('fichier non supprimé : personne gardée liée, second essai termine ; photo partagée détachée', async () => {
  const { raw, db, family, member, personOf, removed, remover } = setup();
  const f = family(CLUB, '2026-2027', 'paul@x.fr');
  const ines = member(CLUB, f, '2026-2027', 'Inès', file('fail'));
  const leo = member(CLUB, f, '2026-2027', 'Léo', file('shared'));
  raw.prepare('UPDATE members SET medical_doc_storage_path = ? WHERE id = ?').run(file('shared'), ines);
  const pid = personOf(ines);
  const first = await erasePerson(db, CLUB, pid, NOW, remover([file('fail')]));
  assert.deepEqual([first?.echecsFichiers, first?.adherents, first?.personneSupprimee], [1, 0, false]);
  assert.ok(!removed.includes(file('shared')), 'fichier encore utilisé pour Léo : pas supprimé');
  assert.equal((raw.prepare('SELECT photo_storage_path p FROM members WHERE id = ?').get(leo) as { p: string }).p, file('shared'));
  const second = await erasePerson(db, CLUB, pid, NOW, remover());
  assert.deepEqual([second?.adherents, second?.personneSupprimee], [1, true]);
});
