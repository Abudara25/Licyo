// Phase 4B.2 : ensureSchema borné dans le temps, sans jamais condamner une instance du Worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema, resetSchemaCacheForTests, SchemaTimeoutError, SCHEMA_TIMEOUT_MS } from '../functions/_shared/inscriptions-db.js';
import { fixture } from './helpers/inscriptions.mjs';

// Préparation simulée : chaque appel crée une tentative contrôlable par le test.
function controlled() {
  const attempts = [];
  const prepare = (db, progress) => {
    progress.step = 'migrations';
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    attempts.push({ resolve, reject });
    return promise;
  };
  return { attempts, prepare };
}
const quiet = (t) => t.mock.method(console, 'warn', () => {});
const tick = () => new Promise((r) => setImmediate(r));

test('délai par défaut : 15 s, borné et documenté', () => {
  assert.equal(SCHEMA_TIMEOUT_MS, 15_000);
});

test('succès normal : vraie base, préparation mémorisée (un seul passage)', async () => {
  resetSchemaCacheForTests();
  const env = await fixture();
  await ensureSchema(env.DB);
  const { attempts, prepare } = controlled();
  await ensureSchema(env.DB, { prepare }); // déjà prête : aucune nouvelle préparation
  assert.equal(attempts.length, 0);
  const { results } = await env.DB.prepare('SELECT MAX(version) AS v FROM schema_migrations').all();
  assert.equal(results[0].v, 13);
});

test('appels simultanés : une seule préparation partagée', async () => {
  resetSchemaCacheForTests();
  const db = {};
  const { attempts, prepare } = controlled();
  const calls = Array.from({ length: 5 }, () => ensureSchema(db, { prepare, timeoutMs: 1000 }));
  await tick();
  assert.equal(attempts.length, 1);
  attempts[0].resolve();
  await Promise.all(calls);
  await ensureSchema(db, { prepare, timeoutMs: 1000 });
  assert.equal(attempts.length, 1, 'mémorisée après succès');
});

test('rejet : erreur transmise, puis nouvelle tentative possible à l’appel suivant', async (t) => {
  quiet(t);
  resetSchemaCacheForTests();
  const db = {};
  const { attempts, prepare } = controlled();
  const first = ensureSchema(db, { prepare, timeoutMs: 1000 });
  await tick();
  attempts[0].reject(new Error('D1 indisponible'));
  await assert.rejects(first, /D1 indisponible/);
  const second = ensureSchema(db, { prepare, timeoutMs: 1000 });
  await tick();
  assert.equal(attempts.length, 2);
  attempts[1].resolve();
  await second;
});

test('préparation qui ne se termine jamais : délai dépassé, puis nouvelle tentative qui réussit', async (t) => {
  const warn = quiet(t);
  resetSchemaCacheForTests();
  const db = {};
  const { attempts, prepare } = controlled();
  const started = Date.now();
  await assert.rejects(ensureSchema(db, { prepare, timeoutMs: 50 }), (error) => error instanceof SchemaTimeoutError && /étape migrations/.test(error.message));
  assert.ok(Date.now() - started < 1000, 'l’appel ne reste pas suspendu');
  assert.equal(attempts.length, 1);
  // Requête suivante : nouvelle préparation (l'ancienne, jamais terminée, n'est plus attendue).
  const retry = ensureSchema(db, { prepare, timeoutMs: 1000 });
  await tick();
  assert.equal(attempts.length, 2);
  attempts[1].resolve();
  await retry;
  await ensureSchema(db, { prepare, timeoutMs: 1000 });
  assert.equal(attempts.length, 2, 'la tentative réussie est mémorisée');
  // Journal : étape, durée, type d'erreur ; aucun message d'erreur brut.
  assert.match(String(warn.mock.calls[0].arguments[0]), /^ensureSchema : délai dépassé à l'étape « migrations » après \d+ ms \(SchemaTimeoutError\)$/);
});

test('ancienne préparation qui échoue ou réussit APRÈS une nouvelle tentative : la nouvelle entrée n’est jamais retirée', async (t) => {
  quiet(t);
  resetSchemaCacheForTests();
  const db = {};
  const { attempts, prepare } = controlled();
  await assert.rejects(ensureSchema(db, { prepare, timeoutMs: 20 }), SchemaTimeoutError);
  const second = ensureSchema(db, { prepare, timeoutMs: 1000 });
  await tick();
  assert.equal(attempts.length, 2);
  // L'ancienne préparation finit par échouer : elle ne doit pas faire oublier la seconde, en cours.
  attempts[0].reject(new Error('tardive'));
  await tick();
  const third = ensureSchema(db, { prepare, timeoutMs: 1000 });
  await tick();
  assert.equal(attempts.length, 2, 'la seconde préparation est toujours partagée');
  attempts[1].resolve();
  await Promise.all([second, third]);
  // L'ancienne qui « réussirait » tard ne change rien non plus.
  attempts[0].resolve();
  await ensureSchema(db, { prepare, timeoutMs: 1000 });
  assert.equal(attempts.length, 2);
});

test('délai propre à chaque appelant : un appel arrivé plus tard dispose de son délai complet', async (t) => {
  quiet(t);
  resetSchemaCacheForTests();
  const db = {};
  const { attempts, prepare } = controlled();
  const early = ensureSchema(db, { prepare, timeoutMs: 40 });
  await new Promise((r) => setTimeout(r, 25));
  const late = ensureSchema(db, { prepare, timeoutMs: 200 });
  await assert.rejects(early, SchemaTimeoutError);
  // L'appel tardif attend toujours la même préparation (retirée de la mémoire, mais pas pour lui).
  attempts[0].resolve();
  await late;
  assert.equal(attempts.length, 1);
});
