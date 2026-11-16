// Éducateurs (2026-11-12) : le club ajoute un éducateur, un lien personnel part par e-mail, l'éducateur remplit sa
// fiche et sa photo ; lien à durée limitée (empreinte seule), renouvellement envoyé à la seule adresse de la fiche,
// isolation par organisation, contrôle d'origine, retrait puis suppression définitive avec la photo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import {
  createEducateur,
  issueEducateurLink,
  resolveEducateurToken,
  validateEducateurForm,
  getEducateur,
  LINK_DAYS,
  DIPLOMES,
  DIPLOME_GROUPS,
} from '../functions/_shared/educateurs.js';
import { withSecurityHeaders } from '../functions/_shared/security-headers.js';
import * as adminList from '../functions/admin/educateurs.js';
import * as adminFiche from '../functions/admin/educateurs/[id].js';
import * as adminPhoto from '../functions/admin/educateurs/[id]/photo.js';
import * as publicPage from '../functions/educateur/[token].js';
import * as publicPhoto from '../functions/educateur/[token]/photo.js';
import * as renew from '../functions/educateur/[token]/nouveau-lien.js';
import { onRequest as educMiddleware } from '../functions/educateur/_middleware.js';
import * as joinPage from '../functions/educateur/rejoindre/[token].js';
import { createR2 } from './helpers/d1.mjs';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const ORG_B = 'org_test_association';
const SITE = 'https://club-exemple.example';
const DAY = 86_400_000;
const SAME = { Origin: SITE, 'Sec-Fetch-Site': 'same-origin' };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

const VALID = {
  civilite: 'Monsieur', prenom: 'Karim', nom: 'Benali', nomNaissance: '', naissance: '1990-04-12',
  paysNaissance: 'France', cpNaissance: '99999', villeNaissance: 'Demoville', nationalite: 'Française',
  telephone: '06 11 22 33 44', adresse: '1 rue du Stade', codePostal: '99999', ville: 'Demoville',
  urgenceNom: 'Samia Benali', urgenceLien: 'Conjointe', urgenceTelephone: '06 55 44 33 22',
  diplomesAutre: '', numeroLicence: '', tailleTenue: 'L', disponibilites: 'Jeudi soir', rgpd: '1', attestation: '1',
};
const formOf = (fields, diplomes = ['cff1', 'psc1', 'inconnu']) => {
  const body = new URLSearchParams(fields);
  for (const d of diplomes) body.append('diplomes', d);
  return body;
};

test('certifications : parcours fédéraux actuels, secourisme, anciens diplômes conservés, aucun diplôme exigé', () => {
  const keys = DIPLOME_GROUPS.flatMap((g) => g.keys);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(keys.slice().sort(), Object.keys(DIPLOMES).sort());
  for (const key of ['cfi_u6u9', 'cfi_u10u13', 'df_ref', 'psc', 'sst', 'cff1', 'psc1']) {
    const result = validateEducateurForm(formOf(VALID, [key]));
    assert.equal(result.values.diplomes, key);
  }
  assert.equal(validateEducateurForm(formOf(VALID, [])).values.diplomes, '');
});

async function setup(t) {
  clearOrganizationCache();
  const env = {
    ...(await fixture()),
    ADMIN_PASSWORD: 'x',
    BREVO_API_KEY: 'cle-de-test',
    DOSSIERS: createR2(),
    DOSSIERS_BACKUP: createR2(),
    ASSETS: { fetch: async () => new Response('404', { status: 404 }) },
  };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'test-association', 'Test Association', 'cultural_association')").bind(ORG_B).run();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('brevo.com')) sent.push(JSON.parse(init.body));
    return new Response('{"messageId":"x"}', { status: 201 });
  });
  const tasks = [];
  const waitUntil = (p) => tasks.push(p);
  const flush = () => Promise.all(tasks.splice(0));
  const adminPost = (path, mod, fields, params = {}) =>
    mod.onRequestPost({
      request: new Request(`${SITE}${path}`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) }),
      env, params, waitUntil,
    });
  const adminGet = (path, mod, params = {}) => mod.onRequestGet({ request: new Request(`${SITE}${path}`, { headers: { Cookie: cookie } }), env, params });
  const linkIn = (mail) => mail.htmlContent.match(/\/educateur\/(e[A-Za-z0-9_-]{43})/)[1];
  return { env, sent, waitUntil, flush, adminPost, adminGet, linkIn };
}

