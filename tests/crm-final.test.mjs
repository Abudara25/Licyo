// Phase 3.2 : régression des deux derniers P1 de l'audit Codex et des P2 locaux. Personnes FICTIVES uniquement.
//   P1-A coordonnées CRM périmées après une panne  → mapping, état, groupe et coordonnées dans UNE transaction, et
//                                                    dérive détectée puis réparée par la réconciliation
//   P1-B perte de contact_relationship_sources     → échec explicite (fail closed), jamais une table vide « saine »
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { syncInscription, backfillOrganization, crmReport, inscriptionsNeedingSync } from '../functions/_shared/crm.js';
import { deleteInscriptionPermanently } from '../functions/_shared/inscription-deletion.js';
import { ensureSchema, resetSchemaCacheForTests } from '../functions/_shared/inscriptions-db.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { runCrmAudit } from '../scripts/crm-audit-lib.mjs';
import { createD1, createKV } from './helpers/d1.mjs';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
async function setup() {
  const env = await fixture();
  await getCategoriesConfig(env, A);
  return env;
}
const count = async (db, sql, ...params) => (await db.prepare(sql).bind(...params).first()).n;
const hash = async (db, sql, ...params) => createHash('sha256').update(JSON.stringify((await db.prepare(sql).bind(...params).all()).results)).digest('hex');
const restart = async (db) => {
  resetSchemaCacheForTests();
  await ensureSchema(db);
};
const family = (overrides = {}) => ({
  enfant_prenom: 'Lina', enfant_nom: 'Martin', naissance: '2018-03-04', categorie: 'U8 - U9',
  parent_prenom: 'Sonia', parent_nom: 'Martin', email: 'a@example.test', telephone: '0611111111',
  adresse: '1 rue A', code_postal: '00000', ville: 'Villea', ...overrides,
});
const seasons = async (env, second = {}) => {
  const s1 = await seedInscription(env.DB, family({ saison: '2026-2027', created_at: '2026-09-01 10:00:00' }));
  const s2 = await seedInscription(env.DB, family({ saison: '2027-2028', created_at: '2027-09-01 10:00:00', ...second }));
  return [s1, s2];
};
const guardian = (db) => db.prepare("SELECT * FROM contacts WHERE created_from_role LIKE 'guardian%' ORDER BY id LIMIT 1").first();
const CHANGES = {
  'e-mail': { email: 'b@example.test' },
  téléphone: { telephone: '0699999999' },
  'e-mail et téléphone': { email: 'b@example.test', telephone: '0699999999' },
  adresse: { adresse: '2 rue B', code_postal: '75001', ville: 'Villeb' },
};
const boom = (db, column) => db.prepare(`CREATE TRIGGER boom BEFORE UPDATE OF ${column} ON contacts BEGIN SELECT RAISE(ABORT, 'boom'); END`).run();

// ---------------------------------------------------------------------------------------------
// P1-A

test('P1-A : panne EXACTEMENT au moment de la mise à jour des coordonnées → rollback complet, puis reprise saine', async () => {
  const env = await setup();
  const [s1, s2] = await seasons(env, { email: 'b@example.test', telephone: '0699999999' });
  await syncInscription(env, A, s1.id);
  await boom(env.DB, 'phone');
  await assert.rejects(syncInscription(env, A, s2.id), /boom/);
  // Tout ou rien : ni adhésion, ni provenance de la saison 2 ; les coordonnées A restent cohérentes avec la source retenue (saison 1).
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships WHERE legacy_inscription_id = ?', s2.id), 0);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources WHERE legacy_inscription_id = ?', s2.id), 0);
  assert.equal((await guardian(env.DB)).phone, '0611111111');
  const report = await crmReport(env.DB, A);
  assert.ok(report.inscriptionsUnmapped > 0, 'la saison 2 est visiblement à relier : jamais « complète » avec des coordonnées A');
  assert.equal((await backfillOrganization(env, A)).pending, 1);

  await env.DB.prepare('DROP TRIGGER boom').run();
  const repaired = await backfillOrganization(env, A, { dryRun: false });
  assert.deepEqual([repaired.processed, repaired.failed], [1, 0]);
  const fixed = await guardian(env.DB);
  assert.deepEqual([fixed.email, fixed.phone], ['b@example.test', '0699999999'], 'coordonnées B, source la plus récente');
  const final = await crmReport(env.DB, A);
  assert.deepEqual([final.anomalies, final.inscriptionsStale, final.inscriptionsUnmapped], [0, 0, 0]);
  assert.equal((await backfillOrganization(env, A)).pending, 0, 'converge');
});

