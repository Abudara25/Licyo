// R0a : mesure d'audience isolée par organisation. POST /api/track-event (public, non authentifié) et GET /admin/events.
// L'organisation B (« Atelier Exemple », tests/fixtures) n'existe QUE dans ces tests. Une organisation ne lit, ne compte
// ni ne découvre les événements d'une autre ; l'ancienne table globale `events` n'est jamais lue ni attribuée.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as trackEvent from '../functions/api/track-event.js';
import * as events from '../functions/admin/events.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { clearPublishedSiteCache, publishSiteConfig, saveDraftSiteConfig } from '../functions/_shared/site-config.js';
import { DEMO_ORG_ID, TENANT_TABLES, repairSchemaInvariants } from '../functions/_shared/schema.js';
import { SITE_EVENT_LIMITS, SITE_EVENT_TYPES, ensureSiteEventsTable } from '../functions/_shared/site-events.js';
import { exempleSite } from './fixtures/site-exemple.mjs';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const A_HOST = 'clubdemo.licyo.fr';
const B = exempleSite.organizationId;
const B_HOST = 'atelier.example';
const PHONE = SITE_EVENT_TYPES.phone_click.label;
const CONTACT = SITE_EVENT_TYPES.contact_form_submit.label;

async function setup() {
  clearOrganizationCache();
  clearPublishedSiteCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'atelier-exemple', 'Atelier Exemple')").bind(B).run();
  await env.DB.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(B_HOST, B).run();
  await saveDraftSiteConfig(env, B, JSON.parse(JSON.stringify(exempleSite)), { expectedRevision: 0 });
  await publishSiteConfig(env, B);
  await ensureSiteEventsTable(env.DB);
  const cookie = async (org) => (await createSession(env, org)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  return { env, cookieA: await cookie(A), cookieB: await cookie(B) };
}

let visitor = 0;
const nextIp = () => `198.51.${Math.floor(visitor / 250) % 250}.${(visitor++ % 250) + 1}`;
const track = (env, host, body, { ip = nextIp(), raw, headers = {} } = {}) =>
  trackEvent.onRequestPost({
    request: new Request(`https://${host}/api/track-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, Origin: `https://${host}`, 'Sec-Fetch-Site': 'same-origin', ...headers },
      body: raw ?? JSON.stringify(body),
    }),
    env,
  });
// Lecture de contrôle dans les tests (hors functions/, non soumise au garde-fou statique).
const plain = (rows) => rows.map((row) => ({ ...row }));
const allRows = async (env) => plain((await env.DB.prepare('SELECT organization_id, event, page FROM site_events ORDER BY id').all()).results);
const adminEvents = async (env, cookie, host = A_HOST) =>
  (await events.onRequestGet({ request: new Request(`https://${host}/admin/events`, { headers: { Cookie: cookie } }), env })).text();
