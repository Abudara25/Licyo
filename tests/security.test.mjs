import test from 'node:test';
import assert from 'node:assert/strict';
import {
  timingSafeEqual,
  hashPassword,
  verifyPassword,
  isPasswordHash,
  randomToken,
  sniffFileType,
  readUpload,
  hitRateLimit,
  isRateLimited,
  clearRateLimit,
  verifyTurnstile,
} from '../functions/_shared/security.js';
import { createD1 } from './helpers/d1.mjs';

const bytes = (...values) => new Uint8Array(values).buffer;

test('timingSafeEqual compare les chaînes sans raccourci', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
  assert.equal(timingSafeEqual('é', 'e'), false);
});

test('hashPassword / verifyPassword', async () => {
  const hash = await hashPassword('Mot-de-passe 2026');
  assert.ok(isPasswordHash(hash));
  assert.ok(!hash.includes('Mot-de-passe'));
  assert.equal(await verifyPassword('Mot-de-passe 2026', hash), true);
  assert.equal(await verifyPassword('mot-de-passe 2026', hash), false);
  assert.equal(await verifyPassword('', hash), false);
  // deux empreintes du même mot de passe diffèrent (sel aléatoire)
  assert.notEqual(await hashPassword('x', { iterations: 1000 }), await hashPassword('x', { iterations: 1000 }));
  // valeur héritée stockée en clair
  assert.equal(await verifyPassword('ancien', 'ancien'), true);
  assert.equal(await verifyPassword('autre', 'ancien'), false);
  assert.equal(await verifyPassword('x', 'pbkdf2$abc$$'), false);
});

test('randomToken produit des jetons URL-safe et distincts', () => {
  const a = randomToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, randomToken());
});

test('sniffFileType reconnaît le contenu réel', () => {
  assert.equal(sniffFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37)), 'application/pdf');
  assert.equal(sniffFileType(bytes(0x0a, 0x0a, 0x25, 0x50, 0x44, 0x46, 0x2d)), 'application/pdf');
  assert.equal(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(sniffFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'image/png');
  assert.equal(sniffFileType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50)), 'image/webp');
  assert.equal(sniffFileType(new TextEncoder().encode('<html><script>alert(1)</script>').buffer), null);
  assert.equal(sniffFileType(bytes()), null);
});

test('readUpload ignore le type annoncé par le navigateur', async () => {
  const allowedTypes = new Set(['application/pdf', 'image/png']);
  const fakePdf = new File(['<html>'], 'dossier.pdf', { type: 'application/pdf' });
  assert.deepEqual(await readUpload(fakePdf, { allowedTypes, maxSize: 1000 }), { error: 'bad_type' });

  const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], 'photo.pdf', { type: 'application/pdf' });
  const result = await readUpload(png, { allowedTypes, maxSize: 1000 });
  assert.equal(result.type, 'image/png');
  assert.equal(result.buffer.byteLength, 10);

  assert.deepEqual(await readUpload(png, { allowedTypes, maxSize: 5 }), { error: 'too_large' });
  assert.deepEqual(await readUpload(null, { allowedTypes, maxSize: 5 }), { error: 'empty' });
  assert.deepEqual(await readUpload('texte', { allowedTypes, maxSize: 5 }), { error: 'empty' });
});

test('limitation de débit à fenêtre fixe', async () => {
  const db = createD1();
  const limits = { limit: 2, windowSeconds: 60 };
  const t0 = Date.UTC(2026, 8, 15, 10, 0, 0);

  assert.equal((await hitRateLimit(db, 'login:a', limits, t0)).allowed, true);
  assert.equal(await isRateLimited(db, 'login:a', limits, t0), false);
  assert.equal((await hitRateLimit(db, 'login:a', limits, t0 + 1000)).allowed, true);
  assert.equal(await isRateLimited(db, 'login:a', limits, t0 + 1000), true);
  const third = await hitRateLimit(db, 'login:a', limits, t0 + 2000);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfter, 58);

  // une autre clé n'est pas concernée
  assert.equal((await hitRateLimit(db, 'login:b', limits, t0 + 2000)).allowed, true);
  // la fenêtre expirée repart de zéro
  assert.equal((await hitRateLimit(db, 'login:a', limits, t0 + 61_000)).allowed, true);
  assert.equal(await isRateLimited(db, 'login:a', limits, t0 + 61_000), false);

  await hitRateLimit(db, 'login:a', limits, t0 + 62_000);
  assert.equal(await isRateLimited(db, 'login:a', limits, t0 + 62_000), true);
  await clearRateLimit(db, 'login:a');
  assert.equal(await isRateLimited(db, 'login:a', limits, t0 + 62_000), false);
});

test('Turnstile : inactif sans secret, jeton exigé avec', async () => {
  const request = new Request('https://clubdemo.licyo.fr/api/inscriptions', { method: 'POST' });
  assert.equal(await verifyTurnstile({}, undefined, request), true);
  assert.equal(await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret' }, '', request), false);
  assert.equal(await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret' }, 42, request), false);
});
