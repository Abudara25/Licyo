// Phase 4B : protection CSRF de l'espace admin (origine + jeton), testée à travers le vrai middleware
// (functions/admin/_middleware.js) et les vrais handlers, sur plusieurs routes qui modifient des données.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession, isAuthed } from '../functions/_shared/admin-auth.js';
import { csrfTokenFor, injectCsrfField, checkCsrf, CSRF_FIELD } from '../functions/_shared/csrf.js';
import { isSameOrigin } from '../functions/_shared/security.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { getInscriptionStatus } from '../functions/_shared/settings-kv.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import { onRequest as depotMiddleware } from '../functions/depot/_middleware.js';
import * as inscriptions from '../functions/admin/inscriptions.js';
import * as fiche from '../functions/admin/inscriptions/[id].js';
import * as verification from '../functions/admin/inscriptions/[id]/verification.js';
import * as dossier from '../functions/admin/inscriptions/[id]/dossier.js';
import * as status from '../functions/admin/inscription-status.js';
import * as parametres from '../functions/admin/parametres.js';
import * as logout from '../functions/admin/logout.js';
import * as depot from '../functions/depot/[token].js';
import { fixture, seedInscription, validData } from './helpers/inscriptions.mjs';
import { issueFamilyLink } from '../functions/_shared/family-links.js';

const SITE = 'https://clubdemo.licyo.fr';
const A = DEMO_ORG_ID;

let shared;
async function setup() {
  if (!shared) {
    clearOrganizationCache();
    const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
    const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
    const token = await csrfTokenFor(new Request(SITE, { headers: { Cookie: cookie } }));
    shared = { env, cookie, token };
  }
  return shared;
}

// Exécute la chaîne de middlewares de /admin puis le handler, comme Cloudflare Pages.
async function run(chain, handler, request, env, params = {}) {
  const middlewares = Array.isArray(chain) ? chain : [chain];
  const waitUntil = () => {};
  let index = 0;
  const next = async () => {
    if (index < middlewares.length) return middlewares[index++]({ request, env, params, waitUntil, next });
    return handler({ request, env, params, waitUntil });
  };
  return next();
}

const SAME = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
function form(fields) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of [].concat(value)) body.append(key, v);
  }
  return body;
}
const adminPost = (path, fields, headers) => new Request(`${SITE}${path}`, { method: 'POST', body: form(fields), headers });

// ---------------------------------------------------------------------------------------------
// Contrôle d'origine (isSameOrigin, désormais strict : même ORIGINE, pas seulement même site)

test('isSameOrigin : même origine acceptée ; autre origine, null, same-site et cross-site refusés', () => {
  const req = (headers) => new Request(`${SITE}/admin/inscriptions`, { method: 'POST', headers });
  assert.equal(isSameOrigin(req(SAME)), true);
  assert.equal(isSameOrigin(req({ 'Sec-Fetch-Site': 'none' })), true, 'action directe de l’utilisateur');
  assert.equal(isSameOrigin(req({})), true, 'sans Origin ni Sec-Fetch-Site (client hors navigateur) : accepté, voir csrf.js');
  assert.equal(isSameOrigin(req({ Origin: 'https://evil.example' })), false);
  assert.equal(isSameOrigin(req({ Origin: 'null' })), false, 'Origin null (iframe sandbox, fichier local, redirection)');
  assert.equal(isSameOrigin(req({ Origin: 'http://clubdemo.licyo.fr' })), false, 'autre schéma');
  assert.equal(isSameOrigin(req({ Origin: 'https://club-b.clubdemo.licyo.fr' })), false, 'sous-domaine voisin');
  assert.equal(isSameOrigin(req({ 'Sec-Fetch-Site': 'same-site' })), false, 'futur site client sur un sous-domaine voisin');
  assert.equal(isSameOrigin(req({ 'Sec-Fetch-Site': 'cross-site' })), false);
  assert.equal(isSameOrigin(req({ Origin: SITE, 'Sec-Fetch-Site': 'cross-site' })), false, 'les deux en-têtes doivent concorder');
});

// ---------------------------------------------------------------------------------------------
// Jeton

