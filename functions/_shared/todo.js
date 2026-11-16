// Page « À traiter » (2026-11-04) : tout ce qui attend une action du club, par ordre d'urgence. Règles fixes (aucune
// IA) calculées sur les fiches actives de l'organisation ; chaque ligne mène à l'écran où l'action se fait.
// Ne recode aucune règle : s'appuie sur dossierStatus, isInscriptionComplete, familyHasActionPending (inscriptions-db.js)
// et licenceStage / licenceMissing (club-followup.js).
import { formatEuros, monthLabel, paymentBalance } from './payments.js';
import { dossierStatus, isInscriptionComplete, hasFamilyDetails, isPhotoToRedo } from './inscriptions-db.js';
import { reminderDueAt, REMIND_AFTER_DAYS } from './reminder-policy.js';
export { REMIND_AFTER_DAYS } from './reminder-policy.js';
import { licenceStage, licenceMissing } from './club-followup.js';
import { preinscriptionDedupKey } from './preinscriptions.js';
import { educateurStatus } from './educateurs.js';

const DAY = 86400000;
// Dates SQLite (« 2026-11-04 10:00:00 », UTC) ou ISO.
const time = (v) => (v ? Date.parse(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`) : NaN);
const olderThan = (v, days, now) => Number.isFinite(time(v)) && now - time(v) > days * DAY;

// Familles à relancer : même délai que les relances automatiques (automations.js) : 3 jours.
// Licence en attente de la famille : relance conseillée après 7 jours sans nouvelle.
export const LICENCE_REMIND_DAYS = 7;
const CLUB_PAYMENT_MODES = new Set(['Espèces', 'Chèque', 'Carte bancaire']);

/**
 * rows : inscriptions de l'organisation ; educateurs : encadrants de la même organisation ;
 * preinscriptionKeys : Set des clés enfant des pré-inscriptions (doublons ; sans celles transférées en inscription par le club). Renvoie les sections non vides.
 */
export function buildTodo(rows, { preinscriptionKeys = new Set(), cheques = [], educateurs = [], now = Date.now() } = {}) {
  const active = rows.filter((r) => !r.archived_at);
  const name = (r) => `${r.enfant_prenom} ${r.enfant_nom}`.trim();
  const fiche = (r) => `/admin/inscriptions/${r.id}`;
  const member = (r) => `${fiche(r)}#suivi-club`;
  const item = (r, detail, since, actions) => ({ id: r.id, name: name(r), detail, since: since || null, actions });
  const byDate = (key) => (a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) || a.id - b.id;
  const sections = [];
  const add = (key, title, hint, tone, list) => {
    if (list.length) sections.push({ key, title, hint, tone, items: list });
  };

  add(
    'dossiers',
    'Dossiers signés à vérifier',
    'Ouvrez le document, puis validez ou refusez : le suivant s’ouvre ensuite.',
    'no',
    active
      .filter((r) => dossierStatus(r) === 'a_verifier')
      .sort(byDate('dossier_uploaded_at'))
      .map((r) => item(r, 'Dossier déposé', r.dossier_uploaded_at, [{ href: `${fiche(r)}/apercu`, label: 'Vérifier', primary: true }]))
  );

  const complete = active.filter(isInscriptionComplete);
  const stageOf = new Map(complete.map((r) => [r.id, licenceStage(r)]));
  const missingText = (r) => licenceMissing(r).map((d) => d.label.toLowerCase() + (d.refused ? ' (refusé)' : '')).join(', ');
  const relancer = (r) => ({ href: `/admin/email?inscription=${r.id}&modele=licence`, label: 'Relancer', primary: true });
  const suivi = (r, label = 'Suivi licence') => ({ href: member(r), label });

  add(
    'licence_refusee',
    'Licences : pièce refusée',
    'La famille doit déposer de nouveau la pièce sur Footclubs.',
    'no',
    complete.filter((r) => stageOf.get(r.id) === 'refusee').map((r) => item(r, `À corriger : ${missingText(r) || 'pièce refusée'}`, r.licence_relance_at, [relancer(r), suivi(r)]))
  );
  add(
    'licence_a_verifier',
    'Licences : pièces à vérifier sur Footclubs',
    'La famille a complété sa demande : vérifiez les pièces.',
    'wait',
    complete.filter((r) => stageOf.get(r.id) === 'a_verifier').sort(byDate('licence_famille_at')).map((r) => item(r, 'Complétée par la famille', r.licence_famille_at, [suivi(r, 'Ouvrir le suivi')]))
  );
  add(
    'licence_a_signer',
    'Licences : à signer sur Footclubs',
    'Pièces vérifiées : signez pour transmettre à la FFF.',
    'wait',
    complete.filter((r) => stageOf.get(r.id) === 'a_signer').sort(byDate('licence_verifiee_at')).map((r) => item(r, 'Pièces vérifiées', r.licence_verifiee_at, [suivi(r, 'Ouvrir le suivi')]))
  );
  add(
    'licence_relance',
    'Licences : familles à relancer',
    `Demande faite il y a plus de ${LICENCE_REMIND_DAYS} jours, sans relance récente.`,
    'wait',
    complete
      .filter((r) => stageOf.get(r.id) === 'attente_famille' && olderThan(r.licence_demandee_at, LICENCE_REMIND_DAYS, now) && (!r.licence_relance_at || olderThan(r.licence_relance_at, LICENCE_REMIND_DAYS, now)))
      .sort(byDate('licence_demandee_at'))
      .map((r) => item(r, missingText(r) ? `Manque : ${missingText(r)}` : 'En attente de la famille', r.licence_demandee_at, [relancer(r), suivi(r)]))
  );
  add(
    'licence_a_demander',
    'Licences : à demander sur Footclubs',
    'Inscription complète : faites la demande de licence.',
    'wait',
    complete.filter((r) => stageOf.get(r.id) === 'a_demander').sort(byDate('created_at')).map((r) => item(r, 'Inscription complète', null, [suivi(r, 'Ouvrir le suivi')]))
  );

  add(
    'paiements',
    'Paiements à encaisser au club',
    'Familles qui règlent sur place : marquez le paiement à réception.',
    'wait',
    active.filter((r) => !r.paye && CLUB_PAYMENT_MODES.has(r.mode_paiement)).sort(byDate('created_at')).map((r) => item(r, `Mode : ${r.mode_paiement}${paymentBalance(r)?.reste ? ` · reste ${formatEuros(paymentBalance(r).reste)}` : ''}`, r.created_at, [{ href: `${fiche(r)}#versement`, label: 'Enregistrer un versement', primary: true }]))
  );

  const pendingWhat = (r) =>
    [
      !hasFamilyDetails(r) && 'coordonnées et autorisations',
      ['manquant', 'refuse'].includes(dossierStatus(r)) && (dossierStatus(r) === 'refuse' ? 'dossier à corriger' : 'dossier signé'),
      !r.photo_uploaded_at && (isPhotoToRedo(r) ? 'photo à refaire' : 'photo'),
      !r.paye && (paymentBalance(r)?.reste ? `solde de ${formatEuros(paymentBalance(r).reste)}` : 'paiement'),
      !(String(r.ville_naissance || '').trim() && String(r.pays_naissance || '').trim()) && 'lieu de naissance',
    ]
      .filter(Boolean)
      .join(', ');
  add(
    'relances',
    'Inscriptions : familles à relancer',
    `Après ${REMIND_AFTER_DAYS} jours sans nouvelle ; après un versement, le rappel du solde attend 30 jours.`,
    'wait',
    active
      .filter((r) => { const due = reminderDueAt(r); return due !== null && due <= now; })
      .sort(byDate('created_at'))
      .map((r) => item(r, `Manque : ${pendingWhat(r)}`, r.last_reminder_at || r.created_at, [{ href: `${fiche(r)}#relancer`, label: 'Ouvrir et relancer' }]))
  );

  add(
    'tenues',
    'Tenues',
    'Adhérents dont la tenue reste à commander ou à remettre.',
    'neutral',
    complete
      .filter((r) => !r.tenue_remise_at)
      .map((r) => item(r, `${r.tenue_commandee_at ? 'Commandée, à remettre' : 'À commander'}${r.taille_maillot ? ` · taille ${r.taille_maillot}` : ''}`, r.tenue_commandee_at, [suivi(r, 'Suivi tenue')]))
  );

  // Chèques remis dont le mois d'encaissement est arrivé (_shared/payments.js, chequesToCash) : suivi interne.
  add(
    'cheques',
    'Chèques à encaisser',
    'Suivi interne : la famille n’est pas prévenue. Marquez chaque chèque encaissé depuis sa fiche.',
    'no',
    cheques.map((c) => ({
      id: c.inscription_id,
      name: `${c.enfant_prenom} ${c.enfant_nom}`.trim(),
      detail: `Chèque ${c.rang} · ${formatEuros(c.montant_cents)}${c.numero ? ` · n° ${c.numero}` : ''} · prévu en ${monthLabel(c.encaissement_prevu)}`,
      since: null,
      actions: [{ href: `/admin/inscriptions/${c.inscription_id}#cheques`, label: 'Suivi des chèques', primary: true }],
    }))
  );

  add(
    'educateurs',
    'Éducateurs : fiches à compléter',
    'Invitez les encadrants à renseigner leurs informations et leurs formations depuis leur lien personnel.',
    'wait',
    educateurs.filter((r) => ['invite', 'photo'].includes(educateurStatus(r))).map((r) => ({
      id: r.id, kind: 'educateur', name: `${r.prenom} ${r.nom}`, since: r.link_sent_at || null,
      detail: !r.submitted_at ? (r.link_sent_at ? 'Fiche attendue · lien déjà envoyé' : 'Invitation à envoyer') : 'Photo manquante',
      actions: [{ href: `/admin/educateurs/${r.id}#${r.submitted_at ? 'photo' : 'lien'}`, label: r.submitted_at ? 'Voir la fiche' : r.link_sent_at ? 'Suivre l’invitation' : 'Envoyer le lien', primary: true }],
    }))
  );

  add(
    'doublons',
    'Doublons inscription / pré-inscription',
    'Enfant présent dans les deux listes : retirez-le des inscriptions depuis sa fiche.',
    'no',
    active
      .filter((r) => preinscriptionKeys.has(preinscriptionDedupKey({ enfantPrenom: r.enfant_prenom, enfantNom: r.enfant_nom, naissance: r.naissance })))
      .map((r) => item(r, `Inscription n° ${r.id}`, null, [{ href: fiche(r), label: 'Ouvrir la fiche' }]))
  );

  return sections;
}

export const todoCount = (sections) => sections.filter((s) => s.tone !== 'neutral').reduce((n, s) => n + s.items.length, 0);
