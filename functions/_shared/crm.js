// Fondation CRM (phase 3, durcie en 3.1) : personnes (contacts), relations, périodes, adhésions et groupes
// d'adhésion, construits À CÔTÉ de la table historique `inscriptions` (migrations 8 et 9).
//
// RÈGLES DE LA TRANSITION
// - `inscriptions` reste la transaction métier principale : ce module ne l'écrit JAMAIS (lecture seule).
//   Paiements, dossiers, photos, jetons et références R2 restent attachés à l'inscription ; la fiche CRM les
//   retrouve par `memberships.legacy_inscription_id`.
// - Pendant la transition, l'inscription fait autorité pour les données de personne : le CRM n'a pas d'édition
//   (voir l'admin) et se met à jour depuis elle : jamais deux sources contradictoires.
// - Toute écriture d'une inscription vers le CRM tient dans UNE transaction (db.batch) : jamais de contact ou de
//   période orphelins après une erreur. Elle est idempotente (index uniques) : relancer ne double rien.
// - Une synchronisation en échec ne fait JAMAIS échouer ni perdre une inscription (syncInscriptionSafe) ; la
//   réconciliation (crmReport, backfillOrganization) détecte et répare ensuite.
// - Toutes les requêtes sont limitées à l'organisation ; l'organisation vient toujours du serveur.
//
// RÈGLES D'IDENTITÉ (phase 3.1, conservatrices : mieux vaut deux contacts qu'une fausse fusion)
// Aucun identifiant humain fiable n'existe : un nom, un e-mail, un téléphone ou une adresse sont souvent PARTAGÉS
// dans une famille et ne prouvent pas qu'il s'agit de la même personne. Donc :
// 1. Deux inscriptions d'enfants différents ne fusionnent JAMAIS leurs responsables, même avec nom, e-mail et
//    téléphone identiques. Les contacts restent séparés et sont signalés comme « candidats doublons »
//    (contact_duplicate_candidates) pour une revue humaine future.
// 2. La CONTINUITÉ d'un même enfant d'une période à l'autre est reconnue ainsi : même prénom, même nom, même date de
//    naissance exacte ET au moins un responsable de la nouvelle inscription porte le même nom qu'un responsable déjà
//    rattaché à cet enfant. Le responsable est alors retrouvé parmi ceux DE CET ENFANT (par son nom, un seul
//    candidat) : coordonnées changées = même personne, coordonnées mises à jour ; nom changé = autre personne.
// 3. Plusieurs candidats possibles, ou aucune preuve de continuité = aucune fusion.
// 4. Une synchronisation ne transforme jamais une personne en une autre : si l'identité (nom) d'un emplacement
//    change, la relation est RE-RÉSOLUE (nouvelle personne trouvée ou créée) ; l'ancien contact reste intact
//    tant qu'une autre inscription s'appuie sur lui, et disparaît sinon (plus aucune raison de le conserver).
// 5. Les coordonnées d'un contact suivent la plus récente inscription qui le concerne (created_at, puis id).
//
// PROVENANCE DES RELATIONS
// Une relation enfant ↔ responsable est permanente ; elle est soutenue par une ou plusieurs inscriptions
// (contact_relationship_sources : une ligne par inscription et par emplacement). Supprimer une inscription retire
// sa provenance ; la relation reste tant qu'une autre inscription la soutient.
import { normalizeGroupLabel } from './accounts.js';
import { ensureSchema, normalize } from './inscriptions-db.js';
import { FOLLOWUP_FILTERS } from './club-followup.js';

export const CRM_SOURCE = 'legacy_inscription';
const ROLE_CHILD = 'child';
const ROLE_GUARDIAN_1 = 'guardian1';
const ROLE_GUARDIAN_2 = 'guardian2';
// Types de relation connus (liste ouverte : la colonne accepte tout texte non vide).
export const RELATIONSHIP_TYPES = ['parent', 'legal_guardian', 'emergency_contact', 'sibling', 'other'];
const GUARDIAN_RELATION = 'legal_guardian';

