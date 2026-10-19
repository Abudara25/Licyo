// Phase 4D.2A : pages décrites uniquement par des sections structurées. Suppression des fragments, sérialisation
// JSON, bornes, identifiants stables, markers/static, second site fictif, variantes fermées, XSS par type de bloc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderSitePage, validateSite } from '../renderer/render.js';
import { safeAbsoluteUrl, safeHref } from '../renderer/html.js';
import { siteForOrganization } from '../sites/index.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { exempleSite } from './fixtures/site-exemple.mjs';

const clone = (value) => structuredClone(value);
const demo = siteForOrganization(DEMO_ORG_ID);
const SITES = [demo, exempleSite];
const versionsFor = (site) => Object.fromEntries([site.theme.stylesheet, ...site.pages.flatMap((p) => p.scripts || [])].map((path) => [path, 'cccccccccc']));
const render = (site, route, extra = {}) => renderSitePage({ site, route, locale: site.locale, assetVersions: versionsFor(site), ...extra }).html;

test('aucune section « fragment » ni fichier de fragment ne subsiste', () => {
  for (const site of SITES) for (const page of site.pages) for (const section of page.sections) assert.notEqual(section.type, 'fragment');
  assert.equal(existsSync('sites/club-demo/fragments'), false);
  assert.equal(JSON.stringify(demo).includes('"trust"'), false);
  for (const name of readdirSync('renderer')) assert.doesNotMatch(readFileSync(join('renderer', name), 'utf8'), /fragments\[|trust\.fragments/, name);
  const build = readFileSync('scripts/build-pages.mjs', 'utf8');
  assert.doesNotMatch(build, /loadFragments|fragments\//);
});

test('SiteConfig sérialisable : JSON.stringify → JSON.parse → validation → rendu identique', () => {
  for (const site of SITES) {
    const copy = JSON.parse(JSON.stringify(site));
    assert.deepStrictEqual(copy, site);
    validateSite(copy);
    for (const page of site.pages) assert.equal(render(copy, page.route), render(site, page.route), `${site.id} ${page.route}`);
  }
});

test('valeurs non JSON et bornes : refusées (fonction, expression régulière, date, NaN, textes et listes démesurés)', () => {
  const cases = [
    [(s) => (s.brand.name = () => 'x'), /non sérialisable/],
    [(s) => (s.brand.tagline = /x/), /non sérialisable/],
    [(s) => (s.brand.shortName = new Date()), /non sérialisable/],
    [(s) => (s.pages[0].sections[0].emblem.width = NaN), /non fini/],
    [(s) => (s.pages[1].sections[1].blocks[0].eyebrow = 'x'.repeat(6001)), /texte trop long/],
    [(s) => (s.pages[1].sections[1].blocks[1].items = Array.from({ length: 201 }, () => ({ icon: 'clock', title: ['a'], text: ['b'] }))), /trop d'éléments/],
    [(s) => (s.pages[1].sections[0].lead = [JSON.parse(`${'{"em":['.repeat(30)}"x"${']}'.repeat(30)}`)]), /imbrication trop profonde/],
    [(s) => (s.pages[1].sections = Array.from({ length: 41 }, (_, i) => ({ type: 'page_header', id: `ateliers.h${i}`, eyebrow: 'a', title: 'b', lead: ['c'] }))), /sections requises/],
  ];
  for (const [mutate, expected] of cases) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), expected, String(mutate));
  }
});

test('SiteConfig fermé : propriétés Symbol et clés inconnues refusées dans tous les objets structurés', () => {
  const symbolCases = [
    (s) => (s[Symbol('extra')] = true),
    (s) => (s.brand[Symbol('extra')] = true),
    (s) => (s.pages[0].sections[0].lead[Symbol('extra')] = true),
  ];
  for (const mutate of symbolCases) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), /propriété Symbol refusée/, String(mutate));
  }

  const unknownKeyCases = [
    (s) => (s.brand.extra = true),
    (s) => (s.theme.extra = true),
    (s) => (s.brand.logo.extra = true),
    (s) => (s.seo.ogImage.extra = true),
    (s) => (s.contact.phone.extra = true),
    (s) => (s.navigation.items[0].extra = true),
    (s) => (s.footer.practical.extra = true),
    (s) => (s.pages[0].seo.extra = true),
    (s) => (s.pages[0].head = { extra: true }),
    (s) => (s.pages[0].sections[0].lead[0] = { link: { href: '/', children: ['x'], extra: true } }),
  ];
  for (const mutate of unknownKeyCases) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), /clé inconnue/, String(mutate));
  }

  const site = clone(demo);
  site.news.categories.club.extra = true;
  assert.throws(() => validateSite(site), /clé inconnue/);
});

