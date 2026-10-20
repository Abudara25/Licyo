// Éditeur de site et site de départ (2026-10-20) : un club créé depuis la console a aussitôt un site publié, à ses
// couleurs, sans aucune trace du club de démo ; il le modifie en brouillon dans « Site web », le prévisualise, puis le
// publie. Le club de démo (configuration écrite à la main) ne peut modifier que des champs sûrs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest as catchAll } from '../functions/[[path]].js';
import { onRequest as rootMiddleware } from '../functions/_middleware.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as plateforme from '../functions/admin/plateforme.js';
import * as siteAdmin from '../functions/admin/site.js';
import * as apercu from '../functions/admin/site/apercu.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { readSiteConfig, clearPublishedSiteCache } from '../functions/_shared/site-config.js';
import { clearPageDataCache } from '../functions/_shared/page-data.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { setNewsSourcesForTests } from '../functions/_shared/news.js';
import { buildStarterSite } from '../sites/starter.js';
import { validateSite } from '../renderer/validate.js';
import { renderPage } from '../renderer/render.js';
import { paletteVariables, contrast } from '../renderer/palette.js';
import { ASSET_VERSIONS } from '../functions/_shared/asset-versions.js';
import { site as demoSite } from '../sites/club-demo/site.js';
import { fixture } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';

