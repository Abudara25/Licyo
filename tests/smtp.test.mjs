// 2026-10-09 : envoi par SMTP depuis la boîte contact@ d'Infomaniak, Brevo en secours (voir _shared/smtp.js).
// Un faux serveur SMTP en mémoire remplace cloudflare:sockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { setSmtpConnectForTests, sendSmtp, encodeHeader, buildMessage } from '../functions/_shared/smtp.js';
import { sendCronFailureAlert, mailConfigured } from '../functions/_shared/confirmation-email.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { fixture } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const SITE = 'https://clubdemo.licyo.fr';
const enc = new TextEncoder();
const dec = new TextDecoder();

// Faux serveur : répond à chaque commande ; `fail` = { commande: code } pour simuler un refus,
// `dropAfterData` = ferme la connexion après réception du message (avant la réponse 250).
function fakeServer({ fail = {}, dropAfterData = false } = {}) {
  const session = { commands: [], data: '', options: null, closed: false };
  const connect = (address, options) => {
    session.address = address;
    session.options = options;
    let controller;
    const readable = new ReadableStream({ start(c) { controller = c; } });
    const reply = (line) => controller.enqueue(enc.encode(`${line}\r\n`));
    reply('220 mail.infomaniak.com ESMTP');
    let inData = false;
    let buffer = '';
    const answer = (command) => {
      const verb = command.split(/[ :]/)[0].toUpperCase();
      session.commands.push(command);
      if (fail[verb]) return reply(`${fail[verb]} refus`);
      if (verb === 'EHLO') { reply('250-mail.infomaniak.com'); return reply('250 AUTH PLAIN LOGIN'); }
      if (verb === 'AUTH') return reply('235 2.7.0 Authentication successful');
      if (verb === 'MAIL' || verb === 'RCPT') return reply('250 2.1.0 Ok');
      if (verb === 'DATA') { inData = true; return reply('354 End data with <CR><LF>.<CR><LF>'); }
      if (verb === 'QUIT') return reply('221 Bye');
      return reply('500 ?');
    };
    const writable = new WritableStream({
      write(chunk) {
        buffer += dec.decode(chunk);
        for (;;) {
          if (inData) {
            const end = buffer.indexOf('\r\n.\r\n');
            if (end < 0) return;
            session.data = buffer.slice(0, end);
            buffer = buffer.slice(end + 5);
            inData = false;
            if (dropAfterData) { controller.close(); return; }
            reply(fail.MESSAGE ? `${fail.MESSAGE} refus` : '250 2.0.0 Ok: queued');
            continue;
          }
          const end = buffer.indexOf('\r\n');
          if (end < 0) return;
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          answer(line);
        }
      },
    });
    return { readable, writable, close: async () => { session.closed = true; } };
  };
  return { connect, session };
}

const body = (overrides = {}) => ({
  sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
  to: [{ email: 'club@example.fr' }, { email: 'autre@example.fr', name: 'Léa Exemple' }],
  subject: 'Espace admin : l’automatisation a échoué — détails',
  htmlContent: '<p>Bonjour <strong>équipe</strong></p>\n.ligne commençant par un point',
  textContent: 'Bonjour équipe',
  ...overrides,
});

const b64decode = (s) => dec.decode(Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));

