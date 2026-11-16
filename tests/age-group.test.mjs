// Catégories d'âge regroupées (U6 - U7, U8 - U9, U10…) dans l'admin : calcul, filtre de la liste, carte, export CSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as list from '../functions/admin/inscriptions.js';
import { ageGroup, sortAgeGroups, ageRangesFrom } from '../functions/_shared/inscriptions-db.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

test('ageGroup : une catégorie FFF par âge (U6, U7, U8, U9 séparés), calculée sur la saison', () => {
  const ctx = { saison: '2026-2027', ranges: [{ label: 'U6 - U7', anneeMin: 2020, anneeMax: 2021 }, { label: 'U8 - U9', anneeMin: 2018, anneeMax: 2019 }] };
  assert.equal(ageGroup('2021-03-01', ctx), 'U6');
  assert.equal(ageGroup('2020-12-31', ctx), 'U7');
  assert.equal(ageGroup('2019-01-01', ctx), 'U8');
  assert.equal(ageGroup('2018-06-15', ctx), 'U9');
  assert.equal(ageGroup('2017-02-28', ctx), 'U10');
  assert.equal(ageGroup('2021-03-01', '2027-2028'), 'U7', 'un an de plus la saison suivante');
  assert.equal(ageGroup('', '2026-2027'), '');
  assert.equal(ageGroup('2020-01-01', ''), '');
  // Saison inconnue : catégorie du club qui contient l'année.
  assert.equal(ageGroup('2020-01-01', { ranges: ctx.ranges }), 'U6 - U7');
  assert.deepEqual(sortAgeGroups(['U10', 'U9', 'U6', 'U7', 'U8']), ['U6', 'U7', 'U8', 'U9', 'U10']);
  assert.deepEqual(ageRangesFrom([{ label: 'U6 - U7', anneeMin: 2020, anneeMax: 2021 }], { label: 'U10', anneeMin: 2017, anneeMax: 2017 }).map((r) => r.label), ['U6 - U7', 'U10']);
});

test('liste des inscriptions : pastilles U6 / U7 / U8 / U9, filtre ?age=, âge et catégorie sur la carte et dans le CSV', async () => {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  await seedInscription(env.DB, { enfant_prenom: 'Alpha', naissance: '2021-01-01', categorie: 'U6 - U7', email: 'a@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Bravo', naissance: '2020-01-01', categorie: 'U6 - U7', email: 'b@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Charlie', naissance: '2019-01-01', categorie: 'U8 - U9', email: 'c@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Delta', naissance: '2018-01-01', categorie: 'U8 - U9', email: 'd@example.fr' });
  const get = async (query) => (await list.onRequestGet({ request: new Request(`https://club-exemple.example/admin/inscriptions${query}`, { headers: { Cookie: cookie } }), env })).text();

  const all = await get('');
  for (const label of ['U6', 'U7', 'U8', 'U9']) assert.match(all, new RegExp(`age=${label}[^"]*"[^>]*>${label}</a>`), label);
  assert.doesNotMatch(all, />U6 - U7<\/a>/, 'plus de pastille regroupée');
  assert.match(all, /<strong>U7<\/strong> · U6 - U7 · inscription du/, 'âge puis catégorie d’inscription');

  const u7 = await get('?age=U7');
  assert.match(u7, /Bravo/);
  assert.doesNotMatch(u7, /Alpha|Charlie|Delta/);

  const csv = await get('?age=U9&format=csv');
  assert.match(csv, /"Catégorie d'âge"/);
  assert.match(csv, /"U8 - U9","U9"|"U9","U8 - U9"/);
  assert.doesNotMatch(csv, /Alpha|Bravo|Charlie/);
});

test('catégorie d’une fiche : libellé exact, sinon catégorie active de son année (anciennes fiches « U6 - U7 »)', async () => {
  const { categoryForRow } = await import('../functions/_shared/inscriptions-db.js');
  const link67 = 'https://www.helloasso.com/beta/associations/x/adhesions/adhesion-u6-u7';
  const categories = [
    { label: 'U6 - U7', anneeMin: 2020, anneeMax: 2021, active: false, helloAssoUrl: link67 },
    { label: 'U6', anneeMin: 2021, anneeMax: 2021, active: true, helloAssoUrl: link67 },
    { label: 'U7', anneeMin: 2020, anneeMax: 2020, active: true, helloAssoUrl: link67 },
  ];
  assert.equal(categoryForRow(categories, { categorie: 'U7', naissance: '2020-05-01' }).label, 'U7');
  assert.equal(categoryForRow(categories, { categorie: 'U6 - U7', naissance: '2020-05-01' }).label, 'U6 - U7', 'catégorie désactivée retrouvée par son libellé');
  assert.equal(categoryForRow(categories.slice(1), { categorie: 'U6 - U7', naissance: '2021-05-01' }).label, 'U6', 'catégorie supprimée : par l’année');
  assert.equal(categoryForRow(categories.slice(1), { categorie: 'U6 - U7', naissance: '2015-05-01' }), null);
});