const publicPost = (env, token, body, waitUntil) =>
  publicPage.onRequestPost({ request: new Request(`${SITE}/educateur/${token}`, { method: 'POST', headers: { ...SAME, 'Content-Type': 'application/x-www-form-urlencoded' }, body }), env, params: { token }, waitUntil });
const publicGet = (env, token, qs = '') => publicPage.onRequestGet({ request: new Request(`${SITE}/educateur/${token}${qs}`), env, params: { token } });

test('échec d’envoi : fiche conservée, invitation non annoncée envoyée, nouvel essai possible', async (t) => {
  const { env, adminPost } = await setup(t);
  t.mock.method(globalThis, 'fetch', async () => new Response('{"message":"indisponible"}', { status: 503 }));
  const response = await adminPost('/admin/educateurs', adminList, { action: 'add', prenom: 'Encadrant', nom: 'Fictif', email: 'encadrant@example.invalid', send: '1' });
  assert.match(response.headers.get('Location'), /msg=addedNoMail/);
  const row = await env.DB.prepare('SELECT * FROM educateurs WHERE organization_id = ? AND email = ?').bind(A, 'encadrant@example.invalid').first();
  assert.ok(row);
  assert.equal(row.link_sent_at, null, 'un jeton créé ne signifie pas que le message est parti');
  t.mock.method(globalThis, 'fetch', async () => new Response('{"messageId":"reessai"}', { status: 201 }));
  const retried = await adminPost(`/admin/educateurs/${row.id}`, adminFiche, { action: 'send-link' }, { id: String(row.id) });
  assert.match(retried.headers.get('Location'), /msg=linkSent/);
  assert.ok((await getEducateur(env.DB, A, row.id)).link_sent_at);
});

test('ajout par le club : fiche créée, lien neuf envoyé à l’éducateur, empreinte seule en base', async (t) => {
  const { env, sent, adminPost, linkIn } = await setup(t);
  const res = await adminPost('/admin/educateurs', adminList, { action: 'add', prenom: 'Karim', nom: 'Benali', email: 'Karim@Example.fr', role: 'educateur', categories: 'U8 - U9', send: '1' });
  assert.equal(res.status, 303);
  assert.match(res.headers.get('Location'), /msg=added/);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to.map((r) => r.email), ['karim@example.fr']);
  const token = linkIn(sent[0]);
  const stored = await env.DB.prepare('SELECT * FROM educateur_links').first();
  assert.ok(!JSON.stringify(stored).includes(token), 'jamais le lien en clair');
  assert.equal((await resolveEducateurToken(env.DB, A, token)).status, 'ok');
  assert.equal((await resolveEducateurToken(env.DB, ORG_B, token)).status, 'unknown', 'autre organisation');
  const log = await env.DB.prepare("SELECT kind, organization_id FROM email_log WHERE kind = 'educateur_lien'").first();
  assert.equal(log.organization_id, A);

  // Doublon d'adresse active refusé.
  const dup = await adminPost('/admin/educateurs', adminList, { action: 'add', prenom: 'K', nom: 'B', email: 'karim@example.fr', role: 'aide' });
  assert.match(dup.headers.get('Location'), /msg=duplicate/);
  // Adresse invalide refusée.
  const bad = await adminPost('/admin/educateurs', adminList, { action: 'add', prenom: 'K', nom: 'B', email: 'pas-un-email' });
  assert.match(bad.headers.get('Location'), /msg=invalid/);
});

