// 2026-11-13 : newsletter (/admin/newsletter) : toutes les familles, une adresse = un e-mail, lien de désinscription
// en bas et en-têtes List-Unsubscribe, page publique de désinscription (confirmation, un clic RFC 8058, réinscription),
// désinscrits exclus des envois suivants, isolation par organisation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { COOKIE_NAME, createSession } from '../functions/_shared/admin-auth.js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { newsletterSigner, newsletterAudience } from '../functions/_shared/newsletter.js';
import { buildMessage } from '../functions/_shared/smtp.js';
import * as admin from '../functions/admin/newsletter.js';
import * as publicPage from '../functions/newsletter/desinscription/[token].js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const ORG_B = 'org_test_association';
const SITE = 'https://club-exemple.example';

async function setup(t) {
  clearOrganizationCache();
  const env = { ...(await fixture()), ADMIN_PASSWORD: 'x', BREVO_API_KEY: 'cle-de-test' };
  await env.DB.prepare("INSERT INTO organizations (id, slug, name, type) VALUES (?, 'test-association', 'Test Association', 'cultural_association')").bind(ORG_B).run();
  const cookie = (await createSession(env, A)).find((c) => c.startsWith(`${COOKIE_NAME}=`)).split(';')[0];
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ messageId: 'x' }), { status: 201 });
  });
  const post = (fields) =>
    admin.onRequestPost({
      request: new Request(`${SITE}/admin/newsletter`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) }),
      env,
    });
  const get = () => admin.onRequestGet({ request: new Request(`${SITE}/admin/newsletter`, { headers: { Cookie: cookie } }), env });
  await seedInscription(env.DB, { enfant_prenom: 'Léo', enfant_nom: 'Martin', parent_prenom: 'Nadia', email: 'nadia@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Adam', enfant_nom: 'Martin', parent_prenom: 'Nadia', email: 'NADIA@example.fr', naissance: '2018-03-03' });
  await seedInscription(env.DB, { enfant_prenom: 'Lina', enfant_nom: 'Durand', parent_prenom: 'Karim', email: 'karim@example.fr', parent2_prenom: 'Sofia', parent2_nom: 'Durand', parent2_email: 'sofia@example.fr' });
  await seedInscription(env.DB, { enfant_prenom: 'Ancien', enfant_nom: 'Archive', email: 'archive@example.fr', archived_at: '2026-09-01' });
  await seedInscription(env.DB, { organization_id: ORG_B, enfant_prenom: 'Bob', enfant_nom: 'Autre', email: 'b@example.fr' });
  return { env, sent, post, get };
}

const NEWS = { subject: 'Les nouvelles du club', message: 'Bonjour à tous.\n\nTournoi le 20 décembre : https://club-exemple.example/actualites', greet: '1' };
const unsubLink = (mail) => mail.htmlContent.match(/href="(https:\/\/club-exemple.example\/newsletter\/desinscription\/[0-9a-f]{64})"/)[1];

const publicRequest = (url, init = {}) => {
  const token = new URL(url).pathname.split('/').pop();
  const request = new Request(url, init);
  return { request, params: { token } };
};

