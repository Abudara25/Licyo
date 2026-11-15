// Newsletter (src/lib/newsletter.ts, migration 0011) sur une vraie base SQLite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratedDatabase, sqliteAdapter } from './helpers/sqlite.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { bodyText, parseAudience, parseBody, processNewsletters, resolveRecipients, unsubscribeByToken, type DeliveryToSend } from '../src/lib/newsletter.ts';
import { buildMime } from '../src/lib/email/mime.ts';

const CLUB = '10000000-0000-4000-8000-00000000000a';
const CAT1 = '20000000-0000-4000-8000-0000000000a1';
const CAT2 = '20000000-0000-4000-8000-0000000000a2';
const NOW = new Date('2026-11-15T10:00:00Z');

function setup() {
  const raw = migratedDatabase();
  const run = (sql: string, ...p: unknown[]) => raw.prepare(sql).run(...(p as never[]));
  run(`INSERT INTO clubs (id, name, slug, city, postal_code, contact_email, current_season) VALUES (?, 'Club A', 'a', 'Paris', '75001', 'a@t.fr', '2026-2027')`, CLUB);
  for (const id of [CAT1, CAT2]) run(`INSERT INTO categories (id, club_id, name, min_birth_year, max_birth_year, annual_price) VALUES (?, ?, 'Cat', 2010, 2020, 100)`, id, CLUB);
  const family = (email: string, season = '2026-2027', cat = CAT1, status = 'validated') => {
    const f = crypto.randomUUID();
    run(`INSERT INTO family_registrations (id, club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone, address, city, postal_code) VALUES (?, ?, ?, 'Paul', 'N', ?, '0600000000', 'U', '0600000001', '1 rue', 'Paris', '75001')`, f, CLUB, season, email);
    run(`INSERT INTO members (id, club_id, family_id, category_id, season, first_name, last_name, birth_date, dossier_status, magic_action_token) VALUES (?, ?, ?, ?, ?, 'E', 'N', '2015-01-01', ?, ?)`, crypto.randomUUID(), CLUB, f, cat, season, status, crypto.randomUUID());
  };
  const newsletter = (audience: object, status = 'scheduled', sendAt = '2026-11-15T09:00:00Z') => {
    const id = crypto.randomUUID();
    run(`INSERT INTO newsletters (id, club_id, subject, body, audience, status, send_at) VALUES (?, ?, 'Infos', 'Bonjour à tous', ?, ?, ?)`, id, CLUB, JSON.stringify(audience), status, sendAt);
    return id;
  };
  return { raw, db: sqliteAdapter(raw), family, newsletter };
}

test('public : une adresse une fois, catégories, saisons passées, désinscrits et refusés exclus', async () => {
  const { raw, db, family } = setup();
  family('a@x.fr');
  family('A@X.fr', '2026-2027', CAT2); // même adresse, autre catégorie
  family('b@x.fr', '2026-2027', CAT2);
  family('old@x.fr', '2024-2025');
  family('refus@x.fr', '2026-2027', CAT1, 'rejected');
  family('stop@x.fr');
  raw.prepare(`INSERT INTO newsletter_unsubscribes (club_id, email) VALUES (?, 'stop@x.fr')`).run(CLUB);
  const club = { id: CLUB, current_season: '2026-2027' };
  const emails = async (a: object) => (await resolveRecipients(db, club, parseAudience(a))).map((r) => r.email);
  assert.deepEqual(await emails({}), ['a@x.fr', 'b@x.fr']);
  assert.deepEqual(await emails({ categoryIds: [CAT2] }), ['a@x.fr', 'b@x.fr']);
  assert.deepEqual(await emails({ categoryIds: [CAT1] }), ['a@x.fr']);
  assert.deepEqual(await emails({ includePastSeasons: true }), ['a@x.fr', 'b@x.fr', 'old@x.fr']);
  assert.deepEqual(parseAudience({ categoryIds: ['x', CAT1, CAT1], includePastSeasons: 'oui' }), { categoryIds: [CAT1], includePastSeasons: false });
});

test('mise en forme : titres, listes, gras, liens https ; aucun HTML interprété', () => {
  const blocks = parseBody('## Rentrée\n\nBonjour, **important** : https://club.fr/infos\n<script>alert(1)</script>\n\n- point 1\n- javascript:alert(1)');
  assert.equal(blocks[0].type, 'h');
  assert.equal(blocks[1].type, 'p');
  const p = blocks[1].type === 'p' ? blocks[1].content : [];
  assert.ok(p.some((i) => i.bold && i.text === 'important'));
  assert.ok(p.some((i) => i.href === 'https://club.fr/infos'));
  assert.ok(p.some((i) => i.text.includes('<script>') && !i.href), 'le HTML reste du texte (échappé par React)');
  assert.equal(blocks[2].type, 'ul');
  assert.ok(!JSON.stringify(blocks).includes('"href":"javascript'), 'seuls les liens https deviennent cliquables');
  assert.match(bodyText(blocks), /^RENTRÉE\n\n/);
});