const clean = (value, max = 200) => {
  const text = String(value ?? '').trim().slice(0, max);
  return text || null;
};
const digits = (value) => String(value ?? '').replace(/\D/g, '');
export const nameKey = (first, last) => `${normalize(first)} ${normalize(last)}`.replace(/\s+/g, ' ').trim();
export const periodSlug = (saison) => normalize(saison || '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'non-definie';
// « U6-U7 », « U6 - U7 », « u6 – u7 » désignent le même groupe (tirets typographiques, espaces, casse).
export const groupKey = (label) =>
  normalize(label).replace(/[‐-―−]/g, '-').replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

function requireOrganization(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('CRM : organisation requise');
}

// ---------------------------------------------------------------------------------------------
// Personnes décrites par une inscription (rien n'est copié au-delà de ce que le modèle justifie : pas de
// taille de maillot, de paiement, de consentement ni de statut de dossier dans un contact).

export function personsOf(row) {
  const child = { role: ROLE_CHILD, first: clean(row.enfant_prenom), last: clean(row.enfant_nom), birth: clean(row.naissance, 10), email: null, phone: null, address: null };
  const guardian1 = {
    role: ROLE_GUARDIAN_1,
    first: clean(row.parent_prenom),
    last: clean(row.parent_nom),
    birth: null,
    email: clean(row.email),
    phone: clean(row.telephone, 40),
    // L'adresse du formulaire est celle de la famille : portée par le responsable 1, pas dupliquée sur l'enfant.
    address: { line1: clean(row.adresse), postalCode: clean(row.code_postal, 10), city: clean(row.ville) },
  };
  const guardian2 =
    clean(row.parent2_prenom) && clean(row.parent2_nom)
      ? { role: ROLE_GUARDIAN_2, first: clean(row.parent2_prenom), last: clean(row.parent2_nom), birth: null, email: clean(row.parent2_email), phone: clean(row.parent2_telephone, 40), address: null }
      : null;
  return { child, guardian1, guardian2 };
}

// Ressemblance de deux fiches de responsable : sert UNIQUEMENT à signaler un candidat doublon, jamais à fusionner.
export function looksLikeSameGuardian(contact, person) {
  if (nameKey(contact.first_name, contact.last_name) !== nameKey(person.first, person.last)) return false;
  const sameEmail = normalize(contact.email) && normalize(contact.email) === normalize(person.email);
  const samePhone = digits(contact.phone) && digits(contact.phone) === digits(person.phone);
  return Boolean(sameEmail || samePhone);
}

// ---------------------------------------------------------------------------------------------
// Lectures d'identité

async function contactById(db, organizationId, id) {
  return db.prepare('SELECT * FROM contacts WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
}

async function contactFromSource(db, organizationId, inscriptionId, role) {
  return db
    .prepare('SELECT * FROM contacts WHERE organization_id = ? AND created_from_inscription_id = ? AND created_from_role = ?')
    .bind(organizationId, inscriptionId, role)
    .first();
}

// Responsables déjà rattachés à un enfant (par relation permanente).
async function guardiansOfChild(db, organizationId, childId) {
  const { results } = await db
    .prepare(
      `SELECT c.* FROM contact_relationships r JOIN contacts c ON c.organization_id = r.organization_id AND c.id = r.related_contact_id
       WHERE r.organization_id = ? AND r.contact_id = ? AND r.relationship_type = ?`
    )
    .bind(organizationId, childId, GUARDIAN_RELATION)
    .all();
  return results;
}

// Emplacement (guardian1 / guardian2) → contact responsable, tel que porté par la provenance de l'inscription.
async function slotContacts(db, organizationId, inscriptionId) {
  const { results } = await db
    .prepare(
      `SELECT s.source_role, r.contact_id AS child_id, c.* FROM contact_relationship_sources s
       JOIN contact_relationships r ON r.organization_id = s.organization_id AND r.id = s.relationship_id
       JOIN contacts c ON c.organization_id = r.organization_id AND c.id = r.related_contact_id
       WHERE s.organization_id = ? AND s.legacy_inscription_id = ?`
    )
    .bind(organizationId, inscriptionId)
    .all();
  return Object.fromEntries(results.map((r) => [r.source_role, r]));
}

// Un nom de rôle de création libre (une re-résolution ne peut pas réutiliser la clé d'un contact plus ancien).
async function freeCreationRole(db, organizationId, inscriptionId, base) {
  for (let n = 0; ; n++) {
    const role = n === 0 ? base : `${base}~${n}`;
    if (!(await contactFromSource(db, organizationId, inscriptionId, role))) return role;
  }
}

// ---------------------------------------------------------------------------------------------
// Plans de résolution (lectures seulement ; les écritures partent ensuite dans une seule transaction)

const literal = (contact) => ({ sql: '?', params: [contact.id] });
const bySource = (organizationId, inscriptionId, role) => ({
  sql: '(SELECT id FROM contacts WHERE organization_id = ? AND created_from_inscription_id = ? AND created_from_role = ?)',
  params: [organizationId, inscriptionId, role],
});

async function planChild(db, organizationId, persons, inscriptionId, { reuseOwn }) {
  if (reuseOwn) {
    const own = await contactFromSource(db, organizationId, inscriptionId, ROLE_CHILD);
    if (own) return { existing: own, ref: literal(own), create: null, ambiguous: false, candidates: [] };
  }
  const { results } = await db
    .prepare('SELECT * FROM contacts WHERE organization_id = ? AND search_name = ? AND birth_date = ?')
    .bind(organizationId, nameKey(persons.child.first, persons.child.last), persons.child.birth)
    .all();
  const wanted = new Set([persons.guardian1, persons.guardian2].filter(Boolean).map((g) => nameKey(g.first, g.last)));
  const continuity = [];
  for (const candidate of results) {
    const known = await guardiansOfChild(db, organizationId, candidate.id);
    if (known.some((g) => wanted.has(nameKey(g.first_name, g.last_name)))) continuity.push(candidate);
  }
  if (continuity.length === 1) {
    return { existing: continuity[0], ref: literal(continuity[0]), create: null, ambiguous: false, candidates: results.filter((c) => c.id !== continuity[0].id) };
  }
  const role = await freeCreationRole(db, organizationId, inscriptionId, ROLE_CHILD);
  return { existing: null, ref: bySource(organizationId, inscriptionId, role), create: { person: persons.child, role }, ambiguous: results.length > 0, candidates: results };
}

async function planGuardian(db, organizationId, person, child, inscriptionId, { reuseOwn }) {
  if (reuseOwn) {
    const own = await contactFromSource(db, organizationId, inscriptionId, person.role);
    if (own) return { existing: own, ref: literal(own), create: null, ambiguous: false, candidates: [] };
  }
  const key = nameKey(person.first, person.last);
  let ambiguous = false;
  if (child.existing) {
    // Continuité : le responsable est cherché parmi ceux DE CET ENFANT, par son nom.
    const same = (await guardiansOfChild(db, organizationId, child.existing.id)).filter((g) => nameKey(g.first_name, g.last_name) === key);
    if (same.length === 1) return { existing: same[0], ref: literal(same[0]), create: null, ambiguous: false, candidates: [] };
    ambiguous = same.length > 1;
  }
  const role = await freeCreationRole(db, organizationId, inscriptionId, person.role);
  const { results } = await db.prepare('SELECT * FROM contacts WHERE organization_id = ? AND search_name = ?').bind(organizationId, key).all();
  const lookalikes = results.filter((c) => looksLikeSameGuardian(c, person));
  return { existing: null, ref: bySource(organizationId, inscriptionId, role), create: { person, role }, ambiguous: ambiguous || lookalikes.length > 0, candidates: lookalikes };
}

// ---------------------------------------------------------------------------------------------
// Périodes

export async function ensurePeriod(db, organizationId, saison) {
  const slug = periodSlug(saison);
  await db
    .prepare('INSERT OR IGNORE INTO periods (organization_id, slug, name, status) VALUES (?, ?, ?, ?)')
    .bind(organizationId, slug, clean(saison) || 'Période non définie', 'open')
    .run();
  return db.prepare('SELECT * FROM periods WHERE organization_id = ? AND slug = ?').bind(organizationId, slug).first();
}

// La période courante suit la saison configurée (une seule à la fois). Les dates ne sont pas devinées :
// elles restent vides tant que l'organisation ne les a pas définies.
export async function syncCurrentPeriod(env, organizationId, saison) {
  requireOrganization(organizationId);
  if (!clean(saison)) return null;
  await ensureSchema(env.DB);
  const period = await ensurePeriod(env.DB, organizationId, saison);
  await env.DB.batch([
    env.DB.prepare("UPDATE periods SET is_current = 0, updated_at = datetime('now') WHERE organization_id = ? AND is_current = 1 AND id <> ?").bind(organizationId, period.id),
    env.DB.prepare("UPDATE periods SET is_current = 1, updated_at = datetime('now') WHERE organization_id = ? AND id = ? AND is_current = 0").bind(organizationId, period.id),
  ]);
  return period;
}

// ---------------------------------------------------------------------------------------------
// Groupe : rattachement par le nom de la catégorie (comparé sans tenir compte de la casse, des espaces et du
// style des tirets). Sans correspondance, l'adhésion existe quand même, avec son libellé historique : aucun
// groupe n'est jamais créé automatiquement.

async function resolveGroup(db, organizationId, label) {
  const { results } = await db.prepare('SELECT id, name FROM groups WHERE organization_id = ?').bind(organizationId).all();
  return results.find((g) => g.name === label) || results.find((g) => groupKey(g.name) === groupKey(label)) || null;
}

const membershipState = (row) => (row.archived_at ? { status: 'ended', endedAt: row.archived_at } : { status: 'active', endedAt: null });

// ---------------------------------------------------------------------------------------------
// Écritures : une seule transaction par inscription

function contactInsert(db, organizationId, person, inscriptionId, role) {
  return db
    .prepare(`INSERT OR IGNORE INTO contacts (organization_id, first_name, last_name, search_name, birth_date, email, phone, address_line1, postal_code, city, source, created_from_inscription_id, created_from_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      organizationId, person.first, person.last, nameKey(person.first, person.last), person.birth, person.email, person.phone,
      person.address?.line1 ?? null, person.address?.postalCode ?? null, person.address?.city ?? null, CRM_SOURCE, inscriptionId, role
    );
}

// Retire la provenance de l'inscription ; une relation qu'elle était seule à soutenir disparaît avec elle.
function detachStatements(db, organizationId, inscriptionId) {
  return [
    db
      .prepare(
        `DELETE FROM contact_relationships WHERE organization_id = ?1
           AND id IN (SELECT relationship_id FROM contact_relationship_sources WHERE organization_id = ?1 AND legacy_inscription_id = ?2)
           AND NOT EXISTS (SELECT 1 FROM contact_relationship_sources s2 WHERE s2.organization_id = contact_relationships.organization_id
                             AND s2.relationship_id = contact_relationships.id AND s2.legacy_inscription_id <> ?2)`
      )
      .bind(organizationId, inscriptionId),
    db.prepare('DELETE FROM contact_relationship_sources WHERE organization_id = ? AND legacy_inscription_id = ?').bind(organizationId, inscriptionId),
  ];
}

// Personnes issues des inscriptions et qui n'ont plus aucune raison d'exister (ni adhésion ni relation).
function sweepOrphansStatement(db, organizationId) {
  return db
    .prepare(
      `DELETE FROM contacts WHERE organization_id = ? AND source = 'legacy_inscription'
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = contacts.organization_id AND m.contact_id = contacts.id)
         AND NOT EXISTS (SELECT 1 FROM contact_relationships r WHERE r.organization_id = contacts.organization_id
                           AND (r.contact_id = contacts.id OR r.related_contact_id = contacts.id))`
    )
    .bind(organizationId);
}

// Ajoute (ou complète) tout ce qu'une inscription apporte : contacts manquants, relations et leur provenance,
// adhésion, groupe. `detach` : retire d'abord la provenance existante (re-résolution).
function attachBatch(db, organizationId, row, plan, { detach, withGroup, extra = [] }) {
  const statements = [];
  const at = {};
  if (detach) statements.push(...detachStatements(db, organizationId, row.id));
  statements.push(
    db.prepare('INSERT OR IGNORE INTO periods (organization_id, slug, name, status) VALUES (?, ?, ?, ?)').bind(organizationId, periodSlug(row.saison), clean(row.saison) || 'Période non définie', 'open')
  );
  if (plan.child.create) {
    at.child = statements.length;
    statements.push(contactInsert(db, organizationId, plan.child.create.person, row.id, plan.child.create.role));
  }
  at.guardians = [];
  for (const g of plan.guardians) {
    if (g.create) {
      at.guardians.push(statements.length);
      statements.push(contactInsert(db, organizationId, g.create.person, row.id, g.create.role));
    }
  }
  at.relationships = [];
  for (const g of plan.guardians) {
    if (g.ref.sql === '?' && plan.child.ref.sql === '?' && g.ref.params[0] === plan.child.ref.params[0]) continue;
    at.relationships.push(statements.length);
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO contact_relationships (organization_id, contact_id, related_contact_id, relationship_type, is_primary)
           VALUES (?, ${plan.child.ref.sql}, ${g.ref.sql}, ?, ?)`
        )
        .bind(organizationId, ...plan.child.ref.params, ...g.ref.params, GUARDIAN_RELATION, g.role === ROLE_GUARDIAN_1 ? 1 : 0)
    );
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO contact_relationship_sources (organization_id, relationship_id, legacy_inscription_id, source_role)
           SELECT ?, id, ?, ? FROM contact_relationships
           WHERE organization_id = ? AND contact_id = ${plan.child.ref.sql} AND related_contact_id = ${g.ref.sql} AND relationship_type = ?`
        )
        .bind(organizationId, row.id, g.role, organizationId, ...plan.child.ref.params, ...g.ref.params, GUARDIAN_RELATION)
    );
  }
  const state = membershipState(row);
  at.membership = statements.length;
  statements.push(
    db
      .prepare(
        `INSERT OR IGNORE INTO memberships (organization_id, contact_id, period_id, status, joined_at, ended_at, source, legacy_inscription_id)
         VALUES (?, ${plan.child.ref.sql}, (SELECT id FROM periods WHERE organization_id = ? AND slug = ?), ?, ?, ?, ?, ?)`
      )
      .bind(organizationId, ...plan.child.ref.params, organizationId, periodSlug(row.saison), state.status, row.created_at, state.endedAt, CRM_SOURCE, row.id)
  );
  // Adhésion déjà reliée à un autre enfant (identité corrigée) : elle suit la nouvelle résolution.
  statements.push(
    db
      .prepare(
        `UPDATE memberships SET contact_id = ${plan.child.ref.sql}, updated_at = datetime('now')
         WHERE organization_id = ? AND legacy_inscription_id = ? AND contact_id <> ${plan.child.ref.sql}`
      )
      .bind(...plan.child.ref.params, organizationId, row.id, ...plan.child.ref.params)
  );
  if (withGroup) {
    statements.push(
      db
        .prepare(
          `INSERT INTO group_memberships (organization_id, membership_id, group_id, group_label, is_primary, started_at)
           SELECT ?, id, ?, ?, 1, ? FROM memberships
           WHERE organization_id = ? AND legacy_inscription_id = ?
             AND NOT EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.organization_id = ? AND gm.membership_id = memberships.id)`
        )
        .bind(organizationId, plan.group?.id ?? null, clean(row.categorie) || 'Sans groupe', row.created_at, organizationId, row.id, organizationId)
    );
  }
  // Coordonnées, état et groupe : DANS la même transaction que le mapping (tout ou rien).
  statements.push(...extra);
  statements.push(sweepOrphansStatement(db, organizationId));
  return { statements, at };
}

// Candidats doublons : ressemblances signalées, JAMAIS fusionnées.
async function markDuplicateCandidates(db, organizationId, pairs) {
  const statements = [];
  for (const { id, otherId, reason } of pairs) {
    if (!id || !otherId || id === otherId) continue;
    statements.push(
      db
        // Les deux contacts doivent encore exister (un contact remplacé par une re-résolution vient d'être retiré).
        .prepare(
          `INSERT OR IGNORE INTO contact_duplicate_candidates (organization_id, contact_id, other_contact_id, reason)
           SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM contacts WHERE organization_id = ?1 AND id = ?2) AND EXISTS (SELECT 1 FROM contacts WHERE organization_id = ?1 AND id = ?3)`
        )
        .bind(organizationId, Math.min(id, otherId), Math.max(id, otherId), reason)
    );
  }
  if (statements.length) await db.batch(statements);
}

// ---------------------------------------------------------------------------------------------
// Synchronisation d'UNE inscription vers le CRM.
// Renvoie { status: 'created' | 'refreshed' | 'missing', contacts: { child, guardian }, relationships, memberships,
// ambiguous: { guardian, child } } (compteurs, jamais de donnée personnelle).

const emptyResult = (status) => ({ status, contacts: { child: 0, guardian: 0 }, relationships: 0, memberships: 0, ambiguous: { guardian: 0, child: 0 } });

export async function syncInscription(env, organizationId, inscriptionId) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const db = env.DB;
  const row = await db.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, inscriptionId).first();
  if (!row) return emptyResult('missing');
  const persons = personsOf(row);
  if (!persons.child.first || !persons.child.last || !persons.child.birth || !persons.guardian1.first || !persons.guardian1.last) {
    throw new Error('Inscription incomplète : identité illisible');
  }
  const membership = await db.prepare('SELECT * FROM memberships WHERE organization_id = ? AND legacy_inscription_id = ?').bind(organizationId, inscriptionId).first();
  if (membership) return refreshMapped(db, organizationId, row, membership, persons);
  return createMapping(db, organizationId, row, persons);
}

async function createMapping(db, organizationId, row, persons) {
  const child = await planChild(db, organizationId, persons, row.id, { reuseOwn: true });
  const guardians = [];
  for (const person of [persons.guardian1, persons.guardian2].filter(Boolean)) {
    guardians.push({ ...(await planGuardian(db, organizationId, person, child, row.id, { reuseOwn: true })), role: person.role });
  }
  const group = await resolveGroup(db, organizationId, row.categorie);
  // Contacts retrouvés (continuité d'un même enfant) : leurs coordonnées suivent la plus récente inscription, dans
  // la MÊME transaction que le mapping (jamais un mapping à jour avec des coordonnées périmées).
  const extra = await coordinateStatements(db, organizationId, row, persons, child, guardians);
  const { statements, at } = attachBatch(db, organizationId, row, { child, guardians, group }, { detach: false, withGroup: true, extra });
  const outcome = await db.batch(statements);

  const result = emptyResult('created');
  result.contacts.child = child.create ? outcome[at.child].meta.changes : 0;
  result.contacts.guardian = at.guardians.reduce((sum, i) => sum + outcome[i].meta.changes, 0);
  result.relationships = at.relationships.reduce((sum, i) => sum + outcome[i].meta.changes, 0);
  result.memberships = outcome[at.membership].meta.changes;
  if (child.ambiguous) result.ambiguous.child = 1;
  result.ambiguous.guardian = guardians.filter((g) => g.ambiguous).length;
  await recordCandidates(db, organizationId, row.id, child, guardians);
  return result;
}

// Candidats doublons : information dérivée et recalculable (refreshDuplicateCandidates) ; écrite APRÈS le mapping,
// une panne ici ne rend rien d'incohérent.
async function recordCandidates(db, organizationId, inscriptionId, child, guardians) {
  const pairs = [];
  const contactOf = async (plan) => plan.existing || (plan.create ? contactFromSource(db, organizationId, inscriptionId, plan.create.role) : null);
  const childContact = await contactOf(child);
  for (const c of child.candidates) pairs.push({ id: childContact?.id, otherId: c.id, reason: 'same_name_birthdate' });
  for (const g of guardians) {
    const contact = await contactOf(g);
    for (const c of g.candidates) pairs.push({ id: contact?.id, otherId: c.id, reason: 'same_name_contact' });
  }
  await markDuplicateCandidates(db, organizationId, pairs);
}

// Inscription déjà reliée. TOUT ce qui change (état, groupe, identité re-résolue, coordonnées) part dans UNE
// transaction : une panne laisse l'état précédent, jamais un mélange. Les lectures qui décident restent avant.
async function refreshMapped(db, organizationId, row, membership, persons) {
  const result = emptyResult('refreshed');
  const state = membershipState(row);
  const common = [
    db
      .prepare(
        `UPDATE memberships SET status = ?, ended_at = ?, updated_at = datetime('now')
         WHERE organization_id = ? AND id = ? AND status IN ('active', 'ended') AND (status <> ? OR ended_at IS NOT ?)`
      )
      .bind(state.status, state.endedAt, organizationId, membership.id, state.status, state.endedAt),
    ...(await groupStatements(db, organizationId, row, membership)),
  ];

  const childContact = await contactById(db, organizationId, membership.contact_id);
  const slots = await slotContacts(db, organizationId, row.id);
  const childSame =
    childContact &&
    nameKey(childContact.first_name, childContact.last_name) === nameKey(persons.child.first, persons.child.last) &&
    childContact.birth_date === persons.child.birth;
  const slotMatches = (person, role) => {
    const current = slots[role];
    if (!person) return !current;
    return Boolean(current) && nameKey(current.first_name, current.last_name) === nameKey(person.first, person.last) && current.child_id === membership.contact_id;
  };
  if (childSame && slotMatches(persons.guardian1, ROLE_GUARDIAN_1) && slotMatches(persons.guardian2, ROLE_GUARDIAN_2)) {
    const same = {
      child: { existing: childContact },
      guardians: [persons.guardian1, persons.guardian2].filter(Boolean).map((person) => ({ existing: slots[person.role], role: person.role })),
    };
    await db.batch([...common, ...(await coordinateStatements(db, organizationId, row, persons, same.child, same.guardians))]);
    return result;
  }

  // Identité différente : re-résolution (jamais de renommage d'une personne en une autre).
  const child = childSame
    ? { existing: childContact, ref: literal(childContact), create: null, ambiguous: false, candidates: [] }
    : await planChild(db, organizationId, persons, row.id, { reuseOwn: false });
  const guardians = [];
  for (const person of [persons.guardian1, persons.guardian2].filter(Boolean)) {
    if (childSame && slotMatches(person, person.role)) {
      guardians.push({ existing: slots[person.role], ref: literal(slots[person.role]), create: null, ambiguous: false, candidates: [], role: person.role });
    } else {
      guardians.push({ ...(await planGuardian(db, organizationId, person, child, row.id, { reuseOwn: false })), role: person.role });
    }
  }
  const extra = [...common, ...(await coordinateStatements(db, organizationId, row, persons, child, guardians))];
  const { statements, at } = attachBatch(db, organizationId, row, { child, guardians, group: null }, { detach: true, withGroup: false, extra });
  const outcome = await db.batch(statements);
  result.contacts.child = child.create ? outcome[at.child].meta.changes : 0;
  result.contacts.guardian = at.guardians.reduce((sum, i) => sum + outcome[i].meta.changes, 0);
  result.relationships = at.relationships.reduce((sum, i) => sum + outcome[i].meta.changes, 0);
  await recordCandidates(db, organizationId, row.id, child, guardians);
  return result;
}

// Instructions de changement de groupe (fin du groupe en cours, nouveau groupe) ; vide si rien ne change.
async function groupStatements(db, organizationId, row, membership) {
  const label = clean(row.categorie) || 'Sans groupe';
  const current = await db
    .prepare('SELECT id, group_label FROM group_memberships WHERE organization_id = ? AND membership_id = ? AND is_primary = 1 AND ended_at IS NULL')
    .bind(organizationId, membership.id)
    .first();
  if (current && current.group_label === label) return [];
  const group = await resolveGroup(db, organizationId, label);
  const statements = [];
  if (current) {
    statements.push(db.prepare("UPDATE group_memberships SET ended_at = datetime('now'), updated_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(organizationId, current.id));
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO group_memberships (organization_id, membership_id, group_id, group_label, is_primary, started_at)
         VALUES (?, ?, ?, ?, 1, datetime('now'))`
      )
      .bind(organizationId, membership.id, group?.id ?? null, label)
  );
  return statements;
}

