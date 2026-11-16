// Suivi licence FFF et tenue (fiche adhérent). Aide-mémoire du club : ne change rien à « complet » ni aux relances
// automatiques. Colonnes additives d'`inscriptions` (inscriptions-db.js). Clés, colonnes et valeurs stockées : ne
// jamais les renommer.
//
// Parcours réel d'une licence (refait le 2026-11-04 à la demande du club) :
//   1. le club fait la demande sur Footclubs ;
//   2. la famille reçoit l'e-mail de la FFF et complète : photo, pièce d'identité, questionnaire de santé, et
//      certificat médical si elle a répondu « oui » à une question ;
//   3. le club vérifie les pièces ;
//   4. le club signe et transmet à la FFF ;
//   5. la FFF valide, ou refuse une pièce : on relance la famille (ou, en dernier recours, le club l'ajoute).
// Chaque étape est une date (cochée = date du jour conservée, décochée = vide). Chaque pièce a un état.
//
// Historique : 2026-10-16, quatre cases. `licence_verif_at` (« en vérification FFF ») garde le même sens :
// signée et transmise, en attente de la FFF.
export const FOLLOWUP_STEPS = Object.freeze([
  { key: 'licenceDemandee', column: 'licence_demandee_at', label: 'Demande faite sur Footclubs', group: 'licence' },
  { key: 'licenceFamille', column: 'licence_famille_at', label: 'Complétée par la famille', group: 'licence' },
  { key: 'licenceVerifiee', column: 'licence_verifiee_at', label: 'Pièces vérifiées par le club', group: 'licence' },
  { key: 'licenceVerif', column: 'licence_verif_at', label: 'Signée et transmise à la FFF', group: 'licence' },
  { key: 'licenceValidee', column: 'licence_validee_at', label: 'Validée par la FFF', group: 'licence' },
  { key: 'tenueCommandee', column: 'tenue_commandee_at', label: 'Tenue commandée', group: 'tenue' },
  { key: 'tenueRemise', column: 'tenue_remise_at', label: "Tenue remise à l'enfant", group: 'tenue' },
]);

// Pièces demandées par la FFF. Valeur vide = pas encore vérifiée (certificat : pas encore su s'il est requis).
export const LICENCE_DOCS = Object.freeze([
  { key: 'docPhoto', column: 'licence_doc_photo', label: 'Photo' },
  { key: 'docIdentite', column: 'licence_doc_identite', label: "Pièce d'identité" },
  { key: 'docSante', column: 'licence_doc_sante', label: 'Questionnaire de santé' },
  { key: 'docCertificat', column: 'licence_doc_certificat', label: 'Certificat médical', certificat: true },
]);

export const DOC_STATES = Object.freeze({
  manquant: { label: 'Manquant', tone: 'no' },
  ok: { label: 'Conforme', tone: 'yes' },
  refuse: { label: 'Refusé, à corriger', tone: 'no' },
  club: { label: 'Ajouté par le club', tone: 'yes' },
  non_requis: { label: 'Non requis', tone: 'neutral' },
});

// Choix proposés pour une pièce (premier = valeur vide).
export function docChoices(doc) {
  const empty = doc.certificat ? 'À préciser' : 'À vérifier';
  const keys = doc.certificat ? ['non_requis', 'manquant', 'ok', 'refuse', 'club'] : ['manquant', 'ok', 'refuse', 'club'];
  return [['', empty], ...keys.map((k) => [k, DOC_STATES[k].label])];
}

export const FOLLOWUP_COLUMNS = [...FOLLOWUP_STEPS.map((s) => s.column), ...LICENCE_DOCS.map((d) => d.column), 'licence_relance_at'];

