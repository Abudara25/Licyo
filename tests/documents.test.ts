// Pièces configurables par club (src/config/registration-documents.ts, migration 0009).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import {
  DEFAULT_DOCUMENTS,
  documentLabel,
  isDocumentKey,
  parseDocumentsConfig,
  resolveDocuments,
} from '../src/config/registration-documents.ts';
import { clubDocuments, missingDocuments, planClubReminders } from '../src/lib/reminders.ts';

test('par défaut : photo obligatoire, pièce d’identité facultative, rien d’autre', () => {
  assert.deepEqual(DEFAULT_DOCUMENTS.map((d) => [d.key, d.mode]), [['photo', 'required'], ['id', 'optional']]);
  assert.deepEqual(clubDocuments({}, 'football').map((d) => d.key), ['photo', 'id']);
});

test('réglages : catalogue selon le sport, pièces du club, entrées invalides ignorées', () => {
  const cfg = parseDocumentsConfig({
    documents: {
      photo: { mode: 'optional', audience: 'all' },
      parental_authorization_doc: { mode: 'required', audience: 'minor' },
      sport_passport_doc: { mode: 'required', audience: 'all' },
      inconnue: { mode: 'required', audience: 'all' },
      residence_proof: { mode: 'obligatoire', audience: 'all' },
    },
    customDocuments: [
      { id: 'd_assurance', label: 'Attestation d’assurance', mode: 'required', audience: 'adult' },
      { id: 'd_vide', label: '  ', mode: 'required', audience: 'all' },
      { id: 'pas-valide', label: 'X', mode: 'required', audience: 'all' },
      { id: 'd_assurance', label: 'Doublon', mode: 'optional', audience: 'all' },
    ],
  });
  assert.deepEqual(Object.keys(cfg.documents).sort(), ['parental_authorization_doc', 'photo', 'sport_passport_doc']);
  assert.deepEqual(cfg.customDocuments.map((d) => d.id), ['d_assurance']);
  const collectif = resolveDocuments(cfg, 'collectif').map((d) => d.key);
  const combat = resolveDocuments(cfg, 'combat').map((d) => d.key);
  assert.ok(!collectif.includes('sport_passport_doc'), 'passeport sportif : sports de combat seulement');
  assert.ok(combat.includes('sport_passport_doc'));
  assert.ok(collectif.includes('d_assurance') && collectif.includes('parental_authorization_doc'));
  assert.equal(documentLabel(cfg, 'd_assurance'), 'Attestation d’assurance');
  assert.equal(documentLabel(cfg, 'd_ancienne'), 'Pièce retirée par le club');
});

test('clés : seules celles du catalogue ou du format d_… sont acceptées', () => {
  for (const ok of ['photo', 'residence_proof', 'd_assurance']) assert.equal(isDocumentKey(ok), true, ok);
  for (const ko of ['../photo', 'd_', 'D_X', 'medical_doc_storage_path', 'd_' + 'x'.repeat(30)]) assert.equal(isDocumentKey(ko), false, ko);
});

test('pièces manquantes : obligatoires seulement, selon mineur ou majeur, pièces complémentaires comprises', () => {
  const documents = resolveDocuments(
    parseDocumentsConfig({
      documents: { photo: { mode: 'optional', audience: 'all' }, parental_authorization_doc: { mode: 'required', audience: 'minor' } },
      customDocuments: [{ id: 'd_assurance', label: 'Attestation d’assurance', mode: 'required', audience: 'adult' }],
    }),
    'collectif',
  );
  const base = { photo_storage_path: null, medical_doc_storage_path: null, health_questionnaire_passed: 1, medical_requirement: 'health_questionnaire' };
  assert.deepEqual(missingDocuments({ ...base, is_minor: 1 }, documents), ['autorisation parentale signée'], 'photo devenue facultative');
  assert.deepEqual(missingDocuments({ ...base, is_minor: 1 }, documents, new Set(['parental_authorization_doc'])), []);
  assert.deepEqual(missingDocuments({ ...base, is_minor: 0 }, documents), ['attestation d’assurance']);
  assert.deepEqual(missingDocuments({ ...base, is_minor: 0, medical_requirement: 'medical_cert_competition' }, documents), ['attestation d’assurance', 'certificat médical']);
});

