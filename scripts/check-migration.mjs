// Vérifie la migration sur un Postgres embarqué (PGlite) et teste l'isolation RLS.
// Usage : node scripts/check-migration.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";

const db = new PGlite();

// Bouchons minimaux de ce que Supabase fournit (auth, storage, rôles).
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth; CREATE SCHEMA storage;
  CREATE TABLE auth.users (id UUID PRIMARY KEY, email TEXT, email_confirmed_at TIMESTAMPTZ);
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

for (const f of readdirSync("supabase/migrations").sort()) {
  // pgcrypto absent de PGlite ; gen_random_uuid() est natif depuis PG 13.
  const sql = readFileSync(`supabase/migrations/${f}`, "utf8").replace(
    /CREATE EXTENSION[^;]*;/g,
    "",
  );
  try {
    await db.exec(sql);
  } catch (e) {
    console.error(
      f,
      e.message,
      "position",
      e.position,
      sql.slice(Number(e.position) - 80, Number(e.position) + 40),
    );
    process.exit(1);
  }
  console.log("OK", f);
}
await db.exec(`GRANT SELECT, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
REVOKE UPDATE ON clubs FROM authenticated;
GRANT UPDATE(name) ON clubs TO authenticated;`);

const U = {
  superA: "00000000-0000-0000-0000-00000000000a",
  presA: "00000000-0000-0000-0000-0000000000a1",
  coachA: "00000000-0000-0000-0000-0000000000a2",
  presB: "00000000-0000-0000-0000-0000000000b1",
};
await db.exec(
  `INSERT INTO auth.users(id) VALUES ${Object.values(U)
    .map((u) => `('${u}')`)
    .join(",")};`,
);
const {
  rows: [a],
} = await db.query(
  `INSERT INTO clubs (name, slug, city, postal_code, contact_email, status) VALUES ('Club A','club-a','Ville','95000','a@x.fr','active') RETURNING id`,
);
const {
  rows: [b],
} = await db.query(
  `INSERT INTO clubs (name, slug, city, postal_code, contact_email, status) VALUES ('Club B','club-b','Ville','95000','b@x.fr','suspended') RETURNING id`,
);
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
  await db.exec(
    `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${uid ?? ""}', false); SET ROLE ${role};`,
  );
  try {
    return (await db.query(sql)).rows;
  } finally {
    await db.exec("RESET ROLE;");
  }
}
async function fails(role, uid, sql) {
  try {
    await as(role, uid, sql);
    return false;
  } catch {
    return true;
  }
}

// Lecture publique : seul le club actif est visible ; aucun secret, aucun membre.
assert.deepEqual(
  (await as("anon", null, "SELECT slug FROM public_clubs")).map((r) => r.slug),
  ["club-a"],
);
assert.equal((await as("anon", null, "SELECT * FROM members")).length, 0);
assert.equal(
  (await as("anon", null, "SELECT * FROM club_mail_credentials")).length,
  0,
);
assert.ok(
  await fails(
    "anon",
    null,
    `INSERT INTO members (club_id, season, first_name, last_name, birth_date) VALUES ('${a.id}','x','a','b','2015-01-01')`,
  ),
);
// Isolation entre clubs.
assert.deepEqual(
  (await as("authenticated", U.presA, "SELECT last_name FROM members")).map(
    (r) => r.last_name,
  ),
  ["A"],
);
assert.deepEqual(
  (await as("authenticated", U.presB, "SELECT last_name FROM members")).map(
    (r) => r.last_name,
  ),
  ["B"],
);
assert.equal(
  (
    await as(
      "authenticated",
      U.presB,
      `UPDATE clubs SET name='pirate' WHERE id='${a.id}' RETURNING id`,
    )
  ).length,
  0,
);
assert.equal(
  (await as("authenticated", U.presA, "SELECT * FROM club_mail_credentials"))
    .length,
  0,
);
// Un coach lit mais ne modifie pas les dossiers ni l'échéancier.
assert.equal(
  (await as("authenticated", U.coachA, "SELECT * FROM members")).length,
  0,
);
assert.equal(
  (
    await as(
      "authenticated",
      U.coachA,
      `UPDATE members SET last_name='x' RETURNING id`,
    )
  ).length,
  0,
);
assert.equal(
  (await as("authenticated", U.coachA, "SELECT * FROM family_registrations"))
    .length,
  0,
);
const fid = (await db.query("SELECT id FROM family_registrations LIMIT 1"))
  .rows[0].id;
assert.ok(
  await fails(
    "authenticated",
    U.coachA,
    `INSERT INTO payment_installments (club_id,family_id,amount,payment_type) VALUES ('${a.id}','${fid}',10,'check')`,
  ),
);
// Personne ne s'octroie super_admin ; un président ne gère que son club.
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `INSERT INTO staff_members (user_id, club_id, full_name, email, role) VALUES ('${U.presA}', NULL, 'x', 'x', 'super_admin')`,
  ),
);
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `INSERT INTO staff_members (user_id, club_id, full_name, email, role) VALUES ('${U.presA}', '${b.id}', 'x', 'x', 'president')`,
  ),
);
// Le super_admin voit tout.
assert.equal(
  (await as("authenticated", U.superA, "SELECT * FROM members")).length,
  2,
);
// Compteur d'audience : appelable anonymement, ignoré pour un club non public.
for (const id of [a.id, a.id, b.id])
  await as("anon", null, `SELECT increment_page_view('${id}', '/')`);