test('SMTP : authentification, destinataires, message MIME en UTF-8, connexion TLS sur 465', async (t) => {
  const server = fakeServer();
  setSmtpConnectForTests(server.connect);
  t.after(() => setSmtpConnectForTests(null));
  const result = await sendSmtp({ SMTP_PASSWORD: 'secret-test' }, body());
  assert.equal(result.ok, true);
  assert.match(result.messageId, /^smtp:[0-9a-f-]+@clubdemo\.licyo\.fr$/);
  assert.deepEqual(server.session.address, { hostname: 'mail.infomaniak.com', port: 465 });
  assert.equal(server.session.options.secureTransport, 'on');
  const [ehlo, auth, from, rcpt1, rcpt2, data, quit] = server.session.commands;
  assert.equal(ehlo, 'EHLO clubdemo.licyo.fr');
  assert.equal(b64decode(auth.slice('AUTH PLAIN '.length)), '\0contact@clubdemo.licyo.fr\0secret-test');
  assert.deepEqual([from, rcpt1, rcpt2, data, quit], ['MAIL FROM:<contact@clubdemo.licyo.fr>', 'RCPT TO:<club@example.fr>', 'RCPT TO:<autre@example.fr>', 'DATA', 'QUIT']);
  const message = server.session.data;
  assert.match(message, /^From: =\?UTF-8\?B\?[^?]+\?=.* <contact@clubdemo\.licyo\.fr>\r\n/m);
  assert.match(message, /^To: club@example\.fr, =\?UTF-8\?B\?/m);
  assert.match(message, /Content-Type: multipart\/alternative; boundary="demo-/);
  const parts = message.split(/\r\n\r\n/);
  const html = b64decode(parts[parts.findIndex((p) => p.includes('text/html')) + 1].split('\r\n--')[0]);
  assert.equal(html, body().htmlContent);
  assert.ok(server.session.closed, 'connexion fermée');
});

test('SMTP : en-têtes encodés sans couper un caractère, aucune injection possible', async (t) => {
  const encoded = encodeHeader('Inscription de Léa — dossier à vérifier ✅ éèêë'.repeat(3));
  const decoded = encoded.split('\r\n ').map((w) => b64decode(w.slice(10, -2))).join('');
  assert.equal(decoded, 'Inscription de Léa — dossier à vérifier ✅ éèêë'.repeat(3));
  assert.ok(encoded.split('\r\n ').every((w) => w.length <= 75));
  assert.equal(encodeHeader('Simple'), 'Simple');
  assert.doesNotMatch(buildMessage(body({ subject: 'A\r\nBcc: pirate@example.fr' }), { messageId: 'x@y' }), /^Bcc:/m);

  const server = fakeServer();
  setSmtpConnectForTests(server.connect);
  t.after(() => setSmtpConnectForTests(null));
  const result = await sendSmtp({ SMTP_PASSWORD: 'x' }, body({ to: [{ email: 'a@example.fr>\r\nRCPT TO:<pirate@example.fr' }] }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Adresse invalide');
  assert.deepEqual(server.session.commands, [], 'rien envoyé au serveur');
});

async function setupEnv(extra = {}) {
  const env = { ...(await fixture()), SMTP_PASSWORD: 'secret-test', ...extra };
  await getCategoriesConfig(env, A);
  return env;
}
const lastLog = (env) => env.DB.prepare('SELECT kind, ok, status, message_id, error FROM email_log ORDER BY id DESC LIMIT 1').first().then((r) => ({ ...r }));

test('envoi du site : passe par SMTP, Brevo n’est pas appelé, journal « envoyé »', async (t) => {
  const server = fakeServer();
  setSmtpConnectForTests(server.connect);
  t.after(() => setSmtpConnectForTests(null));
  const env = await setupEnv({ BREVO_API_KEY: 'cle-brevo' });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 201 }));
  assert.equal(await sendCronFailureAlert(env, SITE, { at: '2026-10-10T07:00:00Z', step: 'crm', organizationId: A }), true);
  assert.equal(fetchMock.mock.callCount(), 0);
  const log = await lastLog(env);
  assert.deepEqual([log.kind, log.ok, log.status], ['club_cron', 1, 250]);
  assert.match(log.message_id, /^smtp:/);
});

test('envoi du site : SMTP refusé avant le message = Brevo en secours', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const server = fakeServer({ fail: { AUTH: 535 } });
  setSmtpConnectForTests(server.connect);
  t.after(() => setSmtpConnectForTests(null));
  const env = await setupEnv({ BREVO_API_KEY: 'cle-brevo' });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ messageId: '<brevo-1>' }), { status: 201 }));
  assert.equal(await sendCronFailureAlert(env, SITE, { at: '2026-10-10T07:00:00Z', step: 'crm', organizationId: A }), true);
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal((await lastLog(env)).message_id, '<brevo-1>');
});

test('envoi du site : connexion perdue après le message = pas de second envoi (pas de doublon)', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const server = fakeServer({ dropAfterData: true });
  setSmtpConnectForTests(server.connect);
  t.after(() => setSmtpConnectForTests(null));
  const env = await setupEnv({ BREVO_API_KEY: 'cle-brevo' });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 201 }));
  assert.equal(await sendCronFailureAlert(env, SITE, { at: '2026-10-10T07:00:00Z', step: 'crm', organizationId: A }), false);
  assert.equal(fetchMock.mock.callCount(), 0);
  const log = await lastLog(env);
  assert.equal(log.ok, 0);
  assert.equal(log.error, 'Connexion fermée par le serveur');
});

test('envoi du site : SMTP seul (sans Brevo) en échec = journal « échec », aucun secret dans le journal', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const server = fakeServer({ fail: { RCPT: 550 } });
  setSmtpConnectForTests(server.connect);
  t.after(() => setSmtpConnectForTests(null));
  const env = await setupEnv();
  assert.equal(await sendCronFailureAlert(env, SITE, { at: '2026-10-10T07:00:00Z', step: 'crm', organizationId: A }), false);
  const log = await lastLog(env);
  assert.deepEqual([log.ok, log.status, log.error], [0, 550, 'Destinataire : refus du serveur (550)']);
  const all = JSON.stringify((await env.DB.prepare('SELECT * FROM email_log').all()).results);
  assert.doesNotMatch(all, /secret-test/);
});

test('service d’envoi configuré : SMTP ou Brevo', () => {
  assert.equal(mailConfigured({}), false);
  assert.equal(mailConfigured({ SMTP_PASSWORD: 'x' }), true);
  assert.equal(mailConfigured({ BREVO_API_KEY: 'x' }), true);
});
