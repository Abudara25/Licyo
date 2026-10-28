// Données de test pour un Supabase LOCAL uniquement (refuse toute autre URL).
// Usage : node --experimental-strip-types scripts/seed-local.ts
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { SPORTS_PRESETS, birthYearsForSeason } from '../src/config/sports-presets.ts';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error(`Refus : ${url} n'est pas un Supabase local.`);
const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function user(email: string) {
  const { data: list } = await db.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  return data.user.id;
}

const must = <T>(r: { data: T | null; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data as T;
};

const season = '2026-2027';
const preset = SPORTS_PRESETS.handball;

await db.from('clubs').delete().eq('slug', 'hbc-val-de-seine');
const club = must(
  await db
    .from('clubs')
    .insert({
      name: 'Handball Club du Val de Seine',
      slug: 'hbc-val-de-seine',
      sport_type: 'handball',
      primary_color: preset.defaultPrimary,
      secondary_color: preset.defaultSecondary,
      city: 'Poissy',
      postal_code: '78300',
      nearby_cities: ['Carrières-sous-Poissy', 'Achères', 'Villennes-sur-Seine'],
      contact_email: 'contact@hbc-exemple.fr',
      contact_phone: '01 39 00 00 00',
      rna_number: 'W781234567',
      siret_number: '81234567800019',
      federation_name: preset.federation,
      president_name: 'Claire Martin',
      club_history_text: 'Fondé par une bande de copains, le club accueille aujourd\'hui des joueurs de 4 à 60 ans.\n\nNos valeurs : respect, plaisir et engagement.',
      president_word_text: 'Bienvenue à toutes et à tous pour cette nouvelle saison !',
      status: 'active',
      current_season: season,
      sibling_discount_rules: { enabled: true, second_member_discount: 20, third_member_discount: 40, discount_type: 'fixed_euros' },
    })
    .select('*')
    .single(),
) as { id: string };

const facility = must(await db.from('facilities').insert({ club_id: club.id, name: 'Gymnase Marcel Cerdan', address: '12 rue des Sports', city: 'Poissy', postal_code: '78300' }).select('id').single()) as { id: string };
const categories = must(
  await db
    .from('categories')
    .insert(preset.demo.categories.map((c, i) => ({ club_id: club.id, name: c.name, ...birthYearsForSeason(season, c), annual_price: c.price, medical_requirement: c.medical, description: c.description, display_order: i, coach_name: i === 1 ? 'Karim B.' : null })))
    .select('id, display_order'),
) as { id: string; display_order: number }[];
const cat = (i: number) => categories.find((c) => c.display_order === i)!.id;
const schedules = must(
  await db
    .from('schedules')
    .insert(preset.demo.schedules.map(([ci, day, s, e]) => ({ club_id: club.id, category_id: cat(ci), facility_id: facility.id, day_of_week: day, start_time: s, end_time: e })))
    .select('id, category_id'),
) as { id: string; category_id: string }[];
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString();
await db.from('events').insert([
  { club_id: club.id, category_id: cat(3), event_type: 'competition', title: 'Seniors - Achères HB', event_date: day(5), is_home: true, location_text: 'Gymnase Marcel Cerdan' },
  { club_id: club.id, category_id: cat(1), event_type: 'tournament', title: 'Tournoi -11 ans', event_date: day(19), is_home: true, location_text: 'Gymnase Marcel Cerdan' },
  { club_id: club.id, category_id: cat(3), event_type: 'competition', title: 'Seniors - Conflans HB', event_date: day(-6), is_home: false, location_text: 'Conflans', score_club: 31, score_opponent: 27 },
]);
await db.from('posts').insert(preset.demo.posts.map((p, i) => ({ club_id: club.id, title: p.title, slug: `actu-${i + 1}`, content: p.content, published_at: day(-i * 3) })));
await db.from('club_products').insert(preset.demo.products.map((p) => ({ club_id: club.id, name: p.name, price: p.price, available_sizes: p.sizes })));
await db.from('sponsors').insert([{ club_id: club.id, company_name: 'Boulangerie du Centre', logo_url: 'https://placehold.co/300x200/png?text=Boulangerie', website_url: 'https://example.com' }]);

// Familles : 2 dossiers à vérifier, 1 validé et soldé, chèques différés.
const families = [
  { first: 'Sophie', last: 'DURAND', kids: [['Léo', '2017-03-12', 'M', 1], ['Inès', '2014-06-02', 'F', 2]], total: 320, paid: 0, city: 'Poissy' },
  { first: 'Marc', last: 'PETIT', kids: [['Marc', '1990-01-20', 'M', 3]], total: 200, paid: 200, city: 'Achères' },
  { first: 'Nadia', last: 'BENALI', kids: [['Yanis', '2018-11-30', 'M', 1]], total: 160, paid: 160, city: 'Poissy' },
] as const;
const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
for (const [n, f] of families.entries()) {
  const fam = must(
    await db
      .from('family_registrations')
      .insert({
        club_id: club.id, season, payer_first_name: f.first, payer_last_name: f.last, payer_email: `famille${n + 1}@exemple.fr`, payer_phone: '06 12 34 56 7' + n,
        emergency_contact_name: `${f.first} ${f.last}`, emergency_contact_phone: '06 98 76 54 3' + n, address: `${n + 3} avenue de la Gare`, city: f.city, postal_code: f.city === 'Poissy' ? '78300' : '78260',
        licenses_subtotal: f.total, final_total_amount: f.total, amount_paid: f.paid, payment_status: f.paid >= f.total ? 'paid' : 'unpaid', payment_method: 'check', invoice_number: `ADH-2026-TEST${n}`,
      })
      .select('id')
      .single(),
  ) as { id: string };
  for (const [i, [first, birth, gender, ci]] of f.kids.entries()) {
    await db.from('members').insert({
      club_id: club.id, family_id: fam.id, category_id: cat(ci), season, first_name: first, last_name: f.last, birth_date: birth, is_minor: Number(birth.slice(0, 4)) > 2008,
      gender, health_questionnaire_passed: true, consent_image_rights: true, consent_autonomous_exit: i === 0, signature_data_url: sig,
      dossier_status: f.paid ? 'validated' : 'pending_review', pass_sport_code: n === 0 && i === 1 ? 'PS-26-ABCD' : null,
    });
  }
  if (n === 0) {
    await db.from('payment_installments').insert([
      { club_id: club.id, family_id: fam.id, amount: 106.68, payment_type: 'check', scheduled_deposit_date: '2026-10-05', check_number: '0012345' },
      { club_id: club.id, family_id: fam.id, amount: 106.66, payment_type: 'check', scheduled_deposit_date: '2026-11-05' },
      { club_id: club.id, family_id: fam.id, amount: 106.66, payment_type: 'check', scheduled_deposit_date: '2026-12-05' },
    ]);
  } else {
    await db.from('payment_installments').insert({ club_id: club.id, family_id: fam.id, amount: f.paid, payment_type: n === 1 ? 'transfer' : 'check', scheduled_deposit_date: '2026-09-15', status: 'cashed' });
  }
}

const superId = await user('admin@licyo.test');
const presidentId = await user('president@hbc.test');
const coachId = await user('coach@hbc.test');
await db.from('staff_members').upsert([{ user_id: superId, club_id: null, full_name: 'Admin Licyo', email: 'admin@licyo.test', role: 'super_admin' }], { onConflict: 'user_id,club_id' });
must(await db.from('staff_members').insert([
  { user_id: presidentId, club_id: club.id, full_name: 'Claire Martin', email: 'president@hbc.test', role: 'president', assigned_category_ids: [] },
  { user_id: coachId, club_id: club.id, full_name: 'Karim B.', email: 'coach@hbc.test', role: 'coach', assigned_category_ids: [cat(1)] },
]));
await db.from('saas_prospects').insert({ club_name: 'Judo Club de Meulan', sport_type: 'judo', city: 'Meulan', contact_name: 'M. Leroy', phone: '06 11 22 33 44', stage: 'contacted' });
console.log(`Club ${club.id} créé avec ${schedules.length} créneaux. Comptes : admin@licyo.test, president@hbc.test, coach@hbc.test`);
