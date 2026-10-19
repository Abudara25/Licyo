// Profil sportif du club (2026-10-20) : les mots du football des gabarits sont traduits selon le sport du club.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { getSportProfile, setSportProfile, applySportVocabulary, SPORT_PRESETS } from '../functions/_shared/sport-profile.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { onRequest as adminMiddleware } from '../functions/admin/_middleware.js';
import * as parametres from '../functions/admin/parametres.js';
import * as adherents from '../functions/admin/adherents.js';
import { sendFollowUpEmail } from '../functions/_shared/confirmation-email.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { testUser } from './helpers/accounts.mjs';
import { createKV } from './helpers/d1.mjs';
import { csrfTokenFor, CSRF_FIELD } from '../functions/_shared/csrf.js';

const SITE = 'https://clubdemo.licyo.fr';
const SAMPLE = 'Licence FFF à enregistrer sur Footclubs : vous recevrez un e-mail de la Fédération Française de Football (FFF). En vérification FFF. Club de démonstration · École de foot. Contact de la FFF.';

test('profils : démo = football (rien ne change), autre club = « autre », champs modifiables', async () => {
  const env = { INSCRIPTION_STATUS: createKV() };
  const demo = await getSportProfile(env, DEMO_ORG_ID);
  assert.equal(demo.sport, 'football');
  assert.equal(applySportVocabulary(SAMPLE, demo), SAMPLE, 'football : texte identique');
  assert.equal((await getSportProfile(env, 'org_b')).sport, 'autre');

  const judo = await setSportProfile(env, 'org_b', { sport: 'judo', platform: 'Extranet judo <script>' });
  assert.equal(judo.federation, 'FFJDA');
  assert.equal(judo.platform, 'Extranet judo script', 'chevrons retirés');
  const text = applySportVocabulary(SAMPLE, judo);
  assert.doesNotMatch(text, /FFF|Footclubs|football|École de foot/i);
  assert.match(text, /Licence FFJDA à enregistrer sur Extranet judo script/);
  assert.match(text, /Fédération Française de Judo, Jujitsu, Kendo et Disciplines Associées \(FFJDA\)/);
  assert.match(text, /En vérification FFJDA/);
  assert.match(text, /Club de judo/);
  assert.match(text, /de la FFJDA/);

  const other = await setSportProfile(env, 'org_b', { sport: 'autre' });
  const neutral = applySportVocabulary(SAMPLE, other);
  assert.match(neutral, /^Licence à enregistrer sur l’espace en ligne de la fédération/);
  assert.match(neutral, /En vérification\./);
  assert.match(neutral, /de la fédération/);
  assert.doesNotMatch(neutral, /FFF|Footclubs/);
  for (const preset of Object.values(SPORT_PRESETS)) assert.ok(preset.label && typeof preset.tagline === 'string');
});

test('admin : pages traduites selon le sport, Paramètres enregistre le sport', async () => {
  clearOrganizationCache();
  const env = await fixture();
  await seedInscription(env.DB);
  const userId = await testUser(env, DEMO_ORG_ID);
  const cookie = (await createSession(env, DEMO_ORG_ID, userId)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const run = (handler, request) => {
    let i = 0;
    const next = async () => (i < adminMiddleware.length ? adminMiddleware[i++]({ request, env, params: {}, next, waitUntil() {} }) : handler({ request, env, params: {}, waitUntil() {} }));
    return next();
  };
  const before = await (await run(adherents.onRequestGet, new Request(`${SITE}/admin/adherents`, { headers: { Cookie: cookie } }))).text();
  assert.match(before, /Licence FFF|Licence et tenue/);

  const body = new FormData();
  body.set('action', 'sport');
  body.set('sport', 'natation');
  body.set(CSRF_FIELD, await csrfTokenFor(new Request(SITE, { headers: { Cookie: cookie } })));
  const saved = await run(parametres.onRequestPost, new Request(`${SITE}/admin/parametres`, { method: 'POST', body, headers: { Cookie: cookie, Origin: SITE, 'Sec-Fetch-Site': 'same-origin' } }));
  assert.equal(saved.status, 200);
  assert.equal((await getSportProfile(env, DEMO_ORG_ID)).sport, 'natation');
  const html = await (await run(parametres.onRequestGet, new Request(`${SITE}/admin/parametres`, { headers: { Cookie: cookie } }))).text();
  assert.match(html, /<option value="natation" selected>/);
  assert.doesNotMatch(html, /\bFFF\b/);
  const after = await (await run(adherents.onRequestGet, new Request(`${SITE}/admin/adherents`, { headers: { Cookie: cookie } }))).text();
  assert.doesNotMatch(after, /\bFFF\b/);
});

test('e-mails : traduits au point d’envoi selon le club', async (t) => {
  const env = { ...(await fixture()), BREVO_API_KEY: 'test' };
  await setSportProfile(env, DEMO_ORG_ID, { sport: 'tennis' });
  const row = await seedInscription(env.DB, { paye: 1 });
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response('{"messageId":"x"}', { status: 201 });
  });
  assert.equal(await sendFollowUpEmail(env, row, SITE, { step: 'paiement', origin: 'manuel' }), true);
  const mail = sent[0];
  const all = `${mail.subject}\n${mail.htmlContent}\n${mail.textContent}`;
  assert.doesNotMatch(all, /\bFFF\b|Footclubs|Football/);
  assert.match(all, /FFT|Fédération Française de Tennis/);
});

test('équipement : champ masqué si aucune taille, exigé seulement si le sport fournit une tenue', async () => {
  const { renderPage } = await import('../renderer/render.js');
  const { ASSET_VERSIONS } = await import('../functions/_shared/asset-versions.js');
  const { siteForOrganization } = await import('../sites/index.js');
  const { onRequestPost } = await import('../functions/api/inscriptions.js');
  const { validData } = await import('./helpers/inscriptions.mjs');
  const site = structuredClone(siteForOrganization(DEMO_ORG_ID));
  const page = site.pages.find((p) => p.sections.some((s) => s.type === 'registration'));
  const html = (sizes) => {
    page.sections.find((s) => s.type === 'registration').sizes = sizes;
    return renderPage({ site, page, mode: 'static', locale: 'fr-FR', assetVersions: ASSET_VERSIONS });
  };
  assert.match(html(['8 ans']), /name="tailleMaillot"/);
  assert.doesNotMatch(html([]), /name="tailleMaillot"/);

  const submit = (env, data) => onRequestPost({
    request: new Request(`${SITE}/api/inscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': crypto.randomUUID() }, body: JSON.stringify(data) }),
    env, waitUntil() {},
  });
  const { tailleMaillot, ...withoutSize } = validData;
  assert.ok(tailleMaillot);
  const env = await fixture();
  const refused = await submit(env, withoutSize);
  assert.equal(refused.status, 400, 'football : taille exigée');
  assert.match((await refused.json()).error, /tailleMaillot/);
  await setSportProfile(env, DEMO_ORG_ID, { sport: 'natation' });
  const ok = await submit(env, withoutSize);
  assert.equal(ok.status, 200, 'natation : ' + (await ok.clone().text()));
  assert.equal((await env.DB.prepare('SELECT taille_maillot FROM inscriptions').first()).taille_maillot, '');
  assert.equal((await submit(env, { ...validData, enfantPrenom: 'Autre', tailleMaillot: 'XXL inventée' })).status, 400, 'valeur fournie toujours contrôlée');
});