test('P1-A : panne pendant la synchronisation d’une inscription DÉJÀ reliée → état et groupe restent cohérents (rollback), reprise saine', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family());
  await syncInscription(env, A, row.id);
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now'), categorie = 'U6 - U7', telephone = '0688888888' WHERE id = ?").bind(row.id).run();
  await boom(env.DB, 'phone');
  await assert.rejects(syncInscription(env, A, row.id), /boom/);
  assert.equal((await env.DB.prepare('SELECT status FROM memberships').first()).status, 'active', 'état non modifié : rien n’est à moitié appliqué');
  assert.equal((await env.DB.prepare('SELECT group_label FROM group_memberships WHERE ended_at IS NULL').first()).group_label, 'U8 - U9');
  const report = await crmReport(env.DB, A);
  assert.ok(report.inscriptionsStale > 0 && report.anomalies > 0, 'la divergence est détectée');
  await env.DB.prepare('DROP TRIGGER boom').run();
  await backfillOrganization(env, A, { dryRun: false });
  assert.equal((await env.DB.prepare('SELECT status FROM memberships').first()).status, 'ended');
  assert.equal((await guardian(env.DB)).phone, '0688888888');
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

for (const [label, change] of Object.entries(CHANGES)) {
  test(`P1-A : ${label} changé(e) à la saison 2 → contact mis à jour dans le mapping ; toute dérive ultérieure est détectée puis réparée`, async () => {
    const env = await setup();
    const [s1, s2] = await seasons(env, change);
    await syncInscription(env, A, s1.id);
    await syncInscription(env, A, s2.id);
    const g = await guardian(env.DB);
    for (const [column, value] of Object.entries(change)) {
      const contactColumn = { email: 'email', telephone: 'phone', adresse: 'address_line1', code_postal: 'postal_code', ville: 'city' }[column];
      assert.equal(g[contactColumn], value, contactColumn);
    }
    assert.equal((await crmReport(env.DB, A)).anomalies, 0);
    assert.equal(await count(env.DB, "SELECT COUNT(*) AS n FROM contacts WHERE created_from_role LIKE 'guardian%'"), 1, 'même responsable');

    // Dérive (panne exceptionnelle simulée) : le contact retombe sur l'ancienne valeur.
    await env.DB.prepare("UPDATE contacts SET email = 'a@example.test', phone = '0611111111', address_line1 = '1 rue A', postal_code = '00000', city = 'Villea' WHERE created_from_role LIKE 'guardian%'").run();
    const drift = await crmReport(env.DB, A);
    assert.ok(drift.inscriptionsStale >= 1 && drift.anomalies >= 1, 'dérive détectée');
    assert.ok((await inscriptionsNeedingSync(env.DB, A)).stale.includes(s2.id), 'et rattachée à l’inscription source la plus récente');
    await backfillOrganization(env, A, { dryRun: false });
    assert.deepEqual([(await crmReport(env.DB, A)).anomalies, (await backfillOrganization(env, A)).pending], [0, 0]);
  });
}

test('P1-A : une inscription ANCIENNE modifiée après la plus récente n’écrase pas la source retenue', async () => {
  const env = await setup();
  const [s1, s2] = await seasons(env, { email: 'b@example.test', telephone: '0699999999' });
  await syncInscription(env, A, s1.id);
  await syncInscription(env, A, s2.id);
  await env.DB.prepare("UPDATE inscriptions SET telephone = '0600000000', email = 'ancien@example.test' WHERE id = ?").bind(s1.id).run();
  await syncInscription(env, A, s1.id);
  const g = await guardian(env.DB);
  assert.deepEqual([g.email, g.phone], ['b@example.test', '0699999999'], 'la saison 2 reste la source');
  assert.equal((await crmReport(env.DB, A)).anomalies, 0, 'l’audit attend bien la valeur de la saison 2, pas celle de la saison 1');
  // Si le contact prenait à tort la valeur de l'ancienne inscription, l'audit le verrait.
  await env.DB.prepare("UPDATE contacts SET phone = '0600000000' WHERE created_from_role LIKE 'guardian%'").run();
  assert.ok((await crmReport(env.DB, A)).anomalies >= 1);
});

test('P1-A : différences non autoritatives ignorées (l’adresse ne suit que le responsable 1, pas de comparaison des anciennes saisons)', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family({ parent2_prenom: 'Karim', parent2_nom: 'Martin', parent2_email: 'k@example.test' }));
  await syncInscription(env, A, row.id);
  await env.DB.prepare("UPDATE contacts SET address_line1 = 'saisie autre' WHERE first_name = 'Karim'").run(); // le responsable 2 n'a pas d'adresse synchronisée
  await env.DB.prepare("UPDATE contacts SET status = 'inactive' WHERE first_name = 'Karim'").run(); // statut du contact : non autoritatif
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

// ---------------------------------------------------------------------------------------------
// P1-B

