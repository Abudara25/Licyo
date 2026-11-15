// Conservation des données personnelles (RGPD) : durées choisies par le club, appliquées chaque nuit.
//
// Trois étapes, dans cet ordre, pour une saison terminée (fin de saison : 31 août) :
// 1. pièces justificatives (photo, certificat, identité, autres pièces) : fichiers R2 supprimés puis VÉRIFIÉS
//    absents ; le chemin n'est effacé de la base qu'une fois la suppression confirmée (sinon nouvel essai la nuit
//    suivante, jamais de fichier orphelin sans trace) ;
// 2. adhérents et dossiers familiaux : anonymisés (noms, coordonnées, signature, code Pass'Sport), pas supprimés,
//    pour garder montants réglés, présences et statistiques par saison. Un adhérent dont une pièce n'a pas pu être
//    supprimée attend la nuit suivante ;
// 3. demandes de pré-inscription closes, coordonnées des opérations bancaires importées, fiches personne sans
//    adhésion restante.
//
// Désactivée par défaut : le club l'active en voyant d'abord ce qui serait concerné (aperçu).
// Module sans dépendance à Next.js : testé sur SQLite (tests/retention.test.ts).

import type { SqlDatabase, SqlStatement } from './db/query.ts';

export type RetentionPolicy = {
  enabled: boolean;
  /** Pièces justificatives : mois après la fin de la saison. */
  documentsMonths: number;
  /** Adhérents et dossiers : années après la fin de la saison avant anonymisation. */
  membersYears: number;
  /** Demandes de pré-inscription closes (ou d'une saison terminée) : mois. */
  preregistrationsMonths: number;
};

export const RETENTION_DEFAULTS: RetentionPolicy = { enabled: false, documentsMonths: 3, membersYears: 3, preregistrationsMonths: 6 };
export const RETENTION_BOUNDS = {
  documentsMonths: [0, 36],
  membersYears: [1, 6],
  preregistrationsMonths: [1, 24],
} as const satisfies Record<Exclude<keyof RetentionPolicy, 'enabled'>, readonly [number, number]>;