test('l’éducateur remplit sa fiche : erreurs listées sans rien écrire, puis enregistrement et une seule alerte club', async (t) => {
  const { env, sent, waitUntil, flush } = await setup(t);
  const row = await createEducateur(env.DB, A, { prenom: 'Karim', nom: 'Benali', email: 'karim@example.fr', role: 'educateur' });
  const token = await issueEducateurLink(env.DB, A, row.id);

  const page = await (await publicGet(env, token)).text();
  assert.match(page, /Fiche éducateur de Karim/);
  assert.match(page, /name="villeNaissance"/);

  const invalid = await publicPost(env, token, formOf({ ...VALID, naissance: '2020-01-01', rgpd: '' }), waitUntil);
  assert.equal(invalid.status, 400);
  const text = await invalid.text();
  assert.match(text, /date de naissance/);
  assert.match(text, /consentement/);
  assert.match(text, /value="Demoville"/, 'saisie réaffichée');
  assert.equal((await getEducateur(env.DB, A, row.id)).submitted_at, null);

  const ok = await publicPost(env, token, formOf(VALID), waitUntil);
  assert.equal(ok.status, 303);
  await flush();
  const saved = await getEducateur(env.DB, A, row.id);
  assert.ok(saved.submitted_at);
  assert.equal(saved.diplomes, 'cff1,psc1', 'diplôme inconnu ignoré');
  assert.equal(saved.ville_naissance, 'Demoville');
  assert.equal(saved.urgence_telephone, '06 55 44 33 22');
  const alerts = sent.filter((m) => /Fiche éducateur remplie/.test(m.subject));
  assert.equal(alerts.length, 1);

  await publicPost(env, token, formOf({ ...VALID, tailleTenue: 'XL' }), waitUntil);
  await flush();
  assert.equal(sent.filter((m) => /Fiche éducateur remplie/.test(m.subject)).length, 1, 'pas d’alerte à la modification');
  assert.equal((await getEducateur(env.DB, A, row.id)).taille_tenue, 'XL');
});

test('validation : né à l’étranger sans code postal accepté, champs hors liste refusés', () => {
  const ok = validateEducateurForm(formOf({ ...VALID, paysNaissance: 'Maroc', cpNaissance: '' }));
  assert.ok(ok.values);
  assert.equal(ok.values.cp_naissance, '');
  const ko = validateEducateurForm(formOf({ ...VALID, civilite: 'Autre', tailleTenue: '10 ans', cpNaissance: '12', telephone: 'abc' }));
  assert.deepEqual(ko.errors, ['civilité', 'code postal de naissance', 'téléphone', 'taille de tenue']);
});

test('photo : contenu vérifié, stockée dans R2 sous une clé aléatoire, lisible par le lien et par l’admin seulement', async (t) => {
  const { env, waitUntil, flush, adminGet } = await setup(t);
  const row = await createEducateur(env.DB, A, { prenom: 'Karim', nom: 'Benali', email: 'karim@example.fr', role: 'educateur' });
  const token = await issueEducateurLink(env.DB, A, row.id);
  const upload = (bytes, type) => {
    const form = new FormData();
    form.append('photo', new File([bytes], 'p.jpg', { type }));
    return publicPhoto.onRequestPost({ request: new Request(`${SITE}/educateur/${token}/photo`, { method: 'POST', headers: SAME, body: form }), env, params: { token }, waitUntil });
  };
  const bad = await upload(new TextEncoder().encode('<script>'), 'image/jpeg');
  assert.match(bad.headers.get('Location'), /photoError=/);
  const ok = await upload(JPEG, 'image/jpeg');
  assert.match(ok.headers.get('Location'), /photoOk=1/);
  await flush();
  const saved = await getEducateur(env.DB, A, row.id);
  assert.match(saved.photo_key, /^educateurs\/\d+-[A-Za-z0-9_-]+$/);
  assert.ok(await env.DOSSIERS.get(saved.photo_key));
  assert.ok(await env.DOSSIERS_BACKUP.get(saved.photo_key), 'copie de sauvegarde');
  const viaAdmin = await adminGet(`/admin/educateurs/${row.id}/photo`, adminPhoto, { id: String(row.id) });
  assert.equal(viaAdmin.status, 200);
  assert.equal(viaAdmin.headers.get('X-Content-Type-Options'), 'nosniff');
  const anonymous = await adminPhoto.onRequestGet({ request: new Request(`${SITE}/admin/educateurs/${row.id}/photo`), env, params: { id: String(row.id) } });
  assert.equal(anonymous.status, 401);
});

