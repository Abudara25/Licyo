// Recherche globale (2026-11-13) : pas que des enfants. Responsables regroupés avec tous leurs enfants, éducateurs,
// pré-inscriptions, catégories ; filtre par type ; suggestions JSON ; organisation de la session uniquement.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as recherche from '../functions/admin/recherche.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { DEMO_ORG_ID as A } from '../functions/_shared/schema.js';
import { createEducateur } from '../functions/_shared/educateurs.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const SITE = 'https://club-exemple.example';

async function setup() {
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_b_test', 'b-test', 'B')").run();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const get = (q) => recherche.onRequestGet({ request: new Request(`${SITE}/admin/recherche${q}`, { headers: { Cookie: cookie } }), env });
  return { env, get, page: async (q) => (await get(q)).text() };
}

test('un parent apparaît une fois avec tous ses enfants, et un bouton E-mail limité à lui', async () => {
  const { env, page } = await setup();
  const a = await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Moreau', naissance: '2021-03-02', parent_prenom: 'Sophie', parent_nom: 'Moreau', email: 'sophie@exemple.fr', telephone: '06 12 34 56 78', parent2_prenom: 'David', parent2_nom: 'Moreau', parent2_email: 'david@exemple.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Tom', enfant_nom: 'Moreau', naissance: '2019-06-11', parent_prenom: 'Sophie', parent_nom: 'Moreau', email: 'SOPHIE@exemple.fr', telephone: '0612345678' });
  await seedInscription(env.DB, { enfant_prenom: 'Autre', enfant_nom: 'Moreau', parent_prenom: 'Sophie', parent_nom: 'Moreau', email: 'sophie@exemple.fr', organization_id: 'org_b_test' });

  const html = await page('?q=sophie');
  assert.match(html, /Responsables légaux <em>1<\/em>/, 'même e-mail (casse ignorée) = une seule personne');
  assert.match(html, />Lina \(U6\)<\/a>/);
  assert.match(html, />Tom \(U8\)<\/a>/);
  // E-mail écrit depuis une fiche de cette personne (la plus récente), à elle seule.
  assert.ok(a.id);
  assert.match(html, /\/admin\/email\?inscription=\d+&amp;destinataire=sophie%40exemple\.fr/i);
  assert.doesNotMatch(html, /Autre/, 'autre organisation invisible');
  // Le second responsable est une autre personne, trouvée par son nom.
  assert.match(await page('?q=david'), /David Moreau[\s\S]*Lina \(U6\)/);
  // Téléphone : 6 chiffres suffisent, quelle que soit la mise en forme.
  assert.match(await page('?q=06%2012%2034'), /Sophie Moreau/);
});

test('éducateurs, pré-inscriptions et catégories ; filtre par type ; texte échappé', async () => {
  const { env, page } = await setup();
  await createEducateur(env.DB, A, { prenom: 'Karim', nom: 'Morin', email: 'karim@exemple.fr', role: 'educateur', categories: 'U8' });
  await createEducateur(env.DB, 'org_b_test', { prenom: 'Karim', nom: 'Ailleurs', email: 'k@b.fr', role: 'educateur' });
  await seedInscription(env.DB, { enfant_prenom: '<b>Mor</b>', enfant_nom: 'Test' });

  const all = await page('?q=mor');
  assert.match(all, /Éducateurs <em>1<\/em>[\s\S]*Karim Morin[\s\S]*À remplir/);
  assert.doesNotMatch(all, /Ailleurs/);
  assert.ok(all.includes('&lt;b&gt;Mor&lt;/b&gt;') && !all.includes('<b>Mor</b>'));
  assert.match(all, /href="\/admin\/recherche\?q=mor&amp;type=educateurs"/);

  const only = await page('?q=mor&type=educateurs');
  assert.match(only, /Karim Morin/);
  assert.doesNotMatch(only, /Enfants <em>/, 'filtre : un seul type affiché');
  assert.match(await page('?q=mor&type=%3Cx%3E'), /Enfants <em>/, 'type inconnu : tout');

  const cats = await page('?q=u8');
  assert.match(cats, /Catégories <em>\d+<\/em>[\s\S]*href="\/admin\/inscriptions\?categorie=U8"/);
});

test('suggestions JSON : quelques résultats par type, session exigée', async () => {
  const { env, get } = await setup();
  for (let i = 0; i < 5; i += 1) await seedInscription(env.DB, { enfant_prenom: `Zoé${i}`, enfant_nom: 'Durand', email: `z${i}@exemple.fr` });
  const res = await get('?q=durand&format=json');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const data = await res.json();
  const enfants = data.groups.find((g) => g.type === 'enfants');
  assert.equal(enfants.count, 5);
  assert.equal(enfants.items.length, 3, 'trois suggestions par type au plus');
  assert.deepEqual(Object.keys(enfants.items[0]).sort(), ['href', 'sub', 'tag', 'title', 'tone']);
  const anon = await recherche.onRequestGet({ request: new Request(`${SITE}/admin/recherche?q=durand&format=json`), env });
  assert.equal(anon.status, 401);
  assert.deepEqual((await (await get('?q=d&format=json')).json()).groups, [], 'moins de 2 lettres : rien');
});
