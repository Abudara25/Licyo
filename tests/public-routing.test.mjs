// Phase 4D.2B (durcissement) : site public routé par la configuration PUBLIÉE de l'organisation du domaine, sans
// aucun secours inter-organisation, et actualités isolées par organisation. Requêtes HTTP réelles sur les Functions
// (functions/[[path]].js, functions/actualites/[slug].js, functions/api/actualites.js), base D1 simulée (node:sqlite).
// A = Sportville ; B = « Atelier Exemple » (tests/fixtures, jamais en production) ; C = organisation sans site publié.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest as catchAll } from '../functions/[[path]].js';
import { onRequest as rootMiddleware } from '../functions/_middleware.js';
import { setNewsSourcesForTests } from '../functions/_shared/news.js';
import { onRequestGet as articleFunction } from '../functions/actualites/[slug].js';
import { onRequestGet as newsApi } from '../functions/api/actualites.js';
import { readSiteConfig, saveDraftSiteConfig, publishSiteConfig, clearPublishedSiteCache } from '../functions/_shared/site-config.js';
import { clearPageDataCache } from '../functions/_shared/page-data.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { site as demoSite } from '../sites/club-demo/site.js';
import { exempleSite } from './fixtures/site-exemple.mjs';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = exempleSite.organizationId;
const C = 'org_sans_publication';
const A_HOST = 'clubdemo.licyo.fr';
const B_HOST = 'atelier.example';
const C_HOST = 'sans-publication.example';
const UNKNOWN_HOST = 'inconnu.example';
const clone = (value) => JSON.parse(JSON.stringify(value));

// Fichiers publiés (binding ASSETS) : pages statiques générées de Sportville, un asset, et — comme dans un
// ancien déploiement — le fichier d'actualités de Sportville sous /content/ (le middleware racine doit le refuser).
// Toute autre URL : la 404 statique de Sportville, comme Pages.
// Actualités (lues par les Functions seulement) : A et B ont un article de même slug « demo ».
const STATIC_PAGES = Object.fromEntries(demoSite.pages.map((p) => [p.route, p.file]));
const NEWS = {
  [A]: { articles: [{ slug: 'demo', title: 'Article du club DEMO', date: '2026-09-01', category: 'club', excerpt: 'Résumé DEMO', body: 'Texte DEMO.' }] },
  [B]: { articles: [{ slug: 'demo', title: 'Article de l’atelier', date: '2026-09-02', category: 'vie', excerpt: 'Résumé atelier', body: 'Texte atelier.' }] },
};
const html = (file, status = 200) =>
  new Response(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'DENY' } });
const ASSETS = {
  fetch: async (input) => {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input));
    if (/^\/content\//i.test(decodeURIComponent(pathname).replace(/\/+/g, '/'))) return new Response(JSON.stringify(NEWS[A]), { headers: { 'Content-Type': 'application/json' } });
    if (pathname === '/assets/css/styles.css') return new Response('body{}', { headers: { 'Content-Type': 'text/css' } });
    if (pathname === '/admin/') return new Response('<p>CMS</p>', { headers: { 'Content-Type': 'text/html' } });
    if (STATIC_PAGES[pathname]) return html(STATIC_PAGES[pathname]);
    return html('404.html', 404);
  },
};

async function setup() {
  setNewsSourcesForTests(NEWS);
  clearPublishedSiteCache();
  clearPageDataCache();
  clearOrganizationCache();
  const env = { ...(await fixture()), ASSETS };
  for (const [id, host, name] of [[B, B_HOST, 'Atelier Exemple'], [C, C_HOST, 'Sans Publication']]) {
    await env.DB.prepare('INSERT INTO organizations (id, slug, name) VALUES (?, ?, ?)').bind(id, id.replaceAll('_', '-'), name).run();
    await env.DB.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(host, id).run();
  }
  await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
  await publishSiteConfig(env, B);
  return env;
}

const get = async (env, host, path, init) => {
  const request = new Request(`https://${host}${path}`, init);
  const article = /^\/actualites\/([^/]+)$/.exec(path);
  // Comme Pages : middleware racine d'abord, puis la Function la plus précise, sinon le catch-all.
  const next = () => {
    if (article) return articleFunction({ request, params: { slug: article[1] }, env });
    if (path === '/api/actualites') return newsApi({ request, env });
    return catchAll({ request, env });
  };
  const response = await rootMiddleware({ request, env, next });
  return { status: response.status, headers: response.headers, body: await response.text() };
};

