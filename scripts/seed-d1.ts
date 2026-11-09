// Données FICTIVES de démonstration pour D1 : deux clubs, quatre profils.
// Le scénario est joué à travers la couche de données réelle sur une base en
// mémoire, puis exporté en SQL et appliqué avec wrangler.
//
// Usage : npm run db:seed:local            (base locale de wrangler)
//         npm run db:seed:remote           (base de test hébergée, explicite)
// Refuse de s'exécuter si la base ciblée contient déjà des clubs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { SPORTS_PRESETS, birthYearsForSeason } from '../src/config/sports-presets.ts';
import { makeClient } from '../src/lib/db/client.ts';
import { migratedDatabase, sqliteAdapter } from '../tests/helpers/sqlite.ts';

const target = process.argv.includes('--remote') ? '--remote' : '--local';
const raw = migratedDatabase();
const db = makeClient(sqliteAdapter(raw), { role: 'service' });
const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.data as T;
};
const season = '2026-2027';
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function user(email: string): string {
  const id = crypto.randomUUID();
  raw.prepare("INSERT INTO auth_users (id, email, email_confirmed_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(id, email);
  return id;
}

async function seedClub(opts: { sport: string; name: string; slug: string; city: string; postal: string; template: string; president: string }) {
  const preset = SPORTS_PRESETS[opts.sport];
  const club = must(
    await db
      .from('clubs')
      .insert({
        name: opts.name, slug: opts.slug, sport_type: opts.sport, theme_preset: opts.template,
        primary_color: preset.defaultPrimary, secondary_color: preset.defaultSecondary,
        city: opts.city, postal_code: opts.postal, nearby_cities: [], contact_email: `contact@${opts.slug}.exemple.fr`,
        federation_name: preset.federation, president_name: opts.president, status: 'active', current_season: season,
        club_history_text: 'Club fictif de démonstration Licyo.\n\nToutes les personnes et coordonnées sont inventées.',
        president_word_text: 'Bienvenue à toutes et à tous pour cette nouvelle saison !',
        membership_tier_id: 'essentiel', declared_member_count: 60, pass_stripe_fees_to_parents: false,
      })
      .select('*')
      .single(),
  ) as { id: string };
  const facility = must(await db.from('facilities').insert({ club_id: club.id, name: 'Gymnase municipal', address: '12 rue des Sports', city: opts.city, postal_code: opts.postal }).select('id').single()) as { id: string };
  const categories = must(
    await db
      .from('categories')
      .insert(preset.demo.categories.map((c, i) => ({ club_id: club.id, name: c.name, ...birthYearsForSeason(season, c), annual_price: c.price, medical_requirement: c.medical, description: c.description, display_order: i })))
      .select('id, display_order'),
  ) as { id: string; display_order: number }[];
  const cat = (i: number) => (categories.find((c) => c.display_order === i) ?? categories[0]).id;
  await db.from('schedules').insert(preset.demo.schedules.map(([ci, d, s, e]) => ({ club_id: club.id, category_id: cat(ci), facility_id: facility.id, day_of_week: d, start_time: s, end_time: e })));
  await db.from('events').insert([
    { club_id: club.id, category_id: cat(1), event_type: 'competition', title: 'Rencontre à domicile', event_date: day(5), is_home: true, location_text: 'Gymnase municipal' },
    { club_id: club.id, category_id: cat(0), event_type: 'tournament', title: 'Tournoi des jeunes', event_date: day(19), is_home: true, location_text: 'Gymnase municipal' },
  ]);
  await db.from('posts').insert(preset.demo.posts.map((p, i) => ({ club_id: club.id, title: p.title, slug: `actu-${i + 1}`, content: p.content, published_at: day(-i * 3) })));
  await db.from('club_products').insert(preset.demo.products.map((p) => ({ club_id: club.id, name: p.name, price: p.price, available_sizes: p.sizes })));
  return { id: club.id, cat };
}

const hb = await seedClub({ sport: 'handball', name: 'Handball Club du Val de Seine', slug: 'hbc-val-de-seine', city: 'Poissy', postal: '78300', template: 'heritage', president: 'Claire Martin' });
const judo = await seedClub({ sport: 'judo', name: 'Judo Club des Coteaux', slug: 'judo-coteaux', city: 'Meulan', postal: '78250', template: 'studio', president: 'Paul Leroy' });

// Familles du club de handball : 1 dossier à vérifier, 2 validés, chèques différés.
const families = [
  { first: 'Sophie', last: 'DURAND', kids: [['Léo', '2017-03-12', 'M', 1], ['Inès', '2014-06-02', 'F', 2]], total: 320, paid: 0 },
  { first: 'Marc', last: 'PETIT', kids: [['Marc', '1990-01-20', 'M', 3]], total: 200, paid: 200 },
  { first: 'Nadia', last: 'BENALI', kids: [['Yanis', '2018-11-30', 'M', 1]], total: 160, paid: 160 },
] as const;
for (const [n, f] of families.entries()) {
  const fam = must(
    await db
      .from('family_registrations')
      .insert({
        club_id: hb.id, season, payer_first_name: f.first, payer_last_name: f.last, payer_email: `famille${n + 1}@exemple.fr`, payer_phone: `06 12 34 56 7${n}`,
        emergency_contact_name: `${f.first} ${f.last}`, emergency_contact_phone: `06 98 76 54 3${n}`, address: `${n + 3} avenue de la Gare`, city: 'Poissy', postal_code: '78300',
        licenses_subtotal: f.total, final_total_amount: f.total, amount_paid: f.paid, payment_status: f.paid >= f.total ? 'paid' : 'unpaid', payment_method: 'check', invoice_number: `ADH-2026-TEST${n}`,
      })
      .select('id')
      .single(),
  ) as { id: string };
  for (const [i, [first, birth, gender, ci]] of f.kids.entries()) {
    must(await db.from('members').insert({
      club_id: hb.id, family_id: fam.id, category_id: hb.cat(ci), season, first_name: first, last_name: f.last, birth_date: birth, is_minor: Number(birth.slice(0, 4)) > 2008,
      gender, health_questionnaire_passed: true, consent_image_rights: true, consent_autonomous_exit: i === 0, signature_data_url: sig,
      dossier_status: f.paid ? 'validated' : 'pending_review',
    }));
  }
  if (n === 0) {
    await db.from('payment_installments').insert([
      { club_id: hb.id, family_id: fam.id, amount: 106.68, payment_type: 'check', scheduled_deposit_date: '2026-10-05', check_number: '0012345' },
      { club_id: hb.id, family_id: fam.id, amount: 106.66, payment_type: 'check', scheduled_deposit_date: '2026-11-05' },
      { club_id: hb.id, family_id: fam.id, amount: 106.66, payment_type: 'check', scheduled_deposit_date: '2026-12-05' },
    ]);
  } else {
    await db.from('payment_installments').insert({ club_id: hb.id, family_id: fam.id, amount: f.paid, payment_type: n === 1 ? 'transfer' : 'check', scheduled_deposit_date: '2026-09-15', status: 'cashed' });
  }
}

// Quatre profils : propriétaire Licyo, président handball, entraîneur handball, président judo.
const accounts = {
  admin: user('admin@licyo.test'),
  presHb: user('president@hbc.test'),
  coachHb: user('coach@hbc.test'),
  presJudo: user('president@judo.test'),
};
must(await db.from('staff_members').insert([
  { user_id: accounts.admin, club_id: null, full_name: 'Admin Licyo', email: 'admin@licyo.test', role: 'super_admin' },
  { user_id: accounts.presHb, club_id: hb.id, full_name: 'Claire Martin', email: 'president@hbc.test', role: 'president' },
  { user_id: accounts.coachHb, club_id: hb.id, full_name: 'Karim B.', email: 'coach@hbc.test', role: 'coach', assigned_category_ids: [hb.cat(1)] },
  { user_id: accounts.presJudo, club_id: judo.id, full_name: 'Paul Leroy', email: 'president@judo.test', role: 'president' },
]));
await db.from('saas_prospects').insert({ club_name: 'Tennis Club fictif', sport_type: 'tennis', city: 'Mantes', contact_name: 'Contact fictif', stage: 'contacted' });

// Export : une instruction INSERT par ligne, dans l'ordre des dépendances.
const ORDER = [
  'auth_users', 'clubs', 'staff_members', 'facilities', 'categories', 'schedules', 'club_products', 'family_registrations',
  'payment_installments', 'members', 'events', 'posts', 'saas_prospects',
];
const literal = (v: unknown) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const lines = ["SELECT CASE WHEN (SELECT count(*) FROM clubs) > 0 THEN json('base_deja_remplie') END;"];
for (const table of ORDER) {
  for (const row of raw.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]) {
    const cols = Object.keys(row);
    lines.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')});`);
  }
}
mkdirSync('.wrangler', { recursive: true });
writeFileSync('.wrangler/seed.sql', lines.join('\n') + '\n');
console.log(`${lines.length - 1} lignes générées. Application ${target}…`);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'licyo', target, '--file', '.wrangler/seed.sql', '--yes'], { stdio: 'inherit', shell: true });
console.log('Comptes fictifs : admin@licyo.test, president@hbc.test, coach@hbc.test, president@judo.test');
console.log('Connexion sans e-mail : npm run login-link -- <adresse>' + (target === '--remote' ? ' --remote' : ''));
