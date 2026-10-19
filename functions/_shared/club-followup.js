// Suivi licence et tenue (2026-10-16, demande d'un responsable du club) : quatre cases cochées par le club sur la fiche
// adhérent. Chaque case est une date (cochée = date du jour, décochée = vide), colonnes additives d'`inscriptions`
// (inscriptions-db.js). Ne change rien à « complet » ni aux relances : c'est un aide-mémoire pour le club.
// Clés et colonnes stockées : ne jamais les renommer.
export const FOLLOWUP_STEPS = Object.freeze([
  { key: 'licenceDemandee', column: 'licence_demandee_at', label: 'Licence demandée', group: 'licence' },
  { key: 'licenceVerif', column: 'licence_verif_at', label: 'Licence en vérification FFF', group: 'licence' },
  { key: 'tenueCommandee', column: 'tenue_commandee_at', label: 'Tenue commandée', group: 'tenue' },
  { key: 'tenueRemise', column: 'tenue_remise_at', label: "Tenue remise à l'enfant", group: 'tenue' },
]);

export const FOLLOWUP_COLUMNS = FOLLOWUP_STEPS.map((s) => s.column);

// Mise à jour depuis le formulaire : case cochée = garde la date déjà posée, sinon la date du jour ; décochée = vide.
export function followupUpdate(db, organizationId, inscriptionId, data) {
  const sets = FOLLOWUP_STEPS.map((s) =>
    data[s.key] ? `${s.column} = COALESCE(${s.column}, datetime('now'))` : `${s.column} = NULL`
  );
  return db.prepare(`UPDATE inscriptions SET ${sets.join(', ')} WHERE organization_id = ? AND id = ?`).bind(organizationId, inscriptionId);
}

// État lisible (cartes de la liste) : la licence va de « À demander » à « Demandée », « En vérification FFF », puis le
// n° de licence ; la tenue de « À commander » à « Commandée », puis « Remise ».
export function licenceState(r) {
  if (r.numero_licence) return { tone: 'yes', label: `N° ${r.numero_licence}` };
  if (r.licence_verif_at) return { tone: 'wait', label: 'En vérification FFF' };
  if (r.licence_demandee_at) return { tone: 'wait', label: 'Demandée' };
  return { tone: 'no', label: 'À demander' };
}

export function tenueState(r) {
  if (r.tenue_remise_at) return { tone: 'yes', label: 'Remise' };
  if (r.tenue_commandee_at) return { tone: 'wait', label: 'Commandée' };
  return { tone: 'no', label: 'À commander' };
}

// Filtre de la liste Adhérents (?suivi=…) : condition SQL sur l'inscription (alias i).
export const FOLLOWUP_FILTERS = Object.freeze({
  licence_a_demander: { label: 'Licence à demander', sql: 'i.numero_licence IS NULL AND i.licence_demandee_at IS NULL AND i.licence_verif_at IS NULL' },
  licence_en_cours: { label: 'Licence en cours (demandée ou en vérification)', sql: 'i.numero_licence IS NULL AND (i.licence_demandee_at IS NOT NULL OR i.licence_verif_at IS NOT NULL)' },
  tenue_a_commander: { label: 'Tenue à commander', sql: 'i.tenue_commandee_at IS NULL AND i.tenue_remise_at IS NULL' },
  tenue_a_remettre: { label: 'Tenue commandée, à remettre', sql: 'i.tenue_commandee_at IS NOT NULL AND i.tenue_remise_at IS NULL' },
});