// Traces de Sportville qui ne doivent jamais apparaître chez une autre organisation (marque, navigation, SEO, textes).
const DEMO_TRACES = /Sportville|licyo|Stade municipal|Le Club|Mentions légales|Article du club DEMO|U6-U7/;

// --- P1 #1 : aucun secours inter-organisation ----------------------------------------------------------------------

test('domaine inconnu : 404 neutre partout, jamais de contenu de Sportville', async () => {
  const env = await setup();
  for (const path of ['/', '/equipe', '/equipe.html', '/ateliers', '/404', '/actualites/demo', '/content/articles.json', '/api/inconnue', '/favicon.png']) {
    const res = await get(env, UNKNOWN_HOST, path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body, DEMO_TRACES, path);
  }
  assert.equal((await get(env, UNKNOWN_HOST, '/api/actualites')).status, 404);
});

test('organisation sans version publiée : 404 neutre, aucun fichier statique de Sportville', async () => {
  const env = await setup();
  // Même un brouillon enregistré ne rend rien public.
  await saveDraftSiteConfig(env, C, { ...clone(exempleSite), organizationId: C }, { expectedRevision: 0 });
  for (const path of ['/', '/equipe', '/ateliers', '/inscription', '/404.html', '/actualites/demo']) {
    const res = await get(env, C_HOST, path);
    assert.equal(res.status, 404, path);
    assert.doesNotMatch(res.body, DEMO_TRACES, path);
    assert.doesNotMatch(res.body, /Atelier Exemple/, `${path} : brouillon jamais public`);
  }
});

test('erreur de base : 503 neutre pour une autre organisation, secours statique pour Sportville seulement', async (t) => {
  const env = await setup();
  await get(env, B_HOST, '/'); // organisations résolues (cache 60 s)
  t.mock.method(console, 'warn', () => {});
  clearPublishedSiteCache();
  const prepare = env.DB.prepare.bind(env.DB);
  t.mock.method(env.DB, 'prepare', (sql) => {
    if (/site_configs/.test(sql)) throw new Error('D1 indisponible');
    return prepare(sql);
  });
  for (const path of ['/', '/ateliers', '/equipe', '/inconnue']) {
    const res = await get(env, B_HOST, path);
    assert.equal(res.status, 503, path);
    assert.doesNotMatch(res.body, DEMO_TRACES, path);
    assert.doesNotMatch(res.body, /Atelier Exemple/, path);
  }
  const sg = await get(env, A_HOST, '/equipe');
  assert.equal(sg.status, 200);
  assert.match(sg.body, /Club Démo/, 'Sportville : secours statique sur son propre domaine');

  // Base entièrement inaccessible (organisation non résolue) : seuls les domaines de Sportville ont un secours.
  clearOrganizationCache();
  env.DB.prepare.mock.mockImplementation(() => {
    throw new Error('D1 indisponible');
  });
  assert.equal((await get(env, B_HOST, '/')).status, 503);
  assert.doesNotMatch((await get(env, B_HOST, '/')).body, DEMO_TRACES);
  assert.equal((await get(env, 'nouveau-domaine.example', '/')).status, 503);
  assert.equal((await get(env, A_HOST, '/')).status, 200);
  assert.equal((await get(env, `www.${A_HOST}`, '/equipe')).status, 200);
});

test('version publiée invalide (altérée en base) : 503 neutre, jamais servie ni remplacée par Sportville', async (t) => {
  const env = await setup();
  t.mock.method(console, 'warn', () => {});
  const altered = clone(exempleSite);
  altered.pages[0].sections[0].type = 'inconnu';
  const json = JSON.stringify(altered);
  await env.DB.prepare('UPDATE site_configs SET published_json = ? WHERE organization_id = ?').bind(json, B).run();
  clearPublishedSiteCache();
  for (const path of ['/', '/ateliers', '/inconnue']) {
    const res = await get(env, B_HOST, path);
    assert.equal(res.status, 503, path);
    assert.doesNotMatch(res.body, DEMO_TRACES, path);
  }
  assert.equal((await get(env, B_HOST, '/actualites/demo')).status, 503);
});

// --- P1 #2 : routage piloté par la configuration publiée ------------------------------------------------------------