test('identifiants de section : obligatoires, au format « page.nom », uniques dans le site', () => {
  for (const [mutate, expected] of [
    [(s) => delete s.pages[1].sections[1].id, /identifiant de section invalide/],
    [(s) => (s.pages[1].sections[1].id = 'horaires'), /identifiant de section invalide/],
    [(s) => (s.pages[1].sections[1].id = 'Ateliers.Horaires'), /identifiant de section invalide/],
    [(s) => (s.pages[2].sections[1].id = 'ateliers.horaires'), /en double/],
  ]) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), expected);
  }
  for (const page of demo.pages) for (const section of page.sections) assert.ok(section.id.startsWith(`${page.id}.`), section.id);
});

test('ordre explicite : les sections sont rendues dans l’ordre du tableau', () => {
  const site = clone(exempleSite);
  const sections = site.pages[1].sections;
  const html = (s) => render(s, '/ateliers');
  const before = html(site);
  [sections[1], sections[2]] = [sections[2], sections[1]];
  const after = html(site);
  assert.ok(before.indexOf('Horaires') < before.indexOf('Avant de venir'));
  assert.ok(after.indexOf('Avant de venir') < after.indexOf('Horaires'));
});

// Seules différences admises entre les modes : les attributs data-org-*, et les enveloppes span/strong de
// liaison qui, sans ces attributs, n'auraient plus aucun attribut (omises en static, voir renderer/inline.js).
// Comparaison : attributs data-org-* retirés, puis enveloppes span/strong sans attribut dépliées, des deux côtés.
// Tout autre élément (blocs, listes, liens, crochets, éléments portant une classe ou un style) doit être identique.
const DATA_ORG = / data-org(-if|-list|-attr|-cards|-jsonld)?="[^"]*"/g;
function normalizeModes(html) {
  const stack = [];
  return html.replace(DATA_ORG, '').replace(/<(\/?)(span|strong)((?:\s[^>]*)?)>/g, (tag, close, name, attrs) => {
    if (close) return stack.pop() ? '' : tag;
    const bare = attrs.trim() === '';
    stack.push(bare);
    return bare ? '' : tag;
  });
}

test('markers/static : même DOM hors attributs data-org-* et enveloppes de liaison vides (P2 de la 4D.1)', () => {
  for (const site of SITES) {
    for (const page of site.pages) {
      const markers = render(site, page.route, { mode: 'markers' });
      const staticHtml = render(site, page.route, { mode: 'static' });
      assert.doesNotMatch(staticHtml, /data-org/, `${site.id} ${page.route}`);
      assert.equal(normalizeModes(markers), normalizeModes(staticHtml), `${site.id} ${page.route}`);
      // Mêmes blocs, listes, liens et éléments porteurs d'attributs, dans le même ordre.
      const skeleton = (html) => (html.replace(DATA_ORG, '').match(/<(?!\/?(span|strong)[\s>])[a-z][^>]*>/g) || []).join('');
      assert.equal(skeleton(markers), skeleton(staticHtml), `${site.id} ${page.route}`);
    }
  }
});

test('second site fictif : sections variées (colonnes, cartes, horaires, FAQ, contact, carte, appel à l’action), sans aucune trace DEMO', () => {
  const all = exempleSite.pages.map((p) => render(exempleSite, p.route)).join('\n');
  for (const needle of [
    'class="container grid grid-2" style="align-items:center;"',
    'class="faq-item"',
    'class="info-list" style="max-width:640px;margin-inline:auto;" data-reveal',
    'class="cta-banner"',
    'action="/api/contact"',
    'data-map-src="https://www.openstreetmap.org/export/embed.html?bbox=2.29,48.85,2.30,48.86"',
  ]) {
    assert.ok(all.includes(needle), needle);
  }
  assert.doesNotMatch(all, /Sportville|Sport ville|DEMO|licyo|org_demo|Stade municipal|rue du Stade|U6|U7|U8|U9/);
});