const views = (
  await db.query("SELECT club_id, views_count FROM anonymous_page_views")
).rows;
assert.deepEqual(views, [{ club_id: a.id, views_count: 2 }]);
// Stockage privé : seul le bureau du club lit ses pièces.
await db.exec(
  `INSERT INTO storage.objects (bucket_id, name) VALUES ('club-private-docs', '${a.id}/members/x.webp')`,
);
assert.equal(
  (await as("authenticated", U.presA, "SELECT * FROM storage.objects")).length,
  1,
);
assert.equal(
  (await as("authenticated", U.presB, "SELECT * FROM storage.objects")).length,
  0,
);
assert.equal(
  (await as("anon", null, "SELECT * FROM storage.objects")).length,
  0,
);

console.log("RLS : tous les contrôles passent");

// Régressions de la refonte : facturation protégée, relations entre tenants, familles vérifiées.
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `UPDATE clubs SET subscription_plan='vitrine' WHERE id='${a.id}'`,
  ),
);
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `UPDATE clubs SET status='active' WHERE id='${b.id}'`,
  ),
);
assert.equal((await as("anon", null, "SELECT * FROM clubs")).length, 0);
const projection = (
  await as(
    "anon",
    null,
    "SELECT stripe_customer_id,stripe_subscription_id,president_signature_url FROM public_clubs",
  )
)[0];
assert.deepEqual(projection, {
  stripe_customer_id: null,
  stripe_subscription_id: null,
  president_signature_url: null,
});
const catA = (
  await db.query(
    `INSERT INTO categories(club_id,name,min_birth_year,max_birth_year,annual_price) VALUES('${a.id}','A',2000,2020,100) RETURNING id`,
  )
).rows[0].id;
const catB = (
  await db.query(
    `INSERT INTO categories(club_id,name,min_birth_year,max_birth_year,annual_price) VALUES('${b.id}','B',2000,2020,100) RETURNING id`,
  )
).rows[0].id;
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `INSERT INTO schedules(club_id,category_id,day_of_week,start_time,end_time) VALUES('${a.id}','${catB}',1,'18:00','19:00')`,
  ),
);
await db.exec(
  `UPDATE members SET category_id='${catA}' WHERE club_id='${a.id}'; UPDATE staff_members SET assigned_category_ids=ARRAY['${catA}'::uuid] WHERE user_id='${U.coachA}';`,
);
assert.equal(
  (await as("authenticated", U.coachA, "SELECT * FROM coach_roster")).length,
  1,
);
assert.equal(
  (await as("authenticated", U.presB, "SELECT * FROM coach_roster")).length,
  1,
);
const parentA = "00000000-0000-0000-0000-0000000000c1";
const parentB = "00000000-0000-0000-0000-0000000000c2";
await db.exec(
  `INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('${parentA}','P@x.fr',now()),('${parentB}','other@x.fr',now()); UPDATE members SET family_id='${fid}' WHERE club_id='${a.id}';`,
);
await as("authenticated", parentA, "SELECT claim_family_access()");
await as("authenticated", parentA, "SELECT claim_family_access()");
assert.equal(
  (await as("authenticated", parentA, "SELECT * FROM family_access")).length,
  1,
);
assert.equal(
  (await as("authenticated", parentA, "SELECT * FROM family_registrations"))
    .length,
  1,
);
assert.equal(
  (await as("authenticated", parentA, "SELECT * FROM members")).length,
  1,
);
assert.equal(
  (await as("authenticated", parentB, "SELECT * FROM family_registrations"))
    .length,
  0,
);
assert.equal(
  (await as("authenticated", parentB, "SELECT * FROM members")).length,
  0,
);
assert.ok(
  await fails(
    "authenticated",
    parentB,
    `INSERT INTO family_access(club_id,family_id,user_id) VALUES('${a.id}','${fid}','${parentB}')`,
  ),
);
await db.exec(
  `UPDATE auth.users SET email_confirmed_at=NULL WHERE id='${parentB}'`,
);
assert.ok(
  await fails("authenticated", parentB, "SELECT claim_family_access()"),
);
await db.exec(
  `UPDATE auth.users SET email_confirmed_at=now() WHERE id='${parentB}'`,
);
const payload = {
  name: "Association test",
  slug: "nouveau-club",
  sport: "Escalade",
  template: "studio",
  city: "Paris",
  postalCode: "75000",
  ownerName: "Test",
  memberCount: 101,
};
const provisioned = (
  await as(
    "authenticated",
    parentB,
    `SELECT provision_club('${JSON.stringify(payload)}'::jsonb) AS id`,
  )
)[0].id;
const created = (
  await db.query(
    `SELECT theme_preset,membership_tier_id,status FROM clubs WHERE id='${provisioned}'`,
  )
).rows[0];
assert.deepEqual(created, {
  theme_preset: "studio",
  membership_tier_id: "collectif",
  status: "demo",
});
assert.equal(
  (
    await as(
      "authenticated",
      parentB,
      `SELECT * FROM staff_members WHERE club_id='${provisioned}'`,
    )
  ).length,
  1,
);
const heritagePayload = {
  ...payload,
  slug: "club-heritage",
  template: "heritage",
};
const [heritage] = await as(
  "authenticated",
  parentB,
  `SELECT provision_club('${JSON.stringify(heritagePayload)}'::jsonb) AS id`,
);
assert.equal(
  (await db.query("SELECT theme_preset FROM clubs WHERE id=$1", [heritage.id]))
    .rows[0].theme_preset,
  "heritage",
);
assert.ok(
  await fails(
    "authenticated",
    parentB,
    `SELECT provision_club('${JSON.stringify({ ...payload, slug: "theme-inconnu", template: "inconnu" })}'::jsonb)`,
  ),
);
assert.ok(
  await fails(
    "authenticated",
    parentB,
    `SELECT provision_club('${JSON.stringify({ ...payload, slug: "admin" })}'::jsonb)`,
  ),
);
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `INSERT INTO payment_installments(club_id,family_id,amount,payment_type) VALUES('${b.id}','${fid}',10,'cash')`,
  ),
);
assert.equal(
  (await as("authenticated", parentA, "SELECT * FROM audit_events")).length,
  0,
);
console.log(
  "Refonte : accès familles, catégories coach, facturation, création atomique et isolation vérifiés",
);

