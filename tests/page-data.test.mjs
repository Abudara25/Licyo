// Pages du site alimentées côté serveur par les données publiques (data-org-*), phase 2.1 : rendu HTML
// final, états A/B/C, créneaux multiples, isolation A/B entre organisations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest, injectOrgData, publicValues, applyPublicData, clearPageDataCache } from '../functions/_shared/page-data.js';
import { getPublicData, getAdminPublicData, saveLocation, saveSchedule, clearPublicDataCache } from '../functions/_shared/public-data.js';
import { getCategoriesConfig, setCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { saveDraftSiteConfig, publishSiteConfig, clearPublishedSiteCache } from '../functions/_shared/site-config.js';
import { site as demoSite } from '../sites/club-demo/site.js';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_asso_b';
const PAGES = { '/': 'index.html', '/entrainements': 'entrainements.html', '/equipe': 'equipe.html', '/contact': 'contact.html', '/inscription': 'inscription.html' };
const STATIC = Object.fromEntries(Object.values(PAGES).map((file) => [file, readFileSync(file, 'utf8').replaceAll('\r\n', '\n')]));

// Serveur de fichiers statiques simulé (binding ASSETS de Pages).
const ASSETS = {
  fetch: async (request) => {
    const file = PAGES[new URL(request.url).pathname];
    if (!file) return new Response('introuvable', { status: 404 });
    return new Response(STATIC[file], { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } });
  },
};

async function setup() {
  clearPublishedSiteCache();
  clearPageDataCache();
  clearPublicDataCache();
  clearOrganizationCache();
  const env = { ...(await fixture()), ASSETS };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, email, phone) VALUES (?, 'asso-b', 'Association B', 'contact@asso-b.example', '0102030405')").bind(B).run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('asso-b.example', ?)").bind(B).run();
  // B publie SON site (construit ici sur le même modèle de pages, pour comparer les données métier injectées) :
  // sans version publiée, B n'aurait aucune page (voir tests/public-routing.test.mjs).
  await saveDraftSiteConfig(env, B, { ...JSON.parse(JSON.stringify(demoSite)), organizationId: B }, { expectedRevision: 0 });
  await publishSiteConfig(env, B);
  await getCategoriesConfig(env, A); // premier accès : groupes, lieu et créneau de Sportville importés
  return env;
}
const render = async (env, url, init) => onRequest({ request: new Request(url, init), env });
const pageOf = async (env, host, path) => (await render(env, `https://${host}${path}`)).text();
const A_HOST = 'clubdemo.licyo.fr';
const B_HOST = 'asso-b.example';
const textOnly = (html) => html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// Ce qu'une organisation ne doit jamais recevoir d'une autre : les faits de Sportville.
const DEMO_FACTS = ['Stade municipal', 'rue du Stade', '180', 'Jeudi', 'jeudi', '17h', 'U6-U7', 'U8-U9', 'U6 - U7', 'U8 - U9', 'nés en 20', 'nés de 20', '2018', '2019', '2021', '06 00 00 00 00', 'contact@clubdemo.licyo.fr', '00000'];

test('avec les données actuelles, les 5 pages sont identiques au fichier statique (rien ne change à l’écran)', async () => {
  const env = await setup();
  for (const [path, file] of Object.entries(PAGES)) {
    const res = await render(env, `https://${A_HOST}${path}`);
    assert.equal(res.status, 200, path);
    assert.equal(await res.text(), STATIC[file], `${file} identique`);
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY', 'en-têtes du fichier statique conservés');
  }
});

test('chaque clé des pages (data-org, data-org-if, listes, attributs) correspond à une donnée', async () => {
  const env = await setup();
  const organization = await env.DB.prepare('SELECT * FROM organizations WHERE id = ?').bind(A).first();
  const values = publicValues(await getPublicData(env, A), organization);
  for (const [file, html] of Object.entries(STATIC)) {
    for (const [, key] of html.matchAll(/data-org="([^"]+)"/g)) assert.ok(Object.hasOwn(values, key), `${file} : data-org ${key}`);
    for (const [, list] of html.matchAll(/data-org-if="([^"]+)"/g)) for (const key of list.split(',')) assert.ok(Object.hasOwn(values, key.trim()), `${file} : data-org-if ${key}`);
    for (const [, spec] of html.matchAll(/data-org-attr="([^"]+)"/g)) for (const pair of spec.split(';')) assert.ok(Object.hasOwn(values, pair.split(':')[1]), `${file} : attr ${pair}`);
  }
});