async function populatedCrm(env) {
  const row = await seedInscription(env.DB, family());
  await syncInscription(env, A, row.id);
  return row;
}
const snapshot = async (db) => [
  await hash(db, 'SELECT * FROM contacts ORDER BY id'),
  await hash(db, 'SELECT * FROM contact_relationships ORDER BY id'),
  await hash(db, 'SELECT * FROM memberships ORDER BY id'),
];
const tableExists = async (db, name) => Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first());

test('P1-B : table de provenance absente sur un CRM peuplé → ensureSchema ÉCHOUE, rien n’est créé ni modifié', async () => {
  const env = await setup();
  await populatedCrm(env);
  const before = await snapshot(env.DB);
  await env.DB.prepare('DROP TABLE contact_relationship_sources').run();
  await assert.rejects(restart(env.DB), (error) => /contact_relationship_sources est absente/.test(error.message) && /Rien n'a été modifié/.test(error.message) && !/Sonia|Martin|example/.test(error.message));
  assert.equal(await tableExists(env.DB, 'contact_relationship_sources'), false, 'aucune table vide créée comme si tout était sain');
  assert.deepEqual(await snapshot(env.DB), before, 'contacts, relation et adhésion intacts');
  await assert.rejects(restart(env.DB), /absente/, 'et le second essai échoue de la même façon');
});

test('P1-B : table de provenance absente sur un CRM sans relation → recréée, second passage sans effet', async () => {
  const env = await setup();
  await env.DB.prepare('DROP TABLE contact_relationship_sources').run();
  await restart(env.DB);
  assert.equal(await tableExists(env.DB, 'contact_relationship_sources'), true);
  const shape = await hash(env.DB, 'SELECT type, name, sql FROM sqlite_master ORDER BY name');
  await restart(env.DB);
  assert.equal(await hash(env.DB, 'SELECT type, name, sql FROM sqlite_master ORDER BY name'), shape);
  // Contacts et adhésion mais aucune relation : aucune provenance n'est perdue, la table se recrée.
  const env2 = await setup();
  await env2.DB.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, source) VALUES (?, 'Seul', 'Fictif', 'seul fictif', 'manual')").bind(A).run();
  await env2.DB.prepare('DROP TABLE contact_relationship_sources').run();
  await restart(env2.DB);
  assert.equal(await tableExists(env2.DB, 'contact_relationship_sources'), true);
});

test('P1-B : les autres tables porteuses d’information (contacts, adhésions…) suivent la même règle', async () => {
  const env = await setup();
  await populatedCrm(env);
  await env.DB.exec?.('PRAGMA foreign_keys = OFF');
  await env.DB.prepare('DROP TABLE group_memberships').run(); // rien n'en dépend : recréable
  await restart(env.DB);
  assert.equal(await tableExists(env.DB, 'group_memberships'), true);
});

test('P1-B : suppression RGPD refusée avant toute opération si la provenance manque (schéma déjà validé dans l’instance)', async () => {
  const env = await setup();
  const row = await populatedCrm(env);
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(row.id).run();
  await env.DB.prepare('DROP TABLE contact_relationship_sources').run(); // après ensureSchema : le cache de schéma ne le sait pas
  const deleted = [];
  env.DOSSIERS = { delete: async (keys) => deleted.push(keys) };
  await assert.rejects(deleteInscriptionPermanently(env, A, row.id), /contact_relationship_sources est absente/);
  assert.equal(deleted.length, 0, 'aucun fichier supprimé');
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM inscriptions'), 1, 'inscription conservée');
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts'), 2);
});

