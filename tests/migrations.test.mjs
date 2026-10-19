import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureInscriptionsTable, resetSchemaCacheForTests, findExistingInscription } from '../functions/_shared/inscriptions-db.js';
import { createD1 } from './helpers/d1.mjs';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

test('migrations : cache distinct pour chaque base', async () => {
  const first = createD1();
  const second = createD1();
  await Promise.all([ensureInscriptionsTable(first), ensureInscriptionsTable(second)]);
  for (const db of [first, second]) {
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 0);
  }
});

test('migrations : panne transactionnelle visible, schéma annulé, reprise possible', async (t) => {
  const db = createD1();
  const batch = db.batch.bind(db);
  const fault = t.mock.method(db, 'batch', (statements) =>
    batch([...statements, db.prepare('INSERT INTO table_absente VALUES (1)')]));
  await assert.rejects(ensureInscriptionsTable(db), /table_absente/);
  const { results } = await db.prepare('PRAGMA table_info(inscriptions)').all();
  assert.equal(results.some((c) => c.name === 'saison'), false);
  fault.mock.restore();
  await ensureInscriptionsTable(db);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inscriptions WHERE saison IS NULL').first()).n, 0);
});

test('migrations : réparation des anciennes données sans modifier les saisons et validations existantes', async () => {
  const env = await fixture();
  const legacy = await seedInscription(env.DB, { dossier_uploaded_at: '2026-09-01', dossier_status: null, saison: null });
  await env.DB.prepare('UPDATE inscriptions SET dedup_key = NULL WHERE id = ?').bind(legacy.id).run();
  const current = await seedInscription(env.DB, { saison: '2027-2028', dossier_uploaded_at: '2026-09-01', dossier_status: 'valide' });
  resetSchemaCacheForTests();
  await ensureInscriptionsTable(env.DB);
  const repaired = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(legacy.id).first();
  assert.equal(repaired.saison, '2026-2027');
  assert.equal(repaired.dossier_status, 'a_verifier');
  assert.ok(repaired.dedup_key);
  assert.ok(await findExistingInscription(env.DB, DEMO_ORG_ID, { enfantPrenom: 'LEA', enfantNom: 'Durand', email: legacy.email, naissance: legacy.naissance }, '2026-2027'));
  const unchanged = await env.DB.prepare('SELECT * FROM inscriptions WHERE id = ?').bind(current.id).first();
  assert.equal(unchanged.saison, '2027-2028');
  assert.equal(unchanged.dossier_status, 'valide');
});

test('migrations : deux Workers concurrents relisent le schéma après un conflit de colonne', { timeout: 5000 }, async (t) => {
  const db = createD1();
  const { synchronizeReads } = await import('./helpers/inscriptions.mjs');
  synchronizeReads(t, db, /^PRAGMA table_info/);
  // Deux bindings distincts partagent la même base, comme deux instances de Worker.
  const a = { ...db }, b = { ...db };
  await Promise.all([ensureInscriptionsTable(a), ensureInscriptionsTable(b)]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 0);
});

test('migrations : les doublons historiques sont conservés sans bloquer la mise à jour', async () => {
  const env = await fixture();
  await seedInscription(env.DB);
  await seedInscription(env.DB);
  resetSchemaCacheForTests();
  await ensureInscriptionsTable(env.DB);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions').first()).n, 2);
});