test('jeton : dérivé de la session, différent d’une session à l’autre, absent sans session', async () => {
  const { env, cookie, token } = await setup();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(token.includes(cookie.split('=')[1]), false, 'le jeton ne révèle pas le cookie');
  const other = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  assert.notEqual(await csrfTokenFor(new Request(SITE, { headers: { Cookie: other } })), token);
  assert.equal(await csrfTokenFor(new Request(SITE)), null);
});

test('injection : champ ajouté à chaque formulaire POST, formulaires GET inchangés', () => {
  const html = '<form method="POST" action="/a"><form method=post><form method="GET"><form><form class="x" method=\'post\' enctype="multipart/form-data">';
  const out = injectCsrfField(html, 'abc');
  assert.equal(out.match(/name="_csrf" value="abc"/g).length, 3);
  assert.match(out, /<form method="GET"><form>/);
  assert.equal(injectCsrfField(html, null), html);
});

test('pages admin : le jeton est injecté dans tous les formulaires POST de la fiche, et un aller-retour fonctionne', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { paye: 0 });
  const page = await run(adminMiddleware, fiche.onRequestGet, new Request(`${SITE}/admin/inscriptions/${row.id}`, { headers: { Cookie: cookie } }), env, { id: String(row.id) });
  const html = await page.text();
  const postForms = html.match(/<form\b[^>]*method="POST"[^>]*>/gi) || [];
  assert.ok(postForms.length >= 3, `formulaires POST sur la fiche : ${postForms.length}`);
  assert.equal((html.match(new RegExp(`name="${CSRF_FIELD}" value="${token}"`, 'g')) || []).length, postForms.length);

  // Jeton relu dans la page, renvoyé tel quel : l'action passe.
  const pageToken = new RegExp(`name="${CSRF_FIELD}" value="([0-9a-f]+)"`).exec(html)[1];
  const res = await run(adminMiddleware, inscriptions.onRequestPost, adminPost('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id), [CSRF_FIELD]: pageToken }, { ...SAME, Cookie: cookie }), env);
  assert.equal(res.status, 302);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
});

test('réponses non HTML (fichiers, redirections) : transmises sans modification', async () => {
  const { env, cookie } = await setup();
  const res = await run(adminMiddleware, () => new Response('%PDF-1.4 <form method="post">', { headers: { 'Content-Type': 'application/pdf' } }), new Request(`${SITE}/admin/x`, { headers: { Cookie: cookie } }), env);
  assert.equal(await res.text(), '%PDF-1.4 <form method="post">');
});

// ---------------------------------------------------------------------------------------------
// Plusieurs routes : même origine + jeton = accepté ; tout le reste = 403 sans écriture

const REJECTED = [
  ['origine externe', { Origin: 'https://evil.example' }],
  ['Origin null', { Origin: 'null' }],
  ['Sec-Fetch-Site cross-site', { 'Sec-Fetch-Site': 'cross-site' }],
  ['Sec-Fetch-Site same-site', { 'Sec-Fetch-Site': 'same-site' }],
];

test('marquer payé (/admin/inscriptions) : refusé hors même origine, ou sans jeton, ou avec un faux jeton', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { paye: 0 });
  const attempt = (headers, extra = {}) => run(adminMiddleware, inscriptions.onRequestPost, adminPost('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id), ...extra }, { Cookie: cookie, ...headers }), env);

  for (const [label, headers] of REJECTED) assert.equal((await attempt(headers, { [CSRF_FIELD]: token })).status, 403, label);
  assert.equal((await attempt(SAME)).status, 403, 'jeton absent');
  assert.equal((await attempt(SAME, { [CSRF_FIELD]: '0'.repeat(64) })).status, 403, 'faux jeton');
  const refused = await attempt(SAME);
  assert.match(await refused.text(), /Rechargez-la/);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 0, 'rien n’a été écrit');

  assert.equal((await attempt(SAME, { [CSRF_FIELD]: token })).status, 302);
  assert.equal((await env.DB.prepare('SELECT paye FROM inscriptions WHERE id = ?').bind(row.id).first()).paye, 1);
});

