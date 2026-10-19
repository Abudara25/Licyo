// Phase 3 : fondation CRM (contacts, relations, périodes, adhésions, groupes d'adhésion) et remplissage depuis
// les inscriptions historiques. Personnes FICTIVES uniquement.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  syncInscription, syncInscriptionSafe, backfillOrganization, crmReport, syncCurrentPeriod, looksLikeSameGuardian, listMembers, getContactProfile, periodSlug,
} from '../functions/_shared/crm.js';
import { deleteInscriptionPermanently } from '../functions/_shared/inscription-deletion.js';
import { getCategoriesConfig } from '../functions/_shared/settings-kv.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = 'org_asso_b';

async function setup() {
  const env = await fixture();
  await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'b', 'B')").bind(B).run();
  await getCategoriesConfig(env, A); // groupes « U6 - U7 » et « U8 - U9 » de l'organisation A
  return env;
}
const count = async (db, table, org = A) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE organization_id = ?`).bind(org).first()).n;
const inscriptionsHash = async (db) => createHash('sha256').update(JSON.stringify((await db.prepare('SELECT * FROM inscriptions ORDER BY id').all()).results)).digest('hex');
const family = (overrides = {}) => ({
  enfant_prenom: 'Lina', enfant_nom: 'Martin', naissance: '2018-03-04', categorie: 'U8 - U9',
  parent_prenom: 'Sonia', parent_nom: 'Martin', email: 'sonia.martin@example.test', telephone: '0611223344',
  adresse: '1 rue des Tests', code_postal: '00000', ville: 'Testville', ...overrides,
});

test('cas 1 : un enfant et un responsable → 2 contacts, 1 relation, 1 adhésion, 1 groupe', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family());
  const result = await syncInscription(env, A, row.id);
  assert.deepEqual([result.status, result.contacts, result.relationships, result.memberships], ['created', { child: 1, guardian: 1 }, 1, 1]);
  assert.equal(await count(env.DB, 'contacts'), 2);
  const member = await env.DB.prepare('SELECT m.*, p.slug, gm.group_label, gm.group_id FROM memberships m JOIN periods p ON p.id = m.period_id JOIN group_memberships gm ON gm.membership_id = m.id WHERE m.legacy_inscription_id = ?').bind(row.id).first();
  assert.deepEqual([member.status, member.slug, member.group_label, member.source], ['active', '2026-2027', 'U8 - U9', 'legacy_inscription']);
  assert.ok(member.group_id, 'groupe D1 retrouvé par son nom');
  const child = await env.DB.prepare("SELECT * FROM contacts WHERE created_from_role = 'child'").first();
  const guardian = await env.DB.prepare("SELECT * FROM contacts WHERE created_from_role = 'guardian1'").first();
  assert.equal(child.email, null, 'les coordonnées de la famille ne sont pas copiées sur l’enfant');
  assert.equal(child.address_line1, null);
  assert.equal(guardian.address_line1, '1 rue des Tests');
  const relation = await env.DB.prepare('SELECT * FROM contact_relationships').first();
  assert.deepEqual([relation.contact_id, relation.related_contact_id, relation.relationship_type, relation.is_primary], [child.id, guardian.id, 'legal_guardian', 1]);
});

test('minimisation : taille de maillot, paiement, consentements et dossier ne sont copiés dans aucun contact', async () => {
  const env = await setup();
  await seedInscription(env.DB, family({ taille_maillot: '8 ans', paye: 1 }));
  await syncInscription(env, A, 1);
  const columns = (await env.DB.prepare('PRAGMA table_info(contacts)').all()).results.map((c) => c.name);
  for (const forbidden of ['taille_maillot', 'paye', 'mode_paiement', 'rgpd', 'droit_image', 'autorisation', 'dossier_key', 'photo_key', 'upload_token', 'categorie', 'saison']) {
    assert.ok(!columns.includes(forbidden), forbidden);
  }
});

test('cas 2 : un enfant et deux responsables → 3 contacts, 2 relations dont une principale', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family({ parent2_prenom: 'Karim', parent2_nom: 'Martin', parent2_email: 'karim.martin@example.test', parent2_telephone: '0655667788' }));
  const result = await syncInscription(env, A, row.id);
  assert.deepEqual([result.contacts, result.relationships], [{ child: 1, guardian: 2 }, 2]);
  assert.equal(await count(env.DB, 'contacts'), 3);
  assert.deepEqual((await env.DB.prepare('SELECT is_primary FROM contact_relationships ORDER BY is_primary DESC').all()).results.map((r) => r.is_primary), [1, 0]);
});

test('cas 3 : deux enfants d’une même famille → contacts SÉPARÉS (aucune fusion inter-enfants), signalés candidats doublons', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family());
  const b = await seedInscription(env.DB, family({ enfant_prenom: 'Yanis', naissance: '2020-06-01', categorie: 'U6 - U7' }));
  await syncInscription(env, A, a.id);
  const second = await syncInscription(env, A, b.id);
  assert.deepEqual(second.contacts, { child: 1, guardian: 1 }, 'un responsable par inscription : jamais fusionné entre enfants différents');
  assert.equal(await count(env.DB, 'contacts'), 4);
  assert.equal(await count(env.DB, 'contact_relationships'), 2);
  assert.equal((await crmReport(env.DB, A)).duplicateCandidates, 1, 'la ressemblance est signalée pour une revue humaine');
  const guardian = await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'guardian1' ORDER BY id").first();
  const profile = await getContactProfile(env.DB, A, guardian.id);
  assert.equal(profile.duplicates.length, 1, 'la fiche du responsable signale son candidat doublon');
  assert.equal(profile.dependents.length, 1);
});

test('cas 4 : mêmes noms mais pas la même personne → jamais fusionnés', async () => {
  const env = await setup();
  // Même nom de responsable, e-mails différents.
  const rows = [
    await seedInscription(env.DB, family({ enfant_prenom: 'Aya', naissance: '2018-01-01' })),
    await seedInscription(env.DB, family({ enfant_prenom: 'Noé', naissance: '2019-02-02', email: 'autre.martin@example.test', telephone: '0699887766' })),
    // Même nom, même e-mail mais téléphones différents (contradiction).
    await seedInscription(env.DB, family({ enfant_prenom: 'Ilan', naissance: '2018-05-05', telephone: '0600000000' })),
    // Même nom, sans aucune corroboration (ni e-mail ni téléphone comparables).
    await seedInscription(env.DB, family({ enfant_prenom: 'Zoé', naissance: '2019-09-09', email: 'x.martin@example.test', telephone: null })),
  ];
  let ambiguous = 0;
  for (const row of rows) ambiguous += (await syncInscription(env, A, row.id)).ambiguous.guardian;
  assert.equal(await count(env.DB, 'contacts'), 8, '4 enfants + 4 responsables distincts');
  const guardians = (await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE created_from_role = 'guardian1'").first()).n;
  assert.equal(guardians, 4);
  assert.ok(ambiguous >= 1, 'les ressemblances sont comptées, jamais fusionnées');
  const person = (overrides = {}) => ({ first: 'Sonia', last: 'Martin', email: null, phone: null, ...overrides });
  const contact = (overrides = {}) => ({ first_name: 'Sonia', last_name: 'Martin', email: null, phone: null, ...overrides });
  assert.equal(looksLikeSameGuardian(contact(), person()), false, 'nom seul : pas même un candidat');
  assert.equal(looksLikeSameGuardian(contact({ email: 'a@x.test' }), person({ email: 'a@x.test' })), true, 'candidat doublon (jamais une fusion)');
  assert.equal(looksLikeSameGuardian(contact({ email: 'a@x.test' }), person({ last: 'Durand', email: 'a@x.test' })), false, 'e-mail seul : jamais');
  assert.equal(looksLikeSameGuardian(contact({ first_name: 'Léa', email: 'A@x.test', phone: '06 11 22 33 44' }), person({ first: 'LEA', email: 'a@x.test', phone: '0611223344' })), true, 'accents, casse et espaces ignorés');
});

test('cas 4 bis : deux enfants homonymes de même naissance mais de familles différentes restent distincts', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family({ enfant_prenom: 'Sam', naissance: '2019-04-04' }));
  const b = await seedInscription(env.DB, family({ enfant_prenom: 'Sam', naissance: '2019-04-04', parent_prenom: 'Paul', parent_nom: 'Autre', email: 'paul@example.test', telephone: '0644444444' }));
  await syncInscription(env, A, a.id);
  const second = await syncInscription(env, A, b.id);
  assert.equal(second.contacts.child, 1);
  assert.equal(second.ambiguous.child, 1, 'homonyme signalé, non fusionné');
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE created_from_role = 'child'").first()).n, 2);
});

test('cas 5 : le même enfant réinscrit une autre période → 1 personne, 2 adhésions, historique conservé', async () => {
  const env = await setup();
  const first = await seedInscription(env.DB, family({ saison: '2026-2027' }));
  const next = await seedInscription(env.DB, family({ saison: '2027-2028', categorie: 'U8 - U9' }));
  await syncInscription(env, A, first.id);
  const second = await syncInscription(env, A, next.id);
  assert.deepEqual(second.contacts, { child: 0, guardian: 0 });
  assert.equal(await count(env.DB, 'contacts'), 2);
  assert.equal(await count(env.DB, 'memberships'), 2);
  assert.equal(await count(env.DB, 'periods'), 2);
  const child = await env.DB.prepare("SELECT id FROM contacts WHERE created_from_role = 'child'").first();
  const profile = await getContactProfile(env.DB, A, child.id);
  assert.deepEqual(profile.memberships.map((m) => m.period_name).sort(), ['2026-2027', '2027-2028']);
  assert.equal(profile.memberships.every((m) => m.inscription_id), true, 'chaque adhésion retrouve son inscription');
});

test('cas 6 : le remplissage relancé (et lancé en parallèle) ne double rien, et ne touche pas aux inscriptions', async () => {
  const env = await setup();
  await seedInscription(env.DB, family());
  await seedInscription(env.DB, family({ enfant_prenom: 'Yanis', naissance: '2020-06-01', categorie: 'U6 - U7' }));
  await seedInscription(env.DB, family({ enfant_prenom: 'Rémi', naissance: '2017-01-01', parent_prenom: 'Paul', parent_nom: 'Autre', email: 'paul@example.test', telephone: '0644444444', parent2_prenom: 'Eva', parent2_nom: 'Autre' }));
  const before = await inscriptionsHash(env.DB);

  const dry = await backfillOrganization(env, A);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.pending, 3);
  assert.equal(await count(env.DB, 'contacts'), 0, 'à blanc : rien n’est écrit');

  const first = await backfillOrganization(env, A, { dryRun: false });
  assert.deepEqual([first.processed, first.failed, first.memberships], [3, 0, 3]);
  const snapshot = async () => JSON.stringify(await Promise.all(['contacts', 'contact_relationships', 'periods', 'memberships', 'group_memberships'].map(async (t) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n)));
  const counts = await snapshot();
  await backfillOrganization(env, A, { dryRun: false });
  await Promise.all([backfillOrganization(env, A, { dryRun: false }), backfillOrganization(env, A, { dryRun: false })]);
  await Promise.all([1, 2, 3].map((id) => syncInscription(env, A, id)));
  assert.equal(await snapshot(), counts, 'aucun doublon après plusieurs passages, y compris simultanés');
  assert.equal(await inscriptionsHash(env.DB), before, 'inscriptions strictement identiques');
  const report = await crmReport(env.DB, A);
  assert.deepEqual([report.inscriptions, report.inscriptionsMapped, report.inscriptionsUnmapped, report.anomalies], [3, 3, 0, 0]);
});

test('cas 7 : une nouvelle inscription arrivée après le remplissage est synchronisée', async () => {
  const env = await setup();
  await seedInscription(env.DB, family());
  await backfillOrganization(env, A, { dryRun: false });
  const late = await seedInscription(env.DB, family({ enfant_prenom: 'Tardif', naissance: '2018-08-08', parent_prenom: 'Luc', parent_nom: 'Neuf', email: 'luc@example.test', telephone: '0677777777' }));
  assert.equal((await crmReport(env.DB, A)).inscriptionsUnmapped, 1);
  const result = await syncInscriptionSafe(env, A, late.id);
  assert.equal(result.memberships, 1);
  assert.equal((await crmReport(env.DB, A)).inscriptionsUnmapped, 0);
});

test('cas 8 : échec de la synchronisation → l’inscription reste intacte, journal sans donnée personnelle, la réconciliation répare', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const env = await setup();
  const row = await seedInscription(env.DB, family());
  const before = await inscriptionsHash(env.DB);
  const prepare = env.DB.prepare.bind(env.DB);
  t.mock.method(env.DB, 'prepare', (sql) => {
    if (/INSERT OR IGNORE INTO contacts/.test(sql)) throw new Error('D1 indisponible pour Sonia Martin sonia.martin@example.test');
    return prepare(sql);
  });
  assert.equal(await syncInscriptionSafe(env, A, row.id), null, 'ne lève jamais');
  const logged = String(errors.mock.calls[0].arguments[0]);
  assert.match(logged, /inscription \d+/);
  assert.doesNotMatch(logged, /Sonia|Martin|example\.test/, 'aucune donnée personnelle dans le journal');
  assert.equal(await inscriptionsHash(env.DB), before, 'inscription conservée telle quelle');
  assert.equal((await crmReport(env.DB, A)).inscriptionsUnmapped, 1);

  t.mock.restoreAll();
  const repaired = await backfillOrganization(env, A, { dryRun: false });
  assert.deepEqual([repaired.processed, repaired.failed], [1, 0]);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

test('reprise après échec partiel : un contact déjà créé est retrouvé, pas recréé', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family());
  await env.DB.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, birth_date, source, created_from_inscription_id, created_from_role) VALUES (?, 'Lina', 'Martin', 'lina martin', '2018-03-04', 'legacy_inscription', ?, 'child')").bind(A, row.id).run();
  const result = await syncInscription(env, A, row.id);
  assert.equal(result.contacts.child, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM contacts WHERE created_from_role = 'child'").first()).n, 1);
});

test('archiver puis restaurer l’inscription : l’adhésion suit (terminée / active) ; le groupe suit la catégorie', async () => {
  const env = await setup();
  const row = await seedInscription(env.DB, family());
  await syncInscription(env, A, row.id);
  const status = async () => env.DB.prepare('SELECT status, ended_at FROM memberships').first();
  await env.DB.prepare("UPDATE inscriptions SET archived_at = '2026-10-01 10:00:00', archive_motif = 'desinscription' WHERE id = ?").bind(row.id).run();
  await syncInscription(env, A, row.id);
  assert.deepEqual({ ...(await status()) }, { status: 'ended', ended_at: '2026-10-01 10:00:00' });
  await env.DB.prepare('UPDATE inscriptions SET archived_at = NULL, archive_motif = NULL WHERE id = ?').bind(row.id).run();
  await backfillOrganization(env, A, { dryRun: false }); // le passage quotidien rattrape aussi
  assert.deepEqual({ ...(await status()) }, { status: 'active', ended_at: null });

  await env.DB.prepare("UPDATE inscriptions SET categorie = 'U6 - U7' WHERE id = ?").bind(row.id).run();
  await syncInscription(env, A, row.id);
  const groups = (await env.DB.prepare('SELECT group_label, ended_at FROM group_memberships ORDER BY id').all()).results;
  assert.deepEqual(groups.map((g) => g.group_label), ['U8 - U9', 'U6 - U7'], 'historique de groupe conservé');
  assert.ok(groups[0].ended_at && !groups[1].ended_at);
  assert.equal((await crmReport(env.DB, A)).anomalies, 0);
});

test('période courante : une seule, dates non devinées', async () => {
  const env = await setup();
  await syncCurrentPeriod(env, A, '2026-2027');
  await syncCurrentPeriod(env, A, '2027-2028');
  const periods = (await env.DB.prepare('SELECT slug, is_current, start_date, end_date FROM periods ORDER BY id').all()).results.map((p) => ({ ...p }));
  assert.deepEqual(periods, [{ slug: '2026-2027', is_current: 0, start_date: null, end_date: null }, { slug: '2027-2028', is_current: 1, start_date: null, end_date: null }]);
  await assert.rejects(env.DB.prepare("UPDATE periods SET is_current = 1 WHERE slug = '2026-2027'").run(), /UNIQUE/);
  assert.equal(periodSlug('2026 - 2027'), '2026-2027');
});

test('suppression définitive d’une inscription : ses traces CRM disparaissent, un responsable partagé reste', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family());
  const b = await seedInscription(env.DB, family({ enfant_prenom: 'Yanis', naissance: '2020-06-01', categorie: 'U6 - U7' }));
  await backfillOrganization(env, A, { dryRun: false });
  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(a.id).run();
  assert.deepEqual(await deleteInscriptionPermanently(env, A, a.id), { ok: true });
  const report = await crmReport(env.DB, A);
  assert.deepEqual([report.inscriptions, report.memberships, report.contacts, report.relationships, report.groupMemberships], [1, 1, 2, 1, 1]);
  assert.equal(report.anomalies, 0);
  assert.equal(await env.DB.prepare('SELECT 1 FROM contacts WHERE first_name = ?').bind('Lina').first(), null, 'l’enfant supprimé n’existe plus dans le CRM');
  assert.ok(await env.DB.prepare('SELECT 1 FROM contacts WHERE first_name = ?').bind('Sonia').first(), 'le responsable, encore lié à un autre enfant, reste');

  await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now') WHERE id = ?").bind(b.id).run();
  await deleteInscriptionPermanently(env, A, b.id);
  const empty = await crmReport(env.DB, A);
  assert.deepEqual([empty.contacts, empty.memberships, empty.relationships], [0, 0, 0], 'plus aucune donnée personnelle résiduelle');
});

// ---------------------------------------------------------------------------------------------
// Isolation entre organisations

test('cas 9 : organisation B aux données similaires → aucune fusion ni lecture croisée', async () => {
  const env = await setup();
  const a = await seedInscription(env.DB, family());
  const b = await seedInscription(env.DB, family({ organization_id: B }));
  await syncInscription(env, A, a.id);
  await syncInscription(env, B, b.id);
  assert.equal(await count(env.DB, 'contacts', A), 2);
  assert.equal(await count(env.DB, 'contacts', B), 2, 'mêmes noms et e-mail, mais contacts distincts');
  const contactB = await env.DB.prepare('SELECT id FROM contacts WHERE organization_id = ? LIMIT 1').bind(B).first();
  assert.equal(await getContactProfile(env.DB, A, contactB.id), null, 'A ne lit pas B même avec un identifiant connu');
  assert.equal((await listMembers(env.DB, A)).total, 1);
  assert.equal((await listMembers(env.DB, B)).total, 1);
  assert.equal(await syncInscription(env, A, b.id).then((r) => r.status), 'missing', 'A ne synchronise pas une inscription de B');
  const membershipA = await env.DB.prepare('SELECT * FROM memberships WHERE organization_id = ?').bind(A).first();
  // La base refuse elle-même les liens entre organisations (clés étrangères composites).
  await assert.rejects(env.DB.prepare('INSERT INTO memberships (organization_id, contact_id, period_id) VALUES (?, ?, ?)').bind(B, contactB.id, membershipA.period_id).run(), /FOREIGN KEY/);
  await assert.rejects(env.DB.prepare('INSERT INTO contact_relationships (organization_id, contact_id, related_contact_id, relationship_type) VALUES (?, ?, ?, ?)').bind(A, contactB.id, membershipA.contact_id, 'other').run(), /FOREIGN KEY/);
  const groupB = (await env.DB.prepare('SELECT id FROM groups WHERE organization_id = ?').bind(A).first()).id;
  await assert.rejects(env.DB.prepare("INSERT INTO group_memberships (organization_id, membership_id, group_id, group_label) VALUES (?, ?, ?, 'x')").bind(B, membershipA.id, groupB).run(), /FOREIGN KEY|autre organisation/);
});

test('contraintes du modèle : relation à soi-même, statuts invalides, deux périodes courantes', async () => {
  const env = await setup();
  await env.DB.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name) VALUES (?, 'Test', 'Un', 'test un')").bind(A).run();
  const id = (await env.DB.prepare('SELECT id FROM contacts').first()).id;
  await assert.rejects(env.DB.prepare("INSERT INTO contact_relationships (organization_id, contact_id, related_contact_id, relationship_type) VALUES (?, ?, ?, 'other')").bind(A, id, id).run());
  await assert.rejects(env.DB.prepare("INSERT INTO contact_relationships (organization_id, contact_id, related_contact_id, relationship_type) VALUES (?, ?, ?, '  ')").bind(A, id, id + 1).run());
  await assert.rejects(env.DB.prepare("INSERT INTO contacts (organization_id, first_name, last_name, search_name, status) VALUES (?, 'a', 'b', 'a b', 'supprime')").bind(A).run());
  await env.DB.prepare("INSERT INTO periods (organization_id, slug, name) VALUES (?, 'p1', 'P1')").bind(A).run();
  await assert.rejects(env.DB.prepare("INSERT INTO periods (organization_id, slug, name, start_date, end_date) VALUES (?, 'p2', 'P2', '2027-09-01', '2027-08-01')").bind(A).run());
  await assert.rejects(env.DB.prepare("INSERT INTO periods (organization_id, slug, name) VALUES (?, 'p1', 'doublon')").bind(A).run(), /UNIQUE/);
  // Le même slug de période est libre dans une autre organisation.
  await env.DB.prepare("INSERT INTO periods (organization_id, slug, name) VALUES (?, 'p1', 'P1')").bind(B).run();
});
