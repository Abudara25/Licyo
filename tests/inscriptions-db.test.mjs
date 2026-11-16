import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureInscriptionsTable,
  resetSchemaCacheForTests,
  findExistingInscription,
  findCurrentSeasonSubmission,
  buildDedupKey,
  normalize,
  isInscriptionComplete,
  dossierStatus,
  familyHasActionPending,
  refusMotifs,
} from '../functions/_shared/inscriptions-db.js';
import { createD1 } from './helpers/d1.mjs';

test('normalize retire accents, casse et espaces', () => {
  assert.equal(normalize('  Léa '), 'lea');
  assert.equal(normalize('ÉLODIE'), 'elodie');
  assert.equal(normalize(null), '');
});

test('buildDedupKey : même enfant malgré accents et majuscules', () => {
  const a = buildDedupKey({ enfantPrenom: 'Léa', enfantNom: 'Durand', email: 'Parent@Exemple.fr' });
  const b = buildDedupKey({ enfantPrenom: 'LEA', enfantNom: ' durand', email: 'parent@exemple.fr ' });
  assert.equal(a, b);
  assert.notEqual(a, buildDedupKey({ enfantPrenom: 'Léo', enfantNom: 'Durand', email: 'parent@exemple.fr' }));
});

test('isInscriptionComplete = dossier validé + paiement + photo + lieu de naissance', () => {
  const complete = { dossier_uploaded_at: '2026-09-15 10:00:00', dossier_status: 'valide', paye: 1, photo_uploaded_at: '2026-09-15 10:05:00', ville_naissance: 'Argenteuil', pays_naissance: 'France' };
  assert.equal(isInscriptionComplete(complete), true);
  assert.equal(isInscriptionComplete({ ...complete, paye: 0 }), false);
  assert.equal(isInscriptionComplete({ ...complete, photo_uploaded_at: null }), false);
  assert.equal(isInscriptionComplete({ ...complete, dossier_uploaded_at: null }), false);
  assert.equal(isInscriptionComplete({ ...complete, dossier_status: 'a_verifier' }), false);
  assert.equal(isInscriptionComplete({ ...complete, dossier_status: 'refuse' }), false);
  assert.equal(isInscriptionComplete({ ...complete, dossier_status: null }), false);
  assert.equal(isInscriptionComplete({ ...complete, ville_naissance: null }), false, 'ville de naissance manquante');
  assert.equal(isInscriptionComplete({ ...complete, pays_naissance: '  ' }), false, 'pays de naissance vide');
  assert.equal(isInscriptionComplete({ ...complete, cp_naissance: null }), true, 'code postal facultatif (né à l’étranger)');
});

test('dossierStatus et relances : un dossier en vérification ne relance pas la famille', () => {
  const recu = { dossier_uploaded_at: '2026-09-15 10:00:00', paye: 1, photo_uploaded_at: '2026-09-15 10:05:00', ville_naissance: 'Argenteuil', pays_naissance: 'France' };
  assert.equal(dossierStatus({}), 'manquant');
  assert.equal(dossierStatus({ dossier_status: 'valide' }), 'manquant'); // pas de fichier = rien à valider
  assert.equal(dossierStatus(recu), 'a_verifier');
  assert.equal(dossierStatus({ ...recu, dossier_status: 'inconnu' }), 'a_verifier');
  assert.equal(dossierStatus({ ...recu, dossier_status: 'refuse' }), 'refuse');

  assert.equal(familyHasActionPending({ ...recu, dossier_status: 'a_verifier' }), false);
  assert.equal(familyHasActionPending({ ...recu, dossier_status: 'refuse' }), true);
  assert.equal(familyHasActionPending({ ...recu, dossier_status: 'valide' }), false);
  assert.equal(familyHasActionPending({ ...recu, dossier_status: 'a_verifier', paye: 0 }), true);
  assert.equal(familyHasActionPending({ ...recu, dossier_uploaded_at: null }), true);
  assert.equal(familyHasActionPending({ ...recu, dossier_status: 'valide', ville_naissance: '' }), true, 'lieu de naissance à indiquer');
});

test('refusMotifs ignore les clés inconnues', () => {
  assert.deepEqual(refusMotifs({ dossier_refus_motifs: 'signature,<script>,date' }).length, 2);
  assert.deepEqual(refusMotifs({}), []);
});

test('migration : les dossiers déjà reçus passent à vérifier', async () => {
  resetSchemaCacheForTests();
  const db = createD1();
  await db.prepare('CREATE TABLE inscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, enfant_prenom TEXT, dossier_uploaded_at TEXT)').run();
  await db.prepare("INSERT INTO inscriptions (enfant_prenom, dossier_uploaded_at) VALUES ('Léa', '2026-09-10 08:00:00'), ('Tom', NULL)").run();
  await ensureInscriptionsTable(db);
  const { results } = await db.prepare('SELECT enfant_prenom, dossier_status FROM inscriptions ORDER BY id').all();
  assert.deepEqual(
    results.map((r) => [r.enfant_prenom, r.dossier_status]),
    [['Léa', 'a_verifier'], ['Tom', null]]
  );
});

async function insert(db, values) {
  const row = {
    enfant_prenom: 'Léa',
    enfant_nom: 'Durand',
    naissance: '2020-04-02',
    categorie: 'U6 - U7',
    taille_maillot: '6 ans',
    parent_prenom: 'Samia',
    parent_nom: 'Durand',
    email: 'parent@exemple.fr',
    autorisation: 1,
    droit_image: 0,
    rgpd: 1,
    saison: '2026-2027',
    upload_token: 'jeton-1',
    organization_id: DEMO_ORG_ID,
    ...values,
  };
  row.dedup_key = buildDedupKey({ enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, email: row.email });
  const columns = Object.keys(row);
  await db
    .prepare(`INSERT INTO inscriptions (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .bind(...Object.values(row))
    .run();
}

test('migrations puis anti-doublon limité à la saison', async () => {
  resetSchemaCacheForTests();
  const db = createD1();
  await ensureInscriptionsTable(db);
  await ensureInscriptionsTable(db); // deuxième appel : aucune migration rejouée, aucune erreur

  await insert(db, {});
  await insert(db, { upload_token: 'jeton-ancien', saison: '2025-2026', naissance: '2019-01-01' });

  const identity = { enfantPrenom: 'LÉA', enfantNom: 'durand', email: 'PARENT@exemple.fr' };
  const found = await findExistingInscription(db, DEMO_ORG_ID, { ...identity, naissance: '2020-04-02' }, '2026-2027');
  assert.equal(found.upload_token, 'jeton-1');
  assert.equal(await findExistingInscription(db, DEMO_ORG_ID, { ...identity, naissance: '2020-05-02' }, '2026-2027'), null);
  assert.equal((await findExistingInscription(db, DEMO_ORG_ID, identity, '2025-2026')).upload_token, 'jeton-ancien');
  assert.equal(await findExistingInscription(db, DEMO_ORG_ID, { ...identity, naissance: '2020-04-02' }, '2027-2028'), null);

  assert.equal(await findCurrentSeasonSubmission(db, DEMO_ORG_ID, { ...identity, naissance: '2020-04-02' }, '2026-2027'), true);
  assert.equal(await findCurrentSeasonSubmission(db, DEMO_ORG_ID, { ...identity, naissance: '2020-04-02' }, '2027-2028'), false);
});