test('jeton accepté aussi par l’en-tête X-CSRF-Token', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { paye: 0 });
  const res = await run(adminMiddleware, inscriptions.onRequestPost, adminPost('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id) }, { ...SAME, Cookie: cookie, 'X-CSRF-Token': token }), env);
  assert.equal(res.status, 302);
});

test('absence d’Origin et de Sec-Fetch-Site (client hors navigateur) : le jeton reste exigé', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { paye: 0 });
  const attempt = (extra) => run(adminMiddleware, inscriptions.onRequestPost, adminPost('/admin/inscriptions', { action: 'toggle-paye', id: String(row.id), ...extra }, { Cookie: cookie }), env);
  assert.equal((await attempt({})).status, 403);
  assert.equal((await attempt({ [CSRF_FIELD]: token })).status, 302);
});

test('fermer les inscriptions (/admin/inscription-status) : protégé', async () => {
  const { env, cookie, token } = await setup();
  const attempt = (headers, extra = {}) => run(adminMiddleware, status.onRequestPost, adminPost('/admin/inscription-status', { status: 'closed', ...extra }, { Cookie: cookie, ...headers }), env);
  const before = await getInscriptionStatus(env, A);
  for (const [label, headers] of REJECTED) assert.equal((await attempt(headers, { [CSRF_FIELD]: token })).status, 403, label);
  assert.equal((await attempt(SAME)).status, 403);
  assert.equal(await getInscriptionStatus(env, A), before, 'statut inchangé');
  assert.equal((await attempt(SAME, { [CSRF_FIELD]: token })).status, 302);
  assert.equal(await getInscriptionStatus(env, A), 'closed');
});

test('paramètres (/admin/parametres) : protégé', async () => {
  const { env, cookie, token } = await setup();
  const attempt = (headers, extra = {}) =>
    run(adminMiddleware, parametres.onRequestPost, adminPost('/admin/parametres', { action: 'notification-email', notificationEmail: 'nouveau@example.test', ...extra }, { Cookie: cookie, ...headers }), env);
  for (const [label, headers] of REJECTED) assert.equal((await attempt(headers, { [CSRF_FIELD]: token })).status, 403, label);
  assert.equal((await attempt(SAME)).status, 403);
  assert.equal((await attempt(SAME, { [CSRF_FIELD]: token })).status, 200);
});

test('validation du dossier (/admin/inscriptions/:id/verification) : protégé', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { dossier_key: 'dossiers/x', dossier_uploaded_at: '2026-09-20 10:00:00', dossier_status: 'a_verifier' });
  const attempt = (headers, extra = {}) =>
    run(adminMiddleware, verification.onRequestPost, adminPost(`/admin/inscriptions/${row.id}/verification`, { action: 'valider', ...extra }, { Cookie: cookie, ...headers }), env, { id: String(row.id) });
  for (const [label, headers] of REJECTED) assert.equal((await attempt(headers, { [CSRF_FIELD]: token })).status, 403, label);
  assert.equal((await attempt(SAME)).status, 403);
  assert.equal((await env.DB.prepare('SELECT dossier_status FROM inscriptions WHERE id = ?').bind(row.id).first()).dossier_status, 'a_verifier');
  assert.equal((await attempt(SAME, { [CSRF_FIELD]: token })).status, 302);
  assert.equal((await env.DB.prepare('SELECT dossier_status FROM inscriptions WHERE id = ?').bind(row.id).first()).dossier_status, 'valide');
});

test('dépôt manuel du dossier (multipart, /admin/inscriptions/:id/dossier) : le jeton est lu sans consommer le fichier', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { upload_token: randomUUID() });
  const puts = [];
  env.DOSSIERS = { put: async (key, body) => puts.push([key, body.byteLength]) };
  const pdf = new Blob([new TextEncoder().encode('%PDF-1.4\n%fictif\n')], { type: 'application/pdf' });
  const attempt = (headers, extra = {}) =>
    run(adminMiddleware, dossier.onRequestPost, adminPost(`/admin/inscriptions/${row.id}/dossier`, { dossier: new File([pdf], 'dossier.pdf', { type: 'application/pdf' }), ...extra }, { Cookie: cookie, ...headers }), env, { id: String(row.id) });
  assert.equal((await attempt({ Origin: 'https://evil.example' }, { [CSRF_FIELD]: token })).status, 403);
  assert.equal((await attempt(SAME)).status, 403);
  assert.equal(puts.length, 0, 'aucun fichier écrit');
  const ok = await attempt(SAME, { [CSRF_FIELD]: token });
  assert.equal(ok.status, 302);
  assert.equal(puts.length, 1, 'le handler a bien reçu le fichier complet');
  assert.ok(puts[0][1] > 0);
});

