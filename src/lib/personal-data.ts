// Demandes d'une personne sur ses données (RGPD, articles 15, 17 et 20) : export complet et effacement ciblé.
//
// Export : tout ce que le club détient sur la personne, toutes saisons, dans un fichier JSON lisible. Les jetons
// internes (liens de correction, hachages) n'en font pas partie ; la signature est signalée, pas recopiée.
// Effacement : mêmes règles que la conservation (src/lib/retention.ts) : pièces supprimées puis vérifiées, fiches
// et dossier familial anonymisés, montants gardés (obligations comptables). Un dossier partagé avec un frère ou une
// sœur qui reste au club n'est pas anonymisé : il concerne aussi cette autre personne.
// Module sans dépendance à Next.js : testé sur SQLite (tests/personal-data.test.ts).

import type { SqlDatabase } from './db/query.ts';
import { SIGNER_QUALITIES, parseSignedAuthorization } from '../config/parental-authorization.ts';
import { anonymizeMembers, removeMemberPieces, type FileRemover, type MemberScope } from './retention.ts';

type Row = Record<string, unknown>;
const all = async <T = Row>(db: SqlDatabase, sql: string, ...params: unknown[]) =>
  ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];
const changes = async (db: SqlDatabase, sql: string, ...params: unknown[]) => Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0);
const marks = (list: unknown[]) => list.map(() => '?').join(',');
const inList = (column: string, list: unknown[]) => (list.length ? `${column} IN (${marks(list)})` : '0');

type Person = { id: string; first_name: string; last_name: string; birth_date: string; gender: string; notes: string | null; created_at: string };

async function personOf(db: SqlDatabase, clubId: string, personId: string): Promise<Person | null> {
  return (await all<Person>(db, 'SELECT id, first_name, last_name, birth_date, gender, notes, created_at FROM people WHERE id = ? AND club_id = ?', personId, clubId))[0] ?? null;
}