// Mise à jour depuis le formulaire : case cochée = garde la date déjà posée, sinon la date du jour ; décochée = vide.
// Pièce : valeur de la liste fermée, sinon vide (jamais une valeur venant du navigateur telle quelle).
export function followupUpdate(db, organizationId, inscriptionId, data) {
  const sets = FOLLOWUP_STEPS.map((s) => (data[s.key] ? `${s.column} = COALESCE(${s.column}, datetime('now'))` : `${s.column} = NULL`));
  const values = [];
  for (const d of LICENCE_DOCS) {
    const v = String(data[d.key] ?? '');
    const allowed = docChoices(d).some(([k]) => k && k === v);
    sets.push(`${d.column} = ?`);
    values.push(allowed ? v : null);
  }
  return db.prepare(`UPDATE inscriptions SET ${sets.join(', ')} WHERE organization_id = ? AND id = ?`).bind(...values, organizationId, inscriptionId);
}

// Relance notée (bouton de la fiche, ou e-mail de relance licence envoyé depuis l'admin).
export function licenceRelanceUpdate(db, organizationId, inscriptionId) {
  return db.prepare("UPDATE inscriptions SET licence_relance_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(organizationId, inscriptionId);
}

// ---------------------------------------------------------------------------------------------
// Le n° de licence (« Numéro personne » de Footclubs) existe dès la demande : il ne vaut jamais « validée ».
// Étape de la licence : UNE définition, en JS (fiche, cartes) et en SQL (filtres, compteurs), tenues identiques par test.

export const LICENCE_STAGES = Object.freeze({
  a_demander: { label: 'À demander sur Footclubs', short: 'À demander', tone: 'no' },
  attente_famille: { label: 'En attente de la famille', short: 'Attente famille', tone: 'wait' },
  a_verifier: { label: 'À vérifier par le club', short: 'À vérifier', tone: 'wait' },
  a_signer: { label: 'À signer par le club', short: 'À signer', tone: 'wait' },
  attente_fff: { label: 'Signée, en attente de la FFF', short: 'Attente FFF', tone: 'wait' },
  refusee: { label: 'Pièce refusée : à corriger par la famille', short: 'Pièce refusée', tone: 'no' },
  validee: { label: 'Validée', short: 'Validée', tone: 'yes' },
});

const docValue = (r, d) => String(r[d.column] ?? '');

export function licenceStage(r) {
  if (r.licence_validee_at) return 'validee';
  if (LICENCE_DOCS.some((d) => docValue(r, d) === 'refuse')) return 'refusee';
  if (r.licence_verif_at) return 'attente_fff';
  if (r.licence_verifiee_at) return 'a_signer';
  if (r.licence_famille_at) return 'a_verifier';
  if (r.licence_demandee_at) return 'attente_famille';
  return 'a_demander';
}

// Pièces à fournir ou à corriger (marquées « manquant » ou « refusé ») : « qui manque quoi ».
export function licenceMissing(r) {
  if (licenceStage(r) === 'validee') return [];
  return LICENCE_DOCS.filter((d) => ['manquant', 'refuse'].includes(docValue(r, d))).map((d) => ({ ...d, refused: docValue(r, d) === 'refuse' }));
}

const sqlDoc = (d, v) => `COALESCE(i.${d.column}, '') = '${v}'`;
const REFUSED_SQL = `(${LICENCE_DOCS.map((d) => sqlDoc(d, 'refuse')).join(' OR ')})`;
export const MISSING_SQL = `(${LICENCE_DOCS.flatMap((d) => [sqlDoc(d, 'manquant'), sqlDoc(d, 'refuse')]).join(' OR ')})`;
export const LICENCE_STAGE_SQL = `(CASE
  WHEN i.licence_validee_at IS NOT NULL THEN 'validee'
  WHEN ${REFUSED_SQL} THEN 'refusee'
  WHEN i.licence_verif_at IS NOT NULL THEN 'attente_fff'
  WHEN i.licence_verifiee_at IS NOT NULL THEN 'a_signer'
  WHEN i.licence_famille_at IS NOT NULL THEN 'a_verifier'
  WHEN i.licence_demandee_at IS NOT NULL THEN 'attente_famille'
  ELSE 'a_demander' END)`;

// État lisible (cartes de la liste).
export function licenceState(r) {
  const stage = licenceStage(r);
  const s = LICENCE_STAGES[stage];
  if (stage === 'validee' && r.numero_licence) return { tone: 'yes', label: `N° ${r.numero_licence}` };
  return { tone: s.tone, label: s.short };
}

export function tenueState(r) {
  if (r.tenue_remise_at) return { tone: 'yes', label: 'Remise' };
  if (r.tenue_commandee_at) return { tone: 'wait', label: 'Commandée' };
  return { tone: 'no', label: 'À commander' };
}

// Filtre de la liste Adhérents (?suivi=…) : condition SQL sur l'inscription (alias i). Liste fermée.
const stageFilter = (keys) => `${LICENCE_STAGE_SQL} IN (${keys.map((k) => `'${k}'`).join(', ')})`;
export const FOLLOWUP_FILTERS = Object.freeze({
  ...Object.fromEntries(Object.entries(LICENCE_STAGES).map(([k, s]) => [`licence_${k}`, { label: `Licence : ${s.short.toLowerCase()}`, sql: stageFilter([k]) }])),
  licence_pieces: { label: 'Licence : pièces manquantes ou refusées', sql: `${MISSING_SQL} AND ${LICENCE_STAGE_SQL} <> 'validee'` },
  // Ancienne valeur (lien enregistré avant le 2026-11-04) : toute licence en cours.
  licence_en_cours: { label: 'Licence : en cours (toutes étapes)', sql: stageFilter(['attente_famille', 'a_verifier', 'a_signer', 'attente_fff', 'refusee']) },
  tenue_a_commander: { label: 'Tenue à commander', sql: 'i.tenue_commandee_at IS NULL AND i.tenue_remise_at IS NULL' },
  tenue_a_remettre: { label: 'Tenue commandée, à remettre', sql: 'i.tenue_commandee_at IS NOT NULL AND i.tenue_remise_at IS NULL' },
  // Bandeau « Parcours de l'adhérent » (2026-11-13) : licence validée ET tenue remise.
  pret_a_jouer: { label: 'Prêts à jouer (licence validée, tenue remise)', sql: `${LICENCE_STAGE_SQL} = 'validee' AND i.tenue_remise_at IS NOT NULL` },
});

// Étapes affichées en compteurs cliquables au-dessus de la liste Adhérents (ordre du parcours).
export const LICENCE_COUNTER_ORDER = ['a_demander', 'attente_famille', 'a_verifier', 'a_signer', 'attente_fff', 'refusee', 'validee'];

// ---------------------------------------------------------------------------------------------
// E-mail de relance licence prérempli (/admin/email?inscription=<id>&modele=licence) : le club le relit et le modifie.

export function licenceReminderText(r) {
  const prenom = String(r.enfant_prenom || '').trim() || 'votre enfant';
  const missing = licenceMissing(r);
  if (missing.length) {
    const lines = missing.map((d) => `- ${d.label}${d.refused ? ' : refusé(e), à déposer de nouveau' : ''}`);
    return {
      subject: `Licence FFF de ${prenom} : document${missing.length > 1 ? 's' : ''} à fournir`,
      message: [
        `Pour finaliser la licence de ${prenom}, la Fédération française de football attend encore :`,
        lines.join('\n'),
        'Vous les déposez vous-même depuis l’e-mail reçu de la FFF pour compléter la demande de licence (pensez à regarder dans les courriers indésirables). Pour une pièce refusée, vérifiez qu’elle est lisible, en entier et à jour.',
        'Si vous ne retrouvez pas cet e-mail de la FFF, répondez simplement à ce message : nous vous le renverrons.',
      ].join('\n\n'),
    };
  }
  return {
    subject: `Licence FFF de ${prenom} : à compléter`,
    message: [
      `Nous avons fait la demande de licence de ${prenom} auprès de la FFF. Vous avez reçu un e-mail de la FFF pour la compléter en ligne :`,
      ['- une photo d’identité de l’enfant', '- une pièce d’identité', '- le questionnaire de santé', '- un certificat médical, uniquement si vous avez répondu « oui » à une question du questionnaire'].join('\n'),
      'Pensez à regarder dans les courriers indésirables. La licence ne peut pas être validée tant que ces éléments ne sont pas déposés.',
      'Si vous ne retrouvez pas cet e-mail de la FFF, répondez simplement à ce message : nous vous le renverrons.',
    ].join('\n\n'),
  };
}