test('envoi : préparé à l’heure, par lots, une fois par adresse, puis « envoyée »', async () => {
  const { raw, db, family, newsletter } = setup();
  for (const e of ['a@x.fr', 'b@x.fr', 'c@x.fr']) family(e);
  const later = newsletter({}, 'scheduled', '2026-11-16T09:00:00Z');
  const now = newsletter({});
  const sent: DeliveryToSend[] = [];
  const send = async (d: DeliveryToSend) => void sent.push(d);
  assert.match(await processNewsletters(db, NOW, send, 2), /preparees=1 envoyes=2/);
  assert.match(await processNewsletters(db, NOW, send, 2), /envoyes=1/);
  assert.match(await processNewsletters(db, NOW, send, 2), /envoyes=0/, 'rien à renvoyer');
  assert.deepEqual(sent.map((d) => d.email).sort(), ['a@x.fr', 'b@x.fr', 'c@x.fr']);
  assert.equal(new Set(sent.map((d) => d.unsubscribeToken)).size, 3, 'un lien de désinscription par e-mail');
  const status = (id: string) => (raw.prepare('SELECT status, sent_count, recipient_count FROM newsletters WHERE id = ?').get(id) as { status: string; sent_count: number; recipient_count: number });
  assert.deepEqual({ ...status(now) }, { status: 'sent', sent_count: 3, recipient_count: 3 });
  assert.equal(status(later).status, 'scheduled', 'programmée plus tard : pas encore partie');
});

test('désinscription : lien d’un e-mail reçu, respectée même pendant un envoi en cours', async () => {
  const { db, family, newsletter } = setup();
  for (const e of ['a@x.fr', 'b@x.fr']) family(e);
  newsletter({});
  const first: DeliveryToSend[] = [];
  await processNewsletters(db, NOW, async (d) => void first.push(d), 1);
  const done = await unsubscribeByToken(db, first[0].unsubscribeToken);
  assert.deepEqual(done, { clubId: CLUB, email: first[0].email });
  assert.equal(await unsubscribeByToken(db, 'inconnu-0123456789'), null);
  // Seconde newsletter : l'adresse désinscrite n'est plus destinataire.
  newsletter({});
  const second: DeliveryToSend[] = [];
  await processNewsletters(db, NOW, async (d) => void second.push(d), 10);
  assert.ok(!second.some((d) => d.email === first[0].email && d.newsletter.id !== first[0].newsletter.id));
});

test('échec d’envoi : compté, jamais renvoyé en boucle', async () => {
  const { raw, db, family, newsletter } = setup();
  family('a@x.fr');
  const id = newsletter({});
  assert.match(await processNewsletters(db, NOW, async () => { throw new Error('panne\nréseau'); }), /echecs=1/);
  const n = raw.prepare('SELECT status, failed_count FROM newsletters WHERE id = ?').get(id) as { status: string; failed_count: number };
  assert.deepEqual({ ...n }, { status: 'sent', failed_count: 1 });
  assert.match(await processNewsletters(db, NOW, async () => assert.fail('pas de renvoi')), /envoyes=0/);
});

test('en-têtes de désinscription (RFC 8058) ; noms invalides et retours à la ligne neutralisés', () => {
  const mime = buildMime({
    from: { address: 'club@x.fr' },
    to: 'a@x.fr',
    subject: 'S',
    html: '<p>h</p>',
    text: 't',
    headers: { 'List-Unsubscribe': '<https://app/u?t=1>\r\nBcc: pirate@x.fr', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', 'Mauvais nom': 'x' },
  });
  assert.match(mime, /\r\nList-Unsubscribe: <https:\/\/app\/u\?t=1>  Bcc: pirate@x\.fr\r\n/);
  assert.match(mime, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  assert.ok(!/\r\nBcc:/.test(mime) && !mime.includes('Mauvais nom'));
});

test('accès : réservé à la communication du club ; envois et désinscrits non modifiables par les utilisateurs', async () => {
  const { raw, family, newsletter } = setup();
  family('a@x.fr');
  newsletter({}, 'draft', null as never);
  const u = { sec: '00000000-0000-4000-8000-000000000001', treasurer: '00000000-0000-4000-8000-000000000002' };
  for (const [k, id] of Object.entries(u)) {
    raw.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').run(id, `${k}@t.fr`);
    raw.prepare(`INSERT INTO staff_members (id, user_id, club_id, full_name, email, role) VALUES (?, ?, ?, 'X', 'x@t.fr', ?)`).run(crypto.randomUUID(), id, CLUB, k === 'sec' ? 'secretary' : 'treasurer');
  }
  const as = (id: string) => makeClient(sqliteAdapter(raw), { role: 'authenticated', userId: id });
  assert.equal((await as(u.sec).from('newsletters').select('id')).data?.length, 1);
  assert.equal((await as(u.treasurer).from('newsletters').select('id')).data?.length, 0);
  const forged = await as(u.sec).from('newsletter_unsubscribes').insert({ club_id: CLUB, email: 'x@x.fr' });
  assert.equal(forged.error?.code, '42501');
});