/** Export de tout ce que le club détient sur une personne (null si elle n'existe pas dans ce club). */
export async function exportPerson(db: SqlDatabase, clubId: string, personId: string, now = new Date()) {
  const person = await personOf(db, clubId, personId);
  if (!person) return null;
  const club = (await all<{ name: string; contact_email: string }>(db, 'SELECT name, contact_email FROM clubs WHERE id = ?', clubId))[0];
  const members = await all<Row>(
    db,
    `SELECT m.id, m.season, c.name AS categorie, m.first_name, m.last_name, m.birth_date, m.gender, m.is_minor, m.registration_type,
            m.dossier_status, m.rejection_reason, m.health_questionnaire_passed, m.pass_sport_code, m.consent_image_rights,
            m.consent_emergency_medical, m.consent_autonomous_exit, m.extra_fields, m.parental_authorization, m.family_id, m.created_at,
            m.photo_storage_path IS NOT NULL AS photo, m.medical_doc_storage_path IS NOT NULL AS certificat_medical,
            m.id_doc_storage_path IS NOT NULL AS piece_identite, m.signature_data_url IS NOT NULL AS signature
     FROM members m LEFT JOIN categories c ON c.id = m.category_id
     WHERE m.club_id = ? AND m.person_id = ? ORDER BY m.season`,
    clubId,
    personId,
  );
  const memberIds = members.map((m) => m.id as string);
  const familyIds = [...new Set(members.map((m) => m.family_id as string | null).filter((x): x is string => Boolean(x)))];
  const families = await all<Row>(
    db,
    `SELECT id, season, payer_first_name, payer_last_name, payer_email, payer_phone, emergency_contact_name, emergency_contact_phone,
            address, city, postal_code, final_total_amount, amount_paid, payment_status, payment_method, invoice_number, created_at
     FROM family_registrations WHERE club_id = ? AND ${inList('id', familyIds)}`,
    clubId,
    ...familyIds,
  );
  const emails = [...new Set(families.map((f) => String(f.payer_email).toLowerCase()).filter(Boolean))];
  const [payments, documents, attendances, convocations, preregistrations, reminders, sentEmails, newsletters, unsubscribed, operations] = await Promise.all([
    all(db, `SELECT family_id, amount, payment_type, scheduled_deposit_date, status, source, created_at FROM payment_installments WHERE club_id = ? AND ${inList('family_id', familyIds)} ORDER BY created_at`, clubId, ...familyIds),
    all(db, `SELECT member_id, doc_key, created_at FROM member_documents WHERE club_id = ? AND ${inList('member_id', memberIds)}`, clubId, ...memberIds),
    all(db, `SELECT member_id, session_date, is_present FROM attendances WHERE club_id = ? AND ${inList('member_id', memberIds)} ORDER BY session_date`, clubId, ...memberIds),
    all(
      db,
      `SELECT ec.member_id, e.title, e.event_date, ec.response_status FROM event_convocations ec JOIN events e ON e.id = ec.event_id
       WHERE ec.club_id = ? AND ${inList('ec.member_id', memberIds)} ORDER BY e.event_date`,
      clubId,
      ...memberIds,
    ),
    all(
      db,
      `SELECT season, first_name, last_name, birth_date, contact_name, email, phone, message, status, created_at FROM preregistrations
       WHERE club_id = ? AND (${inList('member_id', memberIds)} OR (birth_date = ? AND lower(first_name) = lower(?) AND lower(last_name) = lower(?)))`,
      clubId,
      ...memberIds,
      person.birth_date,
      person.first_name,
      person.last_name,
    ),
    all(db, `SELECT kind, step, recipient, sent_at FROM reminder_log WHERE club_id = ? AND ${inList('target_id', [...memberIds, ...familyIds])} ORDER BY sent_at`, clubId, ...memberIds, ...familyIds),
    all(db, `SELECT kind, recipient, subject, status, created_at FROM email_log WHERE club_id = ? AND ${inList('lower(recipient)', emails)} ORDER BY created_at`, clubId, ...emails),
    all(
      db,
      `SELECT n.subject, d.email, d.status, d.sent_at FROM newsletter_deliveries d JOIN newsletters n ON n.id = d.newsletter_id
       WHERE d.club_id = ? AND ${inList('d.email', emails)} ORDER BY d.sent_at`,
      clubId,
      ...emails,
    ),
    all(db, `SELECT email, created_at FROM newsletter_unsubscribes WHERE club_id = ? AND ${inList('email', emails)}`, clubId, ...emails),
    all(db, `SELECT family_id, source, occurred_on, amount_cents, payer_name, payer_email, label, status FROM financial_transactions WHERE club_id = ? AND ${inList('family_id', familyIds)}`, clubId, ...familyIds),
  ]);
  const bool = (v: unknown) => v === 1 || v === true;
  return {
    genere_le: now.toISOString(),
    responsable_du_traitement: { club: club?.name ?? '', contact: club?.contact_email ?? '' },
    personne: { prenom: person.first_name, nom: person.last_name, date_de_naissance: person.birth_date, genre: person.gender, notes_du_club: person.notes, suivie_depuis: person.created_at },
    inscriptions: members.map((m) => ({
      saison: m.season,
      categorie: m.categorie,
      prenom: m.first_name,
      nom: m.last_name,
      date_de_naissance: m.birth_date,
      mineur: bool(m.is_minor),
      type: m.registration_type,
      statut_du_dossier: m.dossier_status,
      motif_de_refus: m.rejection_reason,
      questionnaire_de_sante_valide: bool(m.health_questionnaire_passed),
      code_pass_sport: m.pass_sport_code,
      autorisations: { droit_a_l_image: bool(m.consent_image_rights), soins_d_urgence: bool(m.consent_emergency_medical), sortie_seul: bool(m.consent_autonomous_exit) },
      reponses_au_formulaire: typeof m.extra_fields === 'string' ? JSON.parse(m.extra_fields) : m.extra_fields,
      pieces_deposees: {
        photo: bool(m.photo),
        certificat_medical: bool(m.certificat_medical),
        piece_d_identite: bool(m.piece_identite),
        autres: documents.filter((d) => d.member_id === m.id).map((d) => d.doc_key),
      },
      signature_enregistree: bool(m.signature),
      autorisation_parentale: (() => {
        const a = parseSignedAuthorization(m.parental_authorization);
        return a ? { texte_signe: a.text, signataire: a.signerName, qualite: SIGNER_QUALITIES[a.signerQuality], signee_le: a.signedAt } : null;
      })(),
      presences: attendances.filter((a) => a.member_id === m.id).map((a) => ({ date: a.session_date, present: bool(a.is_present) })),
      convocations: convocations.filter((c) => c.member_id === m.id).map((c) => ({ evenement: c.title, date: c.event_date, reponse: c.response_status })),
      inscrit_le: m.created_at,
    })),
    dossiers_familiaux: families.map((f) => ({
      saison: f.season,
      responsable: { prenom: f.payer_first_name, nom: f.payer_last_name, email: f.payer_email, telephone: f.payer_phone },
      contact_d_urgence: { nom: f.emergency_contact_name, telephone: f.emergency_contact_phone },
      adresse: { rue: f.address, ville: f.city, code_postal: f.postal_code },
      montant_total: f.final_total_amount,
      montant_regle: f.amount_paid,
      statut_du_reglement: f.payment_status,
      facture: f.invoice_number,
      reglements: payments.filter((p) => p.family_id === f.id).map(({ family_id: _f, ...p }) => p),
      operations_importees: operations.filter((o) => o.family_id === f.id).map(({ family_id: _f, ...o }) => o),
    })),
    pre_inscriptions: preregistrations,
    relances: reminders,
    emails_envoyes: sentEmails,
    newsletters: { recues: newsletters, desinscription: unsubscribed },
  };
}

