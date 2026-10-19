// Phase 3.1 : régression des cinq P1 de l'audit Codex et des P2 corrigés. Personnes FICTIVES uniquement.
//   P1-1 invariants CRM réparés un à un      P1-2 aucune fausse fusion de responsables
//   P1-3 responsable partagé jamais muté     P1-4 relation soutenue par plusieurs inscriptions (multi-saison)
//   (P1-5, réconciliation dry-run : tests/crm-audit.test.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { syncInscription, syncInscriptionSafe, backfillOrganization, crmReport, getContactProfile, groupKey } from '../functions/_shared/crm.js';
import { CRM_OBJECTS } from '../functions/_shared/crm-schema.js';
import { deleteInscriptionPermanently } from '../functions/_shared/inscription-deletion.js';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { profilePage } from '../functions/_shared/crm-ui.js';
import { createD1 } from './helpers/d1.mjs';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_asso_b';

async function setup() {
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'b', 'B')").bind(B).run();
  await getCategoriesConfig(env, A);
  return env;
}
const count = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).first()).n;
const guardianContacts = (db, org = A) => count(db, "SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ? AND created_from_role LIKE 'guardian%'", org);
const rowsHash = async (db, sql, ...params) => createHash('sha256').update(JSON.stringify((await db.prepare(sql).bind(...params).all()).results)).digest('hex');
const family = (n, overrides = {}) => ({
  enfant_prenom: `Enfant${n}`, enfant_nom: `Fictif${n}`, naissance: '2018-03-04', categorie: 'U8 - U9',
  parent_prenom: `Parent${n}`, parent_nom: `Fictif${n}`, email: `parent${n}@example.test`, telephone: `06000000${String(n).padStart(2, '0')}`, ...overrides,
});
const restart = async (db) => {
  resetSchemaCacheForTests();
  await ensureSchema(db);
};
const structure = async (db) => rowsHash(db, 'SELECT type, name, sql FROM sqlite_master ORDER BY name');
// Contact responsable (emplacement 1 ou 2) d'une inscription, lu par la provenance.
const guardianOf = (db, inscriptionId, role = 'guardian1') =>
  db
    .prepare(
      `SELECT c.* FROM contact_relationship_sources s JOIN contact_relationships r ON r.id = s.relationship_id JOIN contacts c ON c.id = r.related_contact_id
       WHERE s.legacy_inscription_id = ? AND s.source_role = ?`
    )
    .bind(inscriptionId, role)
    .first();

// ---------------------------------------------------------------------------------------------
// P1-1 : chaque invariant critique est réparé indépendamment

const CODEX_LIST = ['idx_contacts_legacy_source', 'idx_periods_one_current', 'idx_memberships_legacy', 'idx_group_memberships_one_primary', 'trg_group_memberships_same_org_ins', 'trg_group_memberships_same_org_upd'];
const kindOf = (name) => (name.startsWith('trg_') ? 'TRIGGER' : 'INDEX');

