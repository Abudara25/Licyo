// Autorisation parentale en ligne (src/config/parental-authorization.ts, migration 0013).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import {
  DEFAULT_AUTHORIZATION_TEXT,
  parseParentalAuthorization,
  parseSignedAuthorization,
  renderAuthorization,
  templateHash,
} from '../src/config/parental-authorization.ts';
import { exportPerson } from '../src/lib/personal-data.ts';
import { anonymizeMembers } from '../src/lib/retention.ts';

const VARS = { signerName: 'Marie Martin', signerQuality: 'mere' as const, childName: 'Léo MARTIN', birthDate: '2015-04-12', clubName: 'HBC', sport: 'Boxe anglaise', season: '2026-2027' };

test('réglage : activée par défaut, texte par défaut si vide ou trop court, désactivable', () => {
  assert.deepEqual(parseParentalAuthorization({}), { enabled: true, text: DEFAULT_AUTHORIZATION_TEXT });
  assert.deepEqual(parseParentalAuthorization({ parentalAuthorization: { enabled: false, text: 'court' } }), { enabled: false, text: DEFAULT_AUTHORIZATION_TEXT });
  const custom = 'J’autorise {enfant} à participer aux combats amateurs encadrés par {club}.';
  assert.equal(parseParentalAuthorization({ parentalAuthorization: { text: `  ${custom}\r\n` } }).text, custom);
  assert.equal(parseParentalAuthorization({ parentalAuthorization: { text: 'x'.repeat(5000) } }).text, DEFAULT_AUTHORIZATION_TEXT);
});

test('rendu : variables remplacées, accords corrects, contenu laissé en texte', () => {
  const text = renderAuthorization(DEFAULT_AUTHORIZATION_TEXT, VARS);
  assert.match(text, /^Je soussigné\(e\) Marie Martin, agissant en qualité de mère de Léo MARTIN, né\(e\) le 12\/04\/2015/);
  assert.match(text, /pratiquer l'activité « Boxe anglaise » au sein du club HBC pour la saison 2026-2027/);
  assert.ok(!/\{[a-z]+\}/.test(text), 'aucune variable oubliée');
  const inert = renderAuthorization('{enfant} {inconnue}', { ...VARS, childName: '<b>x</b>' });
  assert.equal(inert, '<b>x</b> {inconnue}', 'rien n’est interprété ; variable inconnue laissée telle quelle');
});

test('copie signée : relue strictement ; empreinte stable du modèle', async () => {
  assert.equal(parseSignedAuthorization(null), null);
  assert.equal(parseSignedAuthorization('{"text":"t","signerName":"M","signerQuality":"voisin","signedAt":"x"}'), null);
  const ok = parseSignedAuthorization({ text: 't', signerName: 'M', signerQuality: 'pere', signedAt: '2026-11-15T10:00:00Z', templateHash: 'h' });
  assert.equal(ok?.signerQuality, 'pere');
  assert.equal(await templateHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('dossier : la copie figée sort dans l’export RGPD et disparaît à l’anonymisation', async () => {
  const raw = migratedDatabase();
  const db = sqliteAdapter(raw);
  const CLUB = '10000000-0000-4000-8000-0000000000f1';
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, current_season) VALUES (?, 'Club Test', 'pa-test', 'Paris', '75001', 'c@t.fr', '2026-2027')`).run(CLUB);
  const f = crypto.randomUUID();
  raw.prepare(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code) VALUES (?, ?, '2026-2027', 'Marie', 'Martin', 'm@x.fr', '0600000000', 'U', '0600000001', '1 rue', 'Paris', '75001')`).run(f, CLUB);
  const m = crypto.randomUUID();
  const signed = { text: renderAuthorization(DEFAULT_AUTHORIZATION_TEXT, VARS), signerName: 'Marie Martin', signerQuality: 'mere', signedAt: '2026-11-15T10:00:00Z', templateHash: 'h' };
  raw.prepare(`INSERT INTO members (id, club_id, family_id, season, first_name, last_name, birth_date, magic_action_token, parental_authorization) VALUES (?, ?, ?, '2026-2027', 'Léo', 'MARTIN', '2015-04-12', ?, ?)`).run(m, CLUB, f, crypto.randomUUID(), JSON.stringify(signed));
  assert.throws(() => raw.prepare(`UPDATE members SET parental_authorization = '[1]' WHERE id = ?`).run(m), /CHECK/);
  const person = (raw.prepare('SELECT person_id FROM members WHERE id = ?').get(m) as { person_id: string }).person_id;
  const data = await exportPerson(db, CLUB, person);
  assert.equal(data?.inscriptions[0].autorisation_parentale?.signataire, 'Marie Martin');
  assert.equal(data?.inscriptions[0].autorisation_parentale?.qualite, 'mère');
  await anonymizeMembers(db, CLUB, { where: (t) => `${t}.id = ?`, params: [m] }, '2026-11-15T12:00:00Z');
  assert.equal((raw.prepare('SELECT parental_authorization p FROM members WHERE id = ?').get(m) as { p: string | null }).p, null);
});