test('le moteur ne contient aucune valeur propre à Sportville (recherche élargie, sensible à la casse)', () => {
  for (const name of readdirSync('renderer')) {
    const source = readFileSync(join('renderer', name), 'utf8');
    assert.doesNotMatch(source, /Sportville|Sport ville|DEMO|org_demo|licyo|Stade municipal|rue du Stade|Sportéquip|\bU[6-9]\b/, `renderer/${name}`);
  }
});

test('identifiants dans les URL : refusés (P3 de la 4D.1)', () => {
  for (const bad of ['https://user:pass@example.com/', 'https://user@example.com/', 'http://a:b@example.com']) {
    assert.throws(() => safeHref(bad), /refusée/, bad);
    assert.throws(() => safeAbsoluteUrl(bad), /refusée|non https/, bad);
  }
});

test('variantes, carte, images, événements : listes fermées, toute autre valeur refusée', () => {
  for (const mutate of [
    (s) => (s.pages[0].sections[1].background = 'rainbow'),
    (s) => (s.pages[0].sections[1].columns[0].children[1].variant = 'rainbow'),
    (s) => (s.pages[0].sections[1].columns[0].children[2].placement = 'floating'),
    (s) => (s.pages[0].sections[1].columns[1].variant = 'neon'),
    (s) => (s.pages[0].sections[1].columns[1].columns = 4),
    (s) => (s.pages[1].sections[1].blocks[2].variant = 'warning'),
    (s) => (s.pages[1].sections[1].blocks[1].items[0].icon = 'skull'),
    (s) => (s.pages[0].sections[2].blocks[0].actions[0].track = 'steal'),
    (s) => (s.contact.location.embedUrl = 'https://evil.example/embed'),
    (s) => (s.contact.location.mapsUrl = 'javascript:alert(1)'),
    (s) => (s.pages[0].sections[1].background = 'photo'),
    (s) => Object.assign(s.pages[0].sections[1], { background: 'photo', image: '../secret.jpg' }),
    (s) => s.pages[1].sections[1].blocks.push({ type: 'image', ratio: '16/9', src: 'https://evil.example/x.jpg', alt: '', width: 1, height: 1 }),
    (s) => s.pages[1].sections[1].blocks.push({ type: 'image', ratio: '4/3', src: 'assets/images/x.jpg', alt: '', width: 1, height: 1 }),
    (s) => (s.pages[1].sections[1].blocks[0].layout = 'diagonal'),
    (s) => s.pages[1].sections[1].blocks.push({ type: 'partners', items: [{ name: 'X', role: 'Y', logo: { src: 'https://evil.example/x.png', width: 1, height: 1 } }] }),
    (s) => s.pages[1].sections[1].blocks.push({ type: 'partners', items: [{ name: 'X', role: 'Y', logo: { src: 'assets/images/x.png', width: 1, height: 1 }, href: 'javascript:alert(1)' }] }),
    (s) => (s.pages[1].sections[1].blocks[0].children = [{ type: 'faq', items: [] }]),
  ]) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), undefined, String(mutate));
  }
});

const XSS = `<script>alert("x")</script><img src=x onerror=alert(1)> & ' " javascript:`;
const XSS_ATTR = '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; \' &quot; javascript:';
const XSS_TEXT = '&lt;script&gt;alert("x")&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; \' " javascript:';

