// Moteur de site générique (phase 4D.1) : fonction pure, validation en échec fermé, échappement, parité des
// pages publiques, second site fictif, résolution du site par organisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderSitePage, renderPage, resolvePage, validateSite } from '../renderer/render.js';
import { newsArticlePage } from '../renderer/news.js';
import { escapeAttr, escapeStrict, escapeText, jsonLd, jsonLdCompact, safeAbsoluteUrl, safeAssetPath, safeHref } from '../renderer/html.js';
import { SITES, siteForOrganization } from '../sites/index.js';
import { buildPages } from '../scripts/build-pages.mjs';
import { onRequestGet as articleFunction } from '../functions/actualites/[slug].js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { setNewsSourcesForTests } from '../functions/_shared/news.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture } from './helpers/inscriptions.mjs';
import { exempleSite, EXEMPLE_ASSET_VERSIONS } from './fixtures/site-exemple.mjs';

const clone = (value) => structuredClone(value);
const render = (site, route = '/', extra = {}) => renderSitePage({ site, route, locale: 'fr-FR', assetVersions: EXEMPLE_ASSET_VERSIONS, ...extra });
const demo = siteForOrganization(DEMO_ORG_ID);

// --- Parité des pages publiques ---------------------------------------------------------------------------

test('pages publiques : les fichiers HTML versionnés sont exactement la sortie du moteur (npm run pages)', () => {
  for (const { file, html } of buildPages()) {
    assert.equal(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), html, `${file} : lancer npm run pages`);
  }
});

test('pages publiques : chaque page HTML de la racine est déclarée par la configuration (aucune page écrite à la main)', () => {
  const declared = new Set(demo.pages.map((p) => p.file));
  assert.deepEqual(readdirSync('.').filter((n) => n.endsWith('.html')).sort(), [...declared].sort());
});

