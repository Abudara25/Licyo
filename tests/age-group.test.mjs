// Catégories d'âge regroupées (U6 - U7, U8 - U9, U10…) dans l'admin : calcul, filtre de la liste, carte, export CSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as list from '../functions/admin/inscriptions.js';
import { ageGroup, sortAgeGroups, ageRangesFrom } from '../functions/_shared/inscriptions-db.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

test('ageGroup : catégorie du club qui contient la naissance, sinon paire de la FFF', () => {
  const ctx = {
    saison: '2026-2027',
    ranges: [
      { label: 'U6 - U7', anneeMin: 2020, anneeMax: 2021 },
      { label: 'U8 - U9', anneeMin: 2018, anneeMax: 2019 },
      { label: 'U10', anneeMin: 2017, anneeMax: 2017 },
    ],
  };
  assert.equal(ageGroup('2021-03-01', ctx), 'U6 - U7');
  assert.equal(ageGroup('2020-12-31', ctx), 'U6 - U7');
  assert.equal(ageGroup('2019-01-01', ctx), 'U8 - U9');
  assert.equal(ageGroup('2018-06-15', ctx), 'U8 - U9');
  assert.equal(ageGroup('2017-02-28', ctx), 'U10');
  // Hors catégorie : paire calculée sur la saison.
  assert.equal(ageGroup('2016-05-01', ctx), 'U10 - U11');
  assert.equal(ageGroup('2021-03-01', '2026-2027'), 'U6 - U7');
  assert.equal(ageGroup('2020-03-01', '2026-2027'), 'U6 - U7');
  assert.equal(ageGroup('2021-03-01', '2027-2028'), 'U6 - U7', 'U7 la saison suivante');
  assert.equal(ageGroup('2019-03-01', '2027-2028'), 'U8 - U9');
  assert.equal(ageGroup('', '2026-2027'), '');
  assert.equal(ageGroup('2020-01-01', ''), '');
  assert.deepEqual(sortAgeGroups(['U10', 'U8 - U9', 'U6 - U7']), ['U6 - U7', 'U8 - U9', 'U10']);
  // Le groupe en pré-inscription compte tant qu'aucune catégorie ne couvre ses années.
  assert.deepEqual(ageRangesFrom([{ label: 'U6 - U7', anneeMin: 2020, anneeMax: 2021 }], { label: 'U10', anneeMin: 2017, anneeMax: 2017 }).map((r) => r.label), ['U6 - U7', 'U10']);
  assert.deepEqual(ageRangesFrom([{ label: 'U10 - U11', anneeMin: 2016, anneeMax: 2017 }], { label: 'U10', anneeMin: 2017, anneeMax: 2017 }).map((r) => r.label), ['U10 - U11']);
});

test('liste des inscriptions : pastilles U6 - U7 / U8 - U9, filtre ?age=, catégorie sur la carte et dans le CSV', async () => {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  const cookie = (await createSession(env, DEMO_ORG_ID)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  await seedInscription(env.DB, { enfant_prenom: 'Alpha', naissance: '2021-01-01', categorie: 'U6 - U7', email: 'a@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Bravo', naissance: '2020-01-01', categorie: 'U6 - U7', email: 'b@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Charlie', naissance: '2019-01-01', categorie: 'U8 - U9', email: 'c@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Delta', naissance: '2018-01-01', categorie: 'U6 - U7', email: 'd@example.fr' });
  const get = async (query) => (await list.onRequestGet({ request: new Request(`https://clubdemo.licyo.fr/admin/inscriptions${query}`, { headers: { Cookie: cookie } }), env })).text();

  const all = await get('');
  for (const label of ['U6 - U7', 'U8 - U9']) assert.match(all, new RegExp(`age=${encodeURIComponent(label).replace(/%20/g, '(?:[+]|%20)')}[^"]*"[^>]*>${label}</a>`));
  assert.doesNotMatch(all, />U7<\/a>/, 'plus de pastille par âge seul');
  assert.match(all, /<strong>U6 - U7<\/strong> · inscription du/, 'catégorie non répétée quand elle correspond');
  assert.match(all, /<strong>U8 - U9<\/strong> · U6 - U7 · inscription du/, 'catégorie saisie affichée si elle diffère');

  const u67 = await get(`?age=${encodeURIComponent('U6 - U7')}`);
  assert.match(u67, /Alpha/);
  assert.match(u67, /Bravo/);
  assert.doesNotMatch(u67, /Charlie|Delta/);

  const csv = await get(`?age=${encodeURIComponent('U8 - U9')}&format=csv`);
  assert.match(csv, /"Catégorie d'âge"/);
  assert.match(csv, /"U8 - U9","U8 - U9"/);
  assert.doesNotMatch(csv, /Alpha|Bravo/);
});
