// Envoi d'e-mails par SMTP depuis la messagerie du club (Infomaniak, 2026-10-09), sans service intermédiaire.
// Cloudflare autorise les connexions TCP sortantes (cloudflare:sockets) sauf sur le port 25 : on utilise la
// soumission SMTP chiffrée d'office (port 465, TLS implicite), authentifiée par l'adresse de la boîte et son mot de
// passe (secret SMTP_PASSWORD). Le DNS est déjà prêt : SPF « include:spf.infomaniak.ch » et clé DKIM d'Infomaniak.
//
// Reçoit le même corps que l'API Brevo ({ sender, to, subject, htmlContent, textContent }) pour que brevoSend
// (confirmation-email.js) puisse choisir l'un ou l'autre sans toucher aux modèles. Ne lève jamais : renvoie
// { ok, status, messageId, error, dataSent }. dataSent = le message complet a été transmis au serveur : en cas
// d'erreur à ce stade, il a pu partir quand même, et l'appelant ne doit pas le renvoyer par un autre chemin.

const DEFAULT_HOST = 'mail.infomaniak.com';
const DEFAULT_PORT = 465;
const TIMEOUT_MS = 20_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

let connectOverride = null;
// Réservé aux tests : remplace connect() de cloudflare:sockets (absent sous Node).
export function setSmtpConnectForTests(fn) {
  connectOverride = fn;
}
async function getConnect() {
  if (connectOverride) return connectOverride;
  const sockets = await import('cloudflare:sockets');
  return sockets.connect;
}

export class SmtpError extends Error {
  constructor(message, code = null) {
    super(message);
    this.name = 'SmtpError';
    this.code = code;
  }
}

// Base64 d'une chaîne UTF-8, sans dépasser la pile sur un long HTML.
function base64(text) {
  const bytes = encoder.encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();

// En-tête non ASCII : mots encodés RFC 2047, découpés sans couper un caractère (≤ 45 octets par mot).
export function encodeHeader(text) {
  const value = String(text ?? '').replace(/[\r\n]+/g, ' ');
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  const words = [];
  let chunk = '';
  for (const char of value) {
    if (encoder.encode(chunk + char).length > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(w)}?=`).join('\r\n ');
}

// Adresse sûre (aucun retour à la ligne ni chevron : pas d'injection d'en-tête ou de commande SMTP).
function cleanAddress(email) {
  const value = String(email || '').trim();
  if (!/^[^\s<>"(),;:\\]+@[^\s<>"(),;:\\]+$/.test(value)) throw new SmtpError('Adresse invalide');
  return value;
}
// Nom affiché : entre guillemets s'il est en ASCII, sinon en mots encodés (jamais les deux à la fois).
function displayName(name) {
  const value = String(name).replace(/[\r\n"\\]/g, '').trim();
  return /^[\x20-\x7e]*$/.test(value) ? `"${value}"` : encodeHeader(value);
}
const mailbox = (r) => (r?.name ? `${displayName(r.name)} <${cleanAddress(r.email)}>` : cleanAddress(r?.email));

export function buildMessage(body, { messageId, date = new Date() } = {}) {
  const to = (body.to || []).map(mailbox);
  if (!to.length) throw new SmtpError('Aucun destinataire');
  const headers = [
    `From: ${mailbox(body.sender)}`,
    `To: ${to.join(', ')}`,
    ...(body.replyTo?.email ? [`Reply-To: ${mailbox(body.replyTo)}`] : []),
    `Subject: ${encodeHeader(body.subject)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
  ];
  const part = (type, content) => `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(base64(content))}`;
  const parts = [body.textContent && part('text/plain', body.textContent), body.htmlContent && part('text/html', body.htmlContent)].filter(Boolean);
  if (!parts.length) throw new SmtpError('Message vide');
  if (parts.length === 1) return `${headers.join('\r\n')}\r\n${parts[0]}`;
  const boundary = `demo-${crypto.randomUUID()}`;
  return `${headers.join('\r\n')}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}`).join('\r\n')}\r\n--${boundary}--`;
}

// Lecture des réponses SMTP (éventuellement sur plusieurs lignes « 250-… » puis « 250 … »).
function replyReader(readable) {
  const reader = readable.getReader();
  let buffer = '';
  return {
    async read() {
      const lines = [];
      for (;;) {
        let end;
        while ((end = buffer.indexOf('\r\n')) < 0) {
          const { value, done } = await reader.read();
          if (done) throw new SmtpError('Connexion fermée par le serveur');
          buffer += decoder.decode(value, { stream: true });
        }
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        lines.push(line);
        if (/^\d{3}(?: |$)/.test(line)) return { code: Number(line.slice(0, 3)), text: lines.join('\n') };
      }
    },
    release: () => reader.releaseLock(),
  };
}

export async function sendSmtp(env, body) {
  const host = env.SMTP_HOST || DEFAULT_HOST;
  const port = Number(env.SMTP_PORT) || DEFAULT_PORT;
  const user = env.SMTP_USER || body?.sender?.email;
  const domain = String(body?.sender?.email || '').split('@')[1] || 'localhost';
  const messageId = `${crypto.randomUUID()}@${domain}`;
  let socket = null;
  let dataSent = false;
  let timer;

  const run = async () => {
    const message = buildMessage(body, { messageId });
    const recipients = (body.to || []).map((r) => cleanAddress(r.email));
    const connect = await getConnect();
    socket = connect({ hostname: host, port }, { secureTransport: 'on', allowHalfOpen: false });
    const writer = socket.writable.getWriter();
    const replies = replyReader(socket.readable);
    const send = (line) => writer.write(encoder.encode(`${line}\r\n`));
    const expect = async (codes, step) => {
      const reply = await replies.read();
      if (!codes.includes(reply.code)) throw new SmtpError(`${step} : refus du serveur (${reply.code})`, reply.code);
      return reply;
    };

    await expect([220], 'Connexion');
    await send(`EHLO ${domain}`);
    await expect([250], 'EHLO');
    await send(`AUTH PLAIN ${base64(`\0${user}\0${env.SMTP_PASSWORD}`)}`);
    await expect([235], 'Authentification');
    await send(`MAIL FROM:<${cleanAddress(body.sender?.email)}>`);
    await expect([250], 'Expéditeur');
    for (const rcpt of recipients) {
      await send(`RCPT TO:<${rcpt}>`);
      await expect([250, 251], 'Destinataire');
    }
    await send('DATA');
    await expect([354], 'DATA');
    // Point en début de ligne doublé (RFC 5321 §4.5.2), puis fin du message.
    await writer.write(encoder.encode(`${message.replace(/\r\n\./g, '\r\n..')}\r\n.\r\n`));
    dataSent = true;
    const accepted = await expect([250], 'Message');
    await send('QUIT').catch(() => {});
    replies.release();
    return { ok: true, status: accepted.code, messageId: `smtp:${messageId}`, error: null, dataSent };
  };

  try {
    return await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new SmtpError('Délai dépassé')), TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    // Jamais le message d'une erreur inconnue (il pourrait citer une valeur) : seulement les nôtres.
    const message = error instanceof SmtpError ? error.message : `Erreur SMTP (${error?.name || 'inconnue'})`;
    return { ok: false, status: error?.code ?? null, messageId: null, error: message, dataSent };
  } finally {
    clearTimeout(timer);
    try {
      await socket?.close();
    } catch {
      // déjà fermée
    }
  }
}
