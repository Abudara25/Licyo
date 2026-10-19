// Liens de l'espace famille et de réinscription à durée limitée (2026-10-16, audit de sécurité) : empreinte seule en
// base, expiration, révocation, anciens liens jusqu'au LEGACY_LINKS_UNTIL, nouveau lien envoyé uniquement aux adresses
// de la fiche avec une réponse identique dans tous les cas, en-têtes « no-store » et de sécurité sur les Functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import {
  issueFamilyLink,
  resolveFamilyToken,
  revokeFamilyLinks,
  isReinscriptionLinkValid,
  extendReinscriptionLink,
  FAMILY_LINK_DAYS,
  LEGACY_LINKS_UNTIL,
} from '../functions/_shared/family-links.js';
import { deleteInscriptionPermanently } from '../functions/_shared/inscription-deletion.js';
import { SECURITY_HEADERS, withSecurityHeaders } from '../functions/_shared/security-headers.js';
import * as depot from '../functions/depot/[token].js';
import * as renew from '../functions/depot/[token]/nouveau-lien.js';
import * as espace from '../functions/espace-famille.js';
import * as reinscription from '../functions/reinscription/[token].js';
import * as reinscriptionRenew from '../functions/reinscription/[token]/nouveau-lien.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const SITE = 'https://clubdemo.licyo.fr';
const DAY = 86_400_000;
const SAME = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
const legacyCutoff = Date.parse(`${LEGACY_LINKS_UNTIL.replace(' ', 'T')}Z`);

async function setup(t, overrides = {}) {
  clearOrganizationCache();
  const env = { ...(await fixture()), BREVO_API_KEY: 'cle-de-test', ASSETS: { fetch: async () => new Response('404', { status: 404 }) } };
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    if (String(url).includes('brevo.com')) sent.push(JSON.parse(String(opts.body)));
    return new Response('{"messageId":"x"}', { status: 201 });
  });
  const row = await seedInscription(env.DB, { email: 'parent@example.fr', parent2_prenom: 'Karim', parent2_nom: 'Durand', parent2_email: 'karim@example.fr', ...overrides });
  const tasks = [];
  const waitUntil = (p) => tasks.push(p);
  const flush = () => Promise.all(tasks.splice(0));
  return { env, row, sent, waitUntil, flush };
}

const recipients = (mail) => mail.to.map((r) => r.email).sort();

test('lien neuf : empreinte seule en base, valable 30 jours, puis expiré', async (t) => {
  const { env, row } = await setup(t);
  const now = Date.parse('2026-10-16T10:00:00Z');
  const token = await issueFamilyLink(env.DB, A, row.id, now);
  assert.match(token, /^f[A-Za-z0-9_-]{43}$/);
  const stored = await env.DB.prepare('SELECT * FROM family_links').first();
  assert.equal(stored.token_hash.length, 64);
  assert.ok(!JSON.stringify(stored).includes(token), 'jamais le lien en clair');
  assert.equal((await resolveFamilyToken(env.DB, A, token, now + (FAMILY_LINK_DAYS - 1) * DAY)).status, 'ok');
  assert.equal((await resolveFamilyToken(env.DB, A, token, now + (FAMILY_LINK_DAYS + 1) * DAY)).status, 'expired');
  assert.equal((await resolveFamilyToken(env.DB, 'org_autre', token, now)).status, 'unknown', 'autre organisation');
  assert.equal((await resolveFamilyToken(env.DB, A, `f${'x'.repeat(43)}`, now)).status, 'unknown');
  assert.equal((await resolveFamilyToken(env.DB, A, '../admin', now)).status, 'unknown');
});

