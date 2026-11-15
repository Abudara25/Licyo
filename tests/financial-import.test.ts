// Import financier générique (src/lib/financial-import.ts, migration 0010).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { guessMapping, normalizeRows, parseAmountCents, parseDate, suggestMatch, type FamilyCandidate } from '../src/lib/financial-import.ts';

test('montants : formats français, anglais, symboles, négatifs ; illisibles refusés', () => {
  const cases: [string, number | null][] = [
    ['150', 15000], ['150,00 €', 15000], ['1 234,56', 123456], ['1.234,56', 123456], ['1,234.56', 123456],
    ['-12,5', -1250], ['(45,00)', -4500], ['+20', 2000], ['EUR 9.99', 999], ['1 000,00 €', 100000],
    ['', null], ['abc', null], ['12,345', null],
  ];
  for (const [raw, cents] of cases) assert.equal(parseAmountCents(raw), cents, raw);
});

test('dates : jj/mm/aaaa, jj-mm-aa, ISO, avec heure ; dates impossibles refusées', () => {
  assert.equal(parseDate('15/11/2026'), '2026-11-15');
  assert.equal(parseDate('5-1-26'), '2026-01-05');
  assert.equal(parseDate('2026-11-15T10:32:00Z'), '2026-11-15');
  assert.equal(parseDate('15/11/2026 10:32'), '2026-11-15');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('demain'), null);
});

test('colonnes : export HelloAsso et relevé bancaire reconnus (accents et casse ignorés)', () => {
  const ha = guessMapping(['Référence commande', 'Date', 'Montant', 'Statut', 'Nom', 'Prénom', 'Email', 'Formule'], 'helloasso');
  assert.deepEqual(ha, { reference: 0, date: 1, amount: 2, status: 3, lastName: 4, firstName: 5, email: 6, label: 7 });
  const bank = guessMapping(['Date opération', 'Libellé', 'Débit', 'Crédit'], 'bank');
  assert.equal(bank.date, 0);
  assert.equal(bank.label, 1);
  assert.equal(bank.amount, 3, 'colonne Crédit pour un relevé');
});

test('normalisation : statuts non payés et débits écartés, doublons du fichier distingués, clé stable', () => {
  const mapping = guessMapping(['Date', 'Montant', 'Statut', 'Nom', 'Prénom', 'Email'], 'helloasso');
  const rows = [
    ['15/09/2026', '150,00', 'Validé', 'Martin', 'Paul', 'paul@x.fr'],
    ['15/09/2026', '150,00', 'Validé', 'Martin', 'Paul', 'paul@x.fr'],
    ['16/09/2026', '80', 'Refusé', 'Noel', 'Ana', 'ana@x.fr'],
    ['jour', '80', 'Validé', 'Noel', 'Ana', 'ana@x.fr'],
    ['', '', '', '', '', ''],
  ];
  const a = normalizeRows(rows, mapping, 'helloasso');
  assert.equal(a.transactions.length, 2, 'deux enfants payés le même jour : deux opérations');
  assert.notEqual(a.transactions[0].dedupKey, a.transactions[1].dedupKey);
  assert.deepEqual(a.rejected.map((r) => r.line), [4, 5]);
  assert.equal(a.transactions[0].payerName, 'Paul Martin');
  const again = normalizeRows(rows, mapping, 'helloasso');
  assert.deepEqual(again.transactions.map((t) => t.dedupKey), a.transactions.map((t) => t.dedupKey), 'réimport : mêmes clés');
  const bank = normalizeRows([['01/10/2026', 'VIR M MARTIN', '-30,00'], ['02/10/2026', 'VIR M MARTIN', '150,00']], { date: 0, label: 1, amount: 2 }, 'bank');
  assert.equal(bank.transactions.length, 1);
  assert.match(bank.rejected[0].reason, /Débit/);
  assert.equal(normalizeRows([['x']], { label: 0 }, 'other').rejected[0].reason, 'Indiquez au moins les colonnes Date et Montant.');
});

test('suggestions : e-mail d’abord, puis nom et montant ; ambiguïté = aucune suggestion', () => {
  const families: FamilyCandidate[] = [
    { id: 'f1', payerFirstName: 'Paul', payerLastName: 'Martin', payerEmail: 'paul@x.fr', dueCents: 15000, memberNames: ['Léa MARTIN'] },
    { id: 'f2', payerFirstName: 'Ana', payerLastName: 'Noël', payerEmail: 'ana@x.fr', dueCents: 8000, memberNames: ['Tom NOEL'] },
    { id: 'f3', payerFirstName: 'Inès', payerLastName: 'Durand', payerEmail: 'ines@x.fr', dueCents: 0, memberNames: [] },
    { id: 'f4', payerFirstName: 'Marc', payerLastName: 'Durand', payerEmail: 'marc@x.fr', dueCents: 0, memberNames: [] },
  ];
  assert.deepEqual(suggestMatch({ payerEmail: 'paul@x.fr', payerName: null, label: null, amountCents: 99999 }, families), { familyId: 'f1', score: 3, reason: 'Même e-mail' });
  assert.equal(suggestMatch({ payerEmail: null, payerName: null, label: 'VIR SEPA NOEL ANA COTISATION', amountCents: 8000 }, families)?.score, 2);
  assert.equal(suggestMatch({ payerEmail: null, payerName: null, label: 'VIR NOEL', amountCents: 9000 }, families)?.score, 1, 'montant au-delà du reste');
  assert.equal(suggestMatch({ payerEmail: null, payerName: 'DURAND', label: null, amountCents: 100 }, families), null, 'deux familles Durand');
  assert.equal(suggestMatch({ payerEmail: null, payerName: 'Inconnu', label: null, amountCents: 100 }, families), null);
});

test('base : doublon refusé par club, statut cohérent ; lecture réservée aux finances', async () => {
  const raw = migratedDatabase();
  const A = '10000000-0000-4000-8000-00000000000a';
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email) VALUES (?, 'Club A', 'a', 'Paris', '75001', 'a@t.fr')`).run(A);
  const ins = (key: string) => raw.prepare(`INSERT INTO financial_transactions (id, club_id, source, dedup_key, occurred_on, amount_cents, payment_type) VALUES (?, ?, 'bank', ?, '2026-10-01', 15000, 'transfer')`).run(crypto.randomUUID(), A, key);
  ins('k1');
  assert.throws(() => ins('k1'), 'même clé deux fois');
  assert.throws(() => raw.prepare(`UPDATE financial_transactions SET status = 'matched'`).run(), 'rattachée sans famille ni encaissement');
  const u = { treasurer: '00000000-0000-4000-8000-000000000001', secretary: '00000000-0000-4000-8000-000000000002', coach: '00000000-0000-4000-8000-000000000003' };
  for (const [k, id] of Object.entries(u)) {
    raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${k}@t.fr`);
    raw.prepare(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', ?)`).run(crypto.randomUUID(), id, A, k);
  }
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(u.treasurer).from('financial_transactions').select('id')).data?.length, 1);
  assert.equal((await as(u.secretary).from('financial_transactions').select('id')).data?.length, 1, 'le secrétaire lit les finances');
  assert.equal((await as(u.coach).from('financial_transactions').select('id')).data?.length, 0);
  const write = await as(u.secretary).from('financial_transactions').update({ status: 'ignored' }).eq('dedup_key', 'k1').select('id');
  assert.equal(write.data?.length ?? 0, 0, 'le secrétaire ne modifie pas les finances');
});
