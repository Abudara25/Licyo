// Fiches adhérents permanentes (people) : repérage des doublons possibles.
//
// Le rapprochement automatique est volontairement strict (prénom, nom et date de naissance identiques, voir la
// migration 0008). Ce module signale les ressemblances que le bureau peut vérifier : il ne fusionne jamais rien.
// Module sans dépendance à Next.js : testé sur SQLite (tests/people.test.ts).

import type { SqlDatabase } from './db/query.ts';

export type DuplicateReason = 'birth_differs' | 'same_birth_and_last_name' | 'same_birth_and_first_name';

export const DUPLICATE_LABELS: Record<DuplicateReason, string> = {
  birth_differs: 'Même prénom et nom, date de naissance différente (erreur de saisie ?)',
  same_birth_and_last_name: 'Même nom et même date de naissance (jumeaux, ou prénom mal saisi ?)',
  same_birth_and_first_name: 'Même prénom et même date de naissance (nom mal saisi ?)',
};

export type DuplicatePair = {
  a: string;
  b: string;
  reason: DuplicateReason;
  aName: string;
  bName: string;
  aBirth: string;
  bBirth: string;
};

const norm = (col: string) => `lower(trim(${col}))`;

/** Ressemblances entre fiches d'un club (au plus `limit`), éventuellement limitées à une personne. */
export async function possibleDuplicates(db: SqlDatabase, clubId: string, personId?: string, limit = 200): Promise<DuplicatePair[]> {
  const only = personId ? 'AND (a.id = ? OR b.id = ?)' : '';
  const params: unknown[] = [clubId];
  if (personId) params.push(personId, personId);
  params.push(limit);
  const res = await db
    .prepare(
      `SELECT a.id AS a, b.id AS b,
              CASE
                WHEN ${norm('a.first_name')} = ${norm('b.first_name')} AND ${norm('a.last_name')} = ${norm('b.last_name')} THEN 'birth_differs'
                WHEN ${norm('a.last_name')} = ${norm('b.last_name')} THEN 'same_birth_and_last_name'
                ELSE 'same_birth_and_first_name'
              END AS reason,
              a.first_name || ' ' || a.last_name AS aName, b.first_name || ' ' || b.last_name AS bName,
              a.birth_date AS aBirth, b.birth_date AS bBirth
       FROM people a JOIN people b ON b.club_id = a.club_id AND a.id < b.id
       WHERE a.club_id = ? ${only}
         AND (
           (${norm('a.first_name')} = ${norm('b.first_name')} AND ${norm('a.last_name')} = ${norm('b.last_name')} AND a.birth_date <> b.birth_date)
           OR (a.birth_date = b.birth_date AND ${norm('a.last_name')} = ${norm('b.last_name')} AND ${norm('a.first_name')} <> ${norm('b.first_name')})
           OR (a.birth_date = b.birth_date AND ${norm('a.first_name')} = ${norm('b.first_name')} AND ${norm('a.last_name')} <> ${norm('b.last_name')})
         )
       ORDER BY a.last_name, a.first_name
       LIMIT ?`,
    )
    .bind(...params)
    .all<DuplicatePair>();
  return res.results ?? [];
}