test('l’admin modifie horaire, lieu, adresse, tarif et années : toutes les occurrences factuelles suivent', async () => {
  const env = await setup();
  const admin = await getAdminPublicData(env, A);
  await saveSchedule(env, A, admin.schedules[0].id, { weekday: 5, start: '18:30', end: '20:00', locationId: admin.locations[0].id });
  await saveLocation(env, A, admin.locations[0].id, { name: 'Gymnase Jean Moulin', address: '12 avenue des Sports, 00000 Sportville' });
  const config = await getCategoriesConfig(env, A);
  await setCategoriesConfig(env, A, {
    ...config,
    prix: 200,
    categories: config.categories.map((c) => (c.id === 'u6-u7' ? { ...c, anneeMin: 2021, anneeMax: 2022 } : c)),
  });

  const entrainements = await pageOf(env, A_HOST, '/entrainements');
  assert.match(entrainements, /<span data-org="schedule.Day">Vendredi<\/span>, <span data-org="schedule.startLong">18h30<\/span> – <span data-org="schedule.endLong">20h00<\/span>/);
  assert.match(entrainements, /Tous les <span data-org="schedule.days">vendredis<\/span> de <span data-org="schedule.start">18h30<\/span> à <span data-org="schedule.end">20h<\/span><span data-org-if="location.name"> au <span data-org="location.name">Gymnase Jean Moulin<\/span><span data-org-if="location.address">, <span data-org="location.address">12 avenue des Sports, 00000 Sportville<\/span>/);
  assert.match(entrainements, /nés de 2018 à 2022/);
  assert.match(entrainements, /Pas pour cette saison : un seul créneau \(<span data-org="schedule.day">vendredi<\/span> <span data-org="schedule.start">18h30<\/span>-<span data-org="schedule.end">20h<\/span>\)/);
  assert.match(await pageOf(env, A_HOST, '/'), /<strong data-org="price.season">200 €<\/strong>/);
  assert.match(await pageOf(env, A_HOST, '/equipe'), /nés en <span data-org="group.u6-u7.yearMin">2021<\/span> ou <span data-org="group.u6-u7.yearMax">2022<\/span>/);
  assert.match(await pageOf(env, A_HOST, '/inscription'), /data-org="price.seasonAmount">200<\/span>/);

  // Adresse, carte et liens : toutes les occurrences (contact, entraînements, accueil, pied de page).
  for (const path of ['/contact', '/entrainements']) {
    const html = await pageOf(env, A_HOST, path);
    assert.doesNotMatch(html, /rue du Stade|Stade municipal/, `${path} : plus d'ancienne adresse`);
    assert.match(html, /12 avenue des Sports, 00000 Sportville/);
    assert.match(html, /data-map-src="https:\/\/www\.google\.com\/maps\?q=Gymnase%20Jean%20Moulin%2012%20avenue%20des%20Sports%2C%2000000%20Sportville&amp;output=embed"/);
    assert.match(html, /data-map-title="Carte — Gymnase Jean Moulin, Sportville"/);
    assert.match(html, /href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Gymnase%20Jean%20Moulin%2012%20avenue%20des%20Sports%2C%2000000%20Sportville"/);
  }
  const home = await pageOf(env, A_HOST, '/');
  assert.doesNotMatch(home, /rue du Stade|Stade municipal/);
  assert.match(home, /<a href="\/contact" data-org="location.short">Gymnase Jean Moulin, Sportville<\/a>/, 'pied de page');
  const json = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(home)[1]);
  assert.equal(json.address.streetAddress, '12 avenue des Sports');
});