export type ErasureResult = {
  pieces: number;
  echecsFichiers: number;
  adherents: number;
  familles: number;
  famillesPartagees: number;
  preinscriptions: number;
  journaux: number;
  personneSupprimee: boolean;
};

/**
 * Efface une personne à sa demande. Rejouable : si un fichier n'a pas pu être supprimé, la personne reste liée à
 * l'inscription concernée et un nouvel essai termine le travail.
 */
export async function erasePerson(db: SqlDatabase, clubId: string, personId: string, now: Date, removeFiles: FileRemover): Promise<ErasureResult | null> {
  const person = await personOf(db, clubId, personId);
  if (!person) return null;
  const memberIds = (await all<{ id: string }>(db, 'SELECT id FROM members WHERE club_id = ? AND person_id = ?', clubId, personId)).map((m) => m.id);
  const familyIds = (
    await all<{ family_id: string }>(db, `SELECT DISTINCT family_id FROM members WHERE ${inList('id', memberIds)} AND family_id IS NOT NULL`, ...memberIds)
  ).map((f) => f.family_id);
  const emails = (
    await all<{ e: string }>(db, `SELECT DISTINCT lower(payer_email) AS e FROM family_registrations WHERE ${inList('id', familyIds)} AND payer_email <> ''`, ...familyIds)
  ).map((r) => r.e);
  const out: ErasureResult = { pieces: 0, echecsFichiers: 0, adherents: 0, familles: 0, famillesPartagees: 0, preinscriptions: 0, journaux: 0, personneSupprimee: false };

  if (memberIds.length) {
    const scope: MemberScope = { where: (t) => `${t}.id IN (${marks(memberIds)})`, params: memberIds };
    Object.assign(out, await removeMemberPieces(db, clubId, scope, removeFiles, memberIds.length));
    Object.assign(out, await anonymizeMembers(db, clubId, scope, now.toISOString()));
  }
  const anonymizedFamilies = (
    await all<{ id: string }>(db, `SELECT id FROM family_registrations WHERE ${inList('id', familyIds)} AND anonymized_at IS NOT NULL`, ...familyIds)
  ).map((f) => f.id);
  out.famillesPartagees = familyIds.length - anonymizedFamilies.length;

  out.preinscriptions = await changes(
    db,
    `DELETE FROM preregistrations WHERE club_id = ? AND (${inList('member_id', memberIds)} OR (birth_date = ? AND lower(first_name) = lower(?) AND lower(last_name) = lower(?)))`,
    clubId,
    ...memberIds,
    person.birth_date,
    person.first_name,
    person.last_name,
  );
  out.journaux += await changes(db, `DELETE FROM reminder_log WHERE club_id = ? AND ${inList('target_id', [...memberIds, ...anonymizedFamilies])}`, clubId, ...memberIds, ...anonymizedFamilies);
  // Adresses qui ne servent plus à aucun dossier conservé du club : historique d'envois effacé.
  const stillUsed = new Set(
    (await all<{ e: string }>(db, `SELECT DISTINCT lower(payer_email) AS e FROM family_registrations WHERE club_id = ? AND anonymized_at IS NULL AND ${inList('lower(payer_email)', emails)}`, clubId, ...emails)).map((r) => r.e),
  );
  const freed = emails.filter((e) => !stillUsed.has(e));
  if (freed.length) {
    out.journaux += await changes(db, `DELETE FROM email_log WHERE club_id = ? AND ${inList('lower(recipient)', freed)}`, clubId, ...freed);
    out.journaux += await changes(db, `DELETE FROM newsletter_deliveries WHERE club_id = ? AND ${inList('email', freed)}`, clubId, ...freed);
    await changes(
      db,
      `UPDATE financial_transactions SET payer_name = NULL, payer_email = NULL, label = NULL WHERE club_id = ? AND (${inList('family_id', anonymizedFamilies)} OR ${inList('lower(payer_email)', freed)})`,
      clubId,
      ...anonymizedFamilies,
      ...freed,
    );
  }
  out.personneSupprimee =
    (await changes(db, 'DELETE FROM people WHERE id = ? AND club_id = ? AND NOT EXISTS (SELECT 1 FROM members m WHERE m.person_id = people.id)', personId, clubId)) > 0;
  return out;
}