test('ancien lien (jeton interne) : valable jusqu’au LEGACY_LINKS_UNTIL, puis expiré ; révocation immédiate', async (t) => {
  const { env, row } = await setup(t);
  assert.equal((await resolveFamilyToken(env.DB, A, row.upload_token, legacyCutoff - DAY)).status, 'ok');
  assert.equal((await resolveFamilyToken(env.DB, A, row.upload_token, legacyCutoff + 1000)).status, 'expired');
  const link = await issueFamilyLink(env.DB, A, row.id);
  await revokeFamilyLinks(env.DB, A, row.id);
  assert.equal((await resolveFamilyToken(env.DB, A, row.upload_token, legacyCutoff - DAY)).status, 'expired', 'ancien lien révoqué');
  assert.equal((await resolveFamilyToken(env.DB, A, link)).status, 'expired', 'lien neuf révoqué');
  assert.equal((await resolveFamilyToken(env.DB, A, await issueFamilyLink(env.DB, A, row.id))).status, 'ok', 'un lien émis après la révocation marche');
  const after = await env.DB.prepare('SELECT upload_token, dossier_key FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(after.upload_token, row.upload_token, 'identifiant interne (fichiers R2) inchangé');
});

test('page d’un lien expiré : aucune donnée de l’enfant, bouton « Recevoir un nouveau lien »', async (t) => {
  const { env, row } = await setup(t, { enfant_prenom: 'Secret', enfant_nom: 'Enfant' });
  const token = await issueFamilyLink(env.DB, A, row.id, Date.now() - (FAMILY_LINK_DAYS + 1) * DAY);
  const res = await depot.onRequestGet({ request: new Request(`${SITE}/depot/${token}`), env, params: { token } });
  assert.equal(res.status, 410);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const html = await res.text();
  assert.match(html, /Ce lien a expiré/);
  assert.match(html, new RegExp(`action="/depot/${token}/nouveau-lien"`));
  assert.doesNotMatch(html, /Secret|Enfant|parent@example/);
  // Un envoi (dépôt) sur un lien expiré n'écrit rien.
  const form = new FormData();
  form.set('dossier', new File(['%PDF-1.4'], 'd.pdf', { type: 'application/pdf' }));
  const post = await depot.onRequestPost({ request: new Request(`${SITE}/depot/${token}`, { method: 'POST', body: form }), env, params: { token }, waitUntil: () => {} });
  assert.equal(post.status, 303);
  assert.equal((await env.DB.prepare('SELECT dossier_key FROM inscriptions WHERE id = ?').bind(row.id).first()).dossier_key, null);
});

test('nouveau lien depuis un lien expiré : envoyé aux seules adresses de la fiche, une fois par heure, réponse identique', async (t) => {
  const { env, row, sent, waitUntil, flush } = await setup(t);
  const old = await issueFamilyLink(env.DB, A, row.id, Date.now() - (FAMILY_LINK_DAYS + 1) * DAY);
  const ask = (token) => renew.onRequestPost({ request: new Request(`${SITE}/depot/${token}/nouveau-lien`, { method: 'POST', headers: SAME }), env, params: { token }, waitUntil });
  const first = await ask(old);
  await flush();
  assert.equal(first.status, 303);
  assert.equal(sent.length, 1);
  assert.deepEqual(recipients(sent[0]), ['karim@example.fr', 'parent@example.fr']);
  const link = sent[0].textContent.match(/\/depot\/(f[A-Za-z0-9_-]{43})/)[1];
  assert.equal((await resolveFamilyToken(env.DB, A, link)).status, 'ok');
  assert.ok(!sent[0].textContent.includes(row.upload_token), 'jamais le jeton interne');
  // Seconde demande dans l'heure : rien d'envoyé, même réponse.
  const second = await ask(old);
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(second.headers.get('Location'), first.headers.get('Location'));
  // Lien inconnu : même réponse, rien d'envoyé.
  const unknown = await ask(`f${'a'.repeat(43)}`);
  assert.equal(unknown.status, 303);
  assert.equal(sent.length, 1);
  const page = await depot.onRequestGet({ request: new Request(`${SITE}${unknown.headers.get('Location')}`), env, params: { token: `f${'a'.repeat(43)}` } });
  assert.match(await page.text(), /un nouveau lien vient d'être envoyé/);
});

test('/espace-famille : lien envoyé seulement si l’adresse est sur une fiche active, réponse identique sinon', async (t) => {
  const { env, row, sent, waitUntil, flush } = await setup(t);
  await seedInscription(env.DB, { email: 'archive@example.fr', archived_at: '2026-10-01 10:00:00', enfant_prenom: 'Archive' });
  const ask = (email, extra = {}) => {
    const body = new FormData();
    body.set('email', email);
    for (const [k, v] of Object.entries(extra)) body.set(k, v);
    return espace.onRequestPost({ request: new Request(`${SITE}/espace-famille`, { method: 'POST', body, headers: SAME }), env, waitUntil });
  };
  const known = await ask('  KARIM@example.fr ');
  await flush();
  assert.equal(known.status, 303);
  assert.equal(sent.length, 1);
  assert.deepEqual(recipients(sent[0]), ['karim@example.fr', 'parent@example.fr'], 'adresses de la fiche, pas celle saisie telle quelle');
  for (const email of ['inconnu@example.fr', 'archive@example.fr']) {
    const res = await ask(email);
    await flush();
    assert.equal(res.headers.get('Location'), known.headers.get('Location'), email);
  }
  assert.equal(sent.length, 1, 'rien pour une adresse inconnue ou une fiche archivée');
  await ask('parent@example.fr', { site_web: 'robot' });
  await flush();
  assert.equal(sent.length, 1, 'champ piège');
  const foreign = await espace.onRequestPost({ request: new Request(`${SITE}/espace-famille`, { method: 'POST', body: new FormData(), headers: { Origin: 'https://evil.example' } }), env, waitUntil });
  assert.equal(foreign.status, 403);
  assert.equal(row.id > 0, true);
});

test('réinscription : ancien lien jusqu’au LEGACY_LINKS_UNTIL, prolongé à chaque envoi, nouveau lien sur demande', async (t) => {
  const { env, row, sent, waitUntil, flush } = await setup(t, { reinscription_token: crypto.randomUUID() });
  const fresh = async () => env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(row.id).first();
  assert.equal(isReinscriptionLinkValid(row, legacyCutoff - DAY), true);
  assert.equal(isReinscriptionLinkValid(row, legacyCutoff + 1000), false);
  await extendReinscriptionLink(env.DB, A, row.id, legacyCutoff);
  assert.equal(isReinscriptionLinkValid(await fresh(), legacyCutoff + DAY), true, 'prolongé par un envoi du club');
  await revokeFamilyLinks(env.DB, A, row.id);
  const revoked = await fresh();
  assert.equal(isReinscriptionLinkValid(revoked), false, 'révoqué');
  const page = await reinscription.onRequestGet({ request: new Request(`${SITE}/reinscription/${row.reinscription_token}`), env, params: { token: row.reinscription_token } });
  assert.equal(page.status, 410);
  assert.doesNotMatch(await page.text(), /parent@example/);
  const res = await reinscriptionRenew.onRequestPost({ request: new Request(`${SITE}/reinscription/${row.reinscription_token}/nouveau-lien`, { method: 'POST', headers: SAME }), env, params: { token: row.reinscription_token }, waitUntil });
  await flush();
  assert.equal(res.status, 303);
  const renewed = await fresh();
  assert.notEqual(renewed.reinscription_token, row.reinscription_token, 'nouveau jeton, l’ancien ne sert plus');
  assert.equal(isReinscriptionLinkValid(renewed), true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].textContent.includes(renewed.reinscription_token));
  assert.deepEqual(recipients(sent[0]), ['karim@example.fr', 'parent@example.fr']);
});

test('suppression définitive : les liens partent avec la fiche', async (t) => {
  const { env, row } = await setup(t, { archived_at: '2026-10-01 10:00:00' });
  await issueFamilyLink(env.DB, A, row.id);
  env.DOSSIERS = { delete: async () => {}, head: async () => null };
  const result = await deleteInscriptionPermanently(env, A, row.id);
  assert.ok(!result.error, result.error);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM family_links').first()).n, 0);
});

test('en-têtes : mêmes valeurs que _headers, no-store sur les pages privées, CSP absente du seul relais OAuth', () => {
  const block = readFileSync(new URL('../_headers', import.meta.url), 'utf8').split(/\r?\n/);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    assert.ok(block.some((line) => line.trim() === `${name}: ${value}`), `${name} identique à _headers`);
  }
  const wrap = (path, headers = {}) => withSecurityHeaders(new Request(`${SITE}${path}`), new Response('x', { headers }));
  const fiche = wrap('/admin/inscriptions/1/photo', { 'Cache-Control': 'private, max-age=86400' });
  assert.equal(fiche.headers.get('Cache-Control'), 'no-store');
  assert.equal(fiche.headers.get('Content-Security-Policy'), SECURITY_HEADERS['Content-Security-Policy']);
  assert.equal(fiche.headers.get('X-Frame-Options'), 'DENY');
  const family = wrap('/depot/abc');
  assert.equal(family.headers.get('Cache-Control'), 'no-store');
  assert.equal(family.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(wrap('/espace-famille').headers.get('Cache-Control'), 'no-store');
  assert.equal(wrap('/api/inscriptions').headers.get('Cache-Control'), 'no-store');
  assert.equal(wrap('/callback').headers.get('Content-Security-Policy'), null);
  assert.equal(wrap('/callback').headers.get('X-Frame-Options'), 'DENY');
  const publicPage = wrap('/equipe', { 'Cache-Control': 'public, max-age=60' });
  assert.equal(publicPage.headers.get('Cache-Control'), 'public, max-age=60', 'pages publiques : cache inchangé');
  assert.equal(publicPage.headers.get('Strict-Transport-Security'), SECURITY_HEADERS['Strict-Transport-Security']);
});

test('conservation : fiches au-delà de 3 ans après la fin de saison listées, jamais supprimées ; liens expirés purgés', async (t) => {
  const { env, row } = await setup(t, { saison: '2026-2027' });
  const { retentionDue, retentionEnd, purgeExpiredFamilyLinks } = await import('../functions/_shared/retention.js');
  assert.equal(retentionEnd('2026-2027'), '2030-06-30');
  assert.equal(retentionEnd('n/a'), null);
  assert.deepEqual(await retentionDue(env.DB, A, Date.parse('2030-06-30T12:00:00Z')), []);
  const due = await retentionDue(env.DB, A, Date.parse('2030-07-01T12:00:00Z'));
  assert.deepEqual(due.map((r) => r.id), [row.id]);
  assert.deepEqual(await retentionDue(env.DB, 'org_autre', Date.parse('2031-01-01T00:00:00Z')), []);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 1, 'rien supprimé');
  const now = Date.parse('2026-10-16T10:00:00Z');
  await issueFamilyLink(env.DB, A, row.id, now - (FAMILY_LINK_DAYS + 91) * DAY);
  await issueFamilyLink(env.DB, A, row.id, now);
  assert.equal(await purgeExpiredFamilyLinks(env.DB, A, now), 1);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM family_links').first()).n, 1);
});