// ---------------------------------------------------------------------------------------------
// Coordonnées : un contact suit la plus récente inscription qui le concerne (created_at de l'inscription, puis id).

const isNewer = (row, other) => !other || row.created_at > other.created_at || (row.created_at === other.created_at && row.id > other.id);

// Cette inscription est-elle la plus récente parmi celles (autres qu'elle) qui s'appuient sur ce contact ?
async function isLatestForChild(db, organizationId, row, childId) {
  const other = await db
    .prepare(
      `SELECT i.created_at, i.id FROM memberships m JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
       WHERE m.organization_id = ? AND m.contact_id = ? AND m.legacy_inscription_id <> ? ORDER BY i.created_at DESC, i.id DESC LIMIT 1`
    )
    .bind(organizationId, childId, row.id)
    .first();
  return isNewer(row, other);
}
async function isLatestForGuardian(db, organizationId, row, guardianId) {
  const other = await db
    .prepare(
      `SELECT i.created_at, i.id FROM contact_relationship_sources s
       JOIN contact_relationships r ON r.organization_id = s.organization_id AND r.id = s.relationship_id
       JOIN inscriptions i ON i.organization_id = s.organization_id AND i.id = s.legacy_inscription_id
       WHERE s.organization_id = ? AND r.related_contact_id = ? AND s.legacy_inscription_id <> ? ORDER BY i.created_at DESC, i.id DESC LIMIT 1`
    )
    .bind(organizationId, guardianId, row.id)
    .first();
  return isNewer(row, other);
}

