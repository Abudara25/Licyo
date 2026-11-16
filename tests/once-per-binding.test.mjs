// Incident du 2026-11-13 : une préparation lancée par une requête terminée ne peut plus aboutir pour les autres
// (« This promise was created by a request that has since ended »). L'instance restait en panne : connexion admin
// « Espace introuvable », /api/categories en erreur 1101. On simule cette promesse par un rejet vu par un autre appelant.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oncePerBinding } from '../functions/_shared/once-per-binding.js';
import { ensureInscriptionsTable, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';

const crossRequest = () => new Error('This promise was created by a request that has since ended, so it can never settle.');

test('oncePerBinding : succès mémorisé, plus jamais attendu ni relancé', async () => {
  const run = oncePerBinding();
  const db = {};
  let calls = 0;
  await run(db, async () => void (calls += 1));
  await run(db, async () => void (calls += 1));
  assert.equal(calls, 1);
});

test('oncePerBinding : préparation d’un autre appelant inaboutie → relancée ici, puis mémorisée', async () => {
  const run = oncePerBinding();
  const db = {};
  let reject;
  const first = run(db, () => new Promise((_, r) => (reject = r)));
  let calls = 0;
  const second = run(db, async () => void (calls += 1));
  await new Promise((r) => setImmediate(r));
  reject(crossRequest());
  await assert.rejects(first, /request that has since ended/);
  await second;
  assert.equal(calls, 1);
  await run(db, async () => void (calls += 1));
  assert.equal(calls, 1, 'plus de nouvelle préparation');
});

test('oncePerBinding : son propre échec remonte, l’appel suivant réessaie', async () => {
  const run = oncePerBinding();
  const db = {};
  await assert.rejects(run(db, async () => { throw new Error('D1'); }), /D1/);
  let calls = 0;
  await run(db, async () => void (calls += 1));
  assert.equal(calls, 1);
});

test('ensureSchema : préparation d’une autre requête inaboutie → relancée par la requête courante', async () => {
  resetSchemaCacheForTests();
  const db = {};
  let reject;
  const first = ensureInscriptionsTable(db, { prepare: () => new Promise((_, r) => (reject = r)) });
  let calls = 0;
  const second = ensureInscriptionsTable(db, { prepare: async () => void (calls += 1) });
  const quiet = console.warn;
  console.warn = () => {};
  try {
    await new Promise((r) => setImmediate(r));
    reject(crossRequest());
    await assert.rejects(first, /request that has since ended/);
    await second;
  } finally {
    console.warn = quiet;
  }
  assert.equal(calls, 1);
  await ensureInscriptionsTable(db, { prepare: async () => void (calls += 1) });
  assert.equal(calls, 1, 'succès mémorisé');
  resetSchemaCacheForTests();
});
