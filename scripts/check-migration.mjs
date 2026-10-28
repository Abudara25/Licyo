// Vérifie la migration sur un Postgres embarqué (PGlite) et teste l'isolation RLS.
// Usage : node scripts/check-migration.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();

// Bouchons minimaux de ce que Supabase fournit (auth, storage, rôles).
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE TABLE auth.users (id UUID PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE TABLE storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN);
  CREATE TABLE storage.objects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id TEXT, name TEXT);
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS
    $$ SELECT (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  GRANT USAGE ON SCHEMA auth, storage, public TO anon, authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
`);

for (const f of readdirSync('supabase/migrations').sort()) {
  // pgcrypto absent de PGlite ; gen_random_uuid() est natif depuis PG 13.
  const sql = readFileSync(`supabase/migrations/${f}`, "utf8").replace(/CREATE EXTENSION[^;]*;/g, "");
  try { await db.exec(sql); } catch (e) { console.error(f, e.message, "position", e.position, sql.slice(Number(e.position) - 80, Number(e.position) + 40)); process.exit(1); }
  console.log('OK', f);
}
await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;`);

const U = { superA: '00000000-0000-0000-0000-00000000000a', presA: '00000000-0000-0000-0000-0000000000a1',
  coachA: '00000000-0000-0000-0000-0000000000a2', presB: '00000000-0000-0000-0000-0000000000b1' };
await db.exec(`INSERT INTO auth.users VALUES ${Object.values(U).map((u) => `('${u}')`).join(',')};`);
const { rows: [a] } = await db.query(`INSERT INTO clubs (name, slug, city, postal_code, contact_email, status) VALUES ('Club A','club-a','Ville','95000','a@x.fr','active') RETURNING id`);
const { rows: [b] } = await db.query(`INSERT INTO clubs (name, slug, city, postal_code, contact_email, status) VALUES ('Club B','club-b','Ville','95000','b@x.fr','suspended') RETURNING id`);
await db.exec(`
  INSERT INTO staff_members (user_id, club_id, full_name, email, role) VALUES
   ('${U.superA}', NULL, 'Root', 'r@x.fr', 'super_admin'),
   ('${U.presA}', '${a.id}', 'PA', 'pa@x.fr', 'president'),
   ('${U.coachA}', '${a.id}', 'CA', 'ca@x.fr', 'coach'),
   ('${U.presB}', '${b.id}', 'PB', 'pb@x.fr', 'president');
  INSERT INTO club_mail_credentials (club_id, smtp_settings_enc) VALUES ('${a.id}', 'secret');
  INSERT INTO family_registrations (club_id, season, payer_first_name, payer_last_name, payer_email, payer_phone,
    emergency_contact_name, emergency_contact_phone, address, city, postal_code)
    VALUES ('${a.id}', '2026-2027', 'P', 'A', 'p@x.fr', '06', 'E', '06', '1 rue', 'Ville', '95000');
  INSERT INTO members (club_id, season, first_name, last_name, birth_date)
    VALUES ('${a.id}', '2026-2027', 'Enfant', 'A', '2015-01-01'), ('${b.id}', '2026-2027', 'Enfant', 'B', '2015-01-01');
`);

async function as(role, uid, sql) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ''}', false); SET ROLE ${role};`);
  try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE;'); }
}
async function fails(role, uid, sql) {
  try { await as(role, uid, sql); return false; } catch { return true; }
}

// Lecture publique : seul le club actif est visible ; aucun secret, aucun membre.
assert.deepEqual((await as('anon', null, 'SELECT slug FROM clubs')).map((r) => r.slug), ['club-a']);
assert.equal((await as('anon', null, 'SELECT * FROM members')).length, 0);
assert.equal((await as('anon', null, 'SELECT * FROM club_mail_credentials')).length, 0);
assert.ok(await fails('anon', null, `INSERT INTO members (club_id, season, first_name, last_name, birth_date) VALUES ('${a.id}','x','a','b','2015-01-01')`));
// Isolation entre clubs.
assert.deepEqual((await as('authenticated', U.presA, 'SELECT last_name FROM members')).map((r) => r.last_name), ['A']);
assert.deepEqual((await as('authenticated', U.presB, 'SELECT last_name FROM members')).map((r) => r.last_name), ['B']);
assert.equal((await as('authenticated', U.presB, `UPDATE clubs SET name='pirate' WHERE id='${a.id}' RETURNING id`)).length, 0);
assert.equal((await as('authenticated', U.presA, 'SELECT * FROM club_mail_credentials')).length, 0);
// Un coach lit mais ne modifie pas les dossiers ni l'échéancier.
assert.equal((await as('authenticated', U.coachA, 'SELECT * FROM members')).length, 1);
assert.equal((await as('authenticated', U.coachA, `UPDATE members SET last_name='x' RETURNING id`)).length, 0);
assert.ok(await fails('authenticated', U.coachA, `INSERT INTO payment_installments (club_id, family_id, amount, payment_type) SELECT club_id, id, 10, 'check' FROM family_registrations`));
// Personne ne s'octroie super_admin ; un président ne gère que son club.
assert.ok(await fails('authenticated', U.presA, `INSERT INTO staff_members (user_id, club_id, full_name, email, role) VALUES ('${U.presA}', NULL, 'x', 'x', 'super_admin')`));
assert.ok(await fails('authenticated', U.presA, `INSERT INTO staff_members (user_id, club_id, full_name, email, role) VALUES ('${U.presA}', '${b.id}', 'x', 'x', 'president')`));
// Le super_admin voit tout.
assert.equal((await as('authenticated', U.superA, 'SELECT * FROM members')).length, 2);
// Compteur d'audience : appelable anonymement, ignoré pour un club non public.
for (const id of [a.id, a.id, b.id]) await as('anon', null, `SELECT increment_page_view('${id}', '/')`);
const views = (await db.query('SELECT club_id, views_count FROM anonymous_page_views')).rows;
assert.deepEqual(views, [{ club_id: a.id, views_count: 2 }]);
// Stockage privé : seul le bureau du club lit ses pièces.
await db.exec(`INSERT INTO storage.objects (bucket_id, name) VALUES ('club-private-docs', '${a.id}/members/x.webp')`);
assert.equal((await as('authenticated', U.presA, 'SELECT * FROM storage.objects')).length, 1);
assert.equal((await as('authenticated', U.presB, 'SELECT * FROM storage.objects')).length, 0);
assert.equal((await as('anon', null, 'SELECT * FROM storage.objects')).length, 0);

console.log('RLS : tous les contrôles passent');