for (const name of CODEX_LIST) {
  test(`P1-1 : ${name} supprimé puis ensureSchema → recréé, données intactes, second passage sans effet`, async () => {
    const env = await setup();
    await seedInscription(env.DB, family(1));
    await backfillOrganization(env, A, { dryRun: false });
    const data = await rowsHash(env.DB, 'SELECT * FROM contacts ORDER BY id');
    const shape = await structure(env.DB);
    await env.DB.prepare(`DROP ${kindOf(name)} ${name}`).run();
    assert.ok(!(await env.DB.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').bind(name).first()));
    await restart(env.DB);
    assert.ok(await env.DB.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').bind(name).first(), `${name} recréé`);
    assert.equal(await structure(env.DB), shape, 'schéma identique à l’origine');
    assert.equal(await rowsHash(env.DB, 'SELECT * FROM contacts ORDER BY id'), data, 'aucune donnée modifiée');
    await restart(env.DB);
    assert.equal(await structure(env.DB), shape, 'second passage sans effet');
  });
}

test('P1-1 : plusieurs invariants (et la table dérivée des candidats doublons) manquants en même temps sont tous restaurés', async () => {
  const env = await setup();
  await seedInscription(env.DB, family(1));
  await backfillOrganization(env, A, { dryRun: false });
  const shape = await structure(env.DB);
  const data = await rowsHash(env.DB, 'SELECT * FROM memberships ORDER BY id');
  for (const object of CRM_OBJECTS.filter((o) => o.kind !== 'table')) await env.DB.prepare(`DROP ${object.kind.toUpperCase()} IF EXISTS ${object.name}`).run();
  await env.DB.prepare('DROP TABLE contact_duplicate_candidates').run();
  await restart(env.DB);
  assert.equal(await structure(env.DB), shape);
  assert.equal(await rowsHash(env.DB, 'SELECT * FROM memberships ORDER BY id'), data);
  await restart(env.DB);
  assert.equal(await structure(env.DB), shape, 'idempotent');
});

test('P1-1 : un doublon empêchant de recréer un index unique = échec explicite, rien n’est supprimé', async () => {
  const env = await setup();
  await seedInscription(env.DB, family(1));
  await backfillOrganization(env, A, { dryRun: false });
  await env.DB.prepare('DROP INDEX idx_memberships_legacy').run();
  await env.DB.prepare('INSERT INTO memberships (organization_id, contact_id, period_id, legacy_inscription_id, source) SELECT organization_id, contact_id, period_id, legacy_inscription_id, source FROM memberships').run();
  await assert.rejects(restart(env.DB), /doublons.*idx_memberships_legacy/);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), 2, 'aucune ligne supprimée');
});

// ---------------------------------------------------------------------------------------------
// P1-2 : aucune fausse fusion de responsables

const twoChildren = async (env, first, second, org = A) => {
  const a = await seedInscription(env.DB, { organization_id: org, ...family(1, first) });
  const b = await seedInscription(env.DB, { organization_id: org, ...family(2, { parent_prenom: 'Parent1', parent_nom: 'Fictif1', ...second }) });
  await syncInscription(env, org, a.id);
  await syncInscription(env, org, b.id);
  return [a, b];
};

test('P1-2 A : même nom, même e-mail, téléphone différent → séparés', async () => {
  const env = await setup();
  await twoChildren(env, {}, { email: 'parent1@example.test', telephone: '0699999999' });
  assert.equal(await guardianContacts(env.DB), 2);
});
test('P1-2 B : même nom, même téléphone, e-mail différent → séparés', async () => {
  const env = await setup();
  await twoChildren(env, {}, { email: 'autre@example.test', telephone: '0600000001' });
  assert.equal(await guardianContacts(env.DB), 2);
});
test('P1-2 C : même nom, même e-mail, téléphone absent → séparés', async () => {
  const env = await setup();
  await twoChildren(env, {}, { email: 'parent1@example.test', telephone: null });
  assert.equal(await guardianContacts(env.DB), 2);
});
test('P1-2 D : homonymes sans coordonnées communes → séparés', async () => {
  const env = await setup();
  await twoChildren(env, {}, { email: 'inconnu@example.test', telephone: '0611111111' });
  assert.equal(await guardianContacts(env.DB), 2);
});
test('P1-2 E/F : deux adultes qui partagent un e-mail ou un téléphone familial → séparés', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family(1, { email: 'famille@example.test', telephone: '0601020304', parent_prenom: 'Paul', parent_nom: 'Durand' }));
  const b = await seedInscription(env.DB, family(2, { email: 'famille@example.test', telephone: '0601020304', parent_prenom: 'Claire', parent_nom: 'Durand', parent2_prenom: 'Paul', parent2_nom: 'Durand' }));
  await syncInscription(env, A, a.id);
  await syncInscription(env, A, b.id);
  assert.equal(await guardianContacts(env.DB), 3, 'Paul (1), Claire et Paul (2) : jamais fusionnés');
});
test('P1-2 G : deux personnes distinctes de même nom, même e-mail, même téléphone → PAS fusionnées, signalées candidats doublons', async () => {
  const env = await setup();
  const [a, b] = await twoChildren(env, {}, { email: 'parent1@example.test', telephone: '0600000001' });
  const first = await guardianOf(env.DB, a.id);
  const second = await guardianOf(env.DB, b.id);
  assert.notEqual(first.id, second.id, 'aucune certitude d’identité : contacts séparés');
  const report = await crmReport(env.DB, A);
  assert.equal(report.duplicateCandidates, 1);
  assert.equal(report.anomalies, 0, 'un candidat doublon est un point à vérifier, pas une anomalie');
  assert.equal((await getContactProfile(env.DB, A, first.id)).duplicates.length, 1);
});
test('P1-2 H : plusieurs candidats possibles → aucune fusion', async () => {
  const env = await setup();
  const base = { parent_prenom: 'Alex', parent_nom: 'Dupont', parent2_prenom: 'Alex', parent2_nom: 'Dupont' };
  const s1 = await seedInscription(env.DB, family(1, { ...base, saison: '2026-2027' }));
  const s2 = await seedInscription(env.DB, family(1, { ...base, saison: '2027-2028' }));
  await syncInscription(env, A, s1.id);
  const second = await syncInscription(env, A, s2.id);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM contacts WHERE created_from_role LIKE 'child%'"), 1, 'même enfant reconnu (continuité)');
  assert.equal(await guardianContacts(env.DB), 4, 'deux responsables homonymes : aucun ne peut être choisi avec certitude');
  assert.ok(second.ambiguous.guardian >= 1);
});
test('P1-2 I : organisations A et B aux données identiques → jamais rapprochées', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family(1));
  const b = await seedInscription(env.DB, family(1, { organization_id: B }));
  await syncInscription(env, A, a.id);
  await syncInscription(env, B, b.id);
  assert.deepEqual([await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ?', A), await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ?', B)], [2, 2]);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_duplicate_candidates'), 0, 'aucune ressemblance inter-organisations');
});