test('un nom ou une adresse avec des caractères spéciaux ne casse ni le HTML ni les attributs (pas de XSS)', async () => {
  const env = await setup();
  const admin = await getAdminPublicData(env, A);
  await saveLocation(env, A, admin.locations[0].id, { name: 'Salle "Les <b>Lilas</b>" & co', address: '1 rue <script>alert(1)</script>, 00000 Sportville' });
  for (const path of ['/', '/contact', '/entrainements']) {
    const html = await pageOf(env, A_HOST, path);
    assert.doesNotMatch(html, /<script>alert\(1\)|<b>Lilas/, `${path} : rien d'exécutable`);
  }
  const contact = await pageOf(env, A_HOST, '/contact');
  assert.match(contact, /data-map-title="Carte — Salle &quot;Les &lt;b&gt;Lilas&lt;\/b&gt;&quot; &amp; co, Sportville"/);
  const home = await pageOf(env, A_HOST, '/');
  const scripts = [...home.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'le JSON-LD n’a pas été fermé prématurément');
  assert.doesNotThrow(() => JSON.parse(scripts[0][1]));
});

test('une URL de carte non fiable enregistrée en base n’est jamais publiée', async () => {
  const env = await setup();
  await env.DB.prepare("UPDATE locations SET maps_url = 'javascript:alert(1)' WHERE organization_id = ?").bind(A).run();
  const html = await pageOf(env, A_HOST, '/contact');
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /class="map-link" data-org-attr="href:location.mapsUrl" href="https:\/\/www\.google\.com\/maps\/search\/\?api=1&amp;query=Stade%20municipal/);
});

// ---------------------------------------------------------------------------------------------
// Créneaux multiples

async function withSchedules(env, schedules) {
  await env.DB.prepare('DELETE FROM group_schedules WHERE organization_id = ?').bind(A).run();
  for (const s of schedules) {
    const result = await saveSchedule(env, A, null, s);
    assert.equal(result.error, undefined, JSON.stringify(s));
  }
}
const slotLines = (html) => [...html.matchAll(/<span class="org-slot">([^<]*)(?:<span class="org-slot-meta">([^<]*)<\/span>)?<\/span>/g)].map((m) => `${m[1].trim()}${m[2] ? ` ${m[2]}` : ''}`);

test('plusieurs créneaux communs : tous affichés, dans l’ordre (jour puis heure), rendu serveur', async () => {
  const env = await setup();
  const { locations } = await getAdminPublicData(env, A);
  await withSchedules(env, [
    { weekday: 6, start: '10:00', end: '11:00', locationId: locations[0].id },
    { weekday: 4, start: '17:00', end: '18:00', locationId: locations[0].id },
    { weekday: 4, start: '18:00', end: '19:30', locationId: locations[0].id },
  ]);
  const home = await pageOf(env, A_HOST, '/');
  assert.deepEqual(slotLines(home), ['Jeudi 17h – 18h', 'Jeudi 18h – 19h30', 'Samedi 10h – 11h']);
  assert.match(home, /<strong data-org-list="slots-compact">Jeudi 17h · Jeudi 18h · Samedi 10h<\/strong>/);
  assert.doesNotMatch(home, /un seul créneau étant disponible/, 'phrase au singulier retirée');
  const entrainements = await pageOf(env, A_HOST, '/entrainements');
  assert.equal([...entrainements.matchAll(/<span class="card-date">Tous les groupes<\/span>/g)].length, 3, 'une carte par créneau');
  assert.doesNotMatch(entrainements, /Un second créneau \?/, 'carte « second créneau » retirée');
  assert.doesNotMatch(entrainements, /Pas pour cette saison : un seul créneau/, 'FAQ au singulier retirée du HTML et du JSON-LD');
  const faq = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(entrainements)[1]);
  assert.ok(!faq.mainEntity.some((q) => /second créneau/.test(q.name)));
  assert.match(faq.mainEntity.find((q) => /Où et quand/.test(q.name)).acceptedAnswer.text, /jeudi de 17h à 18h au Stade municipal ; jeudi de 18h à 19h30 au Stade municipal ; samedi de 10h à 11h/);
  assert.match(await pageOf(env, A_HOST, '/equipe'), /ouvertes aux filles comme aux garçons\./);
  assert.match(await pageOf(env, A_HOST, '/inscription'), /Entraînement <span data-org-list="slots-sentence">jeudi de 17h à 18h au Stade municipal ; jeudi de 18h à 19h30/);
});