test('organisation B : ses routes (même absentes des fichiers statiques) servies depuis SA version publiée', async () => {
  const env = await setup();
  const home = await get(env, B_HOST, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Atelier Exemple/);
  assert.doesNotMatch(home.body, DEMO_TRACES);
  assert.equal(home.headers.get('X-Frame-Options'), 'DENY', 'en-têtes de sécurité des pages statiques');

  const ateliers = await get(env, B_HOST, '/ateliers');
  assert.equal(ateliers.status, 200, 'route propre à B, sans Function ni fichier dédiés');
  assert.match(ateliers.body, /Atelier Exemple/);
  assert.equal((await get(env, B_HOST, '/ateliers', { method: 'HEAD' })).body, '');
});

test('route inconnue ou route de Sportville chez B : 404 de B (sa page), jamais la page de Sportville', async () => {
  const env = await setup();
  for (const path of ['/equipe', '/equipe.html', '/inscription', '/inconnue', '/404', '/404.html', '/api/inexistante']) {
    const res = await get(env, B_HOST, path);
    assert.equal(res.status, 404, path);
    assert.match(res.body, /Atelier Exemple/, `${path} : 404 de B`);
    assert.doesNotMatch(res.body, DEMO_TRACES, path);
  }
  // Sportville : sa propre 404, sur son domaine.
  const sg = await get(env, A_HOST, '/ateliers');
  assert.equal(sg.status, 404);
  assert.match(sg.body, /Club Démo/);
  assert.doesNotMatch(sg.body, /Atelier Exemple/);
});

test('route ajoutée, renommée ou retirée dans la version publiée : effet immédiat, fichiers statiques ignorés', async () => {
  const env = await setup();
  await readSiteConfig(env, A);
  const edited = clone(demoSite);
  edited.pages.find((p) => p.route === '/equipe').route = '/le-club';
  edited.pages = edited.pages.filter((p) => p.route !== '/partenaires');
  await saveDraftSiteConfig(env, A, edited, { expectedRevision: 1 });

  // Brouillon seulement : rien ne change en public.
  assert.equal((await get(env, A_HOST, '/equipe')).status, 200);
  assert.equal((await get(env, A_HOST, '/le-club')).status, 404, 'brouillon jamais lu par le site public');

  await publishSiteConfig(env, A);
  const renamed = await get(env, A_HOST, '/le-club');
  assert.equal(renamed.status, 200, 'route ajoutée / renommée');
  assert.match(renamed.body, /Club Démo/);
  assert.equal((await get(env, A_HOST, '/equipe')).status, 404, 'ancienne route : 404 même si equipe.html existe');
  assert.equal((await get(env, A_HOST, '/partenaires')).status, 404, 'route retirée');
  const legacy = await get(env, A_HOST, '/equipe.html');
  assert.equal(legacy.status, 308, 'ancien fichier : redirigé vers la route publiée');
  assert.equal(legacy.headers.get('Location'), '/le-club');
  assert.equal((await get(env, A_HOST, '/entrainements')).status, 200, 'les autres routes restent servies');
});

test('Sportville, version publiée = référence : fichier statique servi tel quel ; .html et / final redirigés', async () => {
  const env = await setup();
  const res = await get(env, A_HOST, '/partenaires');
  assert.equal(res.status, 200);
  assert.equal(res.body, readFileSync('partenaires.html', 'utf8').replaceAll('\r\n', '\n'));
  const index = await get(env, A_HOST, '/index.html');
  assert.equal(index.status, 308);
  assert.equal(index.headers.get('Location'), '/');
  const slash = await get(env, A_HOST, '/equipe/?x=1');
  assert.equal(slash.status, 308);
  assert.equal(slash.headers.get('Location'), '/equipe?x=1');
});

test('assets et chemins techniques : transmis au serveur statique sans lecture de configuration', async () => {
  const env = await setup();
  const css = await get(env, B_HOST, '/assets/css/styles.css');
  assert.equal(css.status, 200);
  assert.equal(css.body, 'body{}');
  assert.equal((await get(env, A_HOST, '/admin/')).status, 200, 'CMS de Sportville sur son domaine');
  const cms = await get(env, B_HOST, '/admin/');
  assert.equal(cms.status, 404, 'CMS de Sportville refusé aux autres domaines');
  assert.doesNotMatch(cms.body, /CMS|Sportville/);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const res = await catchAll({ request: new Request(`https://${B_HOST}/assets/css/styles.css`, { method }), env });
    assert.equal(res.status, 405, `${method} : 405 neutre, jamais transmise au serveur statique`);
    assert.equal(await res.text(), '');
  }
});