// ---------------------------------------------------------------------------------------------
// Continuité d'un même enfant d'une période à l'autre (P2 « nouvelle saison »)

test('P2 nouvelle saison : téléphone et e-mail changés → même enfant, même responsable, coordonnées mises à jour', async () => {
  const env = await setup();
  const s1 = await seedInscription(env.DB, family(1, { saison: '2026-2027', created_at: '2026-09-01 10:00:00' }));
  const s2 = await seedInscription(env.DB, family(1, { saison: '2027-2028', created_at: '2027-09-01 10:00:00', telephone: '0699887766', email: 'nouveau@example.test' }));
  await syncInscription(env, A, s1.id);
  await syncInscription(env, A, s2.id);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM contacts WHERE created_from_role LIKE 'child%'"), 1);
  assert.equal(await guardianContacts(env.DB), 1);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), 2);
  const guardian = await guardianOf(env.DB, s2.id);
  assert.deepEqual([guardian.phone, guardian.email], ['0699887766', 'nouveau@example.test']);
  assert.deepEqual([(await guardianOf(env.DB, s1.id)).id, (await crmReport(env.DB, A)).anomalies], [guardian.id, 0]);
});
test('P2 nouvelle saison : un responsable qui change de NOM est une autre personne ; l’enfant reste reconnu par l’autre responsable', async () => {
  const env = await setup();
  const s1 = await seedInscription(env.DB, family(1, { saison: '2026-2027', parent2_prenom: 'Karim', parent2_nom: 'Fictif1' }));
  const s2 = await seedInscription(env.DB, family(1, { saison: '2027-2028', parent_prenom: 'Nadia', parent_nom: 'Autre', parent2_prenom: 'Karim', parent2_nom: 'Fictif1' }));
  await syncInscription(env, A, s1.id);
  await syncInscription(env, A, s2.id);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM contacts WHERE created_from_role LIKE 'child%'"), 1, 'continuité par Karim');
  assert.equal((await guardianOf(env.DB, s1.id, 'guardian2')).id, (await guardianOf(env.DB, s2.id, 'guardian2')).id, 'Karim est la même personne');
  assert.notEqual((await guardianOf(env.DB, s1.id)).id, (await guardianOf(env.DB, s2.id)).id, 'Nadia n’est pas Parent1');
});
test('P2 nouvelle saison (limite documentée) : tous les responsables changent → enfant NON reconnu, signalé candidat doublon', async () => {
  const env = await setup();
  const s1 = await seedInscription(env.DB, family(1, { saison: '2026-2027' }));
  const s2 = await seedInscription(env.DB, family(1, { saison: '2027-2028', parent_prenom: 'Nadia', parent_nom: 'Autre' }));
  await syncInscription(env, A, s1.id);
  await syncInscription(env, A, s2.id);
  assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM contacts WHERE created_from_role LIKE 'child%'"), 2, 'aucune preuve de continuité : rien n’est deviné');
  assert.equal((await crmReport(env.DB, A)).duplicateCandidates, 1, 'à vérifier par un humain');
});