test('créneaux propres à un groupe, jours, heures et lieux différents', async () => {
  const env = await setup();
  const { groups } = await getAdminPublicData(env, A);
  await saveLocation(env, A, null, { name: 'Gymnase Berthelot', address: '4 rue Berthelot, 00000 Sportville' });
  const { locations } = await getAdminPublicData(env, A);
  const stade = locations[0].id;
  const gymnase = locations[1].id;
  await withSchedules(env, [
    { weekday: 4, start: '17:00', end: '18:00', locationId: stade, groupId: groups.find((g) => g.slug === 'u6-u7').id },
    { weekday: 6, start: '10:00', end: '11:00', locationId: gymnase, groupId: groups.find((g) => g.slug === 'u8-u9').id },
  ]);
  const entrainements = await pageOf(env, A_HOST, '/entrainements');
  assert.match(entrainements, /<span class="card-date">U6-U7<\/span>\s*<h3>Jeudi, 17h00 – 18h00<\/h3>\s*<p>Stade municipal — 1 rue du Stade, 00000 Sportville<\/p>/);
  assert.match(entrainements, /<span class="card-date">U8-U9<\/span>\s*<h3>Samedi, 10h00 – 11h00<\/h3>\s*<p>Gymnase Berthelot — 4 rue Berthelot, 00000 Sportville<\/p>/);
  assert.ok(entrainements.indexOf('U6-U7</span>\n            <h3>Jeudi') < entrainements.indexOf('U8-U9</span>\n            <h3>Samedi'), 'ordre stable');
  assert.deepEqual(slotLines(await pageOf(env, A_HOST, '/contact')), ['Jeudi 17h – 18h · U6 - U7 · Stade municipal', 'Samedi 10h – 11h · U8 - U9 · Gymnase Berthelot']);
  assert.match(await pageOf(env, A_HOST, '/inscription'), /jeudi de 17h à 18h \(U6-U7\) au Stade municipal ; samedi de 10h à 11h \(U8-U9\) au Gymnase Berthelot/);
});

test('un seul créneau propre à un groupe n’est pas présenté comme commun à tous', async () => {
  const env = await setup();
  const { groups, locations } = await getAdminPublicData(env, A);
  await withSchedules(env, [{ weekday: 4, start: '17:00', end: '18:00', locationId: locations[0].id, groupId: groups[0].id }]);
  const entrainements = await pageOf(env, A_HOST, '/entrainements');
  assert.match(entrainements, /<span class="card-date">U6-U7<\/span>/);
  assert.doesNotMatch(entrainements, /Tous les groupes/);
});

test('aucun créneau : les blocs d’horaire disparaissent (aucune ancienne valeur), le reste de la page reste', async () => {
  const env = await setup();
  await withSchedules(env, []);
  for (const path of ['/', '/entrainements', '/contact', '/inscription']) {
    const html = await pageOf(env, A_HOST, path);
    assert.doesNotMatch(textOnly(html), /Jeudi|jeudi|17h/, `${path} : plus de créneau`);
  }
  const faq = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(await pageOf(env, A_HOST, '/entrainements'))[1]);
  assert.ok(!faq.mainEntity.some((q) => /Où et quand|second créneau/.test(q.name)));
});

// ---------------------------------------------------------------------------------------------
// Groupes supprimés, inactifs, non publics