test('lien expiré : page sans donnée personnelle, nouveau lien envoyé à la seule adresse de la fiche', async (t) => {
  const { env, sent, waitUntil, flush, linkIn } = await setup(t);
  const row = await createEducateur(env.DB, A, { prenom: 'Secret', nom: 'Encadrant', email: 'karim@example.fr', role: 'educateur' });
  const token = await issueEducateurLink(env.DB, A, row.id, Date.now() - (LINK_DAYS + 1) * DAY);
  const res = await publicGet(env, token);
  assert.equal(res.status, 410);
  const page = await res.text();
  assert.doesNotMatch(page, /Secret|Encadrant|karim@/);
  assert.match(page, /Recevoir un nouveau lien/);

  const ask = () => renew.onRequestPost({ request: new Request(`${SITE}/educateur/${token}/nouveau-lien`, { method: 'POST', headers: SAME }), env, params: { token }, waitUntil });
  assert.equal((await ask()).status, 303);
  await flush();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to.map((r) => r.email), ['karim@example.fr']);
  assert.equal((await resolveEducateurToken(env.DB, A, linkIn(sent[0]))).status, 'ok');
  await ask();
  await flush();
  assert.equal(sent.length, 1, 'au plus un envoi par heure et par fiche');

  // Lien inconnu : même réponse, rien n'est envoyé.
  const unknown = `e${'a'.repeat(43)}`;
  const r = await renew.onRequestPost({ request: new Request(`${SITE}/educateur/${unknown}/nouveau-lien`, { method: 'POST', headers: SAME }), env, params: { token: unknown }, waitUntil });
  assert.equal(r.status, 303);
  assert.equal((await publicGet(env, unknown)).status, 404);
  assert.equal((await publicGet(env, '../admin')).status, 404);
});