// ---------------------------------------------------------------------------------------------
// P1-3 : un responsable partagé n'est jamais transformé en une autre personne

// Simule une future fusion HUMAINE : le responsable de dropId est remplacé, pour cette relation, par celui de keepId.
async function humanMerge(db, keepInscription, dropInscription) {
  const keep = await guardianOf(db, keepInscription);
  const drop = await guardianOf(db, dropInscription);
  await db.prepare('UPDATE contact_relationships SET related_contact_id = ? WHERE related_contact_id = ?').bind(keep.id, drop.id).run();
  await db.prepare('DELETE FROM contacts WHERE id = ?').bind(drop.id).run();
  return keep;
}
async function sharedFamily(env, createdA = '2026-09-01 10:00:00', createdB = '2026-09-02 10:00:00') {
  const a = await seedInscription(env.DB, family(1, { created_at: createdA, parent_prenom: 'Sonia', parent_nom: 'Martin', email: 'sonia@example.test', telephone: '0611223344' }));
  const b = await seedInscription(env.DB, family(2, { created_at: createdB, parent_prenom: 'Sonia', parent_nom: 'Martin', email: 'sonia@example.test', telephone: '0611223344' }));
  await syncInscription(env, A, a.id);
  await syncInscription(env, A, b.id);
  const shared = await humanMerge(env.DB, a.id, b.id);
  return { a, b, shared };
}

test('P1-3 cas 1 : deux enfants partagent R ; le responsable de l’enfant 1 devient N → enfant 1 → N, enfant 2 → R, R inchangé', async () => {
  const env = await setup();
  const { a, b, shared } = await sharedFamily(env);
  assert.equal((await guardianOf(env.DB, a.id)).id, (await guardianOf(env.DB, b.id)).id, 'R partagé');
  const identity = 'SELECT first_name, last_name, search_name, email, phone, address_line1, postal_code, city, status FROM contacts WHERE id = ?';
  const before = await rowsHash(env.DB, identity, shared.id);
  await env.DB.prepare("UPDATE inscriptions SET parent_prenom = 'Nadia', parent_nom = 'Nouvelle', email = 'nadia@example.test', telephone = '0677777777' WHERE id = ?").bind(a.id).run();
  await syncInscription(env, A, a.id);
  const n = await guardianOf(env.DB, a.id);
  assert.notEqual(n.id, shared.id);
  assert.equal(n.first_name, 'Nadia');
  assert.equal((await guardianOf(env.DB, b.id)).id, shared.id, 'enfant 2 → R');
  assert.equal(await rowsHash(env.DB, identity, shared.id), before, 'R inchangé (identité et coordonnées)');
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);

  // archiver / restaurer / supprimer l'enfant 1 : enfant 2 → R reste
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now'), archive_motif = 'desinscription' WHERE id = ?").bind(a.id).run();
  await syncInscription(env, A, a.id);
  await env.DB.prepare('UPDATE inscriptions SET archived_at = NULL, archive_motif = NULL WHERE id = ?').bind(a.id).run();
  await syncInscription(env, A, a.id);
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(a.id).run();
  assert.deepEqual(await deleteInscriptionPermanently(env, A, a.id), { ok: true });
  assert.equal((await guardianOf(env.DB, b.id)).id, shared.id);
  assert.equal(await env.DB.prepare('SELECT 1 FROM contacts WHERE first_name = ?').bind('Nadia').first(), null, 'N n’existe plus nulle part');
  assert.equal(await rowsHash(env.DB, identity, shared.id), before);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

test('P1-3 cas 2 : responsable non partagé, coordonnées modifiées → même personne, même contact mis à jour', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family(1));
  await syncInscription(env, A, row.id);
  const before = await guardianOf(env.DB, row.id);
  await env.DB.prepare("UPDATE inscriptions SET telephone = '0688888888', email = 'maj@example.test' WHERE id = ?").bind(row.id).run();
  await syncInscription(env, A, row.id);
  const after = await guardianOf(env.DB, row.id);
  assert.deepEqual([after.id, after.phone, after.email], [before.id, '0688888888', 'maj@example.test']);
});