// Instructions de mise à jour des contacts EXISTANTS dont cette inscription devient la source la plus récente.
// (Un contact créé dans la même transaction porte déjà ses valeurs.)
async function coordinateStatements(db, organizationId, row, persons, child, guardians) {
  const statements = [];
  if (child.existing && (await isLatestForChild(db, organizationId, row, child.existing.id))) {
    statements.push(refreshContactStatement(db, organizationId, child.existing.id, persons.child));
  }
  for (const guardian of guardians) {
    if (!guardian.existing) continue;
    const person = persons[guardian.role === ROLE_GUARDIAN_1 ? 'guardian1' : 'guardian2'];
    if (person && (await isLatestForGuardian(db, organizationId, row, guardian.existing.id))) {
      statements.push(refreshContactStatement(db, organizationId, guardian.existing.id, person));
    }
  }
  return statements.filter(Boolean);
}

function refreshContactStatement(db, organizationId, contactId, person) {
  if (!person.first || !person.last) return null;
  const address = person.address;
  const has = address ? 1 : 0;
  const line1 = address?.line1 ?? null;
  const postal = address?.postalCode ?? null;
  const city = address?.city ?? null;
  return db
    .prepare(
      `UPDATE contacts SET first_name = ?, last_name = ?, search_name = ?, birth_date = COALESCE(?, birth_date), email = ?, phone = ?,
         address_line1 = CASE WHEN ? THEN ? ELSE address_line1 END,
         postal_code = CASE WHEN ? THEN ? ELSE postal_code END,
         city = CASE WHEN ? THEN ? ELSE city END,
         updated_at = datetime('now')
       WHERE organization_id = ? AND id = ?
         AND (first_name IS NOT ? OR last_name IS NOT ? OR birth_date IS NOT COALESCE(?, birth_date) OR email IS NOT ? OR phone IS NOT ?
              OR (? AND (address_line1 IS NOT ? OR postal_code IS NOT ? OR city IS NOT ?)))`
    )
    .bind(
      person.first, person.last, nameKey(person.first, person.last), person.birth, person.email, person.phone,
      has, line1, has, postal, has, city,
      organizationId, contactId,
      person.first, person.last, person.birth, person.email, person.phone,
      has, line1, postal, city
    );
}