test('envoi depuis un autre site refusé ; en-têtes no-store et Referrer-Policy same-origin', async () => {
  const req = (headers) => new Request(`${SITE}/educateur/e${'a'.repeat(43)}`, { method: 'POST', headers });
  let called = false;
  const next = async () => { called = true; return new Response('ok'); };
  const [, sameOrigin] = educMiddleware;
  assert.equal((await sameOrigin({ request: req({ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' }), next })).status, 403);
  assert.equal(called, false);
  await sameOrigin({ request: req(SAME), next });
  assert.equal(called, true);
  const headers = withSecurityHeaders(new Request(`${SITE}/educateur/e${'a'.repeat(43)}`), new Response('x', { headers: { 'Cache-Control': 'max-age=60' } })).headers;
  assert.equal(headers.get('Cache-Control'), 'no-store');
  assert.equal(headers.get('Referrer-Policy'), 'same-origin');
});

test('isolation : une autre organisation ne voit ni la fiche ni la liste', async (t) => {
  const { env, adminGet } = await setup(t);
  const other = await createEducateur(env.DB, ORG_B, { prenom: 'Bob', nom: 'Autre', email: 'bob@example.fr', role: 'educateur' });
  const mine = await createEducateur(env.DB, A, { prenom: 'Karim', nom: 'Benali', email: 'karim@example.fr', role: 'educateur' });
  assert.equal((await adminGet(`/admin/educateurs/${other.id}`, adminFiche, { id: String(other.id) })).status, 404);
  const list = await (await adminGet('/admin/educateurs', adminList)).text();
  assert.match(list, /Karim Benali/);
  assert.doesNotMatch(list, /Bob Autre/);
  const fiche = await (await adminGet(`/admin/educateurs/${mine.id}`, adminFiche, { id: String(mine.id) })).text();
  assert.match(fiche, /Pas encore rempli/);
  const csv = await (await adminGet('/admin/educateurs?format=csv', adminList)).text();
  assert.match(csv, /Benali/);
  assert.doesNotMatch(csv, /bob@example/);
});

test('retrait : liens coupés ; suppression définitive seulement après retrait, photo effacée des deux buckets', async (t) => {
  const { env, adminPost } = await setup(t);
  const row = await createEducateur(env.DB, A, { prenom: 'Karim', nom: 'Benali', email: 'karim@example.fr', role: 'educateur' });
  const token = await issueEducateurLink(env.DB, A, row.id);
  await env.DOSSIERS.put('educateurs/1-abc', JPEG);
  await env.DOSSIERS_BACKUP.put('educateurs/1-abc', JPEG);
  await env.DB.prepare("UPDATE educateurs SET photo_key = 'educateurs/1-abc', photo_uploaded_at = datetime('now') WHERE id = ?").bind(row.id).run();
  const path = `/admin/educateurs/${row.id}`;
  const params = { id: String(row.id) };

  const early = await adminPost(path, adminFiche, { action: 'delete' }, params);
  assert.match(early.headers.get('Location'), /deleteActive/);
  assert.ok(await getEducateur(env.DB, A, row.id));

  await adminPost(path, adminFiche, { action: 'archive' }, params);
  assert.equal((await resolveEducateurToken(env.DB, A, token)).status, 'expired');
  const del = await adminPost(path, adminFiche, { action: 'delete' }, params);
  assert.match(del.headers.get('Location'), /msg=deleted/);
  assert.equal(await getEducateur(env.DB, A, row.id), null);
  assert.equal(await env.DOSSIERS.get('educateurs/1-abc'), null);
  assert.equal(await env.DOSSIERS_BACKUP.get('educateurs/1-abc'), null);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM educateur_links').first()).n, 0);
});

test('modification par le club : nouvel e-mail = anciens liens révoqués', async (t) => {
  const { env, adminPost } = await setup(t);
  const row = await createEducateur(env.DB, A, { prenom: 'Karim', nom: 'Benali', email: 'karim@example.fr', role: 'educateur' });
  const token = await issueEducateurLink(env.DB, A, row.id);
  const res = await adminPost(`/admin/educateurs/${row.id}`, adminFiche, { action: 'club', prenom: 'Karim', nom: 'Benali', email: 'nouveau@example.fr', role: 'responsable', categories: 'U10', numeroLicence: '2547896541' }, { id: String(row.id) });
  assert.match(res.headers.get('Location'), /msg=saved/);
  const saved = await getEducateur(env.DB, A, row.id);
  assert.equal(saved.email, 'nouveau@example.fr');
  assert.equal(saved.role, 'responsable');
  assert.equal(saved.numero_licence, '2547896541');
  assert.equal((await resolveEducateurToken(env.DB, A, token)).status, 'expired');
});

test('rôles : dirigeant et bénévole séparés, clé historique « dirigeant » conservée', async () => {
  const { ROLES } = await import('../functions/_shared/educateurs.js');
  assert.equal(ROLES.dirigeant, 'Dirigeant');
  assert.equal(ROLES.benevole, 'Bénévole');
  const form = new FormData();
  for (const [k, v] of Object.entries({ prenom: 'Bob', nom: 'Test', email: 'bob@example.fr', role: 'benevole' })) form.set(k, v);
  assert.equal(adminList.readClubFields(form).values.role, 'benevole');
});

test('diplômes : CFI Seniors proposé dans le groupe Football', () => {
  assert.equal(DIPLOMES.cfi_seniors, 'CFI Seniors certifié');
  assert.ok(DIPLOME_GROUPS.find((g) => g.label === 'Football').keys.includes('cfi_seniors'));
  assert.equal(validateEducateurForm(formOf(VALID, ['cfi_seniors'])).values.diplomes, 'cfi_seniors');
});

test('lien de groupe : création affichée une fois, inscriptions avec le rôle choisi, places, doublon, désactivation', async (t) => {
  const { env, sent, waitUntil, flush, adminPost, adminGet } = await setup(t);
  const created = await adminPost('/admin/educateurs', adminList, { action: 'invite-create', role: 'dirigeant', days: '7', places: '2' });
  assert.equal(created.status, 200);
  const page = await created.text();
  const token = page.match(/\/educateur\/rejoindre\/(j[A-Za-z0-9_-]{43})/)[1];
  const stored = await env.DB.prepare('SELECT * FROM educateur_invites').first();
  assert.ok(!JSON.stringify(stored).includes(token), 'jamais le lien en clair');
  assert.ok(!(await (await adminGet('/admin/educateurs', adminList)).text()).includes(token), 'plus affiché ensuite');
  // Valeurs hors liste refusées.
  const bad = await adminPost('/admin/educateurs', adminList, { action: 'invite-create', role: 'roi', days: '7', places: '2' });
  assert.match(bad.headers.get('Location'), /inviteInvalid/);

  const join = (fields, tok = token, headers = SAME) =>
    joinPage.onRequestPost({ request: new Request(`${SITE}/educateur/rejoindre/${tok}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) }), env, params: { token: tok }, waitUntil });
  const get = (tok = token, qs = '') => joinPage.onRequestGet({ request: new Request(`${SITE}/educateur/rejoindre/${tok}${qs}`), env, params: { token: tok } });

  assert.equal((await get()).status, 200);
  assert.equal((await get(`j${'A'.repeat(43)}`)).status, 404, 'lien inconnu');
  // Saisie invalide : rien de créé.
  assert.equal((await join({ prenom: 'Ali', nom: '', email: 'x' })).status, 400);
  // Champ piège : rien de créé.
  await join({ prenom: 'Bot', nom: 'Bot', email: 'bot@example.fr', site_web: 'spam' });
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM educateurs').first()).n, 0);

  const ok = await join({ prenom: 'Ali', nom: 'Dirigeant', email: 'Ali@Example.fr' });
  assert.equal(ok.status, 303);
  assert.match(ok.headers.get('Location'), /envoye=1/);
  await flush();
  const row = await env.DB.prepare('SELECT * FROM educateurs WHERE email = ?').bind('ali@example.fr').first();
  assert.equal(row.role, 'dirigeant');
  assert.equal(row.organization_id, A);
  assert.ok(row.invite_id);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to.map((r) => r.email), ['ali@example.fr']);
  assert.match(sent[0].htmlContent, /\/educateur\/e[A-Za-z0-9_-]{43}/, 'lien personnel envoyé');

  // Même adresse : pas de seconde fiche, pas de place prise, même réponse.
  const again = await join({ prenom: 'Ali', nom: 'Dirigeant', email: 'ali@example.fr' });
  assert.match(again.headers.get('Location'), /envoye=1/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM educateurs').first()).n, 1);
  assert.equal((await env.DB.prepare('SELECT uses FROM educateur_invites').first()).uses, 1);

  // Dernière place, puis lien complet.
  await join({ prenom: 'Sara', nom: 'Benevole', email: 'sara@example.fr' });
  assert.equal((await get()).status, 410);
  assert.equal((await join({ prenom: 'Trop', nom: 'Tard', email: 'tard@example.fr' })).status, 410);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM educateurs').first()).n, 2);

  // Autre site : refusé par le middleware.
  const cross = await educMiddleware[1]({ request: new Request(`${SITE}/educateur/rejoindre/${token}`, { method: 'POST', headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } }), env, next: async () => new Response('ok') });
  assert.equal(cross.status, 403);

  // Désactivation d'un nouveau lien.
  const second = await (await adminPost('/admin/educateurs', adminList, { action: 'invite-create', role: 'benevole', days: '3', places: '5' })).text();
  const token2 = second.match(/\/educateur\/rejoindre\/(j[A-Za-z0-9_-]{43})/)[1];
  const { id } = await env.DB.prepare("SELECT id FROM educateur_invites WHERE role = 'benevole'").first();
  await adminPost('/admin/educateurs', adminList, { action: 'invite-revoke', invite: String(id) });
  assert.equal((await get(token2)).status, 410);
});

test('lien de groupe : isolé par organisation', async (t) => {
  const { env } = await setup(t);
  const { createInvite, resolveInvite } = await import('../functions/_shared/educateurs.js');
  const token = await createInvite(env.DB, A, { role: 'dirigeant', days: 7, maxUses: 3 });
  assert.equal((await resolveInvite(env.DB, A, token)).status, 'ok');
  assert.equal((await resolveInvite(env.DB, ORG_B, token)).status, 'unknown');
});
