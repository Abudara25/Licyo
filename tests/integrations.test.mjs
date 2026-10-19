// Identifiants HelloAsso par club, chiffrés (phase 1, 2026-10-20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKV } from './helpers/d1.mjs';
import {
  helloAssoCredentials,
  saveHelloAssoCredentials,
  isValidHelloAssoKey,
  encryptForOrganization,
  decryptForOrganization,
  generateWebhookSecret,
} from '../functions/_shared/integrations.js';

const KEY = 'cle-de-chiffrement-de-test-assez-longue';
const env = () => ({ INSCRIPTION_STATUS: createKV(), SECRETS_KEY: KEY });

test('sans clé de chiffrement : aucune intégration, enregistrement refusé', async () => {
  const e = { INSCRIPTION_STATUS: createKV() };
  assert.deepEqual(await helloAssoCredentials(e, 'org_a'), { webhookSecret: null, clientId: null, clientSecret: null });
  await assert.rejects(saveHelloAssoCredentials(e, 'org_a', { clientId: 'abcd' }), /SECRETS_KEY/);
  assert.equal(await isValidHelloAssoKey(e, 'org_a', 'x'), false);
  // Les anciennes variables globales ne valent plus pour aucun club.
  const legacy = { ...e, HELLOASSO_WEBHOOK_SECRET: 'ancien', HELLOASSO_CLIENT_ID: 'id', HELLOASSO_CLIENT_SECRET: 's', SECRETS_KEY: KEY };
  assert.equal(await isValidHelloAssoKey(legacy, 'org_demo', 'ancien'), false);
});

test('enregistrement partiel, chiffré, jamais en clair, propre au club', async () => {
  const e = env();
  const secret = generateWebhookSecret();
  await saveHelloAssoCredentials(e, 'org_a', { clientId: 'client-a', clientSecret: 'secret-api-a', webhookSecret: secret });
  const stored = e.INSCRIPTION_STATUS.store.get('org:org_a:integration_helloasso');
  assert.ok(stored.startsWith('v1.'));
  assert.doesNotMatch(stored, /client-a|secret-api-a/);
  assert.deepEqual(await helloAssoCredentials(e, 'org_a'), { webhookSecret: secret, clientId: 'client-a', clientSecret: 'secret-api-a' });
  // Mise à jour partielle : le secret API reste.
  await saveHelloAssoCredentials(e, 'org_a', { clientId: 'client-a2' });
  assert.equal((await helloAssoCredentials(e, 'org_a')).clientSecret, 'secret-api-a');
  assert.equal(await isValidHelloAssoKey(e, 'org_a', secret), true);
  assert.equal(await isValidHelloAssoKey(e, 'org_b', secret), false);
  // Texte copié vers un autre club : indéchiffrable.
  e.INSCRIPTION_STATUS.store.set('org:org_b:integration_helloasso', stored);
  assert.equal((await helloAssoCredentials(e, 'org_b')).webhookSecret, null);
  // Clé changée ou texte altéré : traité comme absent.
  assert.equal((await helloAssoCredentials({ ...e, SECRETS_KEY: `${KEY}-autre` }, 'org_a')).clientId, null);
  assert.equal(await decryptForOrganization(e, 'org_a', `${stored.slice(0, -4)}AAAA`), null);
  assert.deepEqual(await decryptForOrganization(e, 'org_a', await encryptForOrganization(e, 'org_a', { a: 1 })), { a: 1 });
  // Valeur invalide refusée ; tout effacer supprime la clé.
  await assert.rejects(saveHelloAssoCredentials(e, 'org_a', { clientId: 'avec espace' }), /invalide/);
  await saveHelloAssoCredentials(e, 'org_a', { clientId: null, clientSecret: null, webhookSecret: null });
  assert.equal(e.INSCRIPTION_STATUS.store.has('org:org_a:integration_helloasso'), false);
});