// DÉFENSE EN PROFONDEUR — dérive de coordonnées : pour chaque contact, la valeur attendue est recalculée depuis sa
// source la plus récente ; un écart (panne exceptionnelle, écriture partielle) désigne l'inscription à resynchroniser.
// Ne compare que ce que le CRM est censé suivre : identité, e-mail, téléphone (responsables), adresse (responsable 1).
async function coordinateDriftIds(db, organizationId) {
  const ids = new Set();
  const { results: guardians } = await db
    .prepare(
      `SELECT c.id AS contact_id, c.first_name, c.last_name, c.search_name, c.email AS c_email, c.phone AS c_phone, c.address_line1, c.postal_code, c.city,
              s.source_role, i.*
       FROM contacts c
       JOIN contact_relationships r ON r.organization_id = c.organization_id AND r.related_contact_id = c.id
       JOIN contact_relationship_sources s ON s.organization_id = r.organization_id AND s.relationship_id = r.id
       JOIN inscriptions i ON i.organization_id = s.organization_id AND i.id = s.legacy_inscription_id
       WHERE c.organization_id = ? ORDER BY c.id, i.created_at DESC, i.id DESC`
    )
    .bind(organizationId)
    .all();
  const seen = new Set();
  for (const r of guardians) {
    if (seen.has(r.contact_id)) continue; // première ligne = source la plus récente
    seen.add(r.contact_id);
    const person = personsOf(r)[r.source_role === ROLE_GUARDIAN_1 ? 'guardian1' : 'guardian2'];
    if (!person) continue;
    const same =
      r.first_name === person.first && r.last_name === person.last && r.search_name === nameKey(person.first, person.last) &&
      (r.c_email ?? null) === person.email && (r.c_phone ?? null) === person.phone &&
      (!person.address || ((r.address_line1 ?? null) === person.address.line1 && (r.postal_code ?? null) === person.address.postalCode && (r.city ?? null) === person.address.city));
    if (!same) ids.add(r.id);
  }
  const { results: children } = await db
    .prepare(
      `SELECT c.id AS contact_id, c.first_name, c.last_name, c.search_name, c.birth_date, i.*
       FROM memberships m JOIN contacts c ON c.organization_id = m.organization_id AND c.id = m.contact_id
       JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
       WHERE m.organization_id = ? ORDER BY c.id, i.created_at DESC, i.id DESC`
    )
    .bind(organizationId)
    .all();
  const seenChildren = new Set();
  for (const r of children) {
    if (seenChildren.has(r.contact_id)) continue;
    seenChildren.add(r.contact_id);
    const person = personsOf(r).child;
    if (r.first_name !== person.first || r.last_name !== person.last || r.search_name !== nameKey(person.first, person.last) || r.birth_date !== person.birth) ids.add(r.id);
  }
  return [...ids];
}