test('modification de la fiche (/admin/inscriptions/:id) : protégée, le champ _csrf n’est pas enregistré', async () => {
  const { env, cookie, token } = await setup();
  const row = await seedInscription(env.DB, { enfant_prenom: 'Avant' });
  // Même formulaire que tests/admin-fiche.test.mjs (champs valides), prénom modifié.
  const fields = Object.fromEntries(Object.entries({ ...validData, naissance: row.naissance }).filter(([, v]) => v !== false).map(([k, v]) => [k, v === true ? 'on' : String(v)]));
  fields.enfantPrenom = 'Apres';
  const attempt = (headers, extra = {}) => run(adminMiddleware, fiche.onRequestPost, adminPost(`/admin/inscriptions/${row.id}`, { ...fields, ...extra }, { Cookie: cookie, ...headers }), env, { id: String(row.id) });
  assert.equal((await attempt({ 'Sec-Fetch-Site': 'cross-site' }, { [CSRF_FIELD]: token })).status, 403);
  assert.equal((await env.DB.prepare('SELECT enfant_prenom FROM inscriptions WHERE id = ?').bind(row.id).first()).enfant_prenom, 'Avant');
  assert.equal((await attempt(SAME, { [CSRF_FIELD]: token })).status, 302);
  assert.equal((await env.DB.prepare('SELECT enfant_prenom FROM inscriptions WHERE id = ?').bind(row.id).first()).enfant_prenom, 'Apres');
});

// ---------------------------------------------------------------------------------------------
// Connexion, déconnexion, pages des familles, cookie

test('connexion : même origine sans session = accepté (pas de jeton possible) ; autre origine = refusé', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'mot-de-passe-de-test' };
  clearOrganizationCache();
  const login = (headers) => run(adminMiddleware, inscriptions.onRequestPost, adminPost('/admin/inscriptions', { password: 'mot-de-passe-de-test' }, headers), env);
  assert.equal((await login({ Origin: 'https://evil.example' })).status, 403, 'connexion forcée depuis un autre site');
  assert.equal((await login({ Origin: 'null' })).status, 403);
  const ok = await login(SAME);
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('Set-Cookie'), /admin_session=/);
});

test('page de connexion affichée avec un ancien cookie : le jeton de cet ancien cookie permet quand même de se reconnecter', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'mot-de-passe-de-test' };
  clearOrganizationCache();
  const stale = `${COOKIE_NAME}=ancien-jeton-expire`;
  const page = await run(adminMiddleware, inscriptions.onRequestGet, new Request(`${SITE}/admin/inscriptions`, { headers: { Cookie: stale } }), env);
  const html = await page.text();
  assert.match(html, /Connexion/);
  const pageToken = new RegExp(`name="${CSRF_FIELD}" value="([0-9a-f]+)"`).exec(html)?.[1];
  assert.ok(pageToken, 'jeton présent dans le formulaire de connexion');
  const res = await run(adminMiddleware, inscriptions.onRequestPost, adminPost('/admin/inscriptions', { password: 'mot-de-passe-de-test', [CSRF_FIELD]: pageToken }, { ...SAME, Cookie: stale }), env);
  assert.equal(res.status, 302);
});

test('lectures (GET) jamais bloquées par le contrôle', async () => {
  for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://evil.example' }]) {
    assert.equal(await checkCsrf(new Request(`${SITE}/admin/inscriptions`, { headers })), null);
  }
});