// --- P1 #3 : actualités isolées par organisation -------------------------------------------------------------------

test('actualités : même slug chez A et B, chacun ne voit que le sien (détail)', async () => {
  const env = await setup();
  const a = await get(env, A_HOST, '/actualites/demo');
  assert.equal(a.status, 200);
  assert.match(a.body, /Article du club DEMO/);
  assert.doesNotMatch(a.body, /Article de l’atelier/);

  const b = await get(env, B_HOST, '/actualites/demo');
  assert.equal(b.status, 200);
  assert.match(b.body, /Article de l’atelier/);
  assert.match(b.body, /Atelier Exemple/);
  assert.doesNotMatch(b.body, DEMO_TRACES);
});

test('actualités : liste propre à chaque organisation, jamais un fichier commun', async () => {
  const env = await setup();
  const list = async (host) => JSON.parse((await get(env, host, '/api/actualites')).body).articles.map((x) => x.title);
  assert.deepEqual(await list(A_HOST), ['Article du club DEMO']);
  assert.deepEqual(await list(B_HOST), ['Article de l’atelier']);
  assert.deepEqual(await list(C_HOST), [], 'organisation sans actualités : liste vide, jamais celles d’une autre');
  // Le navigateur ne choisit rien : un paramètre ou un en-tête ne change pas l'organisation.
  const forged = await newsApi({ request: new Request(`https://${B_HOST}/api/actualites?organization_id=${A}`, { headers: { 'X-Organization-Id': A } }), env });
  assert.deepEqual((await forged.json()).articles.map((x) => x.title), ['Article de l’atelier']);
});

test('actualités : article de Sportville introuvable depuis B et depuis C ; fichiers de contenu réservés', async () => {
  const env = await setup();
  NEWS[A].articles.push({ slug: 'seulement-demo', title: 'Réservé DEMO', date: '2026-09-03', category: 'club', excerpt: 'x', body: 'y' });
  try {
    const fromB = await get(env, B_HOST, '/actualites/seulement-demo');
    assert.equal(fromB.status, 404);
    assert.match(fromB.body, /Atelier Exemple/, '404 de B');
    assert.doesNotMatch(fromB.body, /Réservé DEMO|Sportville/);
    const fromC = await get(env, C_HOST, '/actualites/seulement-demo');
    assert.equal(fromC.status, 404);
    assert.doesNotMatch(fromC.body, /Réservé DEMO|Sportville/);
    assert.equal((await get(env, A_HOST, '/actualites/seulement-demo')).status, 200);
  } finally {
    NEWS[A].articles.pop();
  }
});

test('fichiers source des actualités : jamais téléchargeables (écritures, casse, encodages, méthodes, domaines)', async () => {
  const env = await setup();
  const paths = ['/content/articles.json', '/content//articles.json', '//content/articles.json', '/Content/articles.json', '/%63ontent/articles.json',
    '/content%2Farticles.json', '/CONTENT/articles.json', '/content/./articles.json', '/assets/..%2fcontent/articles.json', `/content/organizations/${B}/articles.json`];
  for (const host of [UNKNOWN_HOST, B_HOST, C_HOST, A_HOST]) {
    for (const path of paths) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'DELETE']) {
        const res = await get(env, host, path, { method });
        assert.equal(res.status, 404, `${method} ${host}${path}`);
        assert.doesNotMatch(res.body, /Article du club DEMO|articles/, `${method} ${host}${path}`);
      }
    }
  }
});

test('actualités : fichier illisible → 503 ; slug hostile → 404 de l’organisation', async (t) => {
  const env = await setup();
  t.mock.method(console, 'warn', () => {});
  assert.equal((await get(env, A_HOST, '/actualites/..%2Fadmin')).status, 404);
  setNewsSourcesForTests({ ...NEWS, [B]: { articles: 'pas une liste' } });
  assert.equal((await get(env, B_HOST, '/actualites/demo')).status, 503);
  assert.equal((await get(env, B_HOST, '/api/actualites')).status, 503);
  assert.equal((await get(env, A_HOST, '/api/actualites')).status, 200, 'A non concernée');
});
