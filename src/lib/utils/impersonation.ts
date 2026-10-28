// Valeurs signées HMAC (cookie du Mode Miroir, state OAuth). Web Crypto :
// utilisable dans le middleware (Edge) comme dans les Server Components (Node).

export const IMPERSONATION_COOKIE = 'impersonated_club_id';
export const IMPERSONATION_MAX_AGE = 60 * 60 * 4; // 4 heures

function getKeyMaterial(): string {
  const key = process.env.IMPERSONATION_SECRET_KEY;
  if (!key || key.length < 32) {
    throw new Error('IMPERSONATION_SECRET_KEY manquante ou trop courte (32 caractères minimum).');
  }
  return key;
}

function toBase64Url(buf: ArrayBuffer): string {
  let bin = '';
  for (const byte of new Uint8Array(buf)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getKeyMaterial()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toBase64Url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Valeur signée : partie1.partie2….expiration.signature. Les parties ne contiennent pas de point. */
export async function signValue(parts: string[], ttlSeconds = IMPERSONATION_MAX_AGE): Promise<string> {
  if (parts.some((p) => p.includes('.'))) throw new Error('Une partie signée ne peut pas contenir de point.');
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = [...parts, String(exp)].join('.');
  return `${payload}.${await hmac(payload)}`;
}

/** Renvoie les parties si la signature est valide et non expirée, sinon null. */
export async function verifyValue(value: string | undefined | null, expectedParts: number): Promise<string[] | null> {
  if (!value) return null;
  const pieces = value.split('.');
  if (pieces.length !== expectedParts + 2) return null;
  const sig = pieces.pop()!;
  const exp = Number(pieces[pieces.length - 1]);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  if (!timingSafeEqual(sig, await hmac(pieces.join('.')))) return null;
  return pieces.slice(0, expectedParts);
}

/** Cookie lié au super_admin qui l'a posé : inutilisable par un autre compte. */
export function signImpersonation(clubId: string, superAdminUserId: string) {
  return signValue([clubId, superAdminUserId]);
}

export async function verifyImpersonation(value: string | undefined, currentUserId: string): Promise<string | null> {
  const parts = await verifyValue(value, 2);
  if (!parts || parts[1] !== currentUserId) return null;
  return parts[0];
}