test('envoi : une adresse = un e-mail (responsable 2 compris), sans archive ni autre organisation, lien de désinscription en bas', async (t) => {
  const { sent, post, get } = await setup(t);
  assert.match(await (await get()).text(), /3 adresses/);
  assert.match(await (await post({ ...NEWS, action: 'preview' })).text(), /Se désinscrire de la newsletter/);
  assert.equal(sent.length, 0);
  const done = await (await post({ ...NEWS, action: 'send' })).text();
  assert.match(done, /envoyée à 3 adresses/);
  assert.deepEqual(sent.map((m) => m.to.map((r) => r.email)).sort(), [['karim@example.fr'], ['nadia@example.fr'], ['sofia@example.fr']]);
  for (const mail of sent) {
    assert.match(mail.htmlContent, /Se désinscrire de la newsletter/);
    assert.match(mail.textContent, /Se désinscrire de la newsletter : https:\/\/club-exemple.example\/newsletter\/desinscription\//);
    assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.equal(mail.headers['List-Unsubscribe'], `<${unsubLink(mail)}>`);
  }
  assert.match(sent.find((m) => m.to[0].email === 'sofia@example.fr').htmlContent, /Bonjour Sofia,/);
  // Historique.
  assert.match(await (await get()).text(), /Newsletters envoyées[\s\S]*Les nouvelles du club/);
});

test('désinscription : GET demande confirmation, POST désinscrit, exclu de l’envoi suivant, réinscription depuis le site', async (t) => {
  const { env, sent, post, get } = await setup(t);
  await post({ ...NEWS, action: 'send' });
  const link = unsubLink(sent.find((m) => m.to[0].email === 'karim@example.fr'));

  const confirm = await publicPage.onRequestGet({ ...publicRequest(link), env });
  assert.equal(confirm.status, 200);
  assert.match(await confirm.text(), /Me désinscrire/);
  assert.equal((await newsletterAudience(env.DB, A)).recipients.length, 3, 'une simple visite ne désinscrit pas');

  const done = await publicPage.onRequestPost({ ...publicRequest(link, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=unsubscribe' }), env });
  assert.match(await done.text(), /Désinscription confirmée/);
  const audience = await newsletterAudience(env.DB, A);
  assert.deepEqual(audience.recipients.map((r) => r.email).sort(), ['nadia@example.fr', 'sofia@example.fr']);
  assert.match(await (await get()).text(), /Désinscrits de la newsletter \(1\)[\s\S]*karim@example\.fr/);

  sent.length = 0;
  await post({ ...NEWS, action: 'send' });
  assert.equal(sent.length, 2);
  assert.ok(!sent.some((m) => m.to[0].email === 'karim@example.fr'));

  // Réinscription : refusée depuis un autre site, acceptée depuis le site.
  const foreign = await publicPage.onRequestPost({ ...publicRequest(link, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: 'action=resubscribe' }), env });
  assert.equal(foreign.status, 403);
  const back = await publicPage.onRequestPost({ ...publicRequest(link, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: SITE, 'Sec-Fetch-Site': 'same-origin' }, body: 'action=resubscribe' }), env });
  assert.match(await back.text(), /Réinscription confirmée|vous recevrez de nouveau/);
  assert.equal((await newsletterAudience(env.DB, A)).recipients.length, 3);
});

test('désinscription en un clic (RFC 8058) depuis les serveurs d’une messagerie, sans en-tête d’origine', async (t) => {
  const { env, sent, post } = await setup(t);
  await post({ ...NEWS, action: 'send' });
  const link = unsubLink(sent[0]);
  const res = await publicPage.onRequestPost({ ...publicRequest(link, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' }), env });
  assert.equal(res.status, 200);
  assert.equal((await newsletterAudience(env.DB, A)).recipients.length, 2);
});

test('jeton : falsifié, modifié ou d’une autre organisation = lien non valable, rien d’écrit', async (t) => {
  const { env } = await setup(t);
  const signerA = await newsletterSigner(env.DB, A);
  const signerB = await newsletterSigner(env.DB, ORG_B);
  const good = await signerA.token('karim@example.fr');
  assert.ok(await signerA.verify(good));
  assert.equal(await signerB.verify(good), null, 'clé propre à chaque organisation');
  const forged = `${good.slice(0, 63)}${good.endsWith('0') ? '1' : '0'}`;
  for (const token of [forged, 'abc', `${'0'.repeat(64)}`]) {
    const res = await publicPage.onRequestPost({ request: new Request(`${SITE}/newsletter/desinscription/${token}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' }), params: { token }, env });
    assert.equal(res.status, 404);
  }
  assert.equal((await newsletterAudience(env.DB, A)).recipients.length, 3);
  // La clé est stable : même jeton au second calcul.
  assert.equal(await (await newsletterSigner(env.DB, A)).token('KARIM@example.fr '), good);
});

test('SMTP : en-têtes List-Unsubscribe transmis, en-têtes inconnus ou avec retour à la ligne ignorés', () => {
  const raw = buildMessage(
    {
      sender: { email: 'contact@club-exemple.example' },
      to: [{ email: 'a@example.fr' }],
      subject: 'x',
      textContent: 'y',
      headers: { 'List-Unsubscribe': '<https://club-exemple.example/newsletter/desinscription/abc>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', Bcc: 'x@evil.example', 'List-Id': 'a\r\nBcc: x@evil.example' },
    },
    { messageId: 'id@test' }
  );
  assert.match(raw, /\r\nList-Unsubscribe: <https:\/\/club-exemple.example\/newsletter\/desinscription\/abc>\r\n/);
  assert.match(raw, /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/);
  assert.doesNotMatch(raw, /Bcc|evil/);
});

test('mise en forme : titres, gras, listes, liens, bouton, séparateur ; aucun HTML libre ; version texte lisible', async () => {
  const { newsletterBodyHtml, newsletterText, newsletterBlocks } = await import('../functions/_shared/confirmation-email.js');
  const message = [
    '## Le tournoi de Noël',
    'Rendez-vous **samedi 20 décembre** au stade.',
    'Inscriptions : [le formulaire](https://club-exemple.example/contact) ou https://club-exemple.example/actualites.',
    '',
    '### À prévoir',
    '- une gourde',
    '- des protège-tibias',
    '',
    '[Voir le programme](https://club-exemple.example/actualites)',
    '---',
    '<script>alert(1)</script> <img src=x onerror=alert(1)> [piège](javascript:alert(1))',
  ].join('\n');
  assert.deepEqual(newsletterBlocks(message).map((b) => b.type), ['h2', 'p', 'h3', 'ul', 'button', 'hr', 'p']);
  const html = newsletterBodyHtml(message);
  assert.match(html, /<h2[^>]*>Le tournoi de Noël<\/h2>/);
  assert.match(html, /<strong[^>]*>samedi 20 décembre<\/strong>/);
  assert.match(html, /<a href="https:\/\/club-exemple.example\/contact"[^>]*>le formulaire<\/a>/);
  assert.match(html, /<a href="https:\/\/club-exemple.example\/actualites"[^>]*>https:\/\/club-exemple.example\/actualites<\/a>\./);
  assert.match(html, /<li[^>]*>une gourde<\/li><li[^>]*>des protège-tibias<\/li>/);
  assert.match(html, /<td align="center"[^>]*><a href="https:\/\/club-exemple.example\/actualites"[^>]*>Voir le programme &rarr;<\/a>/);
  assert.match(html, /<hr /);
  assert.doesNotMatch(html, /<script|<img|href="javascript/);
  assert.match(html, /&lt;script&gt;/);
  const text = newsletterText(message);
  assert.match(text, /^LE TOURNOI DE NOËL\n=+/);
  assert.match(text, /le formulaire : https:\/\/club-exemple.example\/contact/);
  assert.match(text, /• une gourde\n• des protège-tibias/);
  assert.match(text, /Voir le programme : https:\/\/club-exemple.example\/actualites/);
  assert.doesNotMatch(text, /\*\*|##/);
});

test('aperçu en direct : rendu exact renvoyé en JSON, rien d’envoyé', async (t) => {
  const { sent, post } = await setup(t);
  const res = await post({ action: 'render', subject: 'Brouillon', message: '## Rubrique\n\nTexte **important**.', greet: '1' });
  assert.equal(res.status, 200);
  const { html } = await res.json();
  assert.match(html, /<h2[^>]*>Rubrique<\/h2>/);
  assert.match(html, /<strong[^>]*>important<\/strong>/);
  assert.match(html, /Se désinscrire de la newsletter/);
  assert.equal(sent.length, 0);
});

test('heure de Paris : conversion été/hiver, dates invalides, bornes de programmation', async () => {
  const { parisToDate, toSqlUtc, checkSchedule, formatParis } = await import('../functions/_shared/newsletter.js');
  assert.equal(toSqlUtc(parisToDate('2026-12-20', '18:30')), '2026-12-20 17:30:00'); // hiver : UTC+1
  assert.equal(toSqlUtc(parisToDate('2027-06-20', '18:30')), '2027-06-20 16:30:00'); // été : UTC+2
  assert.equal(formatParis('2026-12-20 17:30:00'), 'dimanche 20 décembre à 18:30');
  for (const [d, h] of [['2026-02-31', '10:00'], ['2026-12-20', '24:00'], ['20-12-2026', '10:00'], ['2026-12-20', '']]) assert.equal(parisToDate(d, h), null);
  const now = new Date('2026-11-13T10:00:00Z');
  assert.match(checkSchedule(new Date('2026-11-13T10:10:00Z'), now), /15 minutes/);
  assert.equal(checkSchedule(new Date('2026-11-13T10:20:00Z'), now), null);
  assert.match(checkSchedule(new Date('2027-02-01T10:00:00Z'), now), /60 jours/);
});

test('programmation : enregistrée, rien d’envoyé, annulable ; le cron l’envoie une seule fois à l’heure, désinscrits exclus', async (t) => {
  const { env, sent, post, get } = await setup(t);
  const { runScheduledNewsletters, unsubscribe, newsletterSigner } = await import('../functions/_shared/newsletter.js');
  const { onRequestPost: cron } = await import('../functions/api/cron.js');
  const { cronUrl, QUICK_CRON } = await import('../workers/cron/index.js');
  env.CRON_SECRET = 'secret-de-test';
  const callCron = () => cron({ request: new Request(cronUrl(SITE, QUICK_CRON), { method: 'POST', headers: { Authorization: 'Bearer secret-de-test' } }), env });
  assert.equal(cronUrl(SITE, '0 7 * * *'), `${SITE}/api/cron`);

  // Trop tôt : refusé.
  const now = new Date();
  const fmt = (d) => [new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d), new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(d)];
  const [d1, h1] = fmt(new Date(now.getTime() + 5 * 60000));
  assert.match(await (await post({ ...NEWS, action: 'schedule', jour: d1, heure: h1 })).text(), /au moins 15 minutes/);

  const [d2, h2] = fmt(new Date(now.getTime() + 2 * 3600000));
  const res = await post({ ...NEWS, action: 'schedule', jour: d2, heure: h2 });
  assert.match(await res.text(), /programmée pour/);
  assert.equal(sent.length, 0);
  assert.match(await (await get()).text(), /Programmées \(1\)[\s\S]*Les nouvelles du club/);

  // Pas encore l'heure : le passage rapide n'envoie rien.
  assert.equal((await callCron()).status, 200);
  assert.equal(sent.length, 0);

  // Une seconde, puis annulation de celle-ci.
  await post({ ...NEWS, subject: 'À annuler', action: 'schedule', jour: d2, heure: h2 });
  const id = (await env.DB.prepare("SELECT id FROM newsletters WHERE subject = 'À annuler'").first()).id;
  assert.match(await (await post({ action: 'cancel', id: String(id) })).text(), /annulé/);
  assert.equal((await post({ action: 'cancel', id: String(id) })).status, 409);

  // Karim se désinscrit entre-temps ; à l'heure dite, envoi aux deux autres adresses, une seule fois.
  const signer = await newsletterSigner(env.DB, A);
  await unsubscribe(env.DB, A, await signer.emailHash('karim@example.fr'));
  const later = new Date(now.getTime() + 3 * 3600000);
  const send = (recipient) => { sent.push({ to: [{ email: recipient.email }] }); return true; };
  const report = await runScheduledNewsletters(env.DB, A, send, { now: later });
  assert.deepEqual(report, { newsletters: 1, sent: 2, failed: 0 });
  assert.deepEqual(sent.map((m) => m.to[0].email).sort(), ['nadia@example.fr', 'sofia@example.fr']);
  assert.deepEqual(await runScheduledNewsletters(env.DB, A, send, { now: later }), { newsletters: 0, sent: 0, failed: 0 });
  const rows = (await env.DB.prepare('SELECT subject, status, sent_count FROM newsletters ORDER BY id').all()).results;
  assert.deepEqual(rows.map((r) => [r.subject, r.status, r.sent_count]), [['Les nouvelles du club', 'envoyee', 2], ['À annuler', 'annulee', 0]]);
  const page = await (await get()).text();
  assert.doesNotMatch(page, /Programmées \(/);
  assert.match(page, /À annuler<\/strong> · Programmée pour .*, annulée/);
});

test('cron : le passage rapide n’exécute que les newsletters ; une newsletter échue part par le vrai envoi', async (t) => {
  const { env, sent } = await setup(t);
  const { scheduleNewsletter } = await import('../functions/_shared/newsletter.js');
  const { onRequestPost: cron } = await import('../functions/api/cron.js');
  env.CRON_SECRET = 'secret-de-test';
  await scheduleNewsletter(env.DB, A, { subject: 'Échue', message: 'Texte **important**', greet: true, date: new Date(Date.now() - 60000) });
  const res = await cron({ request: new Request(`${SITE}/api/cron?taches=newsletters`, { method: 'POST', headers: { Authorization: 'Bearer secret-de-test' } }), env });
  const body = await res.json();
  assert.deepEqual(Object.keys(body), ['newsletters']);
  assert.deepEqual(body.newsletters, { newsletters: 1, sent: 3, failed: 0 });
  assert.equal(sent.length, 3);
  assert.ok(sent.every((m) => m.subject === 'Échue' && /<strong[^>]*>important<\/strong>/.test(m.htmlContent) && m.headers['List-Unsubscribe']));
});