for (const [label, created, expected] of [
  ['cas 3/4 : R partagé, coordonnées changées dans l’inscription la PLUS RÉCENTE → R mis à jour', ['2027-09-01 10:00:00', '2026-09-02 10:00:00'], '0688888888'],
  ['cas 3/4 : R partagé, coordonnées changées dans une inscription PLUS ANCIENNE → R garde celles de la plus récente', ['2025-09-01 10:00:00', '2026-09-02 10:00:00'], '0611223344'],
]) {
  test(`P1-3 ${label}`, async () => {
    const env = await setup();
    const { a } = await sharedFamily(env, created[0], created[1]);
    await env.DB.prepare("UPDATE inscriptions SET telephone = '0688888888', email = 'maj@example.test' WHERE id = ?").bind(a.id).run();
    await syncInscription(env, A, a.id);
    assert.equal((await guardianOf(env.DB, a.id)).phone, expected);
    assert.equal(await guardianContacts(env.DB), 1, 'même personne : aucun nouveau contact');
  });
}

test('P1-3 cas 5 : R partagé + changement de prénom/nom → aucun autre enfant ne voit son responsable muté', async () => {
  const env = await setup();
  const { a, b, shared } = await sharedFamily(env);
  await env.DB.prepare("UPDATE inscriptions SET parent_prenom = 'Sonya' WHERE id = ?").bind(a.id).run();
  await syncInscription(env, A, a.id);
  assert.equal((await guardianOf(env.DB, b.id)).first_name, 'Sonia');
  assert.equal((await guardianOf(env.DB, b.id)).id, shared.id);
  assert.equal((await guardianOf(env.DB, a.id)).first_name, 'Sonya');
});

test('P1-3 multi-saison : le responsable change dans la 2e saison → 1re saison intacte, ancien contact conservé', async () => {
  const env = await setup();
  const s1 = await seedInscription(env.DB, family(1, { saison: '2026-2027', created_at: '2026-09-01 10:00:00' }));
  const s2 = await seedInscription(env.DB, family(1, { saison: '2027-2028', created_at: '2027-09-01 10:00:00', parent2_prenom: 'Karim', parent2_nom: 'Fictif1' }));
  await syncInscription(env, A, s1.id);
  await syncInscription(env, A, s2.id);
  const r = await guardianOf(env.DB, s1.id);
  await env.DB.prepare("UPDATE inscriptions SET parent_prenom = 'Autre', parent_nom = 'Personne' WHERE id = ?").bind(s2.id).run();
  await syncInscription(env, A, s2.id);
  assert.equal((await guardianOf(env.DB, s1.id)).id, r.id, 'la saison 1 garde son responsable');
  assert.equal((await guardianOf(env.DB, s1.id)).first_name, 'Parent1');
  assert.equal((await guardianOf(env.DB, s2.id)).first_name, 'Autre');
});