// Structure DOM minimale de chaque page générée (sans dépendance : comptage des balises).
test('structure : un seul header, nav, main, footer, un titre, une canonical au plus, identifiants uniques', () => {
  for (const { file, html } of buildPages().filter((p) => p.file.endsWith('.html'))) {
    const count = (re) => (html.match(re) || []).length;
    assert.equal(count(/<header class="site-header">/g), 1, `${file} header`);
    assert.equal(count(/<nav class="main-nav"/g), 1, `${file} nav`);
    assert.equal(count(/<main id="main">/g), 1, `${file} main`);
    assert.equal(count(/<\/main>/g), 1, `${file} /main`);
    assert.equal(count(/<footer class="site-footer">/g), 1, `${file} footer`);
    assert.equal(count(/<title>/g), 1, `${file} title`);
    assert.ok(count(/rel="canonical"/g) <= 1, `${file} canonical`);
    assert.ok(html.startsWith('<!DOCTYPE html>\n<html lang="fr">'), `${file} doctype`);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${file} identifiants en double : ${ids.filter((id, i) => ids.indexOf(id) !== i)}`);
  }
});

test('navigation : même header et même footer complet sur toutes les pages (une seule source)', () => {
  const pages = buildPages().filter((p) => p.file.endsWith('.html'));
  const block = (html, tag) => html.match(new RegExp(`<${tag} class="site-${tag}">[\\s\\S]*?</${tag}>`))[0];
  const header = block(pages[0].html, 'header');
  for (const { file, html } of pages) assert.equal(block(html, 'header'), header, file);
  const full = pages.filter((p) => p.file !== '404.html').map((p) => block(p.html, 'footer'));
  assert.equal(new Set(full).size, 1);
});

// --- Fonction pure, routes, échec fermé -----------------------------------------------------------------

test('route connue : 200 ; route inconnue : page 404 du même site, statut 404', () => {
  assert.equal(render(exempleSite, '/').status, 200);
  const missing = render(exempleSite, '/nimporte-quoi');
  assert.equal(missing.status, 404);
  assert.equal(missing.page.id, 'introuvable');
  assert.match(missing.html, /Page introuvable — Atelier Exemple/);
  assert.equal(resolvePage(exempleSite, '/404').status, 404);
});

test('rendu déterministe et sans effet de bord : même entrée, même sortie, configuration intacte', () => {
  const before = JSON.stringify(exempleSite);
  assert.equal(render(exempleSite).html, render(exempleSite).html);
  assert.equal(JSON.stringify(exempleSite), before);
});

test('aucun site : rendu refusé, jamais de site par défaut', () => {
  assert.throws(() => render(null), /Aucun site/);
  assert.throws(() => render(undefined), /Aucun site/);
  assert.equal(siteForOrganization('org_inconnue'), null);
  assert.equal(siteForOrganization(undefined), null);
  assert.equal(siteForOrganization('__proto__'), null);
  assert.equal(siteForOrganization(exempleSite.organizationId), null, 'le site fictif n’est jamais enregistré');
  assert.deepEqual(Object.keys(SITES), [DEMO_ORG_ID]);
});

test('validation : schemaVersion, thème, version, section inconnue, routes et identifiants en double sont refusés', () => {
  const cases = [
    [(s) => (s.schemaVersion = 1), /schemaVersion 1 inconnue/],
    [(s) => (s.schemaVersion = 3), /schemaVersion 3 inconnue/],
    [(s) => delete s.schemaVersion, /schemaVersion/],
    [(s) => (s.theme.id = 'autre'), /thème inconnu/],
    [(s) => (s.theme.version = 2), /version de thème inconnue/],
    [(s) => s.pages[1].sections.push({ type: 'carrousel' }), /type de section inconnu : carrousel/],
    [(s) => (s.pages[1].route = '/'), /route en double/],
    [(s) => (s.pages[1].id = 'accueil'), /id en double/],
    [(s) => (s.pages[1].file = 'index.html'), /file en double/],
    [(s) => (s.pages[1].route = '/Ateliers'), /route invalide/],
    [(s) => (s.pages[1].route = '/../admin'), /route invalide/],
    [(s) => (s.notFoundPage = 'absente'), /page 404 introuvable/],
    [(s) => (s.navigation.items[0].href = 'javascript:alert(1)'), /URL refusée/],
    [(s) => (s.social[0].network = 'myspace'), /réseau inconnu/],
    [(s) => (s.pages[0].sections[0].actions[0].style = 'fluo'), /style inconnu/],
    [(s) => (s.pages[1].sections = []), /sections requises/],
    [(s) => (s.pages[1].sections[0].comment = 'fin -->'), /commentaire invalide/],
    [(s) => (s.pages[1].scripts = ['https://cdn.example/x.js']), /script refusé/],
    [(s) => (s.seo.siteUrl = 'http://atelier.example'), /non https/],
    [(s) => (s.brand.logo.small = '../secret.png'), /asset refusé/],
    [(s) => (s.news.categories.vie.icon = 'inconnue'), /icône inconnue/],
  ];
  for (const [mutate, expected] of cases) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), expected, String(mutate));
  }
});

test('validation : toutes les erreurs sont listées ensemble', () => {
  const site = clone(exempleSite);
  site.theme.id = 'autre';
  site.pages[1].sections.push({ type: 'carrousel' });
  assert.throws(() => validateSite(site), (error) => /thème inconnu/.test(error.message) && /carrousel/.test(error.message));
});

test('fragments et HTML brut : le type « fragment » et toute clé HTML sont refusés', () => {
  const cases = [
    (s) => s.pages[1].sections.push({ type: 'fragment', id: 'ateliers.corps', name: 'corps' }),
    (s) => s.pages[1].sections.push({ type: 'html', id: 'ateliers.html', value: '<p>x</p>' }),
    (s) => s.pages[1].sections.push({ type: 'custom', id: 'ateliers.custom', markup: '<p>x</p>' }),
    (s) => (s.pages[1].sections[1].rawHtml = '<p>x</p>'),
    (s) => (s.pages[1].sections[1].html = '<p>x</p>'),
    (s) => (s.pages[1].sections[1].blocks[0].markup = '<p>x</p>'),
    (s) => (s.pages[1].sections[1].blocks[0].template = '{{x}}'),
    (s) => (s.pages[1].sections[1].blocks[0].class = 'x'),
    (s) => (s.pages[1].sections[1].blocks[0].style = 'color:red'),
    (s) => s.pages[1].sections[1].blocks.push({ type: 'html', value: '<script>alert(1)</script>' }),
    (s) => s.pages[1].sections[1].blocks.push({ type: 'script', src: 'x.js' }),
    (s) => (s.trust = { fragments: 'code' }),
  ];
  for (const mutate of cases) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => validateSite(site), undefined, String(mutate));
  }
});

test('publicData séparées de la configuration : le moteur n’y lit rien de plus que ce qui est déclaré', () => {
  const a = render(exempleSite, '/', { publicData: { groups: [{ name: 'X' }] } }).html;
  assert.equal(a, render(exempleSite, '/').html);
});

// --- Second site fictif --------------------------------------------------------------------------------

test('second site fictif : identité, navigation, hero, coordonnées et bouton propres, aucune trace de Sportville', () => {
  for (const page of exempleSite.pages) {
    const { html } = render(exempleSite, page.route);
    assert.doesNotMatch(html, /Sportville|Sport ville|DEMO|licyo|Club de démonstration|Stade municipal|U6|U8/i, page.id);
    assert.match(html, /<strong>Atelier Exemple<\/strong><span>Quartier des Tilleuls<\/span>/);
    assert.match(html, /<a href="\/reserver" class="btn btn-primary btn-sm nav-cta">Réserver<\/a>/);
    assert.match(html, /assets\/images\/exemple\/logo-96\.webp/);
    assert.match(html, /<meta name="theme-color" content="#123456">/);
  }
  const home = render(exempleSite, '/').html;
  assert.match(home, /<h1>Façonner <em>ensemble<\/em><\/h1>/);
  assert.match(home, /<link rel="canonical" href="https:\/\/atelier\.example\/">/);
  assert.match(home, /href="mailto:bonjour@atelier\.example"[^>]*>bonjour@atelier\.example<\/a>/);
  assert.match(home, /href="tel:\+33102030405"[^>]*>01 02 03 04 05<\/a>/);
  assert.match(home, /<h3>Plan du site<\/h3>/);
  assert.doesNotMatch(home, /adhesion-cta/, 'pas de crochet d’état sans statusHook');
});

test('second site fictif : mode « static » sans aucun marqueur data-org', () => {
  const markers = render(exempleSite, '/').html;
  const staticHtml = render(exempleSite, '/', { mode: 'static', base: '/' }).html;
  assert.match(markers, /data-org-if="org\.email"/);
  assert.doesNotMatch(staticHtml, /data-org/);
  assert.match(staticHtml, /href="\/assets\/css\/styles\.css\?v=aaaaaaaaaa"/);
});

test('second site fictif : page d’actualité avec ses propres libellés et son domaine', () => {
  const page = newsArticlePage(exempleSite, { slug: 'portes-ouvertes', title: 'Portes ouvertes', date: '2026-10-01', category: 'inconnue', excerpt: 'Venez.', body: 'Un.\n\nDeux.' });
  const html = renderPage({ site: exempleSite, page, locale: 'fr-FR', assetVersions: EXEMPLE_ASSET_VERSIONS });
  assert.match(html, /<link rel="canonical" href="https:\/\/atelier\.example\/journal\/portes-ouvertes">/);
  assert.match(html, /<span class="eyebrow">Vie de l&#39;atelier<\/span>/);
  assert.match(html, /<p>Un\.<\/p>\n {12}<p>Deux\.<\/p>/);
  assert.match(html, /href="\/journal" class="card-link">Retour au journal/);
  assert.match(html, /<p>1 octobre 2026<\/p>/);
  assert.doesNotMatch(html, /Sportville|licyo/);
});

// --- Anti-codage en dur ----------------------------------------------------------------------------------

test('le moteur ne contient aucune valeur propre à Sportville', () => {
  const forbidden = ['Sportville', 'Sport ville', 'DEMO', 'clubdemo.licyo.fr', 'contact@clubdemo.licyo.fr', 'org_demo', 'Stade municipal', 'U6-U7'];
  for (const name of readdirSync('renderer')) {
    const source = readFileSync(join('renderer', name), 'utf8');
    for (const word of forbidden) assert.ok(!source.toLowerCase().includes(word.toLowerCase()), `renderer/${name} contient « ${word} »`);
    assert.doesNotMatch(source, /\beval\s*\(|new Function\s*\(/, `renderer/${name}`);
    assert.doesNotMatch(source, /from 'node:|process\.env|env\.DB|env\.ASSETS|\bfetch\s*\(|new Request|Request\b.*url/, `renderer/${name} : dépendance d'exécution`);
  }
});