// Compteurs affichés par événement : { libellé: nombre }.
const eventKpis = (html) => {
  const out = {};
  for (const [, label, value] of html.matchAll(/adm-kpi-label">(?:<svg[\s\S]*?<\/svg>)?([^<]+)<\/span>\s*<span class="adm-kpi-value">(\d+)</g)) {
    if (label === PHONE || label === CONTACT) out[label] = Number(value);
  }
  return out;
};
const recentRows = (html) => (html.split('50 derniers événements du site')[1] || '').split('</tbody>')[0].match(/<tr><td>/g)?.length ?? 0;

test('chaque événement appartient à l’organisation du domaine ; la page stockée est une route publiée', async () => {
  const { env } = await setup();
  for (const [host, body] of [
    [A_HOST, { event: 'phone_click', page: '/partenaires' }],
    [B_HOST, { event: 'contact_form_submit', page: '/infos' }],
    [A_HOST, { event: 'phone_click', page: '/partenaires.html' }],
    [A_HOST, { event: 'phone_click', page: '/partenaires/' }],
    [A_HOST, { event: 'contact_form_submit' }],
    [A_HOST, { event: 'contact_form_submit', page: '' }],
    [A_HOST, { event: 'contact_form_submit', page: null }],
  ]) {
    const res = await track(env, host, body);
    assert.equal(res.status, 204, JSON.stringify(body));
  }
  assert.deepEqual(await allRows(env), [
    { organization_id: A, event: 'phone_click', page: '/partenaires' },
    { organization_id: B, event: 'contact_form_submit', page: '/infos' },
    { organization_id: A, event: 'phone_click', page: '/partenaires' },
    { organization_id: A, event: 'phone_click', page: '/partenaires' },
    { organization_id: A, event: 'contact_form_submit', page: null },
    { organization_id: A, event: 'contact_form_submit', page: null },
    { organization_id: A, event: 'contact_form_submit', page: null },
  ]);
});

test('un organization_id envoyé par le client est ignoré (organisation du domaine uniquement)', async () => {
  const { env } = await setup();
  const forged = { organization_id: B, organizationId: B, organization: B, org: B, tenant: B };
  assert.equal((await track(env, A_HOST, { event: 'phone_click', page: '/partenaires', ...forged })).status, 204);
  assert.equal((await track(env, B_HOST, { event: 'phone_click', page: '/ateliers', organization_id: A, organizationId: A })).status, 204);
  assert.equal((await track(env, A_HOST, { event: 'phone_click' }, { headers: { 'X-Organization-Id': B } })).status, 204);
  assert.deepEqual(await allRows(env), [
    { organization_id: A, event: 'phone_click', page: '/partenaires' },
    { organization_id: B, event: 'phone_click', page: '/ateliers' },
    { organization_id: A, event: 'phone_click', page: null },
  ]);
});

test('domaine inconnu ou organisation inactive : 404, rien n’est écrit (échec fermé)', async () => {
  const { env } = await setup();
  for (const host of ['inconnu.example', 'clubdemo.licyo.fr.attaquant.example', 'atelier.example.evil.test']) {
    const res = await track(env, host, { event: 'phone_click', page: '/partenaires' });
    assert.equal(res.status, 404, host);
  }
  await env.DB.prepare("UPDATE organizations SET status = 'suspended' WHERE id = ?").bind(B).run();
  clearOrganizationCache();
  assert.equal((await track(env, B_HOST, { event: 'phone_click', page: '/ateliers' })).status, 404, 'organisation suspendue');
  assert.deepEqual(await allRows(env), []);
});

test('événement hors liste blanche ou corps invalide : 400, rien n’est écrit', async () => {
  const { env } = await setup();
  for (const event of ['evil', '', 'PHONE_CLICK', 'phone_click ', '__proto__', 'toString', 'hasOwnProperty', 'constructor', 42, null, true, ['phone_click'], {}]) {
    assert.equal((await track(env, A_HOST, { event, page: '/partenaires' })).status, 400, JSON.stringify(event));
  }
  assert.equal((await track(env, A_HOST, { page: '/partenaires' })).status, 400, 'sans événement');
  for (const raw of ['pas du json', '[]', '["phone_click"]', 'null', '"phone_click"', '42', '']) {
    assert.equal((await track(env, A_HOST, null, { raw })).status, 400, raw);
  }
  assert.equal((await track(env, A_HOST, null, { raw: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) })).status, 400, 'UTF-8 invalide');
  assert.deepEqual(await allRows(env), []);
});

test('page invalide (URL externe, protocole, requête, fragment, contrôle, longueur, chemin sensible, HTML) : 400', async () => {
  const { env } = await setup();
  const invalid = [
    'https://evil.example/', 'http://clubdemo.licyo.fr/partenaires', '//evil.example/x', 'javascript:alert(1)', 'mailto:a@b.fr',
    'partenaires', ' /partenaires', '/partenaires ', '/a b', '/partenaires?utm=1', '/partenaires?', '/partenaires#contact',
    '/a\u0000b', '/a\nb', '/a\rb', '/a\tb', '/a b', '/a\\b', '\\\\evil', '/%2e%2e/admin', '/a%20b', '/é',
    `/${'a'.repeat(200)}`, '/admin', '/admin/events', '/Admin/Inscriptions', '/api/track-event', '/depot/0f8e-jeton',
    '/reinscription/jeton', '/auth', '/callback', '/.env', '/.git/config', '/tests/helpers/d1.mjs', '/package.json',
    '/scripts/crm-reconcile.mjs', '/a/../admin', '/a/./b', '/..', '<script>alert(1)</script>', '/<img src=x onerror=alert(1)>',
    '/"onmouseover="alert(1)', 42, true, {}, ['/partenaires'],
  ];
  for (const page of invalid) {
    assert.equal((await track(env, A_HOST, { event: 'phone_click', page })).status, 400, JSON.stringify(page));
  }
  assert.deepEqual(await allRows(env), []);
});

