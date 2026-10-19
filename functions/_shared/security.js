// Primitives de sécurité partagées par les Functions : empreintes, jetons aléatoires, comparaison à
// temps constant, hachage des mots de passe (PBKDF2), limitation de débit (table D1), vérification du
// vrai type d'un fichier envoyé et contrôle anti-robot Cloudflare Turnstile. Uniquement WebCrypto :
// fonctionne à l'identique dans les Workers et dans Node (tests/).
const encoder = new TextEncoder();

const toBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromBase64 = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Jeton URL-safe (base64url) de `bytes` octets aléatoires : 32 octets = 256 bits.
export function randomToken(bytes = 32) {
  return toBase64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Durée indépendante de la position du premier caractère différent (contrairement à === ou !==).
export function timingSafeEqual(a, b) {
  const x = encoder.encode(String(a ?? ''));
  const y = encoder.encode(String(b ?? ''));
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------- Mots de passe ----------
// Format stocké : pbkdf2$<itérations>$<sel base64>$<empreinte base64>. 100 000 itérations est le
// plafond accepté par PBKDF2 dans les Workers.
const PBKDF2_ITERATIONS = 100000;

export const isPasswordHash = (value) => typeof value === 'string' && value.startsWith('pbkdf2$');

export async function hashPassword(password, { iterations = PBKDF2_ITERATIONS, salt = crypto.getRandomValues(new Uint8Array(16)) } = {}) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(bits)}`;
}

// Accepte aussi une valeur en clair (mot de passe enregistré avant le hachage) : l'appelant la
// remplace alors par son empreinte (voir verifyAdminPassword dans admin-auth.js).
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || !password || !stored) return false;
  if (!isPasswordHash(stored)) return timingSafeEqual(password, stored);
  const [, rawIterations, salt, hash] = stored.split('$');
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations <= 0 || !salt || !hash) return false;
  const candidate = await hashPassword(password, { iterations, salt: fromBase64(salt) });
  return timingSafeEqual(candidate, stored);
}

// ---------- Limitation de débit ----------
// Compteurs à fenêtre fixe dans D1 (une ligne par clé). L'adresse IP n'est jamais stockée en clair :
// seule son empreinte sert de clé. Les appelants traitent une erreur de base comme "autorisé", pour
// qu'une panne D1 ne bloque pas les familles ni les responsables.
// Création de la table gardée par base (WeakMap) : une seule fois par binding D1 en production, et une fois par
// base dans les tests (qui en créent une neuve chacun).
const rateLimitTables = new WeakMap();
function ensureRateLimitTable(db) {
  if (!rateLimitTables.has(db)) {
    rateLimitTables.set(
      db,
      db
        .prepare('CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL)')
        .run()
        .catch((error) => {
          rateLimitTables.delete(db);
          throw error;
        })
    );
  }
  return rateLimitTables.get(db);
}

export async function clientKey(request) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'inconnue';
  return (await sha256Hex(`demo:${ip}`)).slice(0, 32);
}

// Formulaire POST envoyé depuis le site lui-même ? Le cookie de session (SameSite=Lax) n'accompagne déjà pas un POST
// venu d'un AUTRE SITE, mais « même site » inclut les sous-domaines voisins (futurs sites clients sur
// *.example.test à côté de app.example.test) : ce contrôle exige donc la MÊME ORIGINE.
// - Origin présent : doit être exactement l'origine de la requête (« null », envoyé par une iframe sandbox,
//   un fichier local ou une redirection entre origines, est refusé) ;
// - Sec-Fetch-Site présent : « same-origin » ou « none » (action directe de l'utilisateur) ; « same-site »
//   et « cross-site » sont refusés ;
// - les deux absents (navigateur très ancien, client hors navigateur) : accepté. Un tel client n'envoie pas
//   de lui-même les cookies d'une victime ; le jeton CSRF (csrf.js) couvre ce cas pour les requêtes authentifiées.
export function isSameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== new URL(request.url).origin) return false;
  const site = request.headers.get('Sec-Fetch-Site');
  return site === null || site === 'same-origin' || site === 'none';
}

// Version stricte, pour les envois des pages à jeton des familles (/depot/*) qui n'ont pas de jeton CSRF :
// un signal d'origine est EXIGÉ. Les formulaires de ces pages sont des formulaires HTML natifs, en POST,
// de même origine : tout navigateur actuel y joint Origin (et Sec-Fetch-Site pour Chrome, Firefox, Edge,
// Safari 16.4+). Aucun client hors navigateur n'utilise ces routes.
// Accepté : Origin = origine du site (Sec-Fetch-Site absent ou same-origin), ou Sec-Fetch-Site: same-origin
// sans Origin. Refusé : tout le reste, y compris l'absence des deux en-têtes et Sec-Fetch-Site: none.
export function hasSameOriginSignal(request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin === null && site === null) return false;
  if (site !== null && site !== 'same-origin') return false;
  return origin === null || origin === new URL(request.url).origin;
}

const nowSeconds = (now) => Math.floor(now / 1000);

// Compte une occurrence et dit si la limite est dépassée.
export async function hitRateLimit(db, bucket, { limit, windowSeconds }, now = Date.now()) {
  await ensureRateLimitTable(db);
  const current = nowSeconds(now);
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (bucket, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`
    )
    .bind(bucket, current + windowSeconds, current)
    .first();
  if (Math.random() < 0.02) await db.prepare('DELETE FROM rate_limits WHERE reset_at <= ?').bind(current).run();
  return { allowed: row.count <= limit, retryAfter: Math.max(0, row.reset_at - current) };
}

