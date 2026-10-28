import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Chiffrement AES-256-GCM des identifiants d'e-mail des clubs (refresh token
// Gmail, mot de passe SMTP). Format : iv.tag.données, en base64url.

function key(): Buffer {
  const raw = process.env.EMAIL_CREDENTIALS_ENCRYPTION_KEY;
  const k = raw ? Buffer.from(raw, 'base64') : Buffer.alloc(0);
  if (k.length !== 32) throw new Error('EMAIL_CREDENTIALS_ENCRYPTION_KEY doit faire 32 octets encodés en base64.');
  return k;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