await as(
  "authenticated",
  U.presA,
  `INSERT INTO club_site_settings(club_id,sections) VALUES('${a.id}',ARRAY['news','hero'])`,
);
assert.deepEqual(
  (
    await as(
      "anon",
      null,
      `SELECT sections FROM club_site_settings WHERE club_id='${a.id}'`,
    )
  )[0].sections,
  ["news", "hero"],
);
assert.deepEqual(
  await as(
    "authenticated",
    U.presB,
    `UPDATE club_site_settings SET sections=ARRAY['hero'] WHERE club_id='${a.id}' RETURNING club_id`,
  ),
  [],
);
assert.deepEqual(
  await as(
    "authenticated",
    U.coachA,
    `UPDATE club_site_settings SET sections=ARRAY['hero'] WHERE club_id='${a.id}' RETURNING club_id`,
  ),
  [],
);
assert.deepEqual(
  (
    await as(
      "authenticated",
      U.presA,
      `SELECT sections FROM club_site_settings WHERE club_id='${a.id}'`,
    )
  )[0].sections,
  ["news", "hero"],
);
assert.ok(
  await fails(
    "authenticated",
    U.coachA,
    `INSERT INTO club_site_settings(club_id,sections) VALUES('${b.id}',ARRAY['hero'])`,
  ),
);
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `UPDATE club_site_settings SET sections=ARRAY['hero','hero'] WHERE club_id='${a.id}'`,
  ),
);
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `UPDATE club_site_settings SET sections=ARRAY['news'] WHERE club_id='${a.id}'`,
  ),
);
await as(
  "authenticated",
  U.presB,
  `INSERT INTO club_site_settings(club_id,sections) VALUES('${b.id}',ARRAY['hero'])`,
);
assert.equal(
  (
    await as(
      "anon",
      null,
      `SELECT * FROM club_site_settings WHERE club_id='${b.id}'`,
    )
  ).length,
  0,
);
console.log(
  "Composition : écriture du dirigeant, accès public, clubs suspendus et isolation vérifiés",
);
// Une photo publique d'un autre club ne peut pas être rattachée à la vitrine.
const [mediaPhoto] = (
  await db.query(
    `INSERT INTO club_gallery(club_id,title,image_url) VALUES('${b.id}','Photo','https://example.org/photo.jpg') RETURNING id`,
  )
).rows;
assert.ok(
  await fails(
    "authenticated",
    U.presA,
    `INSERT INTO club_site_media(club_id,section,photo_id) VALUES('${a.id}','hero','${mediaPhoto.id}')`,
  ),
);
await as(
  "authenticated",
  U.presB,
  `INSERT INTO club_site_media(club_id,section,photo_id) VALUES('${b.id}','hero','${mediaPhoto.id}')`,
);
assert.deepEqual(
  await as(
    "anon",
    null,
    `SELECT * FROM club_site_media WHERE club_id='${b.id}'`,
  ),
  [],
);
await db.exec(`DELETE FROM club_gallery WHERE id='${mediaPhoto.id}'`);
assert.equal((await db.query("SELECT * FROM club_site_media")).rows.length, 0);
console.log(
  "Médiathèque : liaison entre clubs refusée, confidentialité et suppression vérifiées",
);
await db.close();