test('XSS : valeurs hostiles dans chaque type de bloc, échappées en texte comme en attribut', () => {
  const site = clone(exempleSite);
  const [home, ateliers, infos] = site.pages;
  Object.assign(ateliers.sections[1].blocks[0], { eyebrow: XSS, title: [XSS], sub: [XSS] });
  ateliers.sections[1].blocks[1].items[0] = { icon: 'clock', title: [XSS], text: [XSS] };
  ateliers.sections[1].blocks[2].content = [XSS];
  ateliers.sections[2].blocks[1].items[0] = { question: XSS, answer: [XSS] };
  const form = infos.sections[1].columns[0].children[1];
  Object.assign(form, { sent: { title: XSS, text: XSS }, submit: XSS, consent: [XSS] });
  form.name = { label: XSS, placeholder: XSS };
  form.subject.options = [XSS];
  infos.sections[1].columns[1].children[1].labels = { show: XSS, open: XSS, note: XSS };
  site.contact.location.name = XSS;
  site.contact.location.mapTitle = XSS;
  home.sections[1].columns[1].items[0] = { title: [XSS], text: [XSS] };
  home.sections[2].blocks[0] = { type: 'cta_banner', title: XSS, text: [XSS], actions: [{ href: '/', label: XSS }] };
  ateliers.sections.push(
    { type: 'content', id: 'ateliers.legal', background: 'surface', width: 'narrow', blocks: [{ type: 'articles', items: [{ eyebrow: XSS, title: XSS, paragraphs: [[XSS]] }] }] },
    {
      type: 'content',
      id: 'ateliers.equipe',
      background: 'maroon',
      layout: 'split',
      align: 'start',
      columns: [
        { type: 'profile_card', eyebrow: XSS, initial: 'X', name: XSS, role: XSS, points: [XSS] },
        { type: 'callout', variant: 'dark', eyebrow: XSS, content: [XSS] },
      ],
    },
    { type: 'content', id: 'ateliers.photo', background: 'surface', blocks: [{ type: 'image', ratio: '21/9', src: 'assets/images/x.jpg', alt: XSS, width: 10, height: 5 }] },
    { type: 'content', id: 'ateliers.partenaires', background: 'cream', blocks: [{ type: 'partners', items: [{ name: XSS, role: XSS, logo: { src: 'assets/images/x.webp', width: 10, height: 2 }, href: 'https://exemple.test/' }] }] }
  );
  const html = site.pages.map((p) => render(site, p.route)).join('\n');
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.doesNotMatch(html, /="[^"]*" onerror/);
  for (const attr of ['placeholder', 'data-map-title', 'alt']) assert.ok(html.includes(`${attr}="${XSS_ATTR}"`), attr);
  for (const text of [`<summary>${XSS_TEXT}</summary>`, `<h3>${XSS_TEXT}</h3>`, `<option>${XSS_TEXT}</option>`, `<span class="role">${XSS_TEXT}</span>`, `<span class="partner-role">${XSS_TEXT}</span>`]) assert.ok(html.includes(text), text);
});

test('formulaire d’inscription : textes hostiles échappés, champs et modes de paiement fixés par le moteur', () => {
  const site = clone(demo);
  const form = site.pages.find((p) => p.id === 'inscription').sections.find((s) => s.type === 'registration');
  Object.assign(form.texts, { title: XSS, intro: [XSS], submit: XSS });
  form.texts.email = { label: XSS, placeholder: XSS };
  form.groupOptions[0].label = XSS;
  const html = render(site, '/inscription');
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.ok(html.includes(`placeholder="${XSS_ATTR}"`));
  for (const field of ['enfantPrenom', 'enfantNom', 'naissance', 'categorie', 'tailleMaillot', 'parentPrenom', 'email', 'modePaiement', 'passSportCode', 'autorisation', 'droitImage', 'rgpd']) {
    assert.ok(html.includes(`name="${field}"`), field);
  }
  for (const value of ['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque']) assert.ok(html.includes(`<option value="${value}">`), value);
  for (const mutate of [
    (f) => (f.paymentLabels.Bitcoin = 'Bitcoin'),
    (f) => delete f.paymentLabels.HelloAsso,
    (f) => (f.action = 'https://evil.example'),
    (f) => (f.texts.extra = 'x'),
    (f) => (f.groupOptions[0].value = '"><script>'),
    (f) => (f.contactHref = 'javascript:alert(1)'),
    (f) => (f.texts.nextSteps.steps = [['un'], ['deux']]),
  ]) {
    const copy = clone(demo);
    mutate(copy.pages.find((p) => p.id === 'inscription').sections.find((s) => s.type === 'registration'));
    assert.throws(() => validateSite(copy), undefined, String(mutate));
  }
});