// ---------------------------------------------------------------------------------------------
// P1-4 : relation permanente soutenue par plusieurs inscriptions

async function twoSeasons(env, org = A) {
  const s1 = await seedInscription(env.DB, { organization_id: org, ...family(1, { saison: '2026-2027', created_at: '2026-09-01 10:00:00' }) });
  const s2 = await seedInscription(env.DB, { organization_id: org, ...family(1, { saison: '2027-2028', created_at: '2027-09-01 10:00:00' }) });
  await syncInscription(env, org, s1.id);
  await syncInscription(env, org, s2.id);
  return [s1, s2];
}
const archive = (db, id) => db.prepare("UPDATE inscriptions SET archived_at = datetime('now'), archive_motif = 'desinscription' WHERE id = ?").bind(id).run();

test('P1-4 cas A : même enfant, même responsable sur 2 saisons ; suppression de la 1re → tout ce que la 2e soutient reste', async () => {
  const env = await setup();
  const [s1, s2] = await twoSeasons(env);
  assert.deepEqual([await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources')], [2, 1, 2], '1 relation, 2 provenances');
  await archive(env.DB, s1.id);
  assert.deepEqual(await deleteInscriptionPermanently(env, A, s1.id), { ok: true });
  assert.deepEqual([await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts')], [1, 1, 1, 2]);
  const child = await env.DB.prepare('SELECT contact_id FROM memberships').first();
  const profile = await getContactProfile(env.DB, A, child.contact_id);
  assert.equal(profile.guardians.length, 1, 'la fiche 2027-2028 affiche son responsable');
  assert.equal(profile.memberships[0].period_name, '2027-2028');
  assert.equal((await guardianOf(env.DB, s2.id)).first_name, 'Parent1');
  const report = await crmReport(env.DB, A);
  assert.equal(report.anomalies, 0);
  assert.equal(report.relationshipsWithoutSource, 0);
});
test('P1-4 cas B : puis suppression de la dernière saison → nettoyage complet', async () => {
  const env = await setup();
  const [s1, s2] = await twoSeasons(env);
  for (const row of [s1, s2]) {
    await archive(env.DB, row.id);
    await deleteInscriptionPermanently(env, A, row.id);
  }
  for (const table of ['contacts', 'memberships', 'contact_relationships', 'contact_relationship_sources', 'group_memberships', 'contact_duplicate_candidates']) {
    assert.equal(await count(env.DB, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
  }
});
test('P1-4 cas C : deux enfants, plusieurs saisons → un responsable reste tant qu’une relation valide existe', async () => {
  const env = await setup();
  const [x1, x2] = await twoSeasons(env);
  const y1 = await seedInscription(env.DB, family(2, { saison: '2026-2027', created_at: '2026-09-01 11:00:00' }));
  const y2 = await seedInscription(env.DB, family(2, { saison: '2027-2028', created_at: '2027-09-01 11:00:00' }));
  await syncInscription(env, A, y1.id);
  await syncInscription(env, A, y2.id);
  await archive(env.DB, x1.id);
  await deleteInscriptionPermanently(env, A, x1.id);
  assert.equal((await guardianOf(env.DB, x2.id)).first_name, 'Parent1');
  assert.equal((await guardianOf(env.DB, y1.id)).id, (await guardianOf(env.DB, y2.id)).id);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});
test('P1-4 cas D : suppression dans A → aucun effet sur B (mêmes données)', async () => {
  const env = await setup();
  const [a1] = await twoSeasons(env, A);
  await twoSeasons(env, B);
  const snapshotB = await rowsHash(env.DB, 'SELECT * FROM contact_relationship_sources WHERE organization_id = ? ORDER BY id', B);
  const countsB = async () => count(env.DB, 'SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ?', B);
  const before = await countsB();
  await archive(env.DB, a1.id);
  await deleteInscriptionPermanently(env, A, a1.id);
  assert.equal(await countsB(), before);
  assert.equal(await rowsHash(env.DB, 'SELECT * FROM contact_relationship_sources WHERE organization_id = ? ORDER BY id', B), snapshotB);
  assert.equal((await crmReport(env.DB, B)).anomalies, 0);
});

test('migration 9 : la provenance déjà portée par relationships.legacy_inscription_id (préproduction) est recopiée', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family(1, { parent2_prenom: 'Karim', parent2_nom: 'Fictif1' }));
  await syncInscription(env, A, row.id);
  // État de la préproduction : relations avec l'ancienne colonne, sans table de provenance.
  await env.DB.prepare('UPDATE contact_relationships SET legacy_inscription_id = ?').bind(row.id).run();
  await env.DB.prepare('DROP TABLE contact_relationship_sources').run();
  await env.DB.prepare('DELETE FROM schema_migrations WHERE version = 9').run();
  await restart(env.DB);
  assert.deepEqual((await env.DB.prepare('SELECT source_role FROM contact_relationship_sources ORDER BY source_role').all()).results.map((r) => r.source_role), ['guardian1', 'guardian2']);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

// ---------------------------------------------------------------------------------------------
// P2

test('P2 transactionnalité : une erreur en cours de synchronisation ne laisse ni contact, ni période, ni adhésion orphelins', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family(1));
  await env.DB.prepare("CREATE TRIGGER boom BEFORE INSERT ON group_memberships BEGIN SELECT RAISE(ABORT, 'boom'); END").run();
  await assert.rejects(syncInscription(env, A, row.id), /boom/);
  for (const table of ['contacts', 'periods', 'memberships', 'contact_relationships', 'contact_relationship_sources']) {
    assert.equal(await count(env.DB, `SELECT COUNT(*) AS n FROM ${table}`), 0, `${table} intact`);
  }
  await env.DB.prepare('DROP TRIGGER boom').run();
  assert.equal((await syncInscription(env, A, row.id)).memberships, 1, 'la reprise aboutit');
});

test('P2 course fratrie : deux synchronisations simultanées de frères et sœurs → deux responsables séparés, aucune erreur', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family(1));
  const b = await seedInscription(env.DB, family(2, { parent_prenom: 'Parent1', parent_nom: 'Fictif1', email: 'parent1@example.test', telephone: '0600000001' }));
  const results = await Promise.allSettled([syncInscription(env, A, a.id), syncInscription(env, A, b.id)]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
  assert.equal(await guardianContacts(env.DB), 2, 'jamais fusionnés : la course ne peut plus créer de doublon fautif');
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});
test('P2 course : la même inscription synchronisée cinq fois en parallèle → aucun doublon', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family(1, { parent2_prenom: 'Karim', parent2_nom: 'Fictif1' }));
  const results = await Promise.allSettled([1, 2, 3, 4, 5].map(() => syncInscription(env, A, row.id)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 5);
  assert.deepEqual([await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts'), await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM group_memberships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources')], [3, 1, 1, 2]);
});

test('P2 double inscription même période : deux adhésions signalées « à vérifier », rien de fusionné ni supprimé', async () => {
  const env = await setup();
  const first = await seedInscription(env.DB, family(1));
  const second = await seedInscription(env.DB, family(1));
  await syncInscription(env, A, first.id);
  await syncInscription(env, A, second.id);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), 2);
  const report = await crmReport(env.DB, A);
  assert.deepEqual([report.duplicateContactPeriod, report.anomalies, report.warnings > 0], [1, 0, true], 'point à vérifier, pas une incohérence');
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM inscriptions'), 2, 'aucune inscription supprimée');
  const child = await env.DB.prepare('SELECT contact_id FROM memberships LIMIT 1').first();
  const profile = await getContactProfile(env.DB, A, child.contact_id);
  assert.equal(profile.duplicatePeriod, true);
  assert.match(profilePage(profile, { asMember: true }), /Plusieurs adhésions existent pour la même période/);
});