test('chemin valide mais hors des routes publiées de l’organisation : compté sans page (aucun texte libre stocké)', async () => {
  const { env } = await setup();
  assert.equal((await track(env, A_HOST, { event: 'phone_click', page: '/rappelez-le-06-12-34-56-78' })).status, 204);
  assert.equal((await track(env, B_HOST, { event: 'phone_click', page: '/partenaires' })).status, 204, 'route de A, inconnue de B');
  assert.equal((await track(env, A_HOST, { event: 'phone_click', page: '/ateliers' })).status, 204, 'route de B, inconnue de A');
  assert.equal((await track(env, A_HOST, { event: 'phone_click', page: '/404' })).status, 204, 'page introuvable');
  assert.deepEqual(await allRows(env), [
    { organization_id: A, event: 'phone_click', page: null },
    { organization_id: B, event: 'phone_click', page: null },
    { organization_id: A, event: 'phone_click', page: null },
    { organization_id: A, event: 'phone_click', page: null },
  ]);
});

test('admin A voit et compte seulement A ; admin B seulement B ; aucune route de l’autre organisation', async () => {
  const { env, cookieA, cookieB } = await setup();
  for (let i = 0; i < 3; i++) await track(env, A_HOST, { event: 'phone_click', page: '/partenaires' });
  for (let i = 0; i < 7; i++) await track(env, B_HOST, { event: 'contact_form_submit', page: '/infos' });
  await track(env, B_HOST, { event: 'phone_click', page: '/ateliers' });

  const htmlA = await adminEvents(env, cookieA);
  assert.deepEqual(eventKpis(htmlA), { [PHONE]: 3 });
  assert.equal(recentRows(htmlA), 3);
  assert.doesNotMatch(htmlA, /\/infos|\/ateliers/);
  assert.doesNotMatch(htmlA, new RegExp(CONTACT), 'aucun compteur d’un type d’événement propre à B');

  const htmlB = await adminEvents(env, cookieB, B_HOST);
  assert.deepEqual(eventKpis(htmlB), { [CONTACT]: 7, [PHONE]: 1 });
  assert.equal(recentRows(htmlB), 8);
  assert.doesNotMatch(htmlB, /\/partenaires/);
});

test('agrégats : la page de A est identique octet pour octet, quelle que soit l’activité de B (rien à découvrir)', async () => {
  const { env, cookieA } = await setup();
  await track(env, A_HOST, { event: 'phone_click', page: '/partenaires' });
  const before = await adminEvents(env, cookieA);
  for (let i = 0; i < 40; i++) await track(env, B_HOST, { event: i % 2 ? 'phone_click' : 'contact_form_submit', page: '/infos' });
  assert.equal(await adminEvents(env, cookieA), before);
  const empty = await setup();
  const emptyBefore = await adminEvents(empty.env, empty.cookieA);
  await track(empty.env, B_HOST, { event: 'contact_form_submit', page: '/infos' });
  assert.equal(await adminEvents(empty.env, empty.cookieA), emptyBefore, 'organisation sans événement : aucune trace de B');
});

test('contenu altéré en base : échappé dans l’admin, jamais interprété', async () => {
  const { env, cookieA } = await setup();
  await env.DB.prepare('INSERT INTO site_events (organization_id, event, page) VALUES (?, ?, ?)')
    .bind(A, '<img src=x onerror=alert(1)>', '/<script>alert(1)</script>')
    .run();
  const html = await adminEvents(env, cookieA);
  assert.doesNotMatch(html, /<img src=x|<script>alert/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /\/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('événements legacy (table globale `events`) : jamais lus, jamais attribués, jamais modifiés', async () => {
  const { env, cookieA, cookieB } = await setup();
  await env.DB.prepare(
    "CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')), event TEXT NOT NULL, page TEXT)"
  ).run();
  for (const page of ['/page-legacy-secrete', '/rappelez-le-0612345678']) {
    await env.DB.prepare("INSERT INTO events (event, page) VALUES ('phone_click', ?)").bind(page).run();
  }
  const snapshot = async () => ({
    columns: (await env.DB.prepare('PRAGMA table_info(events)').all()).results.map((c) => c.name),
    rows: plain((await env.DB.prepare('SELECT * FROM events ORDER BY id').all()).results),
  });
  const before = await snapshot();

  await track(env, A_HOST, { event: 'phone_click', page: '/partenaires' });
  await repairSchemaInvariants(env.DB);
  const htmlA = await adminEvents(env, cookieA);
  const htmlB = await adminEvents(env, cookieB, B_HOST);
  for (const html of [htmlA, htmlB]) assert.doesNotMatch(html, /page-legacy-secrete|0612345678/);
  assert.deepEqual(eventKpis(htmlA), { [PHONE]: 1 }, 'les clics legacy ne sont pas comptés pour Sportville');
  assert.deepEqual(eventKpis(htmlB), {});
  assert.deepEqual(await snapshot(), before, 'ni colonne organization_id ajoutée, ni ligne attribuée ou modifiée');
  assert.ok(!TENANT_TABLES.includes('events') && TENANT_TABLES.includes('site_events'));
});

test('aucune Function ne lit ni n’écrit l’ancienne table globale `events`', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith('.js')) files.push(path);
    }
  };
  walk('functions');
  const offenders = files.filter((file) => /\b(?:FROM|INTO|UPDATE|JOIN|TABLE(?:\s+IF\s+NOT\s+EXISTS)?)\s+events\b/i.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((f) => relative('.', f)), []);
});