test('la configuration d’un site ne contient aucun secret', () => {
  const walk = (value, path) => {
    if (Array.isArray(value)) return value.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (value && typeof value === 'object') {
      for (const [key, v] of Object.entries(value)) {
        assert.doesNotMatch(key, /secret|token|password|passwd|credential|api_?key|oauth|client_?id/i, `${path}.${key}`);
        walk(v, `${path}.${key}`);
      }
    } else if (typeof value === 'string') {
      assert.doesNotMatch(value, /Bearer |sk_live|-----BEGIN|[0-9a-f]{32,}/i, path);
    }
  };
  for (const site of [...Object.values(SITES), exempleSite]) walk(site, site.id);
});

// --- Échappement et URL ----------------------------------------------------------------------------------

const HOSTILE = `<script>alert("x")</script> & ' " javascript:`;

test('échappement : texte, attribut, strict et JSON-LD', () => {
  assert.equal(escapeText('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(escapeAttr('"><img>'), '&quot;&gt;&lt;img&gt;');
  assert.equal(escapeStrict(`'"<>&`), '&#39;&quot;&lt;&gt;&amp;');
  assert.doesNotMatch(jsonLd({ t: '</script><b>' }), /<\//);
  assert.doesNotMatch(jsonLdCompact({ t: '</script><b>' }), /</);
});

test('URL : seuls les chemins du site, ancres, https/http, mailto et tel sont acceptés', () => {
  for (const ok of ['/', '/contact', '#main', 'https://example.org/a?b=1', 'mailto:a@b.fr', 'tel:+33102030405']) assert.equal(safeHref(ok), ok);
  for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:x', 'data:text/html,<b>', 'vbscript:x', '//evil.example', '/../admin', '/a/./b', 'contact', 'https://', '/a b', '/a\\b', 'mailto:<x>', 'tel:abc', 'file:///etc/passwd', '']) {
    assert.throws(() => safeHref(bad), /refusé/, bad);
  }
  for (const bad of ['../x.png', 'assets/../x.png', '/assets/images/x.png', 'assets/images//x.png', 'https://evil.example/x.png', 'data:image/png;base64,AA', 'assets/js/main.js', 'assets/images/x".png']) {
    assert.throws(() => safeAssetPath(bad), /refusé/, bad);
  }
  for (const bad of ['http://example.org', 'javascript:alert(1)', 'data:text/html,x', 'https://a.example/\u0000']) assert.throws(() => safeAbsoluteUrl(bad), undefined, bad);
});

test('valeurs hostiles dans la configuration : échappées dans le texte, le SEO et les attributs, jamais exécutables', () => {
  const site = clone(exempleSite);
  site.brand.name = HOSTILE;
  site.brand.tagline = HOSTILE;
  site.brand.logo.alt = HOSTILE;
  site.navigation.items[0].label = HOSTILE;
  site.pages[0].seo.title = HOSTILE;
  site.pages[0].seo.description = HOSTILE;
  site.pages[0].seo.ogTitle = HOSTILE;
  site.pages[0].sections[0].eyebrow = HOSTILE;
  site.pages[0].sections[0].lead = [HOSTILE];
  site.footer.about = [HOSTILE];
  const { html } = render(site, '/');
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /content="[^"]*"[^ >]/, 'attribut refermé par une valeur');
  assert.match(html, /<title>&lt;script&gt;alert\("x"\)&lt;\/script&gt; &amp; ' " javascript:<\/title>/);
  assert.match(html, /<meta name="description" content="&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; ' &quot; javascript:">/);
});

test('URL hostiles dans la configuration : refusées, aucune page produite', () => {
  for (const mutate of [
    (s) => (s.pages[0].sections[0].actions[0].href = 'javascript:alert(1)'),
    (s) => (s.pages[0].sections[0].actions[0].href = 'data:text/html,<script>'),
    (s) => (s.footer.bottom[1].content[0].link.href = 'javascript:alert(1)'),
    (s) => (s.pages[0].sections[0].emblem.src = 'javascript:alert(1)'),
    (s) => (s.pages[0].sections[0].emblem.src = '../../etc/passwd'),
    (s) => (s.seo.ogImage.url = 'javascript:alert(1)'),
    (s) => (s.contact.email = 'x"><script>@a.fr'),
    (s) => (s.pages[0].sections[0].lead = [{ link: { href: 'javascript:x', children: ['a'] } }]),
    (s) => (s.pages[0].sections[0].lead = [{ bind: { tag: 'script', attrs: [], children: ['a'] } }]),
    (s) => (s.pages[0].sections[0].lead = [{ bind: { tag: 'span', attrs: [['onclick', 'x']], children: ['a'] } }]),
    (s) => (s.pages[0].sections[0].lead = [{ bind: { tag: 'span', attrs: [['data-org', 'a"b']], children: ['a'] } }]),
    (s) => (s.pages[0].sections[0].lead = [{ html: '<b>x</b>' }]),
    (s) => (s.pages[0].sections[0].lead = [{ hook: { attr: 'onload', children: ['x'] } }]),
  ]) {
    const site = clone(exempleSite);
    mutate(site);
    assert.throws(() => render(site, '/'), undefined, String(mutate));
  }
});

test('actualité : contenu hostile du CMS échappé (strict), image hors /assets/images refusée', () => {
  const article = { slug: 'test', title: HOSTILE, date: '2026-09-01', category: 'vie', excerpt: HOSTILE, body: `${HOSTILE}\n\n<img src=x onerror=alert(1)>` };
  const html = renderPage({ site: exempleSite, page: newsArticlePage(exempleSite, article), locale: 'fr-FR', assetVersions: EXEMPLE_ASSET_VERSIONS });
  assert.doesNotMatch(html, /<script>alert|<img src=x/);
  assert.match(html, /<h1>&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39; &quot; javascript:<\/h1>/);
  assert.match(html, /"headline":"\\u003cscript>alert\(\\"x\\"\)\\u003c\/script> & ' \\" javascript:"/);
  for (const image of ['javascript:alert(1)', 'https://evil.example/x.png', '/assets/images/../../admin', '/assets/images//x', '/assets/images/x".png', '/admin/x.png', 'data:image/png;base64,AA']) {
    assert.throws(() => renderPage({ site: exempleSite, page: newsArticlePage(exempleSite, { ...article, image }), locale: 'fr-FR', assetVersions: EXEMPLE_ASSET_VERSIONS }), undefined, image);
  }
  assert.throws(() => newsArticlePage(exempleSite, { ...article, slug: '../admin' }), /Slug/);
});

// --- Function des actualités : organisation résolue, échec fermé ------------------------------------------

async function articleEnv() {
  clearOrganizationCache();
  const env = await fixture();
  setNewsSourcesForTests({ [DEMO_ORG_ID]: { articles: [{ slug: 'demo', title: 'Démo', date: '2026-09-01', category: 'club', excerpt: 'Résumé', body: 'Texte.' }] } });
  env.ASSETS = {
    fetch: async (url) => {
      const { pathname } = new URL(url);
      if (pathname === '/404.html') return new Response('page 404', { headers: { 'Content-Type': 'text/html' } });
      return new Response('introuvable', { status: 404 });
    },
  };
  return env;
}
const callArticle = (env, host, slug = 'demo') => articleFunction({ request: new Request(`https://${host}/actualites/${slug}`), params: { slug }, env });

test('actualité : domaine de Sportville → page rendue avec la configuration du site', async () => {
  const env = await articleEnv();
  const response = await callArticle(env, 'clubdemo.licyo.fr');
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Démo — Club Démo<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/clubdemo\.licyo\.fr\/actualites\/demo">/);
  assert.doesNotMatch(html, /data-org/);
});

test('actualité : domaine inconnu → 404, jamais le site de Sportville', async () => {
  const env = await articleEnv();
  const response = await callArticle(env, 'inconnu.example');
  assert.equal(response.status, 404);
  const html = await response.text();
  assert.doesNotMatch(html, /Sportville|page 404|Démo/, 'réponse neutre : ni la page 404 statique ni l’article de Sportville');
});

test('actualité : organisation active sans site configuré → 404', async () => {
  const env = await articleEnv();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES ('org_sans_site', 'sans-site', 'Sans site')").run();
  await env.DB.prepare("INSERT INTO organization_domains (domain, organization_id) VALUES ('sans-site.example', 'org_sans_site')").run();
  const response = await callArticle(env, 'sans-site.example');
  assert.equal(response.status, 404);
});

test('actualité : base indisponible → 503, aucun site deviné', async () => {
  const env = await articleEnv();
  env.DB = { prepare() { throw new Error('D1 en panne'); }, batch() { throw new Error('D1 en panne'); } };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const response = await callArticle(env, 'clubdemo.licyo.fr');
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /Sportville/);
  } finally {
    console.warn = warn;
  }
});

test('actualité : article inconnu → vraie 404', async () => {
  const env = await articleEnv();
  assert.equal((await callArticle(env, 'clubdemo.licyo.fr', 'absent')).status, 404);
});
