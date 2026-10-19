import test from 'node:test';
import assert from 'node:assert/strict';
import { isPreviewHost, previewGuard, onRequest } from '../functions/_shared/environment.js';

test('hôtes de prévisualisation reconnus, production et local exclus', () => {
  assert.equal(isPreviewHost('3f2a1b.licyo.pages.dev'), true);
  assert.equal(isPreviewHost('feat-saas-foundation.licyo.pages.dev'), true);
  assert.equal(isPreviewHost('licyo.pages.dev'), false);
  assert.equal(isPreviewHost('clubdemo.licyo.fr'), false);
  assert.equal(isPreviewHost('www.clubdemo.licyo.fr'), false);
  assert.equal(isPreviewHost('localhost'), false);
});

test('une prévisualisation non isolée ne touche jamais aux données', async () => {
  const preview = new Request('https://feat-x.licyo.pages.dev/api/inscriptions', { method: 'POST' });
  let reached = false;
  const next = async () => {
    reached = true;
    return new Response('ok');
  };
  const blocked = await onRequest({ request: preview, env: {}, next });
  assert.equal(blocked.status, 503);
  assert.equal(reached, false, 'la Function n’est pas exécutée');
  assert.equal((await onRequest({ request: preview, env: { APP_ENV: 'production' }, next })).status, 503);

  assert.equal((await onRequest({ request: preview, env: { APP_ENV: 'preview' }, next })).status, 200, 'isolée et déclarée');
  for (const url of ['https://clubdemo.licyo.fr/api/inscriptions', 'https://licyo.pages.dev/admin/inscriptions', 'http://localhost:8788/api/cron']) {
    assert.equal(previewGuard(new Request(url), {}), null, url);
  }
});