for (const [label, change] of [
  ['supprimé', (db, id) => db.prepare('DELETE FROM groups WHERE id = ?').bind(id).run()],
  ['inactif', (db, id) => db.prepare('UPDATE groups SET is_active = 0 WHERE id = ?').bind(id).run()],
  ['non public', (db, id) => db.prepare('UPDATE groups SET is_public = 0 WHERE id = ?').bind(id).run()],
]) {
  test(`groupe U6-U7 ${label} : plus aucune trace publique (D1 disponible → pas de retour au HTML statique)`, async () => {
    const env = await setup();
    const { groups } = await getAdminPublicData(env, A);
    await change(env.DB, groups.find((g) => g.slug === 'u6-u7').id);
    clearPublicDataCache();
    const equipe = await pageOf(env, A_HOST, '/equipe');
    assert.doesNotMatch(equipe, /data-org="group\.u6-u7/, 'carte retirée');
    assert.match(equipe, /group\.u8-u9\.name/, 'l’autre groupe reste');
    const entrainements = await pageOf(env, A_HOST, '/entrainements');
    assert.doesNotMatch(entrainements, /U6-U7|nés en 2020|2020 ou 2021|2021/, 'entraînements : badge, FAQ et JSON-LD');
    assert.match(entrainements, /nés de 2018 à 2019/);
    assert.doesNotMatch(await pageOf(env, A_HOST, '/inscription'), /<option value="U6 - U7"/, 'le formulaire ne propose plus U6-U7');
    assert.match(await pageOf(env, A_HOST, '/inscription'), /<option value="U8 - U9"/);
  });
}

// ---------------------------------------------------------------------------------------------
// États A / B / C et isolation entre organisations

test('état C : D1 réellement en panne → Sportville garde ses pages statiques, une autre organisation reste neutre', async (t) => {
  const env = await setup();
  await pageOf(env, A_HOST, '/'); // organisations résolues et mises en cache (60 s) avant la panne
  await pageOf(env, B_HOST, '/');
  clearPublicDataCache();
  const prepare = env.DB.prepare.bind(env.DB);
  t.mock.method(env.DB, 'prepare', (sql) => {
    if (/FROM groups|FROM group_schedules|FROM locations|FROM prices/.test(sql)) throw new Error('D1 indisponible');
    return prepare(sql);
  });
  t.mock.method(console, 'warn', () => {});
  assert.equal(await pageOf(env, A_HOST, '/entrainements'), STATIC['entrainements.html'], 'Sportville : secours statique historique');
  const b = await pageOf(env, B_HOST, '/entrainements');
  for (const fact of DEMO_FACTS) assert.ok(!textOnly(b).includes(fact), `B ne reçoit pas « ${fact} » de Sportville`);
});

test('état B : D1 fonctionne mais la donnée est absente → jamais l’ancienne valeur statique', async () => {
  const env = await setup();
  await env.DB.prepare('DELETE FROM prices WHERE organization_id = ?').bind(A).run();
  await env.DB.prepare('DELETE FROM locations WHERE organization_id = ?').bind(A).run();
  const pages = await Promise.all(Object.keys(PAGES).map((path) => pageOf(env, A_HOST, path)));
  for (const html of pages) {
    assert.doesNotMatch(textOnly(html), /180 €|Stade municipal|rue du Stade/);
  }
});

test('organisation B vide : aucune donnée métier de Sportville dans le HTML rendu', async () => {
  const env = await setup();
  for (const [path] of Object.entries(PAGES)) {
    const html = await pageOf(env, B_HOST, path);
    const text = textOnly(html);
    for (const fact of DEMO_FACTS) assert.ok(!text.includes(fact), `${path} : « ${fact} » de Sportville chez B`);
    assert.doesNotMatch(html, /"streetAddress"|"telephone": "\+33600000000"/);
  }
  const home = await pageOf(env, B_HOST, '/');
  const json = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(home)[1]);
  assert.equal(json.address, undefined, 'pas d’adresse inventée');
  assert.equal(json.email, 'contact@asso-b.example', 'coordonnées de B, pas de Sportville');
});

test('organisation B partiellement configurée : uniquement ses propres données, Sportville inchangé', async () => {
  const env = await setup();
  await setCategoriesConfig(env, B, { saison: '2026-2027', prix: 95, categories: [{ id: 'danse', label: 'Éveil danse', anneeMin: 2017, anneeMax: 2019, active: true }] });
  await saveLocation(env, B, null, { name: 'Salle des Fêtes', address: '8 place de la Mairie, 75001 Paris' });
  const { locations } = await getAdminPublicData(env, B);
  await saveSchedule(env, B, null, { weekday: 3, start: '14:00', end: '15:30', locationId: locations[0].id });

  const contact = await pageOf(env, B_HOST, '/contact');
  assert.match(contact, /Salle des Fêtes/);
  assert.match(contact, /8 place de la Mairie, 75001 Paris/);
  assert.match(contact, /Mercredi, 14h – 15h30|Mercredi<\/span>, <span data-org="schedule.start">14h/);
  assert.match(contact, /contact@asso-b\.example/);
  assert.match(contact, /01 02 03 04 05/);
  assert.match(await pageOf(env, B_HOST, '/'), /<strong data-org="price.season">95 €<\/strong>/);
  for (const path of Object.keys(PAGES)) {
    const text = textOnly(await pageOf(env, B_HOST, path));
    for (const fact of ['Stade municipal', 'rue du Stade', '180 €', '06 00 00 00 00', 'contact@clubdemo.licyo.fr', 'U6 - U7']) assert.ok(!text.includes(fact), `${path} : « ${fact} »`);
  }
  // A ne reçoit jamais B, et reste identique au fichier statique.
  for (const [path, file] of Object.entries(PAGES)) {
    const html = await pageOf(env, A_HOST, path);
    assert.equal(html, STATIC[file], `A : ${file} inchangé`);
    assert.doesNotMatch(html, /Salle des Fêtes|asso-b|95 €|Éveil danse/);
  }
});

