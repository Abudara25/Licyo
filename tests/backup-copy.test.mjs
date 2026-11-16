// Copies de sauvegarde R2 (audit Codex 2026-11-13) : échec journalisé au dépôt, reprise par la tâche « backups » du cron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backupCopy, syncBackups } from '../functions/_shared/backup-copy.js';
import { CRON_TASKS } from '../functions/api/cron.js';
import { cronStepLabel } from '../functions/_shared/confirmation-email.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';
import { createR2 } from './helpers/d1.mjs';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';

const upload = { buffer: new Uint8Array([1, 2, 3]), type: 'application/pdf' };

function quietWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  return { warnings, restore: () => (console.warn = original) };
}

test('backupCopy retente une fois puis journalise sans la clé complète', async () => {
  let calls = 0;
  const env = { DOSSIERS_BACKUP: { put: async () => { calls += 1; throw new Error('panne'); } } };
  const log = quietWarnings();
  try {
    await backupCopy(env, 'dossiers/jeton-secret', upload);
  } finally {
    log.restore();
  }
  assert.equal(calls, 2);
  assert.equal(log.warnings.length, 1);
  assert.match(log.warnings[0], /« dossiers »/);
  assert.doesNotMatch(log.warnings[0], /jeton-secret/);
});

test('backupCopy réussit à la seconde tentative sans avertissement', async () => {
  const backup = createR2();
  let first = true;
  const env = { DOSSIERS_BACKUP: { ...backup, put: async (k, v) => { if (first) { first = false; throw new Error('x'); } return backup.put(k, v); } } };
  const log = quietWarnings();
  try {
    await backupCopy(env, 'photos/a', upload);
  } finally {
    log.restore();
  }
  assert.ok(backup.store.has('photos/a'));
  assert.equal(log.warnings.length, 0);
});

test('syncBackups recopie les fichiers absents de la sauvegarde, filtrés par organisation', async () => {
  const env = { ...(await fixture()), DOSSIERS: createR2(), DOSSIERS_BACKUP: createR2() };
  await seedInscription(env.DB, { dossier_key: 'dossiers/a', dossier_content_type: 'application/pdf', photo_key: 'photos/a', photo_content_type: 'image/jpeg' });
  await seedInscription(env.DB, { dossier_key: 'dossiers/b', dossier_content_type: 'application/pdf' });
  await env.DOSSIERS.put('dossiers/a', 'A');
  await env.DOSSIERS.put('photos/a', 'P');
  await env.DOSSIERS_BACKUP.put('photos/a', 'P');
  const result = await syncBackups(env, DEMO_ORG_ID);
  assert.deepEqual(result, { checked: 3, copied: 1, missing: 1, remaining: 0 });
  assert.equal(env.DOSSIERS_BACKUP.store.get('dossiers/a'), 'A');
  assert.deepEqual(await syncBackups(env, 'org_autre'), { checked: 0, copied: 0, missing: 0, remaining: 0 });
});

test('syncBackups fait échouer la tâche si une copie échoue, sans bucket de sauvegarde ne fait rien', async () => {
  const env = { ...(await fixture()), DOSSIERS: createR2() };
  assert.equal(await syncBackups(env, DEMO_ORG_ID), null);
  env.DOSSIERS_BACKUP = { head: async () => null, put: async () => { throw new Error('panne'); } };
  await seedInscription(env.DB, { dossier_key: 'dossiers/c' });
  await env.DOSSIERS.put('dossiers/c', 'C');
  const log = quietWarnings();
  try {
    await assert.rejects(() => syncBackups(env, DEMO_ORG_ID), /copie\(s\) de sauvegarde en échec/);
  } finally {
    log.restore();
  }
  assert.ok(CRON_TASKS.backups);
  assert.equal(cronStepLabel('backups'), 'Sauvegarde des dossiers et photos');
});