// Enveloppe sûre : appelée juste après une écriture d'inscription, elle ne doit JAMAIS la faire échouer.
// L'échec est journalisé sans donnée personnelle (l'identifiant numérique de la fiche seulement) ; la
// réconciliation quotidienne ou manuelle rattrape ensuite.
export async function syncInscriptionSafe(env, organizationId, inscriptionId) {
  try {
    return await syncInscription(env, organizationId, inscriptionId);
  } catch (error) {
    console.error(`CRM : synchronisation en échec (organisation ${organizationId}, inscription ${inscriptionId}) : ${error?.name || 'erreur'}`);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Ce qui reste à faire pour qu'inscriptions et CRM concordent (sert au remplissage ET à l'audit).

const STALENESS = {
  statusMismatch: `SELECT i.id FROM memberships m JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
                   WHERE m.organization_id = ? AND m.status IN ('active', 'ended') AND ((i.archived_at IS NULL) <> (m.status = 'active'))`,
  groupMismatch: `SELECT i.id FROM memberships m JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
                  WHERE m.organization_id = ? AND NOT EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.organization_id = m.organization_id
                    AND gm.membership_id = m.id AND gm.is_primary = 1 AND gm.ended_at IS NULL AND gm.group_label = COALESCE(NULLIF(TRIM(i.categorie), ''), 'Sans groupe'))`,
  guardianSlotMissing: `SELECT i.id FROM memberships m JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
                        WHERE m.organization_id = ? AND (
                          NOT EXISTS (SELECT 1 FROM contact_relationship_sources s WHERE s.organization_id = i.organization_id AND s.legacy_inscription_id = i.id AND s.source_role = 'guardian1')
                          OR (TRIM(COALESCE(i.parent2_prenom, '')) <> '' AND TRIM(COALESCE(i.parent2_nom, '')) <> ''
                              AND NOT EXISTS (SELECT 1 FROM contact_relationship_sources s WHERE s.organization_id = i.organization_id AND s.legacy_inscription_id = i.id AND s.source_role = 'guardian2')))`,
};

async function idsOf(db, organizationId, sql) {
  const { results } = await db.prepare(sql).bind(organizationId).all();
  return results.map((r) => r.id);
}

// Adhésions dont le contact enfant ne correspond plus à l'identité de l'inscription (édition non synchronisée).
async function identityMismatchIds(db, organizationId) {
  const { results } = await db
    .prepare(
      `SELECT i.id, i.enfant_prenom, i.enfant_nom, i.naissance, c.search_name, c.birth_date FROM memberships m
       JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
       JOIN contacts c ON c.organization_id = m.organization_id AND c.id = m.contact_id
       WHERE m.organization_id = ?`
    )
    .bind(organizationId)
    .all();
  return results.filter((r) => r.search_name !== nameKey(r.enfant_prenom, r.enfant_nom) || r.birth_date !== clean(r.naissance, 10)).map((r) => r.id);
}

// Emplacements de responsable dont la personne reliée n'a plus le nom saisi dans l'inscription.
async function guardianIdentityMismatchIds(db, organizationId) {
  const { results } = await db
    .prepare(
      `SELECT i.id, s.source_role, i.parent_prenom, i.parent_nom, i.parent2_prenom, i.parent2_nom, c.search_name FROM contact_relationship_sources s
       JOIN contact_relationships r ON r.organization_id = s.organization_id AND r.id = s.relationship_id
       JOIN contacts c ON c.organization_id = r.organization_id AND c.id = r.related_contact_id
       JOIN inscriptions i ON i.organization_id = s.organization_id AND i.id = s.legacy_inscription_id
       WHERE s.organization_id = ?`
    )
    .bind(organizationId)
    .all();
  return results
    .filter((r) => r.search_name !== (r.source_role === ROLE_GUARDIAN_1 ? nameKey(r.parent_prenom, r.parent_nom) : nameKey(r.parent2_prenom, r.parent2_nom)))
    .map((r) => r.id);
}

export async function inscriptionsNeedingSync(db, organizationId) {
  const unmapped = await idsOf(
    db,
    organizationId,
    `SELECT i.id FROM inscriptions i WHERE i.organization_id = ?
       AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = i.organization_id AND m.legacy_inscription_id = i.id)`
  );
  const stale = new Set();
  for (const sql of Object.values(STALENESS)) for (const id of await idsOf(db, organizationId, sql)) stale.add(id);
  for (const id of await identityMismatchIds(db, organizationId)) stale.add(id);
  for (const id of await guardianIdentityMismatchIds(db, organizationId)) stale.add(id);
  for (const id of await coordinateDriftIds(db, organizationId)) stale.add(id);
  for (const id of unmapped) stale.delete(id);
  return { unmapped: unmapped.sort((a, b) => a - b), stale: [...stale].sort((a, b) => a - b) };
}

// ---------------------------------------------------------------------------------------------
// Remplissage / réconciliation d'une organisation
//
// dryRun (défaut) : compte seulement ce qui serait fait. Sinon relie les inscriptions pas encore reliées, remet en
// concordance celles dont l'état, le groupe ou l'identité ont divergé, retire les contacts sans plus aucune raison
// d'exister et recalcule les candidats doublons. `limit` borne le travail d'un appel (requête HTTP, cron).
export async function backfillOrganization(env, organizationId, { dryRun = true, limit = Infinity } = {}) {
  requireOrganization(organizationId);
  await ensureSchema(env.DB);
  const { unmapped, stale } = await inscriptionsNeedingSync(env.DB, organizationId);
  const todo = [...unmapped, ...stale];
  const summary = {
    dryRun,
    pending: todo.length,
    unmapped: unmapped.length,
    stale: stale.length,
    processed: 0,
    failed: 0,
    remaining: 0,
    contacts: { child: 0, guardian: 0 },
    relationships: 0,
    memberships: 0,
    ambiguous: { guardian: 0, child: 0 },
  };
  if (dryRun) return summary;
  const batch = todo.slice(0, limit);
  summary.remaining = todo.length - batch.length;
  for (const id of batch) {
    try {
      const result = await syncInscription(env, organizationId, id);
      summary.processed += 1;
      summary.contacts.child += result.contacts.child;
      summary.contacts.guardian += result.contacts.guardian;
      summary.relationships += result.relationships;
      summary.memberships += result.memberships;
      summary.ambiguous.guardian += result.ambiguous.guardian;
      summary.ambiguous.child += result.ambiguous.child;
    } catch (error) {
      summary.failed += 1;
      console.error(`CRM : remplissage en échec (organisation ${organizationId}, inscription ${id}) : ${error?.name || 'erreur'}`);
    }
  }
  await env.DB.batch([sweepOrphansStatement(env.DB, organizationId)]);
  await refreshDuplicateCandidates(env.DB, organizationId);
  return summary;
}

// Recalcule tous les candidats doublons de l'organisation (ressemblances, jamais de fusion).
export async function refreshDuplicateCandidates(db, organizationId) {
  requireOrganization(organizationId);
  const { results } = await db
    .prepare(
      `SELECT * FROM contacts WHERE organization_id = ? AND search_name IN
         (SELECT search_name FROM contacts WHERE organization_id = ? GROUP BY search_name HAVING COUNT(*) > 1) ORDER BY search_name, id`
    )
    .bind(organizationId, organizationId)
    .all();
  const groups = new Map();
  for (const contact of results) groups.set(contact.search_name, [...(groups.get(contact.search_name) || []), contact]);
  const pairs = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.birth_date && a.birth_date === b.birth_date) pairs.push({ id: a.id, otherId: b.id, reason: 'same_name_birthdate' });
        else if (looksLikeSameGuardian(a, { first: b.first_name, last: b.last_name, email: b.email, phone: b.phone })) pairs.push({ id: a.id, otherId: b.id, reason: 'same_name_contact' });
      }
    }
  }
  await markDuplicateCandidates(db, organizationId, pairs);
  // Retire les candidats devenus faux (les données ont divergé depuis). Ils sont tous calculés automatiquement : aucune
  // décision humaine n'existe encore à préserver (un futur « pas un doublon » validé par un humain devra être conservé).
  const wanted = new Set(pairs.map((pair) => `${Math.min(pair.id, pair.otherId)}:${Math.max(pair.id, pair.otherId)}`));
  const { results: existing } = await db.prepare('SELECT id, contact_id, other_contact_id FROM contact_duplicate_candidates WHERE organization_id = ?').bind(organizationId).all();
  const obsolete = existing.filter((row) => !wanted.has(`${row.contact_id}:${row.other_contact_id}`));
  if (obsolete.length) {
    await db.batch(obsolete.map((row) => db.prepare('DELETE FROM contact_duplicate_candidates WHERE organization_id = ? AND id = ?').bind(organizationId, row.id)));
  }
}

// Rapport de cohérence inscriptions ↔ CRM. Que des compteurs : aucune donnée personnelle.
// `anomalies` : incohérences à corriger ; `warnings` : à vérifier par un humain, sans être une incohérence.
export async function crmReport(db, organizationId) {
  requireOrganization(organizationId);
  const one = async (sql, ...params) => (await db.prepare(sql).bind(organizationId, ...params).first()).n;
  const needs = await inscriptionsNeedingSync(db, organizationId);
  const report = {
    inscriptions: await one('SELECT COUNT(*) AS n FROM inscriptions WHERE organization_id = ?'),
    inscriptionsUnmapped: needs.unmapped.length,
    inscriptionsStale: needs.stale.length,
    memberships: await one('SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ?'),
    membershipsWithoutLegacy: await one('SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ? AND legacy_inscription_id IS NULL'),
    membershipsWithMissingInscription: await one(
      'SELECT COUNT(*) AS n FROM memberships m WHERE m.organization_id = ? AND m.legacy_inscription_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inscriptions i WHERE i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id)'
    ),
    contacts: await one('SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ?'),
    contactsFromChild: await one("SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ? AND created_from_role LIKE 'child%'"),
    contactsFromGuardian: await one("SELECT COUNT(*) AS n FROM contacts WHERE organization_id = ? AND created_from_role LIKE 'guardian%'"),
    orphanContacts: await one(
      `SELECT COUNT(*) AS n FROM contacts c WHERE c.organization_id = ? AND c.source = 'legacy_inscription'
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = c.organization_id AND m.contact_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM contact_relationships r WHERE r.organization_id = c.organization_id AND (r.contact_id = c.id OR r.related_contact_id = c.id))`
    ),
    relationships: await one('SELECT COUNT(*) AS n FROM contact_relationships WHERE organization_id = ?'),
    relationshipSources: await one('SELECT COUNT(*) AS n FROM contact_relationship_sources WHERE organization_id = ?'),
    relationshipsWithoutSource: await one(
      'SELECT COUNT(*) AS n FROM contact_relationships r WHERE r.organization_id = ? AND NOT EXISTS (SELECT 1 FROM contact_relationship_sources s WHERE s.organization_id = r.organization_id AND s.relationship_id = r.id)'
    ),
    sourcesWithMissingInscription: await one(
      'SELECT COUNT(*) AS n FROM contact_relationship_sources s WHERE s.organization_id = ? AND NOT EXISTS (SELECT 1 FROM inscriptions i WHERE i.organization_id = s.organization_id AND i.id = s.legacy_inscription_id)'
    ),
    periods: await one('SELECT COUNT(*) AS n FROM periods WHERE organization_id = ?'),
    currentPeriods: await one('SELECT COUNT(*) AS n FROM periods WHERE organization_id = ? AND is_current = 1'),
    groupMemberships: await one('SELECT COUNT(*) AS n FROM group_memberships WHERE organization_id = ?'),
    membershipsWithoutGroup: await one(
      'SELECT COUNT(*) AS n FROM memberships m WHERE m.organization_id = ? AND NOT EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.organization_id = m.organization_id AND gm.membership_id = m.id)'
    ),
    childrenWithoutGuardian: await one(
      `SELECT COUNT(*) AS n FROM contacts c WHERE c.organization_id = ? AND c.created_from_role LIKE 'child%'
         AND NOT EXISTS (SELECT 1 FROM contact_relationships r WHERE r.organization_id = c.organization_id AND r.contact_id = c.id)`
    ),
    // À vérifier par un humain (pas des incohérences) :
    groupsUnresolved: await one('SELECT COUNT(*) AS n FROM group_memberships WHERE organization_id = ? AND group_id IS NULL AND ended_at IS NULL'),
    duplicateContactPeriod: await one('SELECT COUNT(*) AS n FROM (SELECT 1 FROM memberships WHERE organization_id = ? GROUP BY contact_id, period_id HAVING COUNT(*) > 1)'),
    duplicateCandidates: await one('SELECT COUNT(*) AS n FROM contact_duplicate_candidates WHERE organization_id = ?'),
  };
  report.inscriptionsMapped = report.inscriptions - report.inscriptionsUnmapped;
  report.anomalies =
    report.inscriptionsUnmapped +
    report.inscriptionsStale +
    report.membershipsWithoutLegacy +
    report.membershipsWithMissingInscription +
    report.orphanContacts +
    report.relationshipsWithoutSource +
    report.sourcesWithMissingInscription +
    report.membershipsWithoutGroup +
    report.childrenWithoutGuardian;
  report.warnings = report.groupsUnresolved + report.duplicateContactPeriod + report.duplicateCandidates;
  return report;
}