test('injecteur : attributs multiples, espaces, Unicode, imbrication et structure inattendue', () => {
  const values = { a: 'é & ü', 'x.y': 'Zoé "chat" <b>', 'k': '1' };
  assert.equal(injectOrgData('<p><span  class="c"   id="i" data-org="a"  title="t">ancien</span></p>', values), '<p><span  class="c"   id="i" data-org="a"  title="t">é &amp; ü</span></p>');
  assert.equal(injectOrgData('<span data-org="x.y">x</span>', values), '<span data-org="x.y">Zoé "chat" &lt;b&gt;</span>');
  // texte contenant une balise imbriquée : laissé intact (jamais de HTML cassé)
  assert.equal(injectOrgData('<span data-org="a">avant <b>gras</b> après</span>', values), '<span data-org="a">avant <b>gras</b> après</span>');
  // balise non refermée : laissée telle quelle
  assert.equal(injectOrgData('<div><span data-org="a">jamais fermé</div>', values), '<div><span data-org="a">jamais fermé</div>');
  assert.equal(injectOrgData('', values), '');
});

test('retrait de blocs imbriqués : équilibré, sans laisser de balise orpheline', () => {
  const html = '<main><div data-org-if="groups.any"><div>a<div>b</div></div></div><p>reste</p><ul><li data-org-if="org.email">x</li><li>y</li></ul></main>';
  const out = applyPublicData(html, { data: { groups: [], schedules: [], locations: [], prices: [] } });
  assert.equal(out, '<main><p>reste</p><ul><li>y</li></ul></main>');
});

test('JSON-LD : valide, statique = rendu avec les données actuelles, données à jour après modification', async () => {
  for (const file of ['index.html', 'entrainements.html']) {
    const match = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(STATIC[file]);
    const parsed = JSON.parse(match[1]);
    assert.equal(match[1], `\n${JSON.stringify(parsed, null, 2)}\n`, `${file} : format JSON-LD attendu (rendu identique sans changement)`);
    assert.ok(['SportsClub', 'FAQPage'].includes(parsed['@type']));
  }
  const env = await setup();
  await setCategoriesConfig(env, A, { ...(await getCategoriesConfig(env, A)), prix: 175 });
  const faq = JSON.parse(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/.exec(await pageOf(env, A_HOST, '/entrainements'))[1]);
  assert.match(faq.mainEntity.find((q) => /prix/.test(q.name)).acceptedAnswer.text, /^L'adhésion coûte 175 € pour la saison/);
});

test('secours : domaine inconnu → 404 neutre (jamais Sportville) ; prévisualisation non isolée → page statique telle quelle', async () => {
  const env = await setup();
  const original = STATIC['entrainements.html'];
  const unknown = await render(env, 'https://domaine-inconnu.example/entrainements');
  assert.equal(unknown.status, 404, 'domaine inconnu');
  assert.doesNotMatch(await unknown.text(), /Sportville|Stade municipal|<nav/);
  assert.equal(await (await render(env, 'https://feat-x.licyo.pages.dev/entrainements')).text(), original, 'prévisualisation non isolée');
  const absent = await render(env, `https://${A_HOST}/absente`);
  assert.equal(absent.status, 404, 'route absente : 404 de l’organisation');
  assert.match(await absent.text(), /Club Démo/, 'page 404 de Sportville sur son propre domaine');
  assert.equal((await render(env, `https://${A_HOST}/entrainements`, { method: 'HEAD' })).status, 200);
});

test('texte injecté échappé', () => {
  const html = '<p><span data-org="location.name">Stade</span> <span data-org="inconnue">garde</span></p>';
  assert.equal(
    injectOrgData(html, { 'location.name': 'Salle <script>alert(1)</script> & co' }),
    '<p><span data-org="location.name">Salle &lt;script&gt;alert(1)&lt;/script&gt; &amp; co</span> <span data-org="inconnue">garde</span></p>'
  );
});