test('déconnexion déclenchée depuis un autre site : redirection sans fermer la session', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const req = (headers) => new Request(`${SITE}/admin/logout`, { headers: { Cookie: cookie, ...headers } });
  const cross = await logout.onRequestGet({ request: req({ 'Sec-Fetch-Site': 'cross-site' }), env });
  assert.equal(cross.status, 302);
  assert.equal(cross.headers.get('Set-Cookie'), null);
  assert.ok(await isAuthed(req({}), env), 'session toujours ouverte');
  const own = await logout.onRequestGet({ request: req({ 'Sec-Fetch-Site': 'same-origin' }), env });
  assert.match(own.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(await isAuthed(req({}), env), null);
});

test('pages des familles (/depot/*) : un signal d’origine valide est exigé (phase 4B.1)', async () => {
  const env = {};
  const reached = [];
  const handler = () => { reached.push(1); return new Response('ok'); };
  const req = (headers) => new Request(`${SITE}/depot/abc`, { method: 'POST', body: form({ x: '1' }), headers });
  const refused = [
    ...REJECTED,
    ['ni Origin ni Sec-Fetch-Site', {}],
    ['Sec-Fetch-Site none', { 'Sec-Fetch-Site': 'none' }],
    ['Origin correcte mais Sec-Fetch-Site cross-site', { Origin: SITE, 'Sec-Fetch-Site': 'cross-site' }],
    ['Origin correcte mais Sec-Fetch-Site same-site', { Origin: SITE, 'Sec-Fetch-Site': 'same-site' }],
  ];
  for (const [label, headers] of refused) assert.equal((await run(depotMiddleware, handler, req(headers), env)).status, 403, label);
  assert.equal(reached.length, 0);
  for (const [label, headers] of [['Origin + same-origin', SAME], ['Origin seule (Safari < 16.4)', { Origin: SITE }], ['Sec-Fetch-Site same-origin seul', { 'Sec-Fetch-Site': 'same-origin' }]]) {
    assert.equal((await run(depotMiddleware, handler, req(headers), env)).status, 200, label);
  }
  assert.equal((await run(depotMiddleware, handler, new Request(`${SITE}/depot/abc`, { headers: { 'Sec-Fetch-Site': 'cross-site' } }), env)).status, 200, 'lecture du lien depuis un e-mail');
});

test('dépôt du dossier par la famille (multipart réel, vrai handler) : accepté depuis le site, refusé sans signal d’origine', async () => {
  const env = { ...(await fixture()) };
  clearOrganizationCache();
  const internal = randomUUID();
  const row = await seedInscription(env.DB, { upload_token: internal });
  const token = await issueFamilyLink(env.DB, row.organization_id, row.id);
  const puts = [];
  env.DOSSIERS = { put: async (key, body) => puts.push([key, body.byteLength]) };
  const pdf = () => new File([new TextEncoder().encode('%PDF-1.4\n%fictif\n')], 'dossier.pdf', { type: 'application/pdf' });
  const attempt = (headers) => run(depotMiddleware, depot.onRequestPost, new Request(`${SITE}/depot/${token}`, { method: 'POST', body: form({ dossier: pdf() }), headers }), env, { token });
  assert.equal((await attempt({})).status, 403, 'sans en-têtes');
  assert.equal((await attempt({ Origin: 'https://evil.example' })).status, 403, 'autre origine');
  assert.equal(puts.length, 0, 'aucun fichier écrit');
  const ok = await attempt(SAME);
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('Location'), new RegExp(`/depot/${token}\\?ok=1`));
  assert.deepEqual(puts.map(([key]) => key), [`dossiers/${internal}`], 'clé R2 = identifiant interne, pas le lien');
  assert.ok(puts[0][1] > 0, 'fichier complet reçu par le handler');
  assert.equal((await env.DB.prepare('SELECT dossier_status FROM inscriptions WHERE id = ?').bind(row.id).first()).dossier_status, 'a_verifier');
});

test('cookie de session : HttpOnly, Secure, SameSite=Lax, Path=/admin, sans Domain', async () => {
  const env = { ...(await fixture()), ADMIN_PASSWORD: randomUUID() };
  const [session] = await createSession(env, A);
  assert.match(session, /^admin_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/admin; Max-Age=1209600$/);
  assert.doesNotMatch(session, /Domain=/i);
});