// ---------------------------------------------------------------------------------------------
// Suppression définitive d'une inscription (RGPD) : ses traces CRM disparaissent avec elle, mais RIEN de ce
// qu'une autre inscription soutient encore. Instructions à ajouter au batch de _shared/inscription-deletion.js,
// AVANT la suppression de la fiche :
// - son adhésion (et son groupe) est supprimée ;
// - sa provenance est retirée de chaque relation ; une relation que plus aucune inscription ne soutient disparaît ;
// - les personnes qui n'ont plus ni adhésion ni relation disparaissent (un responsable encore relié à une autre
//   inscription reste, tout comme un enfant qui a une autre période).
export function crmDeletionStatements(db, organizationId, inscriptionId) {
  return [
    db
      .prepare(
        'DELETE FROM group_memberships WHERE organization_id = ?1 AND membership_id IN (SELECT id FROM memberships WHERE organization_id = ?1 AND legacy_inscription_id = ?2)'
      )
      .bind(organizationId, inscriptionId),
    db.prepare('DELETE FROM memberships WHERE organization_id = ?1 AND legacy_inscription_id = ?2').bind(organizationId, inscriptionId),
    ...detachStatements(db, organizationId, inscriptionId),
    // Relations posées avant la migration 9 (provenance portée par l'ancienne colonne) : même règle.
    db
      .prepare(
        `DELETE FROM contact_relationships WHERE organization_id = ?1 AND legacy_inscription_id = ?2
           AND NOT EXISTS (SELECT 1 FROM contact_relationship_sources s WHERE s.organization_id = contact_relationships.organization_id AND s.relationship_id = contact_relationships.id)`
      )
      .bind(organizationId, inscriptionId),
    sweepOrphansStatement(db, organizationId),
    db
      .prepare("UPDATE contacts SET created_from_inscription_id = NULL, created_from_role = NULL, updated_at = datetime('now') WHERE organization_id = ?1 AND created_from_inscription_id = ?2")
      .bind(organizationId, inscriptionId),
  ];
}

// ---------------------------------------------------------------------------------------------
// Lecture (pages /admin/adherents et fiches). Une seule requête jointe par page : pas de N+1.

export const MEMBER_PAGE_SIZE = 25;

// Adhésion dont l'inscription source est complète (même règle qu'isInscriptionComplete de inscriptions-db.js :
// dossier signé déposé ET validé, paiement reçu, photo reçue, ville et pays de naissance). La page Adhérents n'affiche que celles-là ; les
// inscriptions incomplètes se suivent dans Inscriptions ou Réinscription.
export const COMPLETE_INSCRIPTION_SQL =
  "(i.id IS NOT NULL AND i.dossier_uploaded_at IS NOT NULL AND i.dossier_status = 'valide' AND i.paye = 1 AND i.photo_uploaded_at IS NOT NULL" +
  " AND TRIM(COALESCE(i.ville_naissance, '')) <> '' AND TRIM(COALESCE(i.pays_naissance, '')) <> '')";
const likeEscape = (value) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// Inscriptions pas encore reliées au CRM (bandeau « Synchroniser » de /admin/adherents).
export async function countUnmappedInscriptions(db, organizationId) {
  requireOrganization(organizationId);
  return (
    await db
      .prepare(
        'SELECT COUNT(*) AS n FROM inscriptions i WHERE i.organization_id = ? AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = i.organization_id AND m.legacy_inscription_id = i.id)'
      )
      .bind(organizationId)
      .first()
  ).n;
}

// filters : { q, periodId, groupLabel, status, page } — tout vient du navigateur et est lié en paramètres.
export async function listMembers(db, organizationId, filters = {}) {
  requireOrganization(organizationId);
  const where = ['m.organization_id = ?'];
  const params = [organizationId];
  const terms = normalize(filters.q || '').split(/\s+/).filter(Boolean).slice(0, 5);
  for (const term of terms) {
    where.push("c.search_name LIKE ? ESCAPE '\\'");
    params.push(`%${likeEscape(term)}%`);
  }
  if (Number.isInteger(filters.periodId)) {
    where.push('m.period_id = ?');
    params.push(filters.periodId);
  }
  if (filters.groupLabel) {
    where.push('gm.group_label = ?');
    params.push(String(filters.groupLabel));
  }
  // Catégorie (U6 - U7…) : l'appelant la convertit en années de naissance pour la saison affichée.
  const birthYears = (filters.birthYears || []).filter(Number.isInteger);
  if (birthYears.length) {
    where.push(`substr(c.birth_date, 1, 4) IN (${birthYears.map(() => '?').join(', ')})`);
    params.push(...birthYears.map(String));
  }
  if (filters.status && ['pending', 'active', 'ended', 'cancelled'].includes(filters.status)) {
    where.push('m.status = ?');
    params.push(filters.status);
  }
  if (filters.completeOnly) where.push(COMPLETE_INSCRIPTION_SQL);
  // Compte limité à ses groupes (entraîneur) : libellés normalisés comme normalizeGroupLabel (accounts.js), sans accents.
  if (Array.isArray(filters.groupScope)) {
    const keys = filters.groupScope.map((g) => normalizeGroupLabel(g)).filter(Boolean);
    if (!keys.length) where.push('0');
    else {
      const norm = (col) => `lower(replace(replace(replace(COALESCE(${col}, ''), ' ', ''), '-', ''), '_', ''))`;
      const list = keys.map(() => '?').join(', ');
      where.push(`(${norm('i.categorie')} IN (${list}) OR ${norm('gm.group_label')} IN (${list}))`);
      params.push(...keys, ...keys);
    }
  }
  // Suivi licence et tenue (club-followup.js) : liste fermée, jamais de SQL venant du navigateur.
  if (filters.suivi && Object.hasOwn(FOLLOWUP_FILTERS, filters.suivi)) where.push(`(${FOLLOWUP_FILTERS[filters.suivi].sql})`);
  const base = `FROM memberships m
    JOIN contacts c ON c.organization_id = m.organization_id AND c.id = m.contact_id
    JOIN periods p ON p.organization_id = m.organization_id AND p.id = m.period_id
    LEFT JOIN group_memberships gm ON gm.organization_id = m.organization_id AND gm.membership_id = m.id AND gm.is_primary = 1 AND gm.ended_at IS NULL
    LEFT JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
    WHERE ${where.join(' AND ')}`;
  const total = (await db.prepare(`SELECT COUNT(*) AS n ${base}`).bind(...params).first()).n;
  const page = Math.max(1, Number.parseInt(filters.page, 10) || 1);
  const { results } = await db
    .prepare(
      `SELECT m.id AS membership_id, m.status, m.joined_at, m.ended_at, m.legacy_inscription_id,
              c.id AS contact_id, c.first_name, c.last_name, c.birth_date,
              p.id AS period_id, p.name AS period_name, p.is_current,
              gm.group_label,
              i.id AS inscription_id, i.paye, i.dossier_status, i.dossier_uploaded_at, i.photo_uploaded_at, i.archived_at, i.numero_licence,
              i.created_at AS inscription_created_at, i.categorie AS inscription_categorie, i.taille_maillot, i.ville_naissance, i.pays_naissance,
              i.cp_naissance, i.parent_prenom, i.parent_nom, i.email, i.telephone, i.adresse, i.code_postal, i.ville, i.parent2_prenom, i.parent2_nom,
              i.parent2_email, i.parent2_telephone, i.mode_paiement, i.pass_sport_code, i.droit_image, i.autorisation, i.dossier_key, i.photo_key,
              i.dossier_verified_at, i.licence_demandee_at, i.licence_verif_at, i.tenue_commandee_at, i.tenue_remise_at
       ${base}
       ORDER BY p.is_current DESC, p.id DESC, c.search_name, m.id
       LIMIT ? OFFSET ?`
    )
    .bind(...params, MEMBER_PAGE_SIZE, (page - 1) * MEMBER_PAGE_SIZE)
    .all();
  return { rows: results, total, page, pageSize: MEMBER_PAGE_SIZE };
}