test('P2 groupes : « U6-U7 » retrouve « U6 - U7 » (casse, espaces, tirets) ; le libellé historique est conservé ; jamais de groupe créé', async () => {
  for (const variant of ['U8-U9', 'u8 - u9', 'U8  –  U9', 'U8—U9', ' U8 - U9 ']) assert.equal(groupKey(variant), groupKey('U8 - U9'), variant);
  const env = await setup();
  const groups = await count(env.DB, 'SELECT COUNT(*) AS n FROM groups');
  const ok = await seedInscription(env.DB, family(1, { categorie: 'U8-U9' }));
  const unknown = await seedInscription(env.DB, family(2, { categorie: 'Catégorie inconnue' }));
  await syncInscription(env, A, ok.id);
  await syncInscription(env, A, unknown.id);
  const rows = (await env.DB.prepare('SELECT gm.group_label, gm.group_id FROM group_memberships gm JOIN memberships m ON m.id = gm.membership_id ORDER BY m.legacy_inscription_id').all()).results;
  assert.ok(rows[0].group_id, 'groupe résolu malgré le style d’écriture');
  assert.equal(rows[0].group_label, 'U8-U9', 'libellé historique conservé');
  assert.equal(rows[1].group_id, null);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships'), 2, 'l’adhésion existe quand même');
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM groups'), groups, 'aucun groupe créé');
  const report = await crmReport(env.DB, A);
  assert.deepEqual([report.groupsUnresolved, report.anomalies], [1, 0], 'point à vérifier, pas une anomalie');
});

