// Connexion HelloAsso (src/lib/helloasso.ts) : faux serveur HelloAsso et vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { mapPayment, organizationSlugFrom, syncHelloAsso, type Fetch } from '../src/lib/helloasso.ts';
import { insertTransactions } from '../src/lib/financial-store.ts';

const CLUB = '10000000-0000-4000-8000-0000000000a9';
const NOW = new Date('2026-11-15T10:00:00Z');
const CREDS = { organizationSlug: 'club-test', clientId: 'id-123456', clientSecret: 'secret' };

const payment = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  amount: 15000,
  date: '2026-09-02T21:30:00+00:00',
  state: 'Authorized',
  payer: { email: 'Paul@X.fr', firstName: 'Paul', lastName: 'Martin' },
  order: { id: 9000 + id, formSlug: 'adhesion-2026', formType: 'Membership' },
  items: [{ name: 'Licence U13' }],
  ...extra,
});

/** Faux HelloAsso : jeton, puis pages de paiements ; garde les adresses appelées. */
function fakeHelloAsso(pages: unknown[][], opts: { tokenStatus?: number; paymentsStatus?: number } = {}) {
  const calls: string[] = [];
  const fetchFn: Fetch = async (url, init) => {
    calls.push(url);
    if (url.endsWith('/oauth2/token')) {
      assert.match(init?.body ?? '', /grant_type=client_credentials/);
      const status = opts.tokenStatus ?? 200;
      return { ok: status === 200, status, json: async () => ({ access_token: 'tok', expires_in: 1800 }) };
    }
    assert.equal(init?.headers?.Authorization, 'Bearer tok');
    const status = opts.paymentsStatus ?? 200;
    const index = Number(new URL(url).searchParams.get('pageIndex') ?? '1');
    const data = pages[index - 1] ?? [];
    return { ok: status === 200, status, json: async () => ({ data, pagination: { pageIndex: index, totalPages: pages.length, pageSize: 100 } }) };
  };
  return { fetchFn, calls };
}