test('P1-B : l’audit (lecture seule ET --apply) refuse de « réparer » une perte de provenance', async () => {
  for (const apply of [false, true]) {
    resetSchemaCacheForTests();
    const sqlite = new DatabaseSync(':memory:');
    const db = createD1(sqlite);
    const env = { DB: db, INSCRIPTION_STATUS: createKV() };
    await ensureSchema(db);
    await getCategoriesConfig(env, A);
    const row = await seedInscription(db, family());
    await syncInscription(env, A, row.id);
    sqlite.exec('DROP TABLE contact_relationship_sources');
    const lines = [];
    const result = await runCrmAudit({ sqlite, apply, log: (line) => lines.push(line) });
    assert.equal(result.exitCode, 1, `apply=${apply}`);
    assert.match(lines.join('\n'), /schéma CRM incohérent, arrêt sans rien modifier/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'contact_relationship_sources'").get().n, 0, 'aucune table recréée');
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM contact_relationships').get().n, 1, 'relation intacte');
    assert.doesNotMatch(lines.join('\n'), /Sonia|Martin|example\.test/);
  }
});

test('multi-saison (rejeu) : 1 relation, 2 sources, 2 adhésions ; suppression de la saison 1 puis de la dernière', async () => {
  const env = await setup();
  const [s1, s2] = await seasons(env);
  await syncInscription(env, A, s1.id);
  await syncInscription(env, A, s2.id);
  assert.deepEqual([await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources'), await count(env.DB, 'SELECT COUNT(*) AS n FROM memberships')], [1, 2, 2]);
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(s1.id).run();
  await deleteInscriptionPermanently(env, A, s1.id);
  assert.deepEqual([await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationships'), await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources')], [1, 1]);
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(s2.id).run();
  await deleteInscriptionPermanently(env, A, s2.id);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts'), 0);
});

// ---------------------------------------------------------------------------------------------
// P2

test('P2 unicité : un emplacement d’inscription ne soutient qu’UNE relation (migration 10)', async () => {
  const env = await setup();
  const row = await populatedCrm(env);
  const child = (await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'child'").first()).id;
  await env.DB.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, source) VALUES (?, 'Autre', 'Fictif', 'autre fictif', 'manual')").bind(A).run();
  const other = (await env.DB.prepare("SELECT id FROM contacts WHERE first_name = 'Autre'").first()).id;
  await env.DB.prepare("INSERT INTO contact_relationships (organization_id, contact_id, related_contact_id, relationship_type) VALUES (?, ?, ?, 'legal_guardian')").bind(A, child, other).run();
  const second = (await env.DB.prepare('SELECT id FROM contact_relationships WHERE related_contact_id = ?').bind(other).first()).id;
  await assert.rejects(env.DB.prepare("INSERT INTO contact_relationship_sources (organization_id, relationship_id, legacy_inscription_id, source_role) VALUES (?, ?, ?, 'guardian1')").bind(A, second, row.id).run(), /UNIQUE/);
});

test('P2 migration 10 : trajectoire staging (9 → 10) ; des doublons existants = échec explicite, rien n’est supprimé', async () => {
  const env = await setup();
  await populatedCrm(env);
  await env.DB.prepare('DROP INDEX idx_relationship_sources_slot').run();
  await env.DB.prepare('DELETE FROM schema_migrations WHERE version = 10').run();
  await restart(env.DB);
  assert.ok(await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_relationship_sources_slot'").first(), 'posé depuis une base en migration 9');

  await env.DB.prepare('DROP INDEX idx_relationship_sources_slot').run();
  await env.DB.prepare('DELETE FROM schema_migrations WHERE version = 10').run();
  await env.DB.prepare('INSERT INTO contact_relationship_sources (organization_id, relationship_id, legacy_inscription_id, source_role) SELECT organization_id, relationship_id, legacy_inscription_id, ? FROM contact_relationship_sources').bind('guardian2').run();
  await env.DB.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, source) VALUES (?, 'B', 'C', 'b c', 'manual')").bind(A).run();
  const before = await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources');
  // Deux sources du même emplacement pour deux relations : on fabrique la violation
  await env.DB.prepare("INSERT INTO contact_relationships (organization_id, contact_id, related_contact_id, relationship_type) SELECT ?, id, (SELECT id FROM contacts WHERE first_name = 'B'), 'legal_guardian' FROM contacts WHERE created_from_role = 'child'").bind(A).run();
  await env.DB.prepare("INSERT INTO contact_relationship_sources (organization_id, relationship_id, legacy_inscription_id, source_role) SELECT ?, (SELECT id FROM contact_relationships WHERE related_contact_id = (SELECT id FROM contacts WHERE first_name = 'B')), legacy_inscription_id, 'guardian1' FROM contact_relationship_sources WHERE source_role = 'guardian1' LIMIT 1").bind(A).run();
  await assert.rejects(restart(env.DB), /doublons.*idx_relationship_sources_slot/);
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contact_relationship_sources'), before + 1, 'aucune ligne supprimée');
});

test('P2 candidats doublons obsolètes : retirés au recalcul quand les données divergent', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family());
  const b = await seedInscription(env.DB, family({ enfant_prenom: 'Yanis', naissance: '2020-06-01' }));
  await syncInscription(env, A, a.id);
  await syncInscription(env, A, b.id);
  assert.equal((await crmReport(env.DB, A)).duplicateCandidates, 1, 'deux responsables de même nom et mêmes coordonnées');
  await env.DB.prepare("UPDATE inscriptions SET email = 'autre@example.test', telephone = '0677777777' WHERE id = ?").bind(b.id).run();
  await backfillOrganization(env, A, { dryRun: false }); // resynchronise puis recalcule les candidats
  const report = await crmReport(env.DB, A);
  assert.deepEqual([report.duplicateCandidates, report.anomalies], [0, 0], 'la paire n’est plus signalée');
  assert.equal(await count(env.DB, 'SELECT COUNT(*) AS n FROM contacts'), 4, 'aucun contact supprimé pour autant');
});