test('erreur 403 : page du club pour un navigateur, texte brut conservé pour l’API et les appels de script', async () => {
  const forbidden = (path, accept) => withSecurityHeaders(new Request(`${SITE}${path}`, { headers: accept ? { Accept: accept } : {} }), new Response('Requête refusée.', { status: 403 }));
  const page = forbidden('/espace-famille', 'text/html,application/xhtml+xml,*/*;q=0.8');
  assert.equal(page.status, 403);
  assert.match(page.headers.get('Content-Type'), /text\/html/);
  assert.equal(page.headers.get('Cache-Control'), 'no-store');
  assert.equal(page.headers.get('Content-Security-Policy'), SECURITY_HEADERS['Content-Security-Policy']);
  const html = await page.text();
  assert.match(html, /Carton rouge/);
  assert.match(html, /06 00 00 00 00/);
  assert.match(html, /Stade municipal/);
  assert.doesNotMatch(html, /<script>(?!<\/script>)/, 'aucun script en ligne (CSP)');
  assert.doesNotMatch(html, /https?:\/\/(?!licyo)/, 'aucune ressource externe');
  assert.equal(await forbidden('/api/cron', 'text/html').text(), 'Requête refusée.');
  assert.equal(await forbidden('/admin/inscriptions', '*/*').text(), 'Requête refusée.');
});