const DEMO = 'https://clubdemo.licyo.fr';
const JUDO = 'https://judo.licyo.example';
const STATIC_PAGES = Object.fromEntries(demoSite.pages.map((p) => [p.route, p.file]));
const ASSETS = {
  fetch: async (input) => {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input));
    if (STATIC_PAGES[pathname]) return new Response(readFileSync(STATIC_PAGES[pathname], 'utf8'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    return new Response(readFileSync('404.html', 'utf8'), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};
const DEMO_TRACES = /Club Démo|Sportville|clubdemo|Stade municipal|U6|U10|FFF|Sportéquip|2017/;

function admin(env, handler, request, params = {}) {
  let i = 0;
  const next = async () => (i < adminMiddleware.length ? adminMiddleware[i++]({ request, env, params, next, waitUntil() {} }) : handler({ request, env, params, waitUntil() {} }));
  return next();
}
async function adminPost(env, site, cookie, handler, path, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set(CSRF_FIELD, await csrfTokenFor(new Request(site, { headers: { Cookie: cookie } })));
  return admin(env, handler, new Request(site + path, { method: 'POST', body, headers: { Cookie: cookie, Origin: site, 'Sec-Fetch-Site': 'same-origin' } }));
}
const publicGet = async (env, origin, path) => {
  const request = new Request(origin + path);
  const res = await rootMiddleware({ request, env, next: () => catchAll({ request, env }) });
  return { status: res.status, body: await res.text() };
};
const cookieFor = async (env, org, user) => (await createSession(env, org, user)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];

async function setup(t) {
  setNewsSourcesForTests({});
  clearPublishedSiteCache();
  clearPageDataCache();
  clearOrganizationCache();
  const env = { ...(await fixture()), ASSETS, BREVO_API_KEY: 'x', PLATFORM_ADMIN_EMAILS: 'editeur@licyo.example' };
  t.mock.method(globalThis, 'fetch', async () => new Response('{"messageId":"x"}', { status: 201 }));
  const editor = await testUser(env, DEMO_ORG_ID, 'owner', { email: 'editeur@licyo.example' });
  return { env, editorCookie: await cookieFor(env, DEMO_ORG_ID, editor) };
}

test('palette : nuances calculées, couleur principale lisible avec du texte blanc', () => {
  const vars = paletteVariables({ primary: '#ffe600', accent: '#00a3e0' });
  const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  assert.ok(contrast(rgb(vars['--brand-primary-700']), [255, 255, 255]) >= 4.5, 'jaune vif assombri');
  assert.ok(contrast(rgb(vars['--brand-accent-800']), [255, 255, 255]) >= 4.5);
  assert.equal(vars['--brand-accent-500'], '#00a3e0');
  assert.match(vars['--brand-primary-900-rgb'], /^\d+, \d+, \d+$/);
  assert.equal(paletteVariables({ primary: 'red', accent: '#000000' }), null);
});

test('site de départ : valide pour chaque sport, rendu sans aucune trace du club de démo', () => {
  for (const sportLabel of ['Judo', 'Natation', 'Tennis', 'Athlétisme']) {
    const site = buildStarterSite({ organizationId: 'org_x', slug: 'club-x', siteUrl: 'https://club-x.example', profile: { name: `Club de ${sportLabel}`, sportLabel, city: 'Villeneuve-Exemple', email: 'bureau@club-x.example', phone: '06 11 22 33 44', colors: { primary: '#0b6e4f', accent: '#ffb703' } } });
    validateSite(site);
    assert.deepEqual(JSON.parse(JSON.stringify(site)), site, 'JSON pur');
    for (const page of site.pages) {
      const html = renderPage({ site, page, locale: 'fr-FR', assetVersions: ASSET_VERSIONS, mode: 'markers' });
      assert.doesNotMatch(html, DEMO_TRACES, `${sportLabel} ${page.id}`);
      assert.match(html, /<style id="club-palette">:root\{--brand-primary-950:#[0-9a-f]{6};/);
      assert.match(html, new RegExp(`Club de ${sportLabel}`));
    }
  }
  // Champs dangereux neutralisés.
  const evil = buildStarterSite({ organizationId: 'org_x', slug: 'x', siteUrl: 'https://x.example', profile: { name: '<script>alert(1)</script>Club', sportLabel: 'Judo', city: 'X', facebook: 'javascript:alert(1)', colors: { primary: 'url(x)', accent: '#000' } } });
  validateSite(evil);
  const html = renderPage({ site: evil, page: evil.pages[0], locale: 'fr-FR', assetVersions: ASSET_VERSIONS, mode: 'markers' });
  assert.doesNotMatch(html, /<script>alert|javascript:alert|url\(x\)/);
  assert.equal(evil.social.length, 0);
});

test('console : un club créé a aussitôt son site publié ; « Site web » modifie le brouillon puis publie', async (t) => {
  const { env, editorCookie } = await setup(t);
  const created = await adminPost(env, DEMO, editorCookie, plateforme.onRequestPost, '/admin/plateforme', {
    action: 'create', name: 'Judo Club Exemple', domain: 'judo.licyo.example', sport: 'judo', city: 'Villeneuve-Exemple', ownerEmail: 'presidente@judo.example',
  });
  assert.equal(created.status, 200);
  clearOrganizationCache();
  const org = await env.DB.prepare("SELECT * FROM organizations WHERE slug = 'judo-club-exemple'").first();
  assert.equal(org.email, 'presidente@judo.example', 'coordonnées publiques initialisées');

  const home = await publicGet(env, JUDO, '/');
  assert.equal(home.status, 200);
  assert.match(home.body, /Judo Club Exemple/);
  assert.match(home.body, /Bienvenue au Judo Club Exemple/);
  assert.doesNotMatch(home.body, DEMO_TRACES);
  for (const path of ['/le-club', '/inscription', '/contact', '/mentions-legales', '/confidentialite', '/actualites']) {
    const page = await publicGet(env, JUDO, path);
    assert.equal(page.status, 200, path);
    assert.doesNotMatch(page.body, DEMO_TRACES, path);
  }
  assert.equal((await publicGet(env, JUDO, '/equipe')).status, 404, 'pages du club de démo absentes');

  // Le responsable du nouveau club modifie son site.
  // Invitation acceptée (compte créé par la console).
  const owner = (await env.DB.prepare("SELECT id FROM users WHERE email = 'presidente@judo.example'").first()).id;
  await env.DB.prepare("UPDATE organization_memberships SET status = 'active' WHERE organization_id = ? AND user_id = ?").bind(org.id, owner).run();
  const cookie = await cookieFor(env, org.id, owner);
  const page = await (await admin(env, siteAdmin.onRequestGet, new Request(`${JUDO}/admin/site`, { headers: { Cookie: cookie } }))).text();
  assert.match(page, /Modifier le brouillon/);
  assert.match(page, /name="heroTitle"/);
  const state = await readSiteConfig(env, org.id);
  const saved = await adminPost(env, JUDO, cookie, siteAdmin.onRequestPost, '/admin/site', {
    action: 'save', revision: String(state.draftRevision), name: 'Judo Club Exemple', sportLabel: 'Judo', city: 'Villeneuve-Exemple',
    heroTitle: 'Le judo pour tous', phone: '06 99 88 77 66', primary: '#0b6e4f', accent: '#ffb703',
  });
  assert.equal(saved.status, 200);
  assert.match(await saved.text(), /Brouillon enregistré/);
  clearPublishedSiteCache();
  assert.doesNotMatch((await publicGet(env, JUDO, '/')).body, /Le judo pour tous/, 'brouillon jamais public');

  const preview = await admin(env, apercu.onRequestGet, new Request(`${JUDO}/admin/site/apercu?page=accueil`, { headers: { Cookie: cookie } }));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex');
  const previewHtml = await preview.text();
  assert.match(previewHtml, /Aperçu du brouillon/);
  assert.match(previewHtml, /Le judo pour tous/);

  // Révision périmée : refus, rien d'écrit.
  const stale = await adminPost(env, JUDO, cookie, siteAdmin.onRequestPost, '/admin/site', { action: 'save', revision: String(state.draftRevision), name: 'Autre', sportLabel: 'Judo', city: 'X' });
  assert.equal(stale.status, 409);

  const draft = await readSiteConfig(env, org.id);
  const published = await adminPost(env, JUDO, cookie, siteAdmin.onRequestPost, '/admin/site', { action: 'publish', revision: String(draft.draftRevision) });
  assert.equal(published.status, 200);
  clearPublishedSiteCache();
  clearPageDataCache();
  const after = (await publicGet(env, JUDO, '/')).body;
  assert.match(after, /Le judo pour tous/);
  assert.match(after, /--brand-primary-700:#0b6e4f/);
  assert.equal((await env.DB.prepare('SELECT phone FROM organizations WHERE id = ?').bind(org.id).first()).phone, '06 99 88 77 66');
});

test('club de démo : champs sûrs seulement, liaisons conservées pour les textes non modifiés ; accès réservé', async (t) => {
  const { env } = await setup(t);
  const owner = await testUser(env, DEMO_ORG_ID, 'owner');
  const cookie = await cookieFor(env, DEMO_ORG_ID, owner);
  const page = await (await admin(env, siteAdmin.onRequestGet, new Request(`${DEMO}/admin/site`, { headers: { Cookie: cookie } }))).text();
  assert.match(page, /seoTitle:contact/);
  assert.doesNotMatch(page, /name="heroTitle"/);
  const state = await readSiteConfig(env, DEMO_ORG_ID);
  const saved = await adminPost(env, DEMO, cookie, siteAdmin.onRequestPost, '/admin/site', {
    action: 'save', revision: String(state.draftRevision), 'bannerTitle:contact': 'Écrivez-nous', primary: '#123456', accent: '#ffaa00',
  });
  assert.equal(saved.status, 200);
  const draft = (await readSiteConfig(env, DEMO_ORG_ID)).config;
  assert.equal(draft.pages.find((p) => p.id === 'contact').sections[0].title, 'Écrivez-nous');
  assert.deepEqual(draft.theme.colors, { primary: '#123456', accent: '#ffaa00' });
  assert.deepEqual(draft.pages.find((p) => p.id === 'accueil').sections[0].lead, demoSite.pages[0].sections[0].lead, 'texte non modifié : liaisons intactes');
  validateSite(draft);

  for (const role of ['secretary', 'coach', 'treasurer']) {
    const user = await testUser(env, DEMO_ORG_ID, role);
    const c = await cookieFor(env, DEMO_ORG_ID, user);
    assert.equal((await admin(env, siteAdmin.onRequestGet, new Request(`${DEMO}/admin/site`, { headers: { Cookie: c } }))).status, 403, role);
  }
});