const clamp = (v: unknown, [min, max]: readonly [number, number], fallback: number) => {
  const n = typeof v === 'number' && Number.isInteger(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Politique lue en base (JSON libre) : valeurs bornées ; les pièces ne survivent jamais à l'anonymisation. */
export function parseRetentionPolicy(raw: unknown): RetentionPolicy {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const membersYears = clamp(o.membersYears, RETENTION_BOUNDS.membersYears, RETENTION_DEFAULTS.membersYears);
  return {
    enabled: o.enabled === true,
    documentsMonths: Math.min(clamp(o.documentsMonths, RETENTION_BOUNDS.documentsMonths, RETENTION_DEFAULTS.documentsMonths), membersYears * 12),
    membersYears,
    preregistrationsMonths: clamp(o.preregistrationsMonths, RETENTION_BOUNDS.preregistrationsMonths, RETENTION_DEFAULTS.preregistrationsMonths),
  };
}

/** Fin d'une saison « 2025-2026 » : 31 août 2026, fin de journée (UTC). null si le libellé est illisible. */
export function seasonEnd(season: string): Date | null {
  const m = /^(\d{4})-(\d{4})$/.exec(season);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) return null;
  return new Date(Date.UTC(Number(m[2]), 7, 31, 23, 59, 59));
}

/** Ajoute des mois sans débordement : 31 août + 3 mois = 30 novembre (et non 1er décembre). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

/** Saisons dont la fin, augmentée du délai, est passée. */
export function expiredSeasons(seasons: string[], months: number, now: Date): string[] {
  return seasons.filter((s) => {
    const end = seasonEnd(s);
    return end !== null && addMonths(end, months) < now;
  });
}

/** Supprime des fichiers privés et renvoie ceux dont l'absence est confirmée. */
export type FileRemover = (paths: string[]) => Promise<Set<string>>;

export type RetentionCounts = {
  pieces: number;
  adherents: number;
  familles: number;
  personnes: number;
  preinscriptions: number;
  operations: number;
};

type Row = Record<string, unknown>;
const all = async <T = Row>(db: SqlDatabase, sql: string, ...params: unknown[]) =>
  ((await db.prepare(sql).bind(...params).all<T>()).results ?? []) as T[];
const changes = async (db: SqlDatabase, sql: string, ...params: unknown[]) => Number((await db.prepare(sql).bind(...params).run()).meta?.changes ?? 0);
const marks = (list: unknown[]) => list.map(() => '?').join(',');
const PATHS = ['photo_storage_path', 'medical_doc_storage_path', 'id_doc_storage_path'] as const;
const DAY = 86400000;

async function seasonsOf(db: SqlDatabase, clubId: string): Promise<string[]> {
  const rows = await all<{ season: string }>(
    db,
    'SELECT season FROM members WHERE club_id = ? UNION SELECT season FROM family_registrations WHERE club_id = ? UNION SELECT season FROM preregistrations WHERE club_id = ?',
    clubId,
    clubId,
    clubId,
  );
  return rows.map((r) => r.season);
}

function cutoffs(policy: RetentionPolicy, seasons: string[], now: Date) {
  return {
    docSeasons: expiredSeasons(seasons, policy.documentsMonths, now),
    memberSeasons: expiredSeasons(seasons, policy.membersYears * 12, now),
    preregSeasons: expiredSeasons(seasons, policy.preregistrationsMonths, now),
    preregBefore: addMonths(now, -policy.preregistrationsMonths).toISOString(),
    operationsBefore: addMonths(now, -policy.membersYears * 12).toISOString().slice(0, 10),
  };
}

const piecesOf = (t: string) => `(${t}.photo_storage_path IS NOT NULL OR ${t}.medical_doc_storage_path IS NOT NULL OR ${t}.id_doc_storage_path IS NOT NULL
  OR EXISTS (SELECT 1 FROM member_documents d WHERE d.member_id = ${t}.id))`;
const closedPrereg = `status IN ('registered','declined','expired','cancelled')`;

/** Ce que la politique effacerait aujourd'hui (aucune écriture). */
export async function previewRetention(db: SqlDatabase, clubId: string, policy: RetentionPolicy, now: Date): Promise<RetentionCounts> {
  const c = cutoffs(policy, await seasonsOf(db, clubId), now);
  const count = async (sql: string, ...params: unknown[]) => Number((await all<{ n: number }>(db, sql, ...params))[0]?.n ?? 0);
  const inSeasons = (list: string[]) => (list.length ? `season IN (${marks(list)})` : '0');
  return {
    pieces: c.docSeasons.length
      ? (await count(
          `SELECT (SELECT count(photo_storage_path) + count(medical_doc_storage_path) + count(id_doc_storage_path) FROM members WHERE club_id = ? AND ${inSeasons(c.docSeasons)})
                + (SELECT count(*) FROM member_documents d JOIN members m ON m.id = d.member_id WHERE m.club_id = ? AND m.${inSeasons(c.docSeasons)}) AS n`,
          clubId,
          ...c.docSeasons,
          clubId,
          ...c.docSeasons,
        ))
      : 0,
    adherents: await count(`SELECT count(*) AS n FROM members WHERE club_id = ? AND anonymized_at IS NULL AND ${inSeasons(c.memberSeasons)}`, clubId, ...c.memberSeasons),
    familles: await count(`SELECT count(*) AS n FROM family_registrations WHERE club_id = ? AND anonymized_at IS NULL AND ${inSeasons(c.memberSeasons)}`, clubId, ...c.memberSeasons),
    personnes: 0, // dépend des anonymisations du même passage : compté lors de l'application
    preinscriptions: await count(
      `SELECT count(*) AS n FROM preregistrations WHERE club_id = ? AND ((${closedPrereg} AND updated_at < ?) OR ${inSeasons(c.preregSeasons)})`,
      clubId,
      c.preregBefore,
      ...c.preregSeasons,
    ),
    operations: await count(
      'SELECT count(*) AS n FROM financial_transactions WHERE club_id = ? AND occurred_on < ? AND (payer_name IS NOT NULL OR payer_email IS NOT NULL OR label IS NOT NULL)',
      clubId,
      c.operationsBefore,
    ),
  };
}

/** Ensemble d'adhérents visé : condition SQL sur l'alias donné, et ses paramètres. */
export type MemberScope = { where: (alias: string) => string; params: unknown[] };

/**
 * Pièces des adhérents visés : fichiers R2 supprimés puis vérifiés ; chemins effacés de la base seulement après
 * confirmation. Un fichier encore référencé par un adhérent hors du périmètre est détaché sans être supprimé.
 */
export async function removeMemberPieces(
  db: SqlDatabase,
  clubId: string,
  scope: MemberScope,
  removeFiles: FileRemover,
  limit = 300,
): Promise<{ pieces: number; echecsFichiers: number }> {
  const members = await all<{ id: string; photo_storage_path: string | null; medical_doc_storage_path: string | null; id_doc_storage_path: string | null }>(
    db,
    `SELECT m.id, m.photo_storage_path, m.medical_doc_storage_path, m.id_doc_storage_path FROM members m
     WHERE m.club_id = ? AND ${scope.where('m')} AND ${piecesOf('m')} LIMIT ?`,
    clubId,
    ...scope.params,
    limit,
  );
  if (!members.length) return { pieces: 0, echecsFichiers: 0 };
  const ids = members.map((m) => m.id);
  const extras = await all<{ id: string; member_id: string; storage_path: string }>(
    db,
    `SELECT id, member_id, storage_path FROM member_documents WHERE member_id IN (${marks(ids)})`,
    ...ids,
  );
  // Un même fichier peut servir à un adhérent hors du périmètre (réinscription) : on le détache sans le supprimer.
  const outside = `m.club_id = ? AND NOT (${scope.where('m')})`;
  const kept = new Set(
    (
      await all<{ p: string }>(
        db,
        `SELECT m.photo_storage_path AS p FROM members m WHERE ${outside} AND m.photo_storage_path IS NOT NULL
         UNION SELECT m.medical_doc_storage_path FROM members m WHERE ${outside} AND m.medical_doc_storage_path IS NOT NULL
         UNION SELECT m.id_doc_storage_path FROM members m WHERE ${outside} AND m.id_doc_storage_path IS NOT NULL
         UNION SELECT d.storage_path FROM member_documents d JOIN members m ON m.id = d.member_id WHERE ${outside}`,
        ...[0, 1, 2, 3].flatMap(() => [clubId, ...scope.params]),
      )
    ).map((r) => r.p),
  );
  const allPaths = [...members.flatMap((m) => PATHS.map((k) => m[k])), ...extras.map((e) => e.storage_path)].filter((p): p is string => Boolean(p));
  const toDelete = [...new Set(allPaths.filter((p) => !kept.has(p)))];
  const gone = toDelete.length ? await removeFiles(toDelete) : new Set<string>();
  const done = (p: string | null) => p !== null && (kept.has(p) || gone.has(p));
  let pieces = 0;
  const statements: SqlStatement[] = [];
  for (const m of members) {
    const cleared = PATHS.filter((k) => done(m[k]));
    if (cleared.length) {
      statements.push(db.prepare(`UPDATE members SET ${cleared.map((k) => `${k} = NULL`).join(', ')} WHERE id = ?`).bind(m.id));
      pieces += cleared.length;
    }
  }
  const extraDone = extras.filter((e) => done(e.storage_path));
  if (extraDone.length) statements.push(db.prepare(`DELETE FROM member_documents WHERE id IN (${marks(extraDone)})`).bind(...extraDone.map((e) => e.id)));
  pieces += extraDone.length;
  if (statements.length) await db.batch(statements);
  return { pieces, echecsFichiers: toDelete.filter((p) => !gone.has(p)).length };
}

/**
 * Anonymise les adhérents visés qui n'ont plus aucune pièce, puis leurs dossiers familiaux dont tous les adhérents
 * sont anonymisés (un dossier partagé avec un frère ou une sœur encore conservé reste intact).
 */
export async function anonymizeMembers(db: SqlDatabase, clubId: string, scope: MemberScope, stamp: string): Promise<{ adherents: number; familles: number }> {
  const candidates = (
    await all<{ family_id: string }>(
      db,
      `SELECT DISTINCT m.family_id FROM members m WHERE m.club_id = ? AND ${scope.where('m')} AND m.family_id IS NOT NULL`,
      clubId,
      ...scope.params,
    )
  ).map((f) => f.family_id);
  const adherents = await changes(
    db,
    `UPDATE members SET first_name = 'Ancien', last_name = 'adhérent', birth_date = substr(birth_date, 1, 4) || '-01-01',
       pass_sport_code = NULL, signature_data_url = NULL, parental_authorization = NULL, rejection_reason = NULL, extra_fields = '{}', person_id = NULL,
       magic_action_token = lower(hex(randomblob(16))), anonymized_at = ?
     WHERE club_id = ? AND ${scope.where('members')} AND anonymized_at IS NULL AND NOT ${piecesOf('members')}`,
    stamp,
    clubId,
    ...scope.params,
  );
  let familles = 0;
  for (let i = 0; i < candidates.length; i += 50) {
    const chunk = candidates.slice(i, i + 50);
    const ready = (
      await all<{ id: string }>(
        db,
        `SELECT f.id FROM family_registrations f WHERE f.id IN (${marks(chunk)}) AND f.anonymized_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM members m WHERE m.family_id = f.id AND m.anonymized_at IS NULL)`,
        ...chunk,
      )
    ).map((f) => f.id);
    if (!ready.length) continue;
    await db.batch([
      db
        .prepare(
          `UPDATE family_registrations SET payer_first_name = 'Ancien', payer_last_name = 'adhérent', payer_email = '', payer_phone = '',
             emergency_contact_name = '', emergency_contact_phone = '', address = '', city = '', postal_code = '', anonymized_at = ?
           WHERE id IN (${marks(ready)}) AND anonymized_at IS NULL`,
        )
        .bind(stamp, ...ready),
      db.prepare(`UPDATE payment_installments SET check_number = NULL WHERE family_id IN (${marks(ready)})`).bind(...ready),
      db.prepare(`DELETE FROM family_access WHERE family_id IN (${marks(ready)})`).bind(...ready),
    ]);
    familles += ready.length; // sélectionnés juste avant avec la même condition
  }
  return { adherents, familles };
}

/**
 * Applique la politique d'un club. `limit` borne le nombre d'adhérents traités pour les pièces à chaque passage
 * (suppressions R2 vérifiées une par une) : le reste est repris la nuit suivante. Rejouable sans effet de bord.
 */
export async function applyRetention(
  db: SqlDatabase,
  clubId: string,
  policy: RetentionPolicy,
  now: Date,
  removeFiles: FileRemover,
  limit = 300,
): Promise<RetentionCounts & { echecsFichiers: number }> {
  const c = cutoffs(policy, await seasonsOf(db, clubId), now);
  const stamp = now.toISOString();
  const out = { pieces: 0, adherents: 0, familles: 0, personnes: 0, preinscriptions: 0, operations: 0, echecsFichiers: 0 };
  const inSeasons = (seasons: string[]): MemberScope => ({ where: (t) => `${t}.season IN (${marks(seasons)})`, params: seasons });

  // 1. Pièces justificatives.
  if (c.docSeasons.length) Object.assign(out, await removeMemberPieces(db, clubId, inSeasons(c.docSeasons), removeFiles, limit));

  // 2. Anonymisation des adhérents (sans pièce restante), puis des dossiers dont tous les adhérents le sont.
  if (c.memberSeasons.length) Object.assign(out, await anonymizeMembers(db, clubId, inSeasons(c.memberSeasons), stamp));

  // 3. Fiches personne sans adhésion restante (le lien est retiré à l'anonymisation), demandes closes, opérations.
  out.personnes = await changes(
    db,
    'DELETE FROM people WHERE club_id = ? AND created_at < ? AND NOT EXISTS (SELECT 1 FROM members m WHERE m.person_id = people.id)',
    clubId,
    new Date(now.getTime() - 30 * DAY).toISOString(),
  );
  out.preinscriptions = await changes(
    db,
    `DELETE FROM preregistrations WHERE club_id = ? AND ((${closedPrereg} AND updated_at < ?)${c.preregSeasons.length ? ` OR season IN (${marks(c.preregSeasons)})` : ''})`,
    clubId,
    c.preregBefore,
    ...c.preregSeasons,
  );
  out.operations = await changes(
    db,
    `UPDATE financial_transactions SET payer_name = NULL, payer_email = NULL, label = NULL
     WHERE club_id = ? AND occurred_on < ? AND (payer_name IS NOT NULL OR payer_email IS NOT NULL OR label IS NOT NULL)`,
    clubId,
    c.operationsBefore,
  );
  return out;
}

/** Journal du club : nombres seulement. */
export async function logRetention(db: SqlDatabase, clubId: string, trigger: 'auto' | 'manual', detail: object, now: Date): Promise<void> {
  await db
    .prepare('INSERT INTO retention_runs (id, club_id, trigger, detail, ran_at) VALUES (?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), clubId, trigger, JSON.stringify(detail), now.toISOString())
    .run();
}

/** Tâche de nuit : chaque club qui a activé sa politique. Un club en échec n'arrête pas les autres. */
export async function runRetention(db: SqlDatabase, now: Date, removeFiles: FileRemover): Promise<string> {
  const clubs = await all<{ id: string; retention_policy: string }>(db, "SELECT id, retention_policy FROM clubs WHERE json_extract(retention_policy, '$.enabled') = 1");
  const total = { clubs: 0, pieces: 0, adherents: 0, familles: 0, echecs: 0 };
  for (const club of clubs) {
    try {
      const done = await applyRetention(db, club.id, parseRetentionPolicy(JSON.parse(club.retention_policy)), now, removeFiles);
      await logRetention(db, club.id, 'auto', done, now);
      total.clubs++;
      total.pieces += done.pieces;
      total.adherents += done.adherents;
      total.familles += done.familles;
      total.echecs += done.echecsFichiers;
    } catch (error) {
      total.echecs++;
      console.error(`[conservation] club ${club.id} :`, error instanceof Error ? error.message : error);
    }
  }
  return Object.entries(total).map(([k, v]) => `${k}=${v}`).join(' ');
}