// Listes déroulantes des filtres (périodes et groupes de l'organisation).
export async function memberFilterOptions(db, organizationId) {
  requireOrganization(organizationId);
  const [periods, groups, years] = await Promise.all([
    db.prepare('SELECT id, name, is_current FROM periods WHERE organization_id = ? ORDER BY is_current DESC, id DESC').bind(organizationId).all(),
    db.prepare('SELECT DISTINCT group_label FROM group_memberships WHERE organization_id = ? ORDER BY group_label').bind(organizationId).all(),
    // Années de naissance des adhérents (pastilles d'âge U6, U7… de la liste).
    db
      .prepare(
        `SELECT DISTINCT substr(c.birth_date, 1, 4) AS year FROM memberships m
         JOIN contacts c ON c.organization_id = m.organization_id AND c.id = m.contact_id
         WHERE m.organization_id = ? AND c.birth_date IS NOT NULL`
      )
      .bind(organizationId)
      .all(),
  ]);
  return { periods: periods.results, groups: groups.results.map((g) => g.group_label), birthYears: years.results.map((y) => Number(y.year)).filter(Boolean) };
}

// Statistiques de l'en-tête de la liste.
export async function memberStats(db, organizationId) {
  requireOrganization(organizationId);
  return db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM contacts WHERE organization_id = ?1) AS contacts,
         (SELECT COUNT(DISTINCT contact_id) FROM memberships WHERE organization_id = ?1) AS members,
         (SELECT COUNT(*) FROM memberships m JOIN periods p ON p.organization_id = m.organization_id AND p.id = m.period_id
            WHERE m.organization_id = ?1 AND p.is_current = 1 AND m.status = 'active') AS currentMemberships,
         (SELECT COUNT(DISTINCT m.contact_id) FROM memberships m
            LEFT JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
            WHERE m.organization_id = ?1 AND ${COMPLETE_INSCRIPTION_SQL}) AS completeMembers,
         (SELECT COUNT(*) FROM memberships m JOIN periods p ON p.organization_id = m.organization_id AND p.id = m.period_id
            LEFT JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
            WHERE m.organization_id = ?1 AND p.is_current = 1 AND m.status = 'active' AND ${COMPLETE_INSCRIPTION_SQL}) AS currentCompleteMemberships`
    )
    .bind(organizationId)
    .first();
}

// Une personne : identité, adhésions (historique complet, groupe et inscription source), personnes liées et
// candidats doublons (à vérifier par un humain, jamais fusionnés).
export async function getContactProfile(db, organizationId, contactId) {
  requireOrganization(organizationId);
  const contact = await contactById(db, organizationId, contactId);
  if (!contact) return null;
  const [memberships, guardians, dependents, duplicates] = await Promise.all([
    db
      .prepare(
        `SELECT m.id AS membership_id, m.status, m.joined_at, m.ended_at, m.source, m.legacy_inscription_id,
                p.id AS period_id, p.name AS period_name, p.slug AS period_slug, p.is_current, p.start_date, p.end_date,
                gm.group_label, gm.started_at AS group_started_at,
                i.id AS inscription_id, i.created_at AS inscription_created_at, i.categorie, i.saison, i.paye, i.mode_paiement,
                i.dossier_status, i.dossier_uploaded_at, i.photo_uploaded_at, i.archived_at, i.archive_motif, i.archive_commentaire, i.enfant_prenom, i.enfant_nom,
                i.numero_licence, i.taille_maillot, i.custom_fields, i.ville_naissance, i.pays_naissance, i.cp_naissance, i.adresse, i.code_postal, i.ville,
                i.pass_sport_code, i.droit_image, i.autorisation, i.dossier_key, i.photo_key, i.dossier_verified_at,
                i.email, i.parent2_email, i.dossier_refused_at, i.photo_refused_at, i.parent_prenom, i.parent2_prenom, i.note_interne,
                i.licence_demandee_at, i.licence_verif_at, i.tenue_commandee_at, i.tenue_remise_at
         FROM memberships m
         JOIN periods p ON p.organization_id = m.organization_id AND p.id = m.period_id
         LEFT JOIN group_memberships gm ON gm.organization_id = m.organization_id AND gm.membership_id = m.id AND gm.is_primary = 1 AND gm.ended_at IS NULL
         LEFT JOIN inscriptions i ON i.organization_id = m.organization_id AND i.id = m.legacy_inscription_id
         WHERE m.organization_id = ? AND m.contact_id = ?
         ORDER BY p.is_current DESC, p.id DESC, m.id DESC`
      )
      .bind(organizationId, contactId)
      .all(),
    db
      .prepare(
        `SELECT r.relationship_type, r.is_primary, c.id, c.first_name, c.last_name, c.email, c.phone
         FROM contact_relationships r JOIN contacts c ON c.organization_id = r.organization_id AND c.id = r.related_contact_id
         WHERE r.organization_id = ? AND r.contact_id = ? ORDER BY r.is_primary DESC, r.id`
      )
      .bind(organizationId, contactId)
      .all(),
    db
      .prepare(
        `SELECT r.relationship_type, c.id, c.first_name, c.last_name, c.birth_date
         FROM contact_relationships r JOIN contacts c ON c.organization_id = r.organization_id AND c.id = r.contact_id
         WHERE r.organization_id = ? AND r.related_contact_id = ? ORDER BY c.search_name`
      )
      .bind(organizationId, contactId)
      .all(),
    db
      .prepare(
        `SELECT d.reason, c.id, c.first_name, c.last_name FROM contact_duplicate_candidates d
         JOIN contacts c ON c.organization_id = d.organization_id AND c.id = CASE WHEN d.contact_id = ?2 THEN d.other_contact_id ELSE d.contact_id END
         WHERE d.organization_id = ?1 AND (d.contact_id = ?2 OR d.other_contact_id = ?2) ORDER BY c.search_name`
      )
      .bind(organizationId, contactId)
      .all(),
  ]);
  const periods = memberships.results.map((m) => m.period_id);
  return {
    contact,
    memberships: memberships.results,
    guardians: guardians.results,
    dependents: dependents.results,
    duplicates: duplicates.results,
    duplicatePeriod: new Set(periods).size !== periods.length,
  };
}