test('relances : une pièce obligatoire du club manque → relance ; déposée → plus de relance', async () => {
  const raw = migratedDatabase();
  const club = '10000000-0000-4000-8000-00000000000a';
  const policy = JSON.stringify({ enabled: true, delaysDays: [3], kinds: { documents: true, correction: false, payment: false } });
  const form = JSON.stringify({ documents: { photo: { mode: 'optional', audience: 'all' } }, customDocuments: [{ id: 'd_assurance', label: 'Attestation d’assurance', mode: 'required', audience: 'all' }] });
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, status, reminder_policy, registration_form) VALUES (?, 'Club A', 'a', 'Paris', '75001', 'a@t.fr', 'active', ?, ?)`).run(club, policy, form);
  const fam = crypto.randomUUID();
  raw.prepare(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code, payment_status) VALUES (?, ?, '2026-2027', 'P', 'N', 'p@x.fr', '0600000000', 'U', '0600000001', '1 rue', 'Paris', '75001', 'paid')`).run(fam, club);
  const member = crypto.randomUUID();
  raw.prepare(`INSERT INTO members (id, club_id, family_id, season, first_name, last_name, birth_date, magic_action_token, created_at, health_questionnaire_passed) VALUES (?, ?, ?, '2026-2027', 'Léa', 'N', '2015-01-01', ?, '2026-10-01T00:00:00Z', 1)`).run(member, club, fam, crypto.randomUUID());
  const db = sqliteAdapter(raw);
  const clubRow = () => raw.prepare('SELECT id, current_season, reminder_policy, registration_form, sport_type FROM clubs').get() as never;
  const plan = await planClubReminders(db, clubRow(), new Date('2026-10-05T00:00:00Z'));
  assert.deepEqual(plan.map((p) => p.details), [['attestation d’assurance']], 'la photo facultative ne déclenche rien');
  raw.prepare(`INSERT INTO member_documents (id, club_id, member_id, doc_key, storage_path) VALUES (?, ?, ?, 'd_assurance', 'x')`).run(crypto.randomUUID(), club, member);
  assert.equal((await planClubReminders(db, clubRow(), new Date('2026-10-05T00:00:00Z'))).length, 0);
});

test('stockage : une pièce par personne et par type ; lue par le bureau du club seulement', async () => {
  const raw = migratedDatabase();
  const A = '10000000-0000-4000-8000-00000000000a';
  const B = '10000000-0000-4000-8000-00000000000b';
  for (const [id, slug] of [[A, 'a'], [B, 'b']]) raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email) VALUES (?, 'Club ' || ?, ?, 'Paris', '75001', 'a@t.fr')`).run(id, slug, slug);
  const member = crypto.randomUUID();
  raw.prepare(`INSERT INTO members (id, club_id, season, first_name, last_name, birth_date, magic_action_token) VALUES (?, ?, '2026-2027', 'Léa', 'N', '2015-01-01', ?)`).run(member, A, crypto.randomUUID());
  const add = () => raw.prepare(`INSERT INTO member_documents (id, club_id, member_id, doc_key, storage_path) VALUES (?, ?, ?, 'aid_proof', 'p')`).run(crypto.randomUUID(), A, member);
  add();
  assert.throws(add, 'une seule pièce de ce type pour cette personne');
  const u = { sec: '00000000-0000-4000-8000-000000000001', coach: '00000000-0000-4000-8000-000000000002', other: '00000000-0000-4000-8000-000000000003' };
  for (const [k, id] of Object.entries(u)) raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${k}@t.fr`);
  const staff = `INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', ?)`;
  raw.prepare(staff).run(crypto.randomUUID(), u.sec, A, 'secretary');
  raw.prepare(staff).run(crypto.randomUUID(), u.coach, A, 'coach');
  raw.prepare(staff).run(crypto.randomUUID(), u.other, B, 'president');
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(u.sec).from('member_documents').select('id')).data?.length, 1);
  assert.equal((await as(u.coach).from('member_documents').select('id')).data?.length, 0);
  assert.equal((await as(u.other).from('member_documents').select('id')).data?.length, 0);
  raw.prepare('DELETE FROM members WHERE id = ?').run(member);
  assert.equal((raw.prepare('SELECT count(*) AS n FROM member_documents').get() as { n: number }).n, 0, 'supprimées avec l’inscription');
});