// Consulte sans compter (ex. : login, où seuls les échecs sont comptés).
export async function isRateLimited(db, bucket, { limit }, now = Date.now()) {
  await ensureRateLimitTable(db);
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE bucket = ?').bind(bucket).first();
  return Boolean(row && row.reset_at > nowSeconds(now) && row.count >= limit);
}

export async function clearRateLimit(db, bucket) {
  await ensureRateLimitTable(db);
  await db.prepare('DELETE FROM rate_limits WHERE bucket = ?').bind(bucket).run();
}

// ---------- Fichiers envoyés ----------
// Type déduit des premiers octets du fichier, jamais du type annoncé par le navigateur (falsifiable).
export function sniffFileType(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024));
  const startsWith = (signature, offset = 0) => signature.every((byte, i) => bytes[offset + i] === byte);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  // La norme PDF tolère quelques octets avant l'en-tête "%PDF-" (dans les 1024 premiers).
  const pdfHeader = [0x25, 0x50, 0x44, 0x46, 0x2d];
  for (let offset = 0; offset + pdfHeader.length <= bytes.length; offset++) {
    if (startsWith(pdfHeader, offset)) return 'application/pdf';
  }
  return null;
}

// error : 'empty' | 'too_large' | 'bad_type' — chaque page traduit le code en message pour son public.
export async function readUpload(file, { allowedTypes, maxSize }) {
  if (!file || typeof file === 'string' || !file.size) return { error: 'empty' };
  if (file.size > maxSize) return { error: 'too_large' };
  const buffer = await file.arrayBuffer();
  const type = sniffFileType(buffer);
  if (!type || !allowedTypes.has(type)) return { error: 'bad_type' };
  return { buffer, type };
}

// ---------- Cloudflare Turnstile ----------
// Actif seulement quand le secret TURNSTILE_SECRET_KEY est défini sur le projet Pages : tant qu'il
// ne l'est pas, le formulaire fonctionne comme avant (voir assets/js/inscription.js).
export async function verifyTurnstile(env, token, request) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token || typeof token !== 'string') return false;
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const result = await res.json();
    return result.success === true;
  } catch {
    return false;
  }
}