test('limites de débit : par visiteur, puis plafond quotidien par organisation ; B n’est pas affectée par A', async () => {
  const { env } = await setup();
  const ip = '203.0.113.7';
  for (let i = 0; i < SITE_EVENT_LIMITS.client.limit; i++) {
    assert.equal((await track(env, A_HOST, { event: 'phone_click' }, { ip })).status, 204);
  }
  const limited = await track(env, A_HOST, { event: 'phone_click' }, { ip });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  assert.equal((await track(env, B_HOST, { event: 'phone_click' }, { ip })).status, 204, 'même visiteur, autre organisation');
  assert.equal((await track(env, A_HOST, { event: 'phone_click' })).status, 204, 'autre visiteur');

  // Plafond de l'organisation, quelles que soient les adresses : le remplissage de D1 est borné.
  let accepted = SITE_EVENT_LIMITS.client.limit + 1;
  while (accepted < SITE_EVENT_LIMITS.organization.limit) {
    assert.equal((await track(env, A_HOST, { event: 'contact_form_submit' })).status, 204);
    accepted++;
  }
  assert.equal((await track(env, A_HOST, { event: 'contact_form_submit' })).status, 429, 'plafond quotidien atteint');
  assert.equal((await track(env, B_HOST, { event: 'contact_form_submit' })).status, 204, 'B garde son propre plafond');
  const counts = plain((await env.DB.prepare('SELECT organization_id, COUNT(*) AS n FROM site_events GROUP BY organization_id').all()).results);
  assert.deepEqual(Object.fromEntries(counts.map((c) => [c.organization_id, c.n])), { [A]: SITE_EVENT_LIMITS.organization.limit, [B]: 2 });
});

test('corps trop volumineux : 413 ; base indisponible : 503 ; rien n’est écrit', async () => {
  const { env } = await setup();
  const big = JSON.stringify({ event: 'phone_click', page: '/partenaires', bourrage: 'x'.repeat(trackEvent.MAX_BODY_BYTES) });
  assert.equal((await track(env, A_HOST, null, { raw: big })).status, 413);
  const broken = { ...env, DB: { prepare: () => { throw new Error('D1 indisponible'); }, batch: async () => { throw new Error('D1 indisponible'); } } };
  clearOrganizationCache();
  assert.equal((await track(broken, A_HOST, { event: 'phone_click', page: '/partenaires' })).status, 503);
  assert.deepEqual(await allRows(env), []);
});

test('les événements émis par le moteur de site et les configurations sont tous en liste blanche', () => {
  const emitted = new Set();
  const blocks = readFileSync('renderer/blocks.js', 'utf8');
  const trackSet = /TRACK_EVENTS\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(blocks);
  assert.ok(trackSet, 'TRACK_EVENTS introuvable dans renderer/blocks.js');
  for (const [, name] of trackSet[1].matchAll(/'([^']+)'/g)) emitted.add(name);
  for (const [, name] of blocks.matchAll(/data-track-event="([a-z_]+)"/g)) emitted.add(name);
  const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
  for (const file of walk('sites').filter((f) => f.endsWith('.js'))) {
    for (const [, name] of readFileSync(file, 'utf8').matchAll(/\btrack:\s*'([^']+)'/g)) emitted.add(name);
  }
  assert.ok(emitted.size >= 2);
  for (const name of emitted) assert.ok(Object.hasOwn(SITE_EVENT_TYPES, name), `${name} absent de SITE_EVENT_TYPES`);
});

test('envoi direct du navigateur (Zaraz retiré) : même origine exigée, rien n’est écrit sinon', async () => {
  const { env } = await setup();
  const body = { event: 'phone_click', page: '/partenaires' };
  for (const headers of [{ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }, { Origin: null, 'Sec-Fetch-Site': null }]) {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== null));
    const res = await trackEvent.onRequestPost({ request: new Request(`https://${A_HOST}/api/track-event`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...clean }, body: JSON.stringify(body) }), env });
    assert.equal(res.status, 403);
  }
  await ensureSiteEventsTable(env.DB);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM site_events').first()).n, 0);
  assert.equal((await track(env, A_HOST, body)).status, 204);
});
