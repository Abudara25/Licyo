// Message RFC 5322 minimal (texte + HTML, UTF-8) pour l'API Gmail.

export type MimeAddress = { name?: string; address: string };

function b64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** En-tête encodé (RFC 2047) ; refuse les retours à la ligne (injection d'en-têtes). */
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]/g, ' ');
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${b64(clean)}?=`;
}

function formatAddress(a: MimeAddress): string {
  const address = a.address.replace(/[\r\n<>]/g, '');
  return a.name ? `${encodeHeader(a.name.replace(/"/g, ''))} <${address}>` : address;
}

function wrap76(value: string): string {
  return value.replace(/.{1,76}/g, '$&\r\n');
}

export function buildMime(msg: {
  from: MimeAddress;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): string {
  const boundary = `licyo-${crypto.randomUUID()}`;
  const headers = [
    `From: ${formatAddress(msg.from)}`,
    `To: ${formatAddress({ address: msg.to })}`,
    msg.replyTo ? `Reply-To: ${formatAddress({ address: msg.replyTo })}` : null,
    `Subject: ${encodeHeader(msg.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ].filter(Boolean);
  const part = (type: string, body: string) =>
    `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(body))}`;
  return `${headers.join('\r\n')}\r\n\r\n${part('text/plain', msg.text)}${part('text/html', msg.html)}--${boundary}--\r\n`;
}

export function toBase64Url(value: string): string {
  return b64(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