test('P2 remplissage : borné par limit, puis repris', async () => {
  const env = await setup();
  for (let n = 1; n <= 7; n++) await seedInscription(env.DB, family(n));
  const first = await backfillOrganization(env, A, { dryRun: false, limit: 3 });
  assert.deepEqual([first.processed, first.remaining], [3, 4]);
  const second = await backfillOrganization(env, A, { dryRun: false, limit: 50 });
  assert.deepEqual([second.processed, second.remaining], [4, 0]);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

// ---------------------------------------------------------------------------------------------
// A/B rejoué après toutes les corrections

test('A/B : mêmes noms, dates, e-mails, téléphones, saisons et groupes → aucun matching, relation, suppression ni réconciliation croisés', async () => {
  const env = await setup();
  await env.DB.prepare("INSERT INTO groups (organization_id, slug, name) VALUES (?, 'u8-u9', 'U8 - U9')").bind(B).run();
  const [a1, a2] = await twoSeasons(env, A);
  const [b1, b2] = await twoSeasons(env, B);
  const countA = () => count(env.DB, 'SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ?', A);
  assert.deepEqual([await countA(), await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ?', B)], [2, 2]);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_duplicate_candidates'), 0);
  // changement d'identité dans A
  await env.DB.prepare("UPDATE inscriptions SET parent_prenom = 'Changé', parent_nom = 'Autre' WHERE id = ?").bind(a2.id).run();
  await syncInscription(env, A, a2.id);
  assert.equal((await guardianOf(env.DB, b2.id)).first_name, 'Parent1', 'B inchangée');
  // réconciliation et suppression dans A
  await backfillOrganization(env, A, { dryRun: false });
  await archive(env.DB, a1.id);
  await deleteInscriptionPermanently(env, A, a1.id);
  const reportB = await crmReport(env.DB, B);
  assert.deepEqual([reportB.inscriptions, reportB.memberships, reportB.contacts, reportB.relationshipSources, reportB.anomalies], [2, 2, 2, 2, 0]);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
  assert.equal(await syncInscription(env, A, b1.id).then((r) => r.status), 'missing');
  assert.equal(await syncInscriptionSafe(env, A, b2.id).then((r) => r.status), 'missing');
});