function setup() {
  const raw = migratedDatabase();
  raw.prepare(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, current_season) VALUES (?, 'Club Test', 'ha-test', 'Paris', '75001', 'c@t.fr', '2026-2027')`).run(CLUB);
  return { raw, db: sqliteAdapter(raw) };
}

test('adresse de l’association : page HelloAsso ou identifiant', () => {
  assert.equal(organizationSlugFrom('https://www.helloasso.com/associations/judo-club-poissy/adhesions/2026'), 'judo-club-poissy');
  assert.equal(organizationSlugFrom('  Judo-Club-Poissy '), 'judo-club-poissy');
  assert.equal(organizationSlugFrom('mon club'), null);
  assert.equal(organizationSlugFrom('../admin'), null);
});

test('paiement : encaissé seulement, montant en centimes, date de Paris, libellé lisible', () => {
  const t = mapPayment(payment(1));
  assert.deepEqual(t, {
    line: 0,
    dedupKey: 'helloasso:payment:1',
    externalRef: '1',
    occurredOn: '2026-09-02', // 23 h 30 à Paris
    amountCents: 15000,
    payerName: 'Paul Martin',
    payerEmail: 'paul@x.fr',
    label: 'Adhésion - adhesion-2026 - Licence U13',
  });
  assert.equal(mapPayment(payment(2, { date: '2026-09-02T22:30:00+00:00' }))?.occurredOn, '2026-09-03', 'minuit passé à Paris');
  assert.equal(mapPayment(payment(3, { state: 'Refused' })), null);
  assert.equal(mapPayment(payment(4, { amount: 0 })), null);
  assert.equal(mapPayment(payment(5, { amount: 12.5 })), null);
});

test('synchronisation : toutes les pages, rejouable sans doublon, reprise après le dernier passage', async () => {
  const { raw, db } = setup();
  const page1 = Array.from({ length: 100 }, (_, i) => payment(i + 1));
  const page2 = [payment(101), payment(102, { state: 'Refunded' })];
  const fake = fakeHelloAsso([page1, page2]);
  const first = await syncHelloAsso(db, CLUB, CREDS, null, NOW, fake.fetchFn, 'https://api.test');
  assert.deepEqual({ ...first, syncedUntil: undefined }, { recus: 102, nouveaux: 101, dejaConnus: 0, ignores: 1, tronque: false, syncedUntil: undefined });
  assert.equal(first.syncedUntil, NOW.toISOString());
  const firstFrom = new URL(fake.calls[1]).searchParams.get('from');
  assert.equal(firstFrom, new Date(NOW.getTime() - 400 * 86400000).toISOString(), 'première fois : 400 jours');
  assert.equal(new URL(fake.calls[1]).searchParams.get('states'), 'Authorized');
  const again = fakeHelloAsso([[payment(101), payment(103)]]);
  const second = await syncHelloAsso(db, CLUB, CREDS, first.syncedUntil, NOW, again.fetchFn, 'https://api.test');
  assert.deepEqual([second.nouveaux, second.dejaConnus], [1, 1]);
  assert.equal(new URL(again.calls[1]).searchParams.get('from'), new Date(NOW.getTime() - 3 * 86400000).toISOString(), 'reprise avec 3 jours de recouvrement');
  const rows = raw.prepare("SELECT count(*) n, sum(amount_cents) s FROM financial_transactions WHERE source = 'helloasso'").get() as { n: number; s: number };
  assert.deepEqual({ ...rows }, { n: 102, s: 102 * 15000 });
  assert.equal((raw.prepare('SELECT payment_type FROM financial_transactions LIMIT 1').get() as { payment_type: string }).payment_type, 'card');
});

test('déjà importé par fichier CSV (n° de paiement ou de commande) : pas de doublon', async () => {
  const { raw, db } = setup();
  const csv = (ref: string) => ({ line: 2, dedupKey: `helloasso:ref:${ref}`, externalRef: ref, occurredOn: '2026-09-02', amountCents: 15000, payerName: 'Paul Martin', payerEmail: null, label: null });
  await insertTransactions(db, { clubId: CLUB, source: 'helloasso', paymentType: 'card', fileName: 'export.csv', rowCount: 2, importedBy: null }, [csv('1'), csv('9002')]);
  const r = await syncHelloAsso(db, CLUB, CREDS, null, NOW, fakeHelloAsso([[payment(1), payment(2), payment(3)]]).fetchFn, 'https://api.test');
  assert.deepEqual([r.nouveaux, r.dejaConnus], [1, 2]);
  assert.equal((raw.prepare('SELECT count(*) n FROM financial_transactions').get() as { n: number }).n, 3);
});

test('erreurs lisibles : identifiants refusés, droits insuffisants, association inconnue', async () => {
  const { db } = setup();
  const run = (o: { tokenStatus?: number; paymentsStatus?: number }) => syncHelloAsso(db, CLUB, CREDS, null, NOW, fakeHelloAsso([[payment(1)]], o).fetchFn, 'https://api.test');
  await assert.rejects(run({ tokenStatus: 401 }), /Identifiants API HelloAsso refusés/);
  await assert.rejects(run({ paymentsStatus: 403 }), /droit de lire les paiements/);
  await assert.rejects(run({ paymentsStatus: 404 }), /Association introuvable/);
  await assert.rejects(run({ paymentsStatus: 503 }), /erreur 503/);
});

test('lecture tronquée : reprise à la date du dernier paiement lu', async () => {
  const { db } = setup();
  const pages = Array.from({ length: 51 }, (_, p) => Array.from({ length: 100 }, (_, i) => payment(p * 100 + i + 1, { date: `2026-0${(p % 9) + 1}-10T10:00:00+00:00` })));
  const r = await syncHelloAsso(db, CLUB, CREDS, null, NOW, fakeHelloAsso(pages).fetchFn, 'https://api.test');
  assert.equal(r.tronque, true);
  assert.equal(r.recus, 5000);
  assert.equal(r.syncedUntil, new Date('2026-05-10T10:00:00+00:00').toISOString());
});
