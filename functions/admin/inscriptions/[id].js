// Fiche d'une inscription (base D1 "DB") : vue détaillée avec ses actions (paiement, relance, PDF,
// dépôt manuel du dossier, archivage) et, avec ?edit=1, le formulaire de modification. Liée depuis
// les cartes de /admin/inscriptions et depuis /admin/reinscription. Les actions sont traitées par
// functions/admin/inscriptions.js (ou [id]/dossier.js pour le dépôt) et reviennent ici via redirectTo.
import { syncInscriptionSafe } from '../../_shared/crm.js';
import { normalizePassSportCode, PASS_SPORT_ERROR } from '../../_shared/pass-sport.js';
import { passSportDueChange, passSportNotDeducted, amountDueCents, parseEuros, parseEurosOrZero, formatEuros, defaultDueCents, paymentBalance, isPartiallyPaid, ensurePaymentEntriesTable, paymentEntryStatement, listPaymentEntries, amountBeforeHistory,
  ensureChequesTable, listCheques, deletableEntryIds, stateBeforeCorrection, maxChequesFor, chequeMonths, splitCents, monthLabel, todayParis, parsePaymentDate, paymentDateTime,
  EXEMPTION_MOTIFS, EXEMPTION_COMMENT_MAX, isPaymentExempt, exemptionLabel, readExemption } from '../../_shared/payments.js';
import { ensureInscriptionsTable, isInscriptionComplete, familyHasActionPending, hasBirthPlace, hasFamilyDetails, dossierStatus, refusMotifs, archiveReason, PHOTO_REFUS_MOTIFS, photoRefusMotifs, isPhotoToRedo, ageGroup, ageRangesFrom } from '../../_shared/inscriptions-db.js';
import { photoTag,
  isAuthed,
  loginPage,
  escapeHtml,
  adminHead,
  adminShell,
  adminScripts,
  cpLookupButton,
  adminBadges,
  contactActions,
  icon,
  archiveReasonFields,
  avatar,
  statusTag,
  dossierTag,
  PHOTO_TAG,
  PAIEMENT_TAG,
  flash,
  formatDateFr,
  formatBirth,
  ageAndCategory,
} from '../../_shared/admin-auth.js';
import { getCategoriesConfig } from '../../_shared/settings-kv.js';
import { activeFamilyLinks, revokeFamilyLinks, FAMILY_LINK_DAYS } from '../../_shared/family-links.js';
import { followupUpdate, licenceRelanceUpdate } from '../../_shared/club-followup.js';
import { sendFamilyLinkEmail, sendPartialPaymentEmail, sendFollowUpEmail } from '../../_shared/confirmation-email.js';
import { followupSection, noteSection, emailsSection } from '../../_shared/crm-ui.js';
import { buildActivity, activitySection } from '../../_shared/activity.js';
import { getContactProfile } from '../../_shared/crm.js';
import { listEmailsForInscriptions } from '../../_shared/email-log.js';
import { licenceStage, LICENCE_STAGES } from '../../_shared/club-followup.js';
import { afterInscriptionChange } from '../../_shared/automations.js';
import { ensureHelloAssoPaymentsTable, forgetEntryStatement } from '../../_shared/helloasso-import.js';
import { dossierVerificationForms, DOSSIER_CHECKLIST, verifMessage } from '../../_shared/admin-dossier.js';
import { getPreinscriptionGroups, groupForYear, ensurePreinscriptionsTable, findPreinscriptionForChild } from '../../_shared/preinscriptions.js';

const REQUIRED_FIELDS = ['enfantPrenom', 'enfantNom', 'naissance', 'categorie', 'tailleMaillot', 'modePaiement', 'parentPrenom', 'parentNom', 'email', 'telephone'];
const LONG_DATE = { day: 'numeric', month: 'long', year: 'numeric' };
// Numéro de licence FFF (saisi par le club) : chiffres et lettres, espaces ou tirets tolérés.
const LICENCE_RE = /^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/;
const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

// Reconstruit un objet "row" (clés snake_case, comme en base) à partir du formData resoumis, pour
// réafficher les valeurs saisies par l'utilisateur (et pas les anciennes valeurs) en cas d'erreur.
const toRow = (data) => ({
  enfant_prenom: data.enfantPrenom,
  enfant_nom: data.enfantNom,
  naissance: data.naissance,
  ville_naissance: data.villeNaissance,
  pays_naissance: data.paysNaissance,
  cp_naissance: data.cpNaissance,
  numero_licence: data.numeroLicence,
  categorie: data.categorie,
  taille_maillot: data.tailleMaillot,
  mode_paiement: data.modePaiement,
  pass_sport_code: data.passSportCode,
  paye: data.paye === '1' ? 1 : 0,
  parent_prenom: data.parentPrenom,
  parent_nom: data.parentNom,
  email: data.email,
  telephone: data.telephone,
  adresse: data.adresse,
  code_postal: data.codePostal,
  ville: data.ville,
  parent2_prenom: data.parent2Prenom,
  parent2_nom: data.parent2Nom,
  parent2_email: data.parent2Email,
  parent2_telephone: data.parent2Telephone,
  autorisation: data.autorisation ? 1 : 0,
  droit_image: data.droitImage ? 1 : 0,
  rgpd: data.rgpd ? 1 : 0,
});

function actionForm(fields, { label, iconName, className, confirm }) {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`)
    .join('');
  return `<form method="POST" action="/admin/inscriptions"${confirm ? ' class="admin-confirm-form"' : ''}>${hidden}<button type="submit" class="adm-btn ${className}"${
    confirm ? ` data-confirm="${escapeHtml(confirm)}"` : ''
  }>${icon(iconName)}${label}</button></form>`;
}

// Transfert vers la pré-inscription ([id]/preinscription.js) : proposé seulement pour une fiche active dont l'année
// de naissance est celle du groupe en pré-inscription (sinon, corriger d'abord la date via « Modifier »).
// Photo à refaire ([id]/photo-verification.js) : formulaire « Demander une nouvelle photo » quand une photo est reçue,
// rappel des motifs quand elle a été refusée et pas encore renvoyée.
function photoRedoBlock(row, self, rawName) {
  if (isPhotoToRedo(row)) {
    const motifs = photoRefusMotifs(row);
    return `<div class="adm-verif">
      <p class="adm-verif-title is-refused">${icon('alert')}Nouvelle photo demandée le ${formatDateFr(row.photo_refused_at, LONG_DATE)}</p>
      ${motifs.length ? `<ul class="adm-verif-motifs">${motifs.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}
      ${row.photo_refus_commentaire ? `<p class="adm-help">« ${escapeHtml(row.photo_refus_commentaire)} »</p>` : ''}
      <p class="adm-help">En attente d'une nouvelle photo de la famille.${row.photo_key ? ` <a class="adm-link" href="${self}/photo" target="_blank" rel="noopener">Voir la photo refusée</a>` : ''}</p>
    </div>`;
  }
  if (!row.photo_uploaded_at) return '';
  return `<details class="adm-refuse">
      <summary class="adm-btn adm-btn-danger adm-btn-block">${icon('camera')}Demander une nouvelle photo</summary>
      <form method="POST" action="${self}/photo-verification" class="adm-refuse-form admin-confirm-form">
        <input type="hidden" name="action" value="refuser">
        <fieldset>
          <legend>Qu'est-ce qui ne va pas ?</legend>
          ${Object.entries(PHOTO_REFUS_MOTIFS)
            .map(([key, label]) => `<label class="adm-check"><input type="checkbox" name="motifs" value="${key}"><span>${escapeHtml(label)}</span></label>`)
            .join('')}
        </fieldset>
        <label class="adm-field" for="photo-refus-commentaire">Précision pour la famille <small>(facultatif)</small>
          <textarea id="photo-refus-commentaire" name="commentaire" rows="3" maxlength="500" placeholder="Ex. : merci de reprendre la photo devant un mur blanc."></textarea>
        </label>
        <label class="adm-check"><input type="checkbox" name="notifier" checked><span>Prévenir la famille par e-mail (consignes et lien pour envoyer la nouvelle photo)</span></label>
        <button type="submit" class="adm-btn adm-btn-danger-solid adm-btn-block" data-confirm="${escapeHtml(`Demander une nouvelle photo de ${rawName} ? La photo actuelle ne compte plus comme reçue ; si la case est cochée, la famille reçoit un e-mail avec les consignes.`)}">${icon('send')}Demander une nouvelle photo</button>
      </form>
    </details>`;
}

// Fiche créée par le club depuis une pré-inscription (_shared/preinscription-transfer.js) : rappel de l'origine et
// des informations que la famille doit encore donner depuis son espace (adresse, mode de paiement, autorisations).
function fromPreinscriptionBlock(row, origin) {
  if (!origin || row.archived_at) return '';
  const pending = !hasFamilyDetails(row);
  return `<section class="adm-surface adm-transfer">
    <p class="adm-transfer-text">${icon(pending ? 'alert' : 'check')}<span>Fiche créée depuis la <a class="adm-link" href="/admin/preinscriptions?groupe=${encodeURIComponent(origin.groupe)}">pré-inscription ${escapeHtml(origin.label)}</a>. ${
      pending
        ? '<strong>Coordonnées et autorisations à compléter par la famille</strong> (adresse, mode de paiement, autorisation de participation, droit à l’image, données personnelles), depuis son espace famille.'
        : 'Coordonnées et autorisations données par la famille.'
    }</span></p>
  </section>`;
}

function transferBlock(row, config, rawName, listed) {
  if (!config || row.archived_at) return '';
  // Groupe ouvert (preinscription-opening.js) : c'est une catégorie comme les autres, plus de transfert (le doublon
  // éventuel se retire toujours).
  if (config.openedAt && !listed) return '';
  const year = Number(String(row.naissance || '').slice(0, 4));
  if (!listed && !(year >= config.anneeMin && year <= config.anneeMax)) return '';
  const label = escapeHtml(config.label);
  // Déjà pré-inscrit (la famille a rempli les deux formulaires) : il ne reste qu'à retirer cette fiche des inscriptions.
  const text = listed
    ? `<strong>Doublon</strong> : ${escapeHtml(rawName)} est aussi dans la <a class="adm-link" href="/admin/preinscriptions?groupe=${encodeURIComponent(config.groupe)}">pré-inscription ${label}</a>.`
    : `<strong>Né(e) en ${year}</strong> : cet enfant relève du futur groupe ${label}.`;
  const button = listed ? `Retirer des inscriptions` : `Transférer en pré-inscription ${label}`;
  const confirm = listed
    ? `Retirer ${rawName} des inscriptions ? L'enfant reste dans la pré-inscription ${config.label} ; cette fiche est conservée (lien sur sa carte de pré-inscription). Aucun e-mail n'est envoyé.`
    : `Transférer ${rawName} dans la pré-inscription ${config.label} ? Ses informations sont recopiées dans la liste et cette inscription passe à la corbeille (récupérable). Aucun e-mail n'est envoyé.`;
  return `<section class="adm-surface adm-transfer">
    <p class="adm-transfer-text">${icon(listed ? 'alert' : 'refresh')}<span>${text}</span></p>
    <form method="POST" action="/admin/inscriptions/${row.id}/preinscription" class="admin-confirm-form">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-confirm="${escapeHtml(confirm)}">${icon('send')}${button}</button>
    </form>
  </section>`;
}

const ageRangesContext = (saison, categories, preinscription) => ({ saison, ranges: ageRangesFrom(categories, preinscription) });

// Liens de l'espace famille (2026-10-16) : à durée limitée, jamais affichés au club (seule leur empreinte est en base).
// Le club peut en envoyer un neuf aux adresses de la fiche, ou couper tous les liens existants (lien transféré, perdu).
function familyLinksRow(row, links, messages) {
  const kv = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const self = `/admin/inscriptions/${row.id}`;
  const state = links?.count
    ? `${links.count} lien${links.count > 1 ? 's' : ''} valable${links.count > 1 ? 's' : ''} jusqu'au ${formatDateFr(links.until, LONG_DATE)}`
    : 'Aucun lien récent en cours';
  const note = messages.linkSent ? flash('ok', 'Nouveau lien envoyé aux adresses de la fiche.') : messages.linkError ? flash('error', "Le lien n'a pas pu être envoyé, réessayez.") : messages.linksRevoked ? flash('ok', 'Tous les liens de cette fiche sont coupés.') : '';
  return `${kv('Espace famille', escapeHtml(state))}
      </dl>
      <p class="adm-help">Liens personnels valables ${FAMILY_LINK_DAYS} jours, envoyés aux adresses de la fiche. Le club ne les voit jamais.</p>
      ${note}
      <div class="adm-family-links">
        <form method="POST" action="${self}"><input type="hidden" name="action" value="family-link-send">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('send')}Envoyer un nouveau lien</button></form>
        <form method="POST" action="${self}" class="admin-confirm-form"><input type="hidden" name="action" value="family-link-revoke">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Couper tous les liens de l'espace famille de cette fiche ? La famille pourra en recevoir un nouveau par e-mail.">${icon('lock')}Révoquer les liens</button></form>
      </div>
      <dl class="adm-kv">`;
}

function fichePage(row, { saison, ageCtx, prix, siteUrl, messages, preinscription, preinscriptionListed, fromPreinscription = null, badges, familyLinks = null, payments = [], cheques = [], emails = [], seasons = [], contactId = null }) {
  const rawName = `${row.enfant_prenom} ${row.enfant_nom}`;
  const name = escapeHtml(rawName);
  const dossier = dossierStatus(row);
  const docReceived = dossier !== 'manquant';
  const payOk = Boolean(row.paye);
  // Exemption de paiement (motif interne du club, _shared/payments.js).
  const exempt = isPaymentExempt(row);
  // Versements enregistrés : le statut payé se déduit des montants, jamais d'une bascule à la main.
  const paidByEntries = Number(row.montant_recu_cents) > 0;
  const photoOk = Boolean(row.photo_uploaded_at);
  const archived = Boolean(row.archived_at);
  const self = `/admin/inscriptions/${row.id}`;

  // Même document que celui produit à l'inscription (assets/js/pdf-inscription.js, régénéré côté
  // client) : utile si la famille a perdu l'e-mail de confirmation et que le club veut le renvoyer.
  const pdfData = {
    enfantPrenom: row.enfant_prenom,
    enfantNom: row.enfant_nom,
    naissance: row.naissance,
    villeNaissance: row.ville_naissance,
    paysNaissance: row.pays_naissance,
    cpNaissance: row.cp_naissance,
    categorie: row.categorie,
    saison,
    prix,
    tailleMaillot: row.taille_maillot,
    modePaiement: row.mode_paiement,
    passSportCode: row.pass_sport_code,
    parentPrenom: row.parent_prenom,
    parentNom: row.parent_nom,
    email: row.email,
    telephone: row.telephone,
    adresse: row.adresse,
    codePostal: row.code_postal,
    ville: row.ville,
    droitImage: row.droit_image,
    parent2Prenom: row.parent2_prenom,
    parent2Nom: row.parent2_nom,
    parent2Email: row.parent2_email,
    parent2Telephone: row.parent2_telephone,
  };
  const pdfBtn = `<button type="button" class="adm-btn adm-btn-ghost adm-pdf-btn" data-pdf='${escapeHtml(JSON.stringify(pdfData))}' data-depot-url="${escapeHtml(`${siteUrl}/espace-famille`)}">${icon('download')}Télécharger le PDF</button>`;
  const editBtn = `<a href="${self}?edit=1" class="adm-btn adm-btn-ghost">${icon('edit')}Modifier</a>`;
  const mailsBtn = `<a href="/admin/events?inscription=${row.id}#emails" class="adm-btn adm-btn-ghost">${icon('mail')}E-mails envoyés</a>`;
  const writeBtn = `<a href="/admin/email?inscription=${row.id}" class="adm-btn adm-btn-ghost">${icon('send')}Écrire un e-mail</a>`;

  const kv = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const yesNo = (value) => (value ? 'Oui' : 'Non');
  const hasParent2 = Boolean(row.parent2_prenom || row.parent2_nom);
  const adresse =
    [row.adresse, [row.code_postal, row.ville].filter(Boolean).join(' ')]
      .filter(Boolean)
      .map(escapeHtml)
      .join(', ') || '—';

  const enfant = `<section class="adm-surface adm-fiche-enfant">
    <h2 class="adm-h2">${icon('user')}Enfant</h2>
    <dl class="adm-kv">
      ${kv('Naissance', formatBirth(row.naissance))}
      ${kv('Lieu de naissance', escapeHtml([[row.cp_naissance, row.ville_naissance].filter(Boolean).join(' '), row.pays_naissance].filter(Boolean).join(', ') || '—'))}
      ${kv('Catégorie', escapeHtml(row.categorie))}
      ${kv('Taille de maillot', escapeHtml(row.taille_maillot || '—'))}
      ${kv('Saison', escapeHtml(row.saison || '—'))}
      ${kv('Autorisation de participation', yesNo(row.autorisation))}
      ${kv("Droit à l'image", yesNo(row.droit_image))}
      ${kv('Consentement RGPD', yesNo(row.rgpd))}
    </dl>
    <form method="POST" action="${self}" class="adm-upload adm-licence">
      <input type="hidden" name="action" value="licence">
      <label for="numero-licence-rapide">${row.numero_licence ? 'Modifier le n° de licence FFF' : 'N° de licence FFF'}<small>À saisir une fois la licence enregistrée sur Footclubs.</small></label>
      <div class="adm-licence-row">
        <input type="text" id="numero-licence-rapide" name="numeroLicence" value="${escapeHtml(row.numero_licence || '')}" maxlength="40" inputmode="numeric" autocomplete="off">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button>
      </div>
    </form>
  </section>`;

  // Coordonnées des responsables copiables (comme sur l'ancienne fiche adhérent).
  const coord = (value, what) =>
    value
      ? `<span class="adm-person-coord" title="${escapeHtml(value)}">${escapeHtml(value)}</span><button type="button" class="adm-copy-btn" data-copy="${escapeHtml(value)}" aria-label="Copier ${what}" title="Copier">${icon('copy')}${icon('check')}</button>`
      : '—';
  const parent = `<section class="adm-surface adm-fiche-parent">
    <h2 class="adm-h2">${icon('phone')}${hasParent2 ? 'Responsables légaux' : 'Responsable légal'}</h2>
    <dl class="adm-kv">
      ${kv('Prénom', coord(row.parent_prenom, 'le prénom'))}
      ${kv('Nom', coord(row.parent_nom, 'le nom'))}
      ${kv('Téléphone', coord(row.telephone, 'le téléphone'))}
      ${kv('E-mail', coord(row.email, 'l’e-mail'))}
    </dl>
    ${contactActions({ phone: row.telephone, email: row.email, name: hasParent2 ? `${row.parent_prenom} ${row.parent_nom}` : '', inscriptionId: row.id })}
    ${
      hasParent2
        ? `<dl class="adm-kv adm-kv-next">
      ${kv('Prénom (2e)', coord(row.parent2_prenom, 'le prénom'))}
      ${kv('Nom (2e)', coord(row.parent2_nom, 'le nom'))}
      ${kv('Téléphone (2e)', coord(row.parent2_telephone, 'le téléphone'))}
      ${kv('E-mail (2e)', coord(row.parent2_email, 'l’e-mail'))}
    </dl>
    ${contactActions({ phone: row.parent2_telephone, email: row.parent2_email, name: `${row.parent2_prenom || ''} ${row.parent2_nom || ''}`.trim(), inscriptionId: row.id })}`
        : ''
    }
  </section>`;

  // Vérification du dossier (functions/admin/inscriptions/[id]/verification.js) : valider, ou refuser avec
  // des motifs qui partent par e-mail à la famille. Proposée tant qu'un fichier existe ; mise en avant
  // quand il attend d'être vérifié.
  const motifs = refusMotifs(row);
  const verificationForms = dossierVerificationForms({ self, dossier, rawName, openRefuse: dossier === 'a_verifier' && Boolean(messages.verifError) });
  const verification = !docReceived
    ? ''
    : `<div class="adm-verif${dossier === 'a_verifier' ? ' is-pending' : ''}">
      ${
        dossier === 'a_verifier'
          ? `<p class="adm-verif-title">${icon('eye')}Dossier à vérifier</p>
      <p class="adm-help">Ouvrez le document. ${DOSSIER_CHECKLIST}</p>`
          : ''
      }
      ${
        dossier === 'refuse'
          ? `<p class="adm-verif-title is-refused">${icon('alert')}Refusé le ${formatDateFr(row.dossier_refused_at, LONG_DATE)}</p>
      ${motifs.length ? `<ul class="adm-verif-motifs">${motifs.map((m) => `<li>${escapeHtml(m)}</li>`).join('')}</ul>` : ''}
      ${row.dossier_refus_commentaire ? `<p class="adm-help">« ${escapeHtml(row.dossier_refus_commentaire)} »</p>` : ''}
      <p class="adm-help">En attente d'un nouveau dépôt de la famille.</p>`
          : ''
      }
      ${
        dossier === 'a_verifier' && row.dossier_refused_at
          ? `<p class="adm-help">Déjà refusé le ${formatDateFr(row.dossier_refused_at, LONG_DATE)}${motifs.length ? ` (${escapeHtml(motifs.join(' ').toLowerCase())})` : ''} : vérifiez que c'est corrigé.</p>`
          : ''
      }
      <a href="${self}/apercu" class="adm-btn adm-btn-ghost adm-btn-block">${icon('eye')}Voir le dossier reçu</a>
      ${verificationForms}
    </div>`;

  // Paiement en plusieurs fois (_shared/payments.js) : le club enregistre chaque versement reçu ; tant que le total
  // n'atteint pas le montant dû, la fiche reste non payée et la famille est relancée pour le solde.
  const balance = paymentBalance(row);
  const dueCents = amountDueCents(row, prix);
  const passSportFix = payOk ? null : passSportNotDeducted(row, prix);
  const dueValue = dueCents ? String(dueCents / 100).replace('.', ',') : '';
  const today = todayParis();
  const versementForm = payOk
    ? ''
    : `<div class="adm-versement adm-pay-form" id="versement">
      <h3 class="adm-h3">${icon('check')}Enregistrer un versement</h3>
      ${messages.versementError ? flash('error', 'Montants ou date invalides : montant reçu et montant dû en euros (ex. 60 ou 60,50), date du paiement ni future ni de plus d’un an.') : ''}
      <form method="POST" action="${self}" class="adm-refuse-form" data-once>
        <input type="hidden" name="action" value="versement">
        <div class="form-row">
          <label class="adm-field" for="versement-montant">Montant reçu (€)
            <input type="text" class="adm-select" id="versement-montant" name="montant" inputmode="decimal" placeholder="Ex. 60" maxlength="10" required>
          </label>
          <label class="adm-field" for="versement-du">Total dû (€)
            <input type="text" class="adm-select" id="versement-du" name="du" inputmode="decimal" value="${escapeHtml(dueValue)}" maxlength="10" required>
          </label>
        </div>
        ${row.pass_sport_code ? `<p class="adm-help">Pass'Sport déclaré (${escapeHtml(row.pass_sport_code)}) : le total dû doit être le tarif moins 50 €. Ne le remettez au tarif plein que si le code n'est pas valable.</p>` : ''}
        <label class="adm-field" for="versement-date">Date du paiement
          <input type="date" class="adm-select" id="versement-date" name="datePaiement" value="${today}" max="${today}" required>
        </label>
        <label class="adm-field" for="versement-mode">Mode de paiement
          <select id="versement-mode" name="modePaiement" class="adm-select">
            ${['Carte bancaire', 'Espèces', 'Chèque', 'HelloAsso'].map((m) => `<option value="${m}"${m === (row.mode_paiement || 'Carte bancaire') ? ' selected' : ''}>${m === 'Carte bancaire' ? 'Carte bancaire (au club)' : m}</option>`).join('')}
          </select>
        </label>
        <p class="adm-help">${balance ? `Déjà réglé : ${formatEuros(balance.recu)}. Ce montant s'y ajoute.` : 'Pass\'Sport : le montant dû est déjà diminué de 50 € si un code a été déclaré ; corrigez-le si le code n\'est pas valable.'} Si le total atteint le montant dû, la fiche passe à « Payé ».</p>
        <label class="adm-check"><input type="checkbox" name="notifier" checked><span>Envoyer à la famille le reçu et le reste à payer (s'il en reste)</span></label>
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Enregistrer le versement</button>
      </form>
    </div>`;

  // Correction d'un versement saisi par erreur : remplace les deux totaux (pas d'ajout), sans e-mail à la famille.
  // Historique des versements (_shared/payments.js), du plus récent au plus ancien.
  const short = (v) => formatDateFr(v, { dateStyle: 'short', timeStyle: 'short' });
  const before = amountBeforeHistory(payments, balance);
  // Suppression d'un versement saisi par erreur (action versement-suppression) : seulement après la dernière correction.
  const deletable = deletableEntryIds(payments);
  const deleteForm = (p) =>
    deletable.has(p.id)
      ? `<form method="POST" action="${self}" class="admin-confirm-form adm-cheque-form">
          <input type="hidden" name="action" value="versement-suppression"><input type="hidden" name="entree" value="${p.id}">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="${escapeHtml(`Supprimer ce versement de ${formatEuros(p.amount_cents)} ? Le montant est retiré du total reçu${String(p.mode || '').startsWith('Chèques') ? ' et les chèques correspondants sont effacés' : ''}. Aucun e-mail n’est envoyé.`)}">${icon('trash')}Supprimer</button>
        </form>`
      : '';
  // Annulation de la correction la plus récente (action correction-suppression) : retour à l'état d'avant.
  const undo = stateBeforeCorrection(payments);
  const undoForm = (p) => {
    if (!undo || payments[0]?.id !== p.id) return '';
    const target = undo.recu
      ? `${formatEuros(undo.recu)} reçus sur ${formatEuros(undo.du)}${undo.paye ? ' (payé)' : ''}`
      : `aucun montant enregistré, fiche « ${undo.paye ? 'Payé' : 'Non payé'} »`;
    return `<form method="POST" action="${self}" class="admin-confirm-form adm-cheque-form">
          <input type="hidden" name="action" value="correction-suppression"><input type="hidden" name="entree" value="${p.id}">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="${escapeHtml(`Supprimer cette correction ? La fiche revient à l’état d’avant : ${target}. Aucun e-mail n’est envoyé.`)}">${icon('trash')}Supprimer</button>
        </form>`;
  };
  // Modification d'un versement (action versement-modification) : montant, date, mode. Mêmes versements que la
  // suppression ; un versement par chèques se supprime puis se ressaisit (ses chèques en dépendent).
  const editForm = (p) =>
    deletable.has(p.id) && !String(p.mode || '').startsWith('Chèques')
      ? `<details class="adm-pay-edit"${messages.modificationError && String(messages.modificationEntry) === String(p.id) ? ' open' : ''}>
          <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('edit')}Modifier</summary>
          <form method="POST" action="${self}" class="adm-refuse-form" data-once>
            <input type="hidden" name="action" value="versement-modification"><input type="hidden" name="entree" value="${p.id}">
            <div class="form-row">
              <label class="adm-field" for="modif-montant-${p.id}">Montant (€)
                <input type="text" class="adm-select" id="modif-montant-${p.id}" name="montant" inputmode="decimal" value="${escapeHtml(String(p.amount_cents / 100).replace('.', ','))}" maxlength="10" required>
              </label>
              <label class="adm-field" for="modif-date-${p.id}">Date du paiement
                <input type="date" class="adm-select" id="modif-date-${p.id}" name="datePaiement" value="${escapeHtml(p.paid_on || String(p.created_at).slice(0, 10))}" max="${today}" required>
              </label>
            </div>
            <label class="adm-field" for="modif-mode-${p.id}">Mode de paiement
              <select id="modif-mode-${p.id}" name="modePaiement" class="adm-select">
                ${['Carte bancaire', 'Espèces', 'Chèque', 'HelloAsso'].map((m) => `<option value="${m}"${m === p.mode ? ' selected' : ''}>${m === 'Carte bancaire' ? 'Carte bancaire (au club)' : m}</option>`).join('')}
              </select>
            </label>
            <p class="adm-help">Le total reçu et le statut du paiement sont recalculés. Aucun e-mail n’est envoyé.</p>
            <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Enregistrer</button>
          </form>
        </details>`
      : '';
  const historyItems = [
    ...payments.map((p) =>
      p.kind === 'versement'
        ? `<li><span>${p.paid_on ? `Payé le ${formatBirth(p.paid_on)}<br><small>saisi le ${short(p.created_at)}</small>` : short(p.created_at)}</span><span class="adm-line-value"><strong>+ ${formatEuros(p.amount_cents)}</strong>${p.mode ? ` <small>· ${escapeHtml(p.mode)}</small>` : ''}<br><small>total ${formatEuros(p.total_recu_cents)} sur ${formatEuros(p.total_du_cents)}</small></span>${deletable.has(p.id) ? `<div class="adm-pay-actions">${editForm(p)}${deleteForm(p)}</div>` : ''}</li>`
        : `<li><span>${short(p.created_at)}</span><span class="adm-line-value"><strong>Correction</strong><br><small>total ${formatEuros(p.total_recu_cents)} sur ${formatEuros(p.total_du_cents)}</small></span>${undoForm(p)}</li>`
    ),
    before ? `<li><span>Avant l’historique</span><span class="adm-line-value"><strong>${formatEuros(before)}</strong><br><small>versements saisis avant le 9 novembre 2026</small></span></li>` : '',
  ].join('');
  const history = historyItems
    ? `<details class="adm-fold adm-pay-history"${payments.length <= 3 ? ' open' : ''}>
      <summary>${icon('calendar')}Historique des versements <small>(${payments.length + (before ? 1 : 0)})</small></summary>
      <ol class="adm-pay-list">${historyItems}</ol>
      ${payments.some((p) => p.kind === 'versement' && !deletable.has(p.id)) ? '<p class="adm-help">Un versement antérieur à une correction ne se supprime pas : supprimez d’abord la correction, ou utilisez « Corriger montants ou date ».</p>' : ''}
    </details>`
    : '';

  // Paiement par chèques en plusieurs fois (_shared/payments.js) : 3 chèques au plus de juin à septembre, 2 ensuite.
  const maxCheques = maxChequesFor();
  const months = chequeMonths(maxCheques);
  const resteCents = balance ? balance.reste : dueCents || 0;
  const chequesForm = payOk
    ? ''
    : `<details class="adm-refuse adm-versement"${messages.chequesError ? ' open' : ''} id="cheques">
      <summary class="adm-btn adm-btn-ghost adm-btn-block">${icon('file')}Paiement par chèques</summary>
      ${messages.chequesError ? flash('error', messages.chequesError) : ''}
      <form method="POST" action="${self}" class="adm-refuse-form" data-once>
        <input type="hidden" name="action" value="cheques">
        <div class="form-row">
          <label class="adm-field" for="cheques-nombre">Nombre de chèques
            <select id="cheques-nombre" name="nombre" class="adm-select">
              ${Array.from({ length: maxCheques }, (_, i) => `<option value="${i + 1}"${i + 1 === maxCheques ? ' selected' : ''}>${i + 1} fois</option>`).join('')}
            </select>
          </label>
          <label class="adm-field" for="cheques-du">Total dû (€)
            <input type="text" class="adm-select" id="cheques-du" name="du" inputmode="decimal" value="${escapeHtml(dueValue)}" maxlength="10" required>
          </label>
        </div>
        ${months
          .map(
            (m, i) => `<div class="form-row">
          <label class="adm-field" for="cheque-montant-${i + 1}">Chèque ${i + 1} (€) <small>${monthLabel(m)}</small>
            <input type="text" class="adm-select" id="cheque-montant-${i + 1}" name="montant${i + 1}" inputmode="decimal" placeholder="Parts égales" maxlength="10">
          </label>
          <label class="adm-field" for="cheque-numero-${i + 1}">N° du chèque <small>facultatif</small>
            <input type="text" class="adm-select" id="cheque-numero-${i + 1}" name="numero${i + 1}" maxlength="30" autocomplete="off">
          </label>
        </div>`
          )
          .join('')}
        <p class="adm-help">${maxCheques === 3 ? 'Jusqu’à septembre inclus : 3 chèques au plus.' : 'À partir d’octobre : 2 chèques au plus.'} Montants vides : parts égales du reste à payer${resteCents ? ` (${formatEuros(resteCents)}${balance ? ', après les versements déjà reçus' : ''})` : ''}. Un chèque est encaissé chaque mois à partir de ce mois-ci. Les chèques remis règlent l’adhésion : la fiche passe à « Payé ».</p>
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Enregistrer les chèques</button>
      </form>
    </details>`;
  // Suivi INTERNE de l'encaissement : un bouton par chèque, aucun e-mail à la famille.
  const chequesList = cheques.length
    ? `<div class="adm-pay-history adm-cheques">
      <p class="adm-cheques-title">${icon('file')}Chèques remis <small>Suivi interne : la famille n’est pas prévenue</small></p>
      <ol class="adm-pay-list">${cheques
        .map(
          (c) => `<li><span>Chèque ${c.rang}/${cheques.length}<br><small>${formatEuros(c.montant_cents)}${c.numero ? ` · n° ${escapeHtml(c.numero)}` : ''}</small></span>
          <span class="adm-line-value">${
            c.encaisse_at ? `<span class="adm-tag is-yes">Encaissé le ${formatDateFr(c.encaisse_at, { dateStyle: 'short' })}</span>` : `<small>À encaisser en ${monthLabel(c.encaissement_prevu)}</small>`
          }
          <form method="POST" action="${self}" class="adm-cheque-form">
            <input type="hidden" name="action" value="cheque-encaisse"><input type="hidden" name="cheque" value="${c.id}">
            <button type="submit" class="adm-btn adm-btn-sm ${c.encaisse_at ? 'adm-btn-ghost' : 'adm-btn-primary'}">${c.encaisse_at ? 'Annuler' : `${icon('check')}Marquer encaissé`}</button>
          </form></span></li>`
        )
        .join('')}</ol>
    </div>`
    : '';

  // Exemption de paiement (2026-11-13) : décidée par le club, motif interne. Proposée seulement sans versement ni chèque
  // (sinon il faut d'abord les supprimer) ; réversible.
  const exemptionMessages = `${messages.exemptionOk ? flash('ok', 'Exemption enregistrée : aucun paiement n’est demandé à la famille.') : ''}${
    messages.exemptionRemoved ? flash('ok', 'Exemption retirée : le paiement est de nouveau demandé.') : ''
  }${messages.exemptionError ? flash('error', messages.exemptionError) : ''}`;
  const exemptionBlock = archived
    ? ''
    : exempt
      ? `<div class="adm-exempt" id="exemption">
      ${exemptionMessages}
      <p class="adm-exempt-title">${icon('check')}Exempté de paiement <small>Visible du club seulement</small></p>
      <p class="adm-help">${escapeHtml(exemptionLabel(row))}${row.paiement_exempte_at ? ` · depuis le ${formatDateFr(row.paiement_exempte_at, LONG_DATE)}` : ''}. La famille voit seulement « Aucun paiement à régler ».</p>
      <form method="POST" action="${self}" class="admin-confirm-form">
        <input type="hidden" name="action" value="exemption-retrait">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="${escapeHtml(`Retirer l’exemption de ${rawName} ? Le paiement de l’adhésion lui sera de nouveau demandé.`)}">${icon('refresh')}Retirer l’exemption</button>
      </form>
    </div>`
      : paidByEntries || cheques.length
        ? `${exemptionMessages}<p class="adm-help adm-exempt-note">Exemption de paiement : impossible tant qu’un versement ou un chèque est enregistré (supprimez-le d’abord).</p>`
        : `<details class="adm-refuse adm-versement" id="exemption"${messages.exemptionError ? ' open' : ''}>
      <summary class="adm-btn adm-btn-ghost adm-btn-block">${icon('award')}Exempter de paiement</summary>
      ${exemptionMessages}
      <form method="POST" action="${self}" class="adm-refuse-form" data-once>
        <input type="hidden" name="action" value="exemption">
        <fieldset class="adm-motifs"><legend>Motif <small>(visible du club seulement)</small></legend>
          ${Object.entries(EXEMPTION_MOTIFS)
            .map(([key, label], i) => `<label class="adm-check"><input type="radio" name="motif" value="${key}"${i === 0 ? ' checked' : ''} required><span>${escapeHtml(label)}</span></label>`)
            .join('')}
        </fieldset>
        <label class="adm-field" for="exemption-commentaire">Précision <small>obligatoire pour « Autre »</small>
          <input type="text" class="adm-select" id="exemption-commentaire" name="commentaire" maxlength="${EXEMPTION_COMMENT_MAX}" placeholder="Ex. : nom du dirigeant">
        </label>
        <p class="adm-help">La fiche passe à « Payé » sans montant : plus de relance pour le paiement, ni de paiement à encaisser. La famille voit « Aucun paiement à régler », jamais le motif. Aucun e-mail « paiement reçu » n’est envoyé.</p>
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Exempter de paiement</button>
      </form>
    </details>`;

  // Aussi sur une fiche marquée « Payé » sans montant saisi (« Marquer payé » cliqué alors que seule une partie a été
  // réglée, constaté le 2026-11-09) : on indique le montant réellement reçu et la fiche repasse en non payé.
  const correctionRecu = balance ? balance.recu : payOk ? dueCents || 0 : 0;
  const correctionDu = balance ? balance.du : dueCents || 0;
  const correctionForm = !(balance || payOk) || row.archived_at
    ? ''
    : `<details class="adm-refuse adm-versement"${messages.correctionError ? ' open' : ''} id="correction-versement">
      <summary class="adm-btn adm-btn-ghost adm-btn-block">${icon('edit')}${balance ? 'Corriger montants ou date' : 'Paiement incomplet ?'}</summary>
      ${messages.correctionError ? flash('error', 'Montants ou date invalides : total reçu en euros (0 accepté), total dû supérieur à 0, date ni future ni de plus d’un an.') : ''}
      <form method="POST" action="${self}" class="adm-refuse-form admin-confirm-form">
        <input type="hidden" name="action" value="versement-correction">
        <div class="form-row">
          <label class="adm-field" for="correction-recu">Total reçu (€)
            <input type="text" class="adm-select" id="correction-recu" name="recu" inputmode="decimal" value="${escapeHtml(String(correctionRecu / 100).replace('.', ','))}" maxlength="10" required>
          </label>
          <label class="adm-field" for="correction-du">Total dû (€)
            <input type="text" class="adm-select" id="correction-du" name="du" inputmode="decimal" value="${escapeHtml(String(correctionDu / 100).replace('.', ','))}" maxlength="10" required>
          </label>
        </div>
        <label class="adm-field" for="correction-date">Date du dernier paiement <small>départ du délai d’un mois avant le rappel</small>
          <input type="date" class="adm-select" id="correction-date" name="datePaiement" value="${row.dernier_versement_at ? escapeHtml(String(row.dernier_versement_at).slice(0, 10)) : today}" max="${today}" required>
        </label>
        <p class="adm-help">Remplace les montants et la date enregistrés (rien ne s'ajoute) : sert aussi à corriger une date saisie par erreur. Aucun e-mail n'est envoyé maintenant ; la fiche passe à « Payé » ou « Non payé » selon les nouveaux montants. S'il reste un solde, la famille reçoit un rappel dans un mois.</p>
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-block" data-confirm="Remplacer les montants enregistrés par ceux saisis ?">${icon('check')}Enregistrer la correction</button>
      </form>
    </details>`;

  // ---------- Fiche enfant unique (2026-11-10, maquette validée par l'utilisateur) ----------
  // Remplace la fiche inscription + la fiche adhérent : en-tête avec l'état de chaque étape (cliquable), bloc « À faire »,
  // onglets au lieu des sections dépliantes (Nielsen Norman Group : onglets pour quelques grosses sections), formulaires
  // visibles dans leur onglet, colonne Famille + note interne. Sans JavaScript, tous les onglets s'affichent l'un sous
  // l'autre (assets/js/admin-nav.js, data-tabs).
  const m = { ...row, inscription_id: row.id };
  const complete = isInscriptionComplete(row);
  const stage = complete ? licenceStage(m) : null;
  const birthOk = hasBirthPlace(row);
  const infosAsked = Boolean(Number(row.infos_famille_requises));
  const DOSSIER_STATE = { valide: 'Validé', a_verifier: 'À vérifier', refuse: 'Refusé', manquant: 'Manquant' };
  const steps = [
    { key: 'dossier', label: 'Dossier', state: DOSSIER_STATE[dossier], ok: dossier === 'valide', tab: dossier === 'a_verifier' ? `${self}/apercu` : '#tab-dossier',
      todo: { a_verifier: 'Dossier signé à vérifier', refuse: 'Dossier refusé : en attente d’un nouveau dépôt', manquant: 'Dossier signé pas encore reçu' }[dossier],
      cta: dossier === 'a_verifier' ? 'Vérifier' : 'Voir' },
    { key: 'photo', label: 'Photo', state: photoOk ? 'Reçue' : isPhotoToRedo(row) ? 'À refaire' : 'Manquante', ok: photoOk, tab: '#tab-dossier', todo: isPhotoToRedo(row) ? 'Nouvelle photo demandée à la famille' : 'Photo de l’enfant pas encore reçue', cta: 'Voir' },
    infosAsked && { key: 'infos', label: 'Infos famille', state: hasFamilyDetails(row) ? 'Complètes' : 'À compléter', ok: hasFamilyDetails(row), tab: '#tab-famille', todo: 'Adresse, mode de paiement et autorisations à donner par la famille', cta: 'Voir' },
    !birthOk && { key: 'naissance', label: 'Lieu de naissance', state: 'À compléter', ok: false, tab: '#tab-apercu', todo: 'Lieu de naissance à compléter', cta: 'Voir' },
    { key: 'paiement', label: 'Paiement', state: exempt ? 'Exempté' : payOk ? 'Payé' : balance && balance.reste ? `Reste ${formatEuros(balance.reste)}` : 'À payer', ok: payOk, tab: '#tab-paiement',
      todo: balance && balance.reste ? `Solde de ${formatEuros(balance.reste)} à encaisser` : 'Paiement de l’adhésion à recevoir', cta: payOk ? 'Voir' : 'Versement' },
    complete && { key: 'licence', label: 'Licence', state: LICENCE_STAGES[stage].label, ok: stage === 'validee', tab: '#tab-licence', todo: `Licence FFF : ${LICENCE_STAGES[stage].label.toLowerCase()}`, cta: 'Licence' },
  ].filter(Boolean);
  const todo = archived ? [] : steps.filter((st) => !st.ok && !(st.key === 'licence' && stage === 'attente_fff'));

  const stepChips = `<div class="adm-hero-steps" aria-label="Étapes de l'inscription">${steps
    .map((st) => `<a href="${st.tab}" class="adm-step-chip ${st.ok ? 'is-ok' : 'is-todo'}"><span>${escapeHtml(st.label)}</span><strong>${escapeHtml(st.state)}</strong></a>`)
    .join('')}</div>`;

  const todoSection = todo.length
    ? `<section class="adm-surface adm-todo-fiche" aria-labelledby="todo-fiche-titre">
    <h2 class="adm-h2" id="todo-fiche-titre"><span class="adm-todo-count" aria-hidden="true">${todo.length}</span>À faire pour ${escapeHtml(row.enfant_prenom)}</h2>
    <ul class="adm-todo-fiche-list">${todo
      .map((st) => `<li><span>${escapeHtml(st.todo)}</span><a href="${st.tab}" class="adm-btn adm-btn-sm adm-btn-primary">${escapeHtml(st.cta)}</a></li>`)
      .join('')}</ul>
  </section>`
    : '';

  // Champs de l'enfant prêts à copier (Footclubs), comme sur l'ancienne fiche adhérent.
  const copy = (value, what) =>
    value ? `<button type="button" class="adm-copy-btn" data-copy="${escapeHtml(value)}" aria-label="Copier ${what}" title="Copier">${icon('copy')}${icon('check')}</button>` : '';
  const fact = (label, value, what) => `<div><dt>${label}</dt><dd><span class="adm-person-coord">${value ? escapeHtml(value) : '<span class="adm-tag is-wait">À compléter</span>'}</span>${copy(value, what)}</dd></div>`;
  const birthFr = row.naissance ? row.naissance.split('-').reverse().join('/') : '';
  // Code postal de naissance manquant (pré-inscriptions transférées avant le 2026-11-10, anciennes fiches) : saisie
  // directe, ou « Trouver d'après la ville ». Enregistré seulement au clic du club, jamais deviné en silence.
  const bornInFrance = ['', 'france', 'fr'].includes(String(row.pays_naissance || '').trim().toLowerCase());
  const cpForm = !row.cp_naissance && bornInFrance && !archived
    ? `<form method="POST" action="${self}" class="adm-upload adm-licence" id="cp-naissance">
      <input type="hidden" name="action" value="cp-naissance">
      <label for="cp-naissance-rapide">Code postal de naissance<small>5 chiffres, pour la demande de licence.</small></label>
      <div class="adm-licence-row">
        <input type="text" id="cp-naissance-rapide" name="cpNaissance" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" required autocomplete="off">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button>
      </div>
      ${cpLookupButton('cp-naissance-rapide', row)}
    </form>`
    : '';
  const enfantSection = `<section class="adm-surface adm-fiche-enfant" id="licence-champs">
    <h2 class="adm-h2">${icon('user')}L'enfant</h2>
    <dl class="adm-kv adm-kv-copy">
      ${fact('Nom', row.enfant_nom, 'le nom')}
      ${fact('Prénom', row.enfant_prenom, 'le prénom')}
      ${fact('Naissance', birthFr, 'la date de naissance')}
      ${fact('Ville de naissance', row.ville_naissance, 'la ville de naissance')}
      ${fact('Code postal de naissance', row.cp_naissance, 'le code postal de naissance')}
    </dl>
    <dl class="adm-kv">
      ${kv('Pays de naissance', `<span class="adm-person-coord">${escapeHtml(row.pays_naissance || '—')}</span>`)}
      ${kv('Catégorie', escapeHtml(row.categorie))}
      ${kv('Taille de tenue', escapeHtml(row.taille_maillot || '—'))}
      ${kv('Saison', escapeHtml(row.saison || '—'))}
    </dl>
    ${cpForm}
  </section>`;

  const parcoursSection = `<section class="adm-surface adm-fiche-parcours">
    <h2 class="adm-h2">${icon('check')}Où en est l'inscription</h2>
    <ul class="adm-parcours-list">${steps
      .map(
        (st) => `<li><a href="${st.tab}" class="adm-parcours-item">
        <span class="adm-parcours-dot ${st.ok ? 'is-ok' : 'is-todo'}" aria-hidden="true">${st.ok ? icon('check') : '!'}</span>
        <span class="adm-parcours-text"><strong>${escapeHtml(st.label)}</strong><small>${escapeHtml(st.state)}</small></span>
        <span class="adm-parcours-chev" aria-hidden="true">›</span>
      </a></li>`
      )
      .join('')}</ul>
  </section>`;

  const paiementSection = `<section class="adm-surface adm-fiche-paiement" id="dossier">
    <h2 class="adm-h2">${icon('card')}Paiement de l'adhésion</h2>
    ${
      balance
        ? `<p class="adm-pay-total"><strong>${formatEuros(balance.recu)}</strong> sur ${formatEuros(balance.du)}${balance.reste ? ` · reste <strong>${formatEuros(balance.reste)}</strong>` : ' · payé'}</p>
    <div class="adm-pay-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${balance.du}" aria-valuenow="${balance.recu}" aria-label="Montant réglé"><span style="width:${Math.min(100, Math.round((balance.recu / balance.du) * 100))}%"></span></div>`
        : ''
    }
    <dl class="adm-kv">
      ${kv('Paiement', exempt ? `<span class="adm-tag is-yes">Exempté</span> <small>${escapeHtml(exemptionLabel(row))}</small>` : statusTag(payOk, PAIEMENT_TAG))}
      ${balance && row.dernier_versement_at ? kv('Dernier versement', formatDateFr(row.dernier_versement_at, LONG_DATE)) : ''}
      ${kv('Mode de paiement', escapeHtml(row.mode_paiement || '—'))}
      ${kv("Code Pass'Sport", row.pass_sport_code ? `${escapeHtml(row.pass_sport_code)} <small>· ${passSportFix === null ? '50 € déduits' : 'pas encore déduit'}</small>` : '—')}
      ${row.helloasso_order_id ? kv('Validé par HelloAsso', `commande n° ${escapeHtml(row.helloasso_order_id)}`) : ''}
      ${row.last_reminder_at ? kv('Dernière relance', `${formatDateFr(row.last_reminder_at, LONG_DATE)}${row.auto_reminders_sent ? ` (${row.auto_reminders_sent} auto.)` : ''}`) : ''}
    </dl>
    ${
      passSportFix !== null
        ? `<div class="adm-callout adm-callout-warn" id="passsport-deduire">
      <p><strong>Pass'Sport non déduit.</strong> Le montant dû enregistré est le tarif plein (${formatEuros(Number(row.montant_du_cents))}) alors que la famille a un code Pass'Sport : il devrait être de ${formatEuros(passSportFix)}.${
        balance && balance.recu >= passSportFix ? ' Le versement reçu couvre alors tout : la fiche passera à « Payé » et la famille sera prévenue.' : ''
      }</p>
      <form method="POST" action="${self}" data-once>
        <input type="hidden" name="action" value="passsport-deduire">
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-sm">${icon('check')}Déduire les 50 € du Pass'Sport</button>
      </form>
    </div>`
        : ''
    }
    ${versementForm}
    ${chequesList}
    ${history}
    <div class="adm-pay-more">${exempt ? '' : chequesForm}${exempt ? '' : correctionForm}</div>
    ${exemptionBlock}
    ${
      archived || exempt
        ? ''
        : paidByEntries
          ? `<p class="adm-pay-toggle adm-help">Statut calculé d'après les versements : pour le changer, modifiez ou supprimez un versement dans l'historique, ou corrigez les montants.</p>`
          : `<div class="adm-pay-toggle">${actionForm(
            { action: 'toggle-paye', id: row.id, redirectTo: self },
            payOk
              ? { label: 'Marquer non payé', iconName: 'card', className: 'adm-btn-ghost adm-btn-sm', confirm: `Marquer ${rawName} comme NON payé ?` }
              : { label: 'Marquer payé (sans montant)', iconName: 'check', className: 'adm-btn-ghost adm-btn-sm', confirm: `Confirmer que ${rawName} a payé ?` }
          )}</div>`
    }
  </section>`;

  const dossierDocSection = `<section class="adm-surface adm-fiche-dossier" id="dossier-signe">
    <h2 class="adm-h2">${icon('file')}Dossier signé</h2>
    <dl class="adm-kv">
      ${kv('Document', dossierTag(row))}
      ${docReceived ? kv('Reçu le', formatDateFr(row.dossier_uploaded_at, LONG_DATE)) : ''}
      ${dossier === 'valide' && row.dossier_verified_at ? kv('Vérifié le', formatDateFr(row.dossier_verified_at, LONG_DATE)) : ''}
    </dl>
    ${verification}
    <div class="adm-fiche-actions">${pdfBtn.replace('Télécharger le PDF', 'Dossier à signer (PDF)')}</div>
    <form method="POST" action="${self}/dossier" enctype="multipart/form-data" class="adm-upload">
      <input type="hidden" name="redirectTo" value="${self}">
      <label for="dossier-file">${docReceived ? 'Remplacer par un autre fichier' : 'Dossier signé reçu par e-mail ?'}<small>PDF, JPG ou PNG, 10 Mo maximum. Vérifiez signature et date : le dossier est validé dès l'enregistrement.</small></label>
      <input type="file" id="dossier-file" name="dossier" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" required>
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('upload')}${docReceived ? 'Remplacer le dossier' : 'Enregistrer le dossier'}</button>
    </form>
  </section>`;

  const photo = `<section class="adm-surface adm-fiche-photo" id="photo-enfant">
    <h2 class="adm-h2">${icon('camera')}Photo de l'enfant</h2>
    <div class="adm-photo">${
      photoOk
        ? `<a href="${self}/photo" target="_blank" rel="noopener"><img src="${self}/photo?v=${encodeURIComponent(row.photo_uploaded_at)}" alt="Photo de ${name}"></a>`
        : `<span class="adm-photo-empty">${icon('camera')}Pas encore de photo</span>`
    }</div>
    <dl class="adm-kv">
      ${kv('Photo', photoTag(row))}
      ${photoOk ? kv('Reçue le', formatDateFr(row.photo_uploaded_at, LONG_DATE)) : ''}
    </dl>
    ${photoRedoBlock(row, self, rawName)}
    <form method="POST" action="${self}/photo" enctype="multipart/form-data" class="adm-upload">
      <label for="photo-file">${photoOk ? 'Remplacer par une autre photo' : 'Photo reçue par e-mail ?'}<small>JPG, PNG ou WebP, 10 Mo maximum — de face, sur fond blanc.</small></label>
      <input type="file" id="photo-file" name="photo" accept="image/jpeg,image/png,image/webp" required>
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('upload')}${photoOk ? 'Remplacer la photo' : 'Enregistrer la photo'}</button>
    </form>
  </section>`;


  const licenceNumero = `<section class="adm-surface adm-fiche-licence" id="licence">
    <h2 class="adm-h2">${icon('award')}N° de licence FFF</h2>
    <form method="POST" action="${self}" class="adm-upload adm-licence">
      <input type="hidden" name="action" value="licence">
      <label for="numero-licence-rapide">${row.numero_licence ? 'Modifier le n° de licence' : 'N° de licence'}<small>À saisir une fois la licence enregistrée sur Footclubs.</small></label>
      <div class="adm-licence-row">
        <input type="text" id="numero-licence-rapide" name="numeroLicence" value="${escapeHtml(row.numero_licence || '')}" maxlength="40" inputmode="numeric" autocomplete="off">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button>
      </div>
    </form>
  </section>`;

  const familleSection = `<section class="adm-surface adm-fiche-famille-infos">
    <h2 class="adm-h2">${icon('home')}Coordonnées et autorisations</h2>
    <dl class="adm-kv">
      ${kv('Adresse', adresse)}
      ${kv('Autorisation de participation', yesNo(row.autorisation))}
      ${kv("Droit à l'image", yesNo(row.droit_image))}
      ${kv('Consentement RGPD', yesNo(row.rgpd))}
      ${familyLinksRow(row, familyLinks, messages)}
    </dl>
    <div class="adm-fiche-actions">${editBtn}${pdfBtn}</div>
  </section>`;

  const seasonsSection = seasons.length > 1 || contactId
    ? `<section class="adm-surface adm-fiche-saisons">
    <h2 class="adm-h2">${icon('calendar')}Saisons au club</h2>
    <ul class="adm-pay-list">${seasons
      .map((sn) => `<li><span>${escapeHtml(sn.period_name || sn.saison || '')}</span><span class="adm-line-value">${sn.inscription_id === row.id ? '<strong>Cette fiche</strong>' : sn.inscription_id ? `<a class="adm-link" href="/admin/inscriptions/${sn.inscription_id}">Ouvrir la fiche</a>` : '—'}</span></li>`)
      .join('')}</ul>
    ${contactId ? `<p class="adm-help"><a class="adm-link" href="/admin/contacts/${contactId}">Fiche contact (CRM)</a></p>` : ''}
  </section>`
    : '';

  const famille = `<aside class="adm-fiche-side" aria-label="Famille">
    ${parent}
    ${archived ? '' : noteSection(m, contactId, messages, null)}
  </aside>`;

  const TABS = [
    ['apercu', 'Aperçu'],
    ['paiement', payOk ? 'Paiement' : balance && balance.reste ? `Paiement · ${formatEuros(balance.reste)}` : 'Paiement'],
    ['dossier', 'Dossier & photo'],
    ['licence', 'Licence & tenue'],
    ['famille', 'Famille'],
    ['historique', 'Activité'],
  ];
  const tabNav = `<nav class="adm-fiche-tabs" aria-label="Sections de la fiche" data-tabs>${TABS.map(
    ([id, label], i) => `<a href="#tab-${id}" class="adm-fiche-tab" data-tab="tab-${id}"${i === 0 ? ' aria-current="true"' : ''}>${escapeHtml(label)}</a>`
  ).join('')}</nav>`;
  const panel = (id, label, body) => `<div class="adm-tabpanel" id="tab-${id}" data-tabpanel aria-label="${escapeHtml(label)}"><h2 class="adm-tabpanel-title">${escapeHtml(label)}</h2>${body}</div>`;

  const primary = archived
    ? actionForm({ action: 'restore', id: row.id, redirectTo: self }, { label: 'Restaurer', iconName: 'refresh', className: 'adm-btn-primary' })
    : dossier === 'a_verifier'
      ? `<a href="${self}/apercu" class="adm-btn adm-btn-gold">${icon('eye')}Vérifier le dossier</a>`
      : !payOk
        ? `<a href="#versement" class="adm-btn adm-btn-gold">${icon('plus')}Enregistrer un versement</a>`
        : '';
  const moreMenu = `<details class="adm-more-actions" id="relancer" data-dismiss>
      <summary class="adm-btn adm-btn-white" aria-label="Plus d'actions">${icon('more')}<span>Plus</span></summary>
      <div class="adm-more-actions-menu">
        ${editBtn}${pdfBtn}${mailsBtn}
        ${
          !archived && familyHasActionPending(row)
            ? actionForm({ action: 'bulk-reminder', ids: row.id, redirectTo: self }, { label: 'Relancer la famille', iconName: 'send', className: 'adm-btn-ghost', confirm: `Envoyer une relance par e-mail à ${row.email} (dossier, photo ou paiement manquant) ?` })
            : ''
        }
        ${
          archived
            ? actionForm(
                { action: 'delete', id: row.id, view: 'archive' },
                { label: 'Supprimer définitivement', iconName: 'trash', className: 'adm-btn-danger-solid', confirm: `Supprimer définitivement ${rawName} ? Cette action est irréversible, contrairement à l'archivage.` }
              )
            : `<details class="adm-refuse adm-archive">
          <summary class="adm-btn adm-btn-danger">${icon('archive')}Archiver</summary>
          <form method="POST" action="/admin/inscriptions" class="adm-refuse-form adm-archive-form admin-confirm-form">
            <input type="hidden" name="action" value="archive">
            <input type="hidden" name="id" value="${row.id}">
            <input type="hidden" name="redirectTo" value="${escapeHtml(self)}">
            ${archiveReasonFields('fiche')}
            <button type="submit" class="adm-btn adm-btn-danger-solid adm-btn-block" data-confirm="${escapeHtml(`Mettre ${rawName} à la corbeille ? Le profil reste récupérable à tout moment.`)}">${icon('archive')}Mettre à la corbeille</button>
          </form>
        </details>`
        }
      </div>
    </details>`;
  const heroActions = `${primary}<a href="/admin/email?inscription=${row.id}" class="adm-btn adm-btn-white">${icon('mail')}E-mail</a>${moreMenu}`;

  const flashes = [
    messages.savedOk && flash('ok', 'Fiche mise à jour.'),
    messages.licenceOk && flash('ok', 'N° de licence enregistré.'),
    messages.cpOk && flash('ok', 'Code postal de naissance enregistré.'),
    messages.cpError && flash('error', 'Code postal de naissance invalide : 5 chiffres.'),
    messages.correctionOk && flash('ok', 'Montants corrigés.'),
    messages.suppressionOk && flash('ok', 'Versement supprimé : total reçu et statut du paiement mis à jour.'),
    messages.annulationOk && flash('ok', 'Correction supprimée : la fiche est revenue à l’état d’avant.'),
    messages.conflit && flash('error', 'Rien n’a été enregistré : le paiement de cette fiche a changé entre-temps (autre onglet ou autre responsable). Vérifiez les montants ci-dessous puis recommencez si besoin.'),
    messages.modificationOk && flash('ok', 'Versement modifié : total reçu et statut du paiement mis à jour.'),
    messages.modificationError && flash('error', 'Modification impossible : montant en euros (ex. 60), date ni future ni de plus d’un an, versement postérieur à la dernière correction.'),
    messages.suppressionError && flash('error', messages.suppressionError),
    messages.chequesOk && flash('ok', 'Chèques enregistrés : la fiche est payée. Cochez chaque chèque quand il est encaissé (la famille n’est pas prévenue).'),
    messages.versementOk === 'paye' && flash('ok', 'Versement enregistré : le montant dû est atteint, la fiche est payée.'),
    messages.versementOk === 'partiel' && flash('ok', 'Versement enregistré. Le reste à payer est indiqué ci-dessous ; la famille sera relancée pour le solde.'),
    messages.licenceError && flash('error', 'N° de licence invalide : chiffres et lettres uniquement (40 caractères au plus).'),
    messages.dossierOk && flash('ok', 'Dossier enregistré.'),
    messages.dossierError && flash('error', messages.dossierError),
    messages.verifOk && flash(...verifMessage(messages.verifOk)),
    messages.fin && flash('info', 'Plus aucun dossier à vérifier pour le moment.'),
    messages.verifError && flash('error', messages.verifError),
    messages.transfertError && flash('error', messages.transfertError),
    messages.photoOk && flash('ok', 'Photo enregistrée.'),
    messages.photoError && flash('error', messages.photoError),
    messages.photoRefus &&
      flash(
        messages.photoRefus === 'mail-echec' ? 'error' : 'ok',
        {
          mail: 'Nouvelle photo demandée : la famille a reçu un e-mail avec les consignes et le lien pour l’envoyer.',
          sans: 'Nouvelle photo demandée (famille non prévenue).',
          'mail-echec': "Nouvelle photo demandée, mais l'e-mail à la famille n'a pas pu partir : prévenez-la directement.",
        }[messages.photoRefus] || 'Photo mise à jour.'
      ),
    messages.bulkOk && flash('ok', messages.bulkOk),
    messages.bulkError && flash('error', messages.bulkError),
  ]
    .filter(Boolean)
    .join('');


  return `${adminHead(rawName)}
${adminShell({
  active: archived ? 'archive' : complete ? 'adherents' : 'inscriptions',
  badges,
  back: archived ? { href: '/admin/inscriptions?view=archive', label: 'Corbeille' } : complete ? { href: '/admin/adherents', label: 'Adhérents' } : { href: '/admin/inscriptions', label: 'Inscriptions' },
  lead: avatar(row, 'lg'),
  eyebrow: complete ? 'Adhérent' : 'Inscription',
  title: name,
  subtitle: `${ageAndCategory(ageGroup(row.naissance, ageCtx), row.categorie)} · né(e) le ${formatBirth(row.naissance)} · saison ${escapeHtml(row.saison || saison || '')}${archived ? ` · archivée le ${formatDateFr(row.archived_at, LONG_DATE)}${archiveReason(row) ? ` (${escapeHtml(archiveReason(row))})` : ''}` : ''}`,
  meta: stepChips,
  actions: heroActions,
})}
<main id="adm-main" class="adm-wrap adm-main adm-fiche-unique">
  ${flashes ? `<div class="adm-surface adm-fiche-flashes">${flashes}</div>` : ''}
  ${todoSection}
  ${transferBlock(row, preinscription, rawName, preinscriptionListed)}
  ${fromPreinscriptionBlock(row, fromPreinscription)}
  <div class="adm-fiche-layout">
    <div class="adm-fiche-main">
      ${tabNav}
      ${panel('apercu', 'Aperçu', `<div class="adm-fiche-cols">${enfantSection}${parcoursSection}</div>`)}
      ${panel('paiement', 'Paiement', paiementSection)}
      ${panel('dossier', 'Dossier & photo', `<div class="adm-fiche-cols">${dossierDocSection}${photo}</div>`)}
      ${panel('licence', 'Licence & tenue', `${licenceNumero}${followupSection(m, contactId, messages, null)}`)}
      ${panel('famille', 'Famille', familleSection)}
      ${panel('historique', 'Activité', `${activitySection(buildActivity(row, { payments, emails: emails || [] }))}${emailsSection(emails, m, { open: true })}${seasonsSection}`)}
    </div>
    ${famille}
  </div>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js" integrity="sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
${adminScripts('pdf-inscription', 'admin-nav', 'admin-inscriptions', 'naissance-autocomplete')}
</body></html>`;
}

// Personne du CRM liée à cette inscription (adhésion) et ses saisons au club ; vide si le CRM n'est pas encore
// synchronisé pour cette fiche. Organisation de la session uniquement.
async function personContext(db, organizationId, inscriptionId) {
  try {
    const link = await db.prepare('SELECT contact_id FROM memberships WHERE organization_id = ? AND legacy_inscription_id = ?').bind(organizationId, inscriptionId).first();
    if (!link) return { contactId: null, seasons: [] };
    const profile = await getContactProfile(db, organizationId, link.contact_id);
    return { contactId: link.contact_id, seasons: profile?.memberships || [] };
  } catch {
    return { contactId: null, seasons: [] };
  }
}

// Retour sur la fiche adhérent après « Modifier » ouvert depuis celle-ci (2026-10-16), chemin strictement contrôlé.
// Note interne : 2 000 caractères au plus.
const NOTE_MAX = 2000;
const adherentRetour = (value) => (/^\/admin\/adherents\/\d+$/.test(String(value || '')) ? String(value) : null);

function editPage(row, categories, { error, badges, retour = null } = {}) {
  const checked = (v) => (v ? 'checked' : '');
  const selected = (value, option) => (value === option ? 'selected' : '');
  const name = `${escapeHtml(row.enfant_prenom)} ${escapeHtml(row.enfant_nom)}`;

  // La catégorie de la fiche peut avoir été renommée/supprimée depuis /admin/categories : on
  // l'ajoute à la liste si elle n'y figure plus, pour ne jamais faire disparaître silencieusement la
  // valeur enregistrée du formulaire (voir aussi le filtre "catégorie" de /admin/inscriptions, qui
  // dérive sa propre liste des données plutôt que de cette config éditable).
  const categoryOptions = categories.some((c) => c.label === row.categorie) ? categories : [...categories, { label: row.categorie }];

  return `${adminHead(`Modifier — ${row.enfant_prenom} ${row.enfant_nom}`)}
${adminShell({
  active: row.archived_at ? 'archive' : 'inscriptions',
  badges,
  back: retour ? { href: retour, label: 'Retour à la fiche adhérent' } : { href: `/admin/inscriptions/${row.id}`, label: 'Retour à la fiche' },
  lead: avatar(row, 'lg'),
  eyebrow: 'Modifier la fiche',
  title: name,
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${error ? flash('error', error) : ''}
  <form method="POST" class="adm-surface">
    ${retour ? `<input type="hidden" name="retour" value="${escapeHtml(retour)}">` : ''}
    <section class="adm-form-section">
      <h2 class="adm-h2">${icon('user')}Enfant</h2>
      <div class="form-row">
        <div class="form-field">
          <label for="enfant-prenom">Prénom de l'enfant</label>
          <input type="text" id="enfant-prenom" name="enfantPrenom" value="${escapeHtml(row.enfant_prenom)}" required>
        </div>
        <div class="form-field">
          <label for="enfant-nom">Nom de l'enfant</label>
          <input type="text" id="enfant-nom" name="enfantNom" value="${escapeHtml(row.enfant_nom)}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="naissance">Date de naissance</label>
          <input type="date" id="naissance" name="naissance" value="${escapeHtml(row.naissance)}" required>
        </div>
        <div class="form-field">
          <label for="categorie">Catégorie</label>
          <select id="categorie" name="categorie" required>
            ${categoryOptions
              .map((c) => {
                const annees = c.anneeMin == null ? '' : c.anneeMin === c.anneeMax ? ` (${c.anneeMin})` : ` (${c.anneeMin}-${c.anneeMax})`;
                return `<option value="${escapeHtml(c.label)}" ${selected(row.categorie, c.label)}>${escapeHtml(c.label)}${annees}</option>`;
              })
              .join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="pays-naissance">Pays de naissance</label>
          <input type="text" id="pays-naissance" name="paysNaissance" value="${escapeHtml(row.pays_naissance || '')}" maxlength="200">
        </div>
        <div class="form-field">
          <label for="cp-naissance">Code postal de naissance</label>
          <input type="text" id="cp-naissance" name="cpNaissance" value="${escapeHtml(row.cp_naissance || '')}" inputmode="numeric" maxlength="5">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="ville-naissance">Ville de naissance</label>
          <input type="text" id="ville-naissance" name="villeNaissance" value="${escapeHtml(row.ville_naissance || '')}" maxlength="200">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="numero-licence">N° de licence FFF</label>
          <input type="text" id="numero-licence" name="numeroLicence" value="${escapeHtml(row.numero_licence || '')}" maxlength="40" inputmode="numeric" autocomplete="off">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="taille-maillot">Taille de maillot</label>
          <select id="taille-maillot" name="tailleMaillot" required>
            ${['4 ans', '6 ans', '8 ans', '10 ans', '12 ans'].map((t) => `<option value="${t}" ${selected(row.taille_maillot, t)}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="mode-paiement">Mode de paiement</label>
          <select id="mode-paiement" name="modePaiement" required>
            ${['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque'].map((m) => `<option value="${m}" ${selected(row.mode_paiement, m)}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="pass-sport-code">Code Pass'Sport</label>
          <input type="text" id="pass-sport-code" name="passSportCode" value="${escapeHtml(row.pass_sport_code || '')}" maxlength="40">
        </div>
        <div class="form-field">
          <label for="paye">Paiement reçu</label>
${
            Number(row.montant_recu_cents) > 0
              ? `<p id="paye" class="adm-help">${row.paye ? 'Payé' : 'Non payé'} : calculé d'après les versements (fiche, onglet Paiement).</p>`
              : `<select id="paye" name="paye">
            <option value="0" ${row.paye ? '' : 'selected'}>Non payé</option>
            <option value="1" ${row.paye ? 'selected' : ''}>Payé</option>
          </select>`
          }
        </div>
      </div>
    </section>

    <section class="adm-form-section">
      <h2 class="adm-h2">${icon('phone')}Responsable légal</h2>
      <div class="form-row">
        <div class="form-field">
          <label for="parent-prenom">Prénom du parent</label>
          <input type="text" id="parent-prenom" name="parentPrenom" value="${escapeHtml(row.parent_prenom)}" required>
        </div>
        <div class="form-field">
          <label for="parent-nom">Nom du parent</label>
          <input type="text" id="parent-nom" name="parentNom" value="${escapeHtml(row.parent_nom)}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="email">E-mail (parent)</label>
          <input type="email" id="email" name="email" value="${escapeHtml(row.email)}" required>
        </div>
        <div class="form-field">
          <label for="telephone">Téléphone (parent)</label>
          <input type="tel" id="telephone" name="telephone" value="${escapeHtml(row.telephone || '')}" required>
        </div>
      </div>
      <div class="form-field">
        <label for="adresse">Adresse</label>
        <input type="text" id="adresse" name="adresse" value="${escapeHtml(row.adresse || '')}">
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="code-postal">Code postal</label>
          <input type="text" id="code-postal" name="codePostal" value="${escapeHtml(row.code_postal || '')}">
        </div>
        <div class="form-field">
          <label for="ville">Ville</label>
          <input type="text" id="ville" name="ville" value="${escapeHtml(row.ville || '')}">
        </div>
      </div>
    </section>

    <section class="adm-form-section">
      <h2 class="adm-h2">${icon('users')}Second responsable légal <span class="adm-count">facultatif</span></h2>
      <div class="form-row">
        <div class="form-field">
          <label for="parent2-prenom">Prénom</label>
          <input type="text" id="parent2-prenom" name="parent2Prenom" value="${escapeHtml(row.parent2_prenom || '')}">
        </div>
        <div class="form-field">
          <label for="parent2-nom">Nom</label>
          <input type="text" id="parent2-nom" name="parent2Nom" value="${escapeHtml(row.parent2_nom || '')}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="parent2-email">E-mail</label>
          <input type="email" id="parent2-email" name="parent2Email" value="${escapeHtml(row.parent2_email || '')}">
        </div>
        <div class="form-field">
          <label for="parent2-telephone">Téléphone</label>
          <input type="tel" id="parent2-telephone" name="parent2Telephone" value="${escapeHtml(row.parent2_telephone || '')}">
        </div>
      </div>
    </section>

    <section class="adm-form-section">
      <h2 class="adm-h2">${icon('check')}Autorisations</h2>
      <label class="adm-check"><input type="checkbox" name="autorisation" ${checked(row.autorisation)}><span>Autorisation de participation</span></label>
      <label class="adm-check"><input type="checkbox" name="droitImage" ${checked(row.droit_image)}><span>Droit à l'image</span></label>
      <label class="adm-check"><input type="checkbox" name="rgpd" ${checked(row.rgpd)}><span>Consentement RGPD</span></label>
    </section>

    <div class="adm-form-actions adm-form-actions-wide" style="margin-top:20px;">
      <button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button>
      <a href="${retour ? escapeHtml(retour) : `/admin/inscriptions/${row.id}`}" class="adm-btn adm-btn-ghost">Annuler</a>
    </div>
  </form>
</main>
${adminScripts('admin-nav', 'pass-sport')}
</body></html>`;
}

export async function onRequestGet({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return html(loginPage());
  }

  await ensureInscriptionsTable(env.DB);
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, Number(params.id)).first();
  if (!row) {
    return new Response('Inscription introuvable.', { status: 404 });
  }

  const url = new URL(request.url);
  const { categories, saison, prix } = await getCategoriesConfig(env, admin.organizationId);
  if (url.searchParams.get('edit') === '1') {
    return html(editPage(row, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(url.searchParams.get('retour')) }));
  }
  // Pré-inscription du même enfant (doublon à retirer des inscriptions, voir transferBlock).
  // Plusieurs groupes (2026-11-04) : celui où l'enfant est déjà pré-inscrit, sinon celui de son année de naissance.
  const groups = await getPreinscriptionGroups(env, admin.organizationId).catch(() => []);
  let preinscription = groupForYear(groups, Number(String(row.naissance || '').slice(0, 4)));
  let preinscriptionListed = false;
  let fromPreinscription = null;
  if (groups.length && !row.archived_at) {
    await ensurePreinscriptionsTable(env.DB);
    const listed = await findPreinscriptionForChild(env.DB, admin.organizationId, null, { enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance });
    if (listed && Number(listed.inscription_id) === row.id) {
      // Transférée en inscription par le club : ni doublon ni transfert à proposer.
      fromPreinscription = groups.find((g) => g.groupe === listed.groupe) || { groupe: listed.groupe, label: listed.groupe };
      preinscription = null;
    } else if (listed) {
      preinscriptionListed = true;
      preinscription = groups.find((g) => g.groupe === listed.groupe) || preinscription;
    }
  }
  const ageCtx = ageRangesContext(saison, categories, groups);
  return html(
    fichePage(row, {
      saison,
      ageCtx,
      prix,
      siteUrl: url.origin,
      messages: {
        savedOk: url.searchParams.get('savedOk'),
        licenceError: url.searchParams.get('licenceError'),
        dossierOk: url.searchParams.get('dossierOk'),
        dossierError: url.searchParams.get('dossierError'),
        bulkOk: url.searchParams.get('bulkOk'),
        bulkError: url.searchParams.get('bulkError'),
        photoOk: url.searchParams.get('photoOk'),
        photoRefus: url.searchParams.get('photoRefus'),
        photoError: url.searchParams.get('photoError'),
        verifOk: url.searchParams.get('verifOk'),
        verifError: url.searchParams.get('verifError'),
        fin: url.searchParams.get('fin') === '1',
        transfertError: url.searchParams.get('transfertError'),
        linkSent: url.searchParams.has('linkSent'),
        linkError: url.searchParams.has('linkError'),
        linksRevoked: url.searchParams.has('linksRevoked'),
        versementOk: url.searchParams.get('versementOk'),
        versementError: url.searchParams.has('versementError'),
        exemptionOk: url.searchParams.has('exemptionOk'),
        exemptionRemoved: url.searchParams.has('exemptionRemoved'),
        exemptionError: url.searchParams.get('exemptionError'),
        correctionOk: url.searchParams.has('correctionOk'),
        suppressionOk: url.searchParams.has('suppressionOk'),
        annulationOk: url.searchParams.has('annulationOk'),
        modificationOk: url.searchParams.has('modificationOk'),
        conflit: url.searchParams.has('conflit'),
        modificationError: url.searchParams.has('modificationError'),
        modificationEntry: url.searchParams.get('entree'),
        suppressionError: url.searchParams.get('suppressionError'),
        chequesOk: url.searchParams.has('chequesOk'),
        chequesError: url.searchParams.get('chequesError'),
        correctionError: url.searchParams.has('correctionError'),
        licenceOk: url.searchParams.has('licenceOk'),
        cpOk: url.searchParams.has('cpOk'),
        cpError: url.searchParams.has('cpError'),
        suiviOk: url.searchParams.has('suiviOk'),
        relanceOk: url.searchParams.has('relanceOk'),
        noteOk: url.searchParams.has('noteOk'),
        noteError: url.searchParams.has('noteError'),
      },
      preinscription,
      preinscriptionListed,
      fromPreinscription,
      familyLinks: await activeFamilyLinks(env.DB, admin.organizationId, row.id).catch(() => null),
      payments: await listPaymentEntries(env.DB, admin.organizationId, row.id).catch(() => []),
      cheques: await listCheques(env.DB, admin.organizationId, row.id).catch(() => []),
      // Ancienne fiche adhérent (2026-11-10, fiche enfant unique) : e-mails envoyés, saisons de la même personne.
      emails: await listEmailsForInscriptions(env.DB, admin.organizationId, [row.id]).catch(() => null),
      ...(await personContext(env.DB, admin.organizationId, row.id)),
      badges: await adminBadges(env, admin),
    })
  );
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return html(loginPage(), 401);
  }

  await ensureInscriptionsTable(env.DB);
  const id = Number(params.id);
  const existing = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first();
  if (!existing) {
    return new Response('Inscription introuvable.', { status: 404 });
  }

  const form = await request.formData();
  const data = Object.fromEntries(form.entries());

  // Saisie rapide du numéro de licence depuis la fiche : seul ce champ change.
  // Suivi licence et tenue (fiche adhérent, _shared/club-followup.js) : seules les étapes et pièces changent.
  if (data.action === 'suivi-club') {
    await followupUpdate(env.DB, admin.organizationId, id, data).run();
    const retour = adherentRetour(data.retour);
    return new Response('', { status: 302, headers: { Location: retour ? `${retour}?suiviOk=1#suivi-club` : `/admin/inscriptions/${id}?suiviOk=1#suivi-club` } });
  }
  // Relance licence faite hors du site (appel, SMS…) : seule la date de dernière relance change.
  if (data.action === 'licence-relance') {
    await licenceRelanceUpdate(env.DB, admin.organizationId, id).run();
    const retour = adherentRetour(data.retour);
    return new Response('', { status: 302, headers: { Location: retour ? `${retour}?relanceOk=1#suivi-club` : `/admin/inscriptions/${id}?relanceOk=1#suivi-club` } });
  }

  if (data.action === 'family-link-send') {
    const ok = await sendFamilyLinkEmail(env, existing, new URL(request.url).origin, 'manuel');
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?${ok ? 'linkSent' : 'linkError'}=1#dossier` } });
  }
  if (data.action === 'family-link-revoke') {
    await revokeFamilyLinks(env.DB, admin.organizationId, id);
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?linksRevoked=1#dossier` } });
  }

  // Code postal de naissance saisi depuis la fiche (2026-11-10) : seul ce champ change.
  if (data.action === 'cp-naissance') {
    const cp = String(data.cpNaissance ?? '').trim();
    if (!/^\d{5}$/.test(cp)) return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?cpError=1#cp-naissance` } });
    await env.DB.prepare('UPDATE inscriptions SET cp_naissance = ? WHERE organization_id = ? AND id = ?').bind(cp, admin.organizationId, id).run();
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?cpOk=1#licence-champs` } });
  }

  if (data.action === 'licence') {
    const numero = String(data.numeroLicence ?? '').trim();
    // Depuis la fiche adhérent (2026-10-14) : retour sur cette fiche, chemin strictement contrôlé.
    const retour = adherentRetour(data.retour);
    if (numero && !LICENCE_RE.test(numero)) {
      return new Response('', { status: 302, headers: { Location: retour ? `${retour}?licenceError=1#licence` : `/admin/inscriptions/${id}?licenceError=1#licence` } });
    }
    await env.DB.prepare('UPDATE inscriptions SET numero_licence = ? WHERE organization_id = ? AND id = ?').bind(numero || null, admin.organizationId, id).run();
    return new Response('', { status: 302, headers: { Location: retour ? `${retour}?licenceOk=1` : `/admin/inscriptions/${id}?licenceOk=1#licence` } });
  }

  // Écritures de paiement : chacune vérifie que la fiche n'a pas changé depuis sa lecture (total reçu et statut payé
  // identiques), sinon rien n'est écrit (deux responsables ou deux onglets au même moment : un montant aurait été
  // écrasé dans le total alors que l'historique gardait les deux lignes). Les instructions suivantes du même lot ne
  // s'appliquent que si la fiche a été modifiée (changes() = 1).
  const recuAvant = Number(existing.montant_recu_cents) || 0;
  const payeAvant = Number(existing.paye) ? 1 : 0;
  const unchanged = 'COALESCE(montant_recu_cents, 0) = ? AND paye = ?';
  const conflict = () => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?conflit=1#dossier` } });

  // Exemption de paiement (2026-11-13) : seulement sans versement ni chèque, et si le paiement n'a pas changé depuis la
  // lecture. Aucun e-mail d'étape (« Dossier complet » peut partir si c'était la dernière étape).
  if (data.action === 'exemption' || data.action === 'exemption-retrait') {
    const back = (q) => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?${q}#exemption` } });
    if (existing.archived_at) return back(`exemptionError=${encodeURIComponent('Fiche à la corbeille : restaurez-la d’abord.')}`);
    if (data.action === 'exemption-retrait') {
      const res = await env.DB.prepare(
        'UPDATE inscriptions SET paye = 0, paiement_exempte = NULL, paiement_exempte_commentaire = NULL, paiement_exempte_at = NULL, complete_notified_at = NULL WHERE organization_id = ? AND id = ? AND paiement_exempte IS NOT NULL AND COALESCE(montant_recu_cents, 0) = 0'
      ).bind(admin.organizationId, id).run();
      if (!res.meta?.changes) return conflict();
      waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
      return back('exemptionRemoved=1');
    }
    const exemption = readExemption(data);
    if (!exemption) return back(`exemptionError=${encodeURIComponent('Choisissez un motif (une précision est demandée pour « Autre », 200 caractères au plus).')}`);
    await ensureChequesTable(env.DB);
    const chequeCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM cheques WHERE organization_id = ? AND inscription_id = ?').bind(admin.organizationId, id).first();
    if (recuAvant > 0 || Number(chequeCount?.n) > 0) return back(`exemptionError=${encodeURIComponent('Un versement ou un chèque est enregistré : supprimez-le d’abord.')}`);
    const res = await env.DB.prepare(
      `UPDATE inscriptions SET paye = 1, paiement_exempte = ?, paiement_exempte_commentaire = ?, paiement_exempte_at = datetime('now'), montant_du_cents = NULL WHERE organization_id = ? AND id = ? AND ${unchanged}`
    ).bind(exemption.motif, exemption.commentaire, admin.organizationId, id, recuAvant, payeAvant).run();
    if (!res.meta?.changes) return conflict();
    waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'exemption', source: 'admin', siteUrl: new URL(request.url).origin }));
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return back('exemptionOk=1');
  }

  // Versement reçu par le club (paiement en plusieurs fois, _shared/payments.js) : ajoute le montant au total reçu,
  // fixe le montant dû, et passe la fiche à « payé » quand le total l'atteint. Seuls les champs de paiement changent.
  if (data.action === 'versement') {
    const montant = parseEuros(data.montant);
    const du = parseEuros(data.du);
    const mode = ['Carte bancaire', 'Espèces', 'Chèque', 'HelloAsso'].includes(data.modePaiement) ? data.modePaiement : existing.mode_paiement;
    const paidOn = parsePaymentDate(data.datePaiement);
    if (!montant || !du || !paidOn) return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?versementError=1#versement` } });
    if (existing.paye) return conflict();
    const paidAt = paymentDateTime(paidOn);
    const total = (Number(existing.montant_recu_cents) || 0) + montant;
    const paid = total >= du ? 1 : 0;
    // Solde restant : les relances repartent de zéro ; le premier rappel part un mois après la date du paiement
    // (automations.js).
    const notify = Boolean(data.notifier) && !paid;
    await ensurePaymentEntriesTable(env.DB);
    // Fiche et historique dans la même transaction ; la ligne d'historique n'est écrite que si la fiche a changé.
    const [versementResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET montant_recu_cents = ?, montant_du_cents = ?, dernier_versement_at = COALESCE(?, datetime('now')), mode_paiement = ?, paye = ?,
           auto_reminders_sent = CASE WHEN ? = 0 THEN 0 ELSE auto_reminders_sent END,
           last_reminder_at = CASE WHEN ? = 1 THEN datetime('now') ELSE last_reminder_at END
         WHERE organization_id = ? AND id = ? AND ${unchanged}`
      ).bind(total, du, paidAt, mode, paid, paid, notify ? 1 : 0, admin.organizationId, id, recuAvant, payeAvant),
      paymentEntryStatement(env.DB, admin.organizationId, id, { kind: 'versement', amount: montant, mode, totalRecu: total, totalDu: du, paidOn: paidAt ? paidOn : null }),
    ]);
    if (!versementResult.meta.changes) return conflict();
    const siteUrl = new URL(request.url).origin;
    const fresh = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first();
    if (paid && isPartiallyPaid(existing)) {
      // Solde réglé : l'étape paiement comptait déjà (acompte), « Dossier complet » est déjà parti ; e-mail « paiement reçu ».
      waitUntil(sendFollowUpEmail(env, fresh, siteUrl, { step: 'paiement' }).catch(() => false));
    } else if (paid || (fresh && isInscriptionComplete(fresh) && !isInscriptionComplete(existing))) {
      // Même suite que « Marquer payé » : e-mail de suivi « paiement reçu » ou « Dossier complet » (un premier versement
      // suffit pour être complet, hasPaymentStarted).
      waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'paiement', source: 'admin', siteUrl }));
    }
    if (!paid && notify && fresh) waitUntil(sendPartialPaymentEmail(env, fresh, siteUrl, { montant, paidOn }).catch(() => false));
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?versementOk=${paid ? 'paye' : 'partiel'}#dossier` } });
  }

  // Paiement par chèques (_shared/payments.js) : les chèques remis couvrent le reste à payer, la fiche passe à
  // « payé » ; chaque chèque est ensuite encaissé au fil des mois (suivi interne, aucun e-mail).
  if (data.action === 'cheques') {
    const back = (message) => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?chequesError=${encodeURIComponent(message)}#cheques` } });
    if (existing.paye) return conflict();
    const max = maxChequesFor();
    const count = Number.parseInt(String(data.nombre || ''), 10);
    if (!(count >= 1 && count <= max)) return back(`Nombre de chèques : ${max} au plus en ce moment.`);
    const du = parseEuros(data.du);
    if (!du) return back('Indiquez le total dû en euros.');
    const deja = Number(existing.montant_recu_cents) || 0;
    const reste = du - deja;
    if (reste <= 0) return back('Le total dû est déjà couvert par les versements reçus : utilisez « Corriger les montants ».');
    const typed = Array.from({ length: count }, (_, i) => String(data[`montant${i + 1}`] || '').trim());
    let amounts;
    if (typed.every((v) => !v)) amounts = splitCents(reste, count);
    else {
      amounts = typed.map(parseEuros);
      if (amounts.some((a) => !a)) return back('Indiquez le montant de chaque chèque, ou laissez-les tous vides pour des parts égales.');
      if (amounts.reduce((a, b) => a + b, 0) !== reste) return back(`La somme des chèques doit faire ${formatEuros(reste)} (reste à payer).`);
    }
    const numeros = Array.from({ length: count }, (_, i) => String(data[`numero${i + 1}`] || '').trim());
    if (numeros.some((n) => n && !/^[A-Za-z0-9 -]{1,30}$/.test(n))) return back('Numéro de chèque : chiffres et lettres uniquement (30 caractères au plus).');
    const months = chequeMonths(count);
    await ensurePaymentEntriesTable(env.DB);
    await ensureChequesTable(env.DB);
    // Une transaction : fiche, historique et chèques. Chaque insertion n'a lieu que si l'instruction précédente a écrit
    // une ligne (changes() = 1) : fiche déjà payée entre-temps = rien d'enregistré.
    const [chequesResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET mode_paiement = 'Chèque', paye = 1, montant_recu_cents = ?, montant_du_cents = ?, dernier_versement_at = datetime('now') WHERE organization_id = ? AND id = ? AND ${unchanged}`
      ).bind(du, du, admin.organizationId, id, recuAvant, payeAvant),
      paymentEntryStatement(env.DB, admin.organizationId, id, { kind: 'versement', amount: reste, mode: `Chèques (${count} fois)`, totalRecu: du, totalDu: du }),
      ...amounts.map((montant, i) =>
        env.DB.prepare(
          'INSERT INTO cheques (organization_id, inscription_id, rang, montant_cents, numero, encaissement_prevu) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1'
        ).bind(admin.organizationId, id, i + 1, montant, numeros[i] || null, months[i])
      ),
    ]);
    if (!chequesResult.meta.changes) return conflict();
    waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'paiement', source: 'admin', siteUrl: new URL(request.url).origin }));
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?chequesOk=1#dossier` } });
  }
  // Encaissement d'un chèque (ou annulation) : suivi interne, rien d'autre ne change, aucun e-mail.
  if (data.action === 'cheque-encaisse') {
    await ensureChequesTable(env.DB);
    await env.DB.prepare(
      "UPDATE cheques SET encaisse_at = CASE WHEN encaisse_at IS NULL THEN datetime('now') ELSE NULL END WHERE organization_id = ? AND inscription_id = ? AND id = ?"
    )
      .bind(admin.organizationId, id, Number.parseInt(String(data.cheque || ''), 10) || 0)
      .run();
    const retour = String(data.retour || '') === 'a-traiter' ? '/admin/a-traiter#cheques' : `/admin/inscriptions/${id}#dossier`;
    return new Response('', { status: 302, headers: { Location: retour } });
  }

  // Modification d'un versement (historique) : montant, date, mode. Le total reçu (fiche et lignes suivantes de
  // l'historique) est décalé de la différence, le statut payé et la date du dernier paiement recalculés. Aucun e-mail.
  if (data.action === 'versement-modification') {
    const entryId = Number.parseInt(String(data.entree || ''), 10);
    const refuse = () => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?modificationError=1&entree=${entryId || ''}#dossier` } });
    const entries = await listPaymentEntries(env.DB, admin.organizationId, id);
    const entry = entries.find((e) => e.id === entryId);
    const montant = parseEuros(data.montant);
    const paidOn = parsePaymentDate(data.datePaiement);
    const mode = ['Carte bancaire', 'Espèces', 'Chèque', 'HelloAsso'].includes(data.modePaiement) ? data.modePaiement : null;
    if (!entry || entry.kind !== 'versement' || !deletableEntryIds(entries).has(entry.id) || String(entry.mode || '').startsWith('Chèques') || !montant || !paidOn || !mode) return refuse();
    const delta = montant - (entry.amount_cents || 0);
    const recu = Math.max(0, (Number(existing.montant_recu_cents) || 0) + delta);
    const du = Number(existing.montant_du_cents) || 0;
    const paid = recu > 0 && du > 0 && recu >= du ? 1 : 0;
    // Date du dernier paiement : celle du versement le plus récent (ce versement s'il l'est).
    const latest = entries.find((e) => e.kind === 'versement');
    const lastPaidAt = latest && latest.id === entry.id ? `${paidOn} 12:00:00` : existing.dernier_versement_at;
    const [modificationResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET montant_recu_cents = ?, paye = ?, dernier_versement_at = ?,
           mode_paiement = CASE WHEN ? = 1 THEN ? ELSE mode_paiement END
         WHERE organization_id = ? AND id = ? AND ${unchanged}`
      ).bind(recu || null, paid, lastPaidAt, latest && latest.id === entry.id ? 1 : 0, mode, admin.organizationId, id, recuAvant, payeAvant),
      env.DB.prepare(
        "UPDATE payment_entries SET amount_cents = ?, mode = ?, paid_on = ? WHERE organization_id = ? AND inscription_id = ? AND id = ? AND kind = 'versement' AND changes() = 1"
      ).bind(montant, mode, paidOn, admin.organizationId, id, entry.id),
      env.DB.prepare('UPDATE payment_entries SET total_recu_cents = MAX(0, total_recu_cents + ?) WHERE organization_id = ? AND inscription_id = ? AND id >= ? AND changes() = 1').bind(delta, admin.organizationId, id, entry.id),
    ]);
    if (!modificationResult.meta.changes) return conflict();
    if (paid && !existing.paye) {
      // Devient entièrement payé : même suite que « Marquer payé » (e-mail « paiement reçu »).
      const fresh = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first();
      waitUntil(sendFollowUpEmail(env, fresh, new URL(request.url).origin, { step: 'paiement' }).catch(() => false));
    }
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?modificationOk=1#dossier` } });
  }

  // Suppression de la correction la plus récente : la fiche revient à l'état d'avant (stateBeforeCorrection). Aucun e-mail.
  if (data.action === 'correction-suppression') {
    const refuse = (message) => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?suppressionError=${encodeURIComponent(message)}#dossier` } });
    const entries = await listPaymentEntries(env.DB, admin.organizationId, id);
    const entry = entries[0];
    const state = stateBeforeCorrection(entries);
    if (!state || entry.id !== Number.parseInt(String(data.entree || ''), 10)) return refuse('Seule la correction la plus récente peut être supprimée.');
    const [annulationResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET montant_recu_cents = ?, montant_du_cents = ?, paye = ?, dernier_versement_at = ?,
           complete_notified_at = CASE WHEN ? = 0 THEN NULL ELSE complete_notified_at END
         WHERE organization_id = ? AND id = ? AND ${unchanged}`
      ).bind(state.recu || null, state.du || null, state.paye, state.dernier, state.paye || state.recu ? 1 : 0, admin.organizationId, id, recuAvant, payeAvant),
      env.DB.prepare("DELETE FROM payment_entries WHERE organization_id = ? AND inscription_id = ? AND id = ? AND kind = 'correction' AND changes() = 1").bind(admin.organizationId, id, entry.id),
    ]);
    if (!annulationResult.meta.changes) return conflict();
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?annulationOk=1#dossier` } });
  }

  // Suppression d'un versement saisi par erreur (historique) : le montant est retiré du total reçu, le statut payé et la
  // date du dernier paiement sont recalculés ; un versement par chèques efface aussi ses chèques (refusé si l'un est
  // déjà encaissé). Seulement les versements postérieurs à la dernière correction (deletableEntryIds). Aucun e-mail.
  if (data.action === 'versement-suppression') {
    const back = (param) => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?${param}#dossier` } });
    const refuse = (message) => back(`suppressionError=${encodeURIComponent(message)}`);
    const entries = await listPaymentEntries(env.DB, admin.organizationId, id);
    const entry = entries.find((e) => e.id === Number.parseInt(String(data.entree || ''), 10));
    if (!entry || entry.kind !== 'versement') return refuse('Versement introuvable.');
    if (!deletableEntryIds(entries).has(entry.id)) return refuse('Ce versement est antérieur à une correction : utilisez « Corriger montants ou date ».');
    const isCheques = String(entry.mode || '').startsWith('Chèques');
    if (isCheques) {
      await ensureChequesTable(env.DB);
      const cashed = await env.DB.prepare('SELECT COUNT(*) AS n FROM cheques WHERE organization_id = ? AND inscription_id = ? AND encaisse_at IS NOT NULL').bind(admin.organizationId, id).first();
      if (cashed.n) return refuse('Un des chèques est déjà marqué encaissé : annulez d’abord l’encaissement.');
    }
    const recu = Math.max(0, (Number(existing.montant_recu_cents) || 0) - (entry.amount_cents || 0));
    const du = Number(existing.montant_du_cents) || 0;
    const paid = recu > 0 && du > 0 && recu >= du ? 1 : 0;
    await ensureHelloAssoPaymentsTable(env.DB);
    // Date du dernier paiement : celle du versement restant le plus récent (date de paiement, sinon de saisie).
    const latest = entries.find((e) => e.kind === 'versement' && e.id !== entry.id);
    const lastPaidAt = recu ? (latest ? (latest.paid_on ? `${latest.paid_on} 12:00:00` : latest.created_at) : existing.dernier_versement_at) : null;
    const [suppressionResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET montant_recu_cents = ?, paye = ?, dernier_versement_at = ?,
           mode_paiement = CASE WHEN ? = 1 THEN NULL ELSE mode_paiement END,
           complete_notified_at = CASE WHEN ? = 0 THEN NULL ELSE complete_notified_at END
         WHERE organization_id = ? AND id = ? AND ${unchanged}`
      ).bind(recu || null, paid, lastPaidAt, isCheques && !recu ? 1 : 0, recu, admin.organizationId, id, recuAvant, payeAvant),
      env.DB.prepare("DELETE FROM payment_entries WHERE organization_id = ? AND inscription_id = ? AND id = ? AND kind = 'versement' AND changes() = 1").bind(admin.organizationId, id, entry.id),
      ...(isCheques ? [env.DB.prepare('DELETE FROM cheques WHERE organization_id = ? AND inscription_id = ? AND encaisse_at IS NULL AND changes() = 1').bind(admin.organizationId, id)] : []),
      // Paiement importé de HelloAsso : il sera reproposé au prochain import (helloasso-import.js).
      forgetEntryStatement(env.DB, admin.organizationId, id, entry.id),
    ]);
    if (!suppressionResult.meta.changes) return conflict();
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return back('suppressionOk=1');
  }

  // Correction d'un versement saisi par erreur : les deux totaux sont remplacés. Aucun e-mail à la famille, sauf la
  // suite habituelle si la fiche devient payée ; repasser en non payé remet complete_notified_at à NULL (comme
  // « Marquer payé » inversé), pour que « Dossier complet » reparte au vrai paiement.
  if (data.action === 'versement-correction') {
    const recu = parseEurosOrZero(data.recu);
    const du = parseEuros(data.du);
    const paidOn = parsePaymentDate(data.datePaiement);
    if (recu === null || !du || !paidOn) return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?correctionError=1#correction-versement` } });
    const paid = recu > 0 && recu >= du ? 1 : 0;
    // Devient « reste à payer » (fiche payée par erreur, ou rien de saisi avant) : le délai d'un mois avant le rappel
    // du solde part de maintenant (automations.js), compteur de relances remis à zéro.
    const startsBalance = !paid && recu > 0 && (existing.paye || !Number(existing.montant_recu_cents)) ? 1 : 0;
    await ensurePaymentEntriesTable(env.DB);
    const [correctionResult] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE inscriptions SET montant_recu_cents = ?, montant_du_cents = ?, paye = ?,
           dernier_versement_at = CASE WHEN ? = 0 THEN NULL ELSE COALESCE(?, datetime('now')) END,
           last_reminder_at = CASE WHEN ? = 1 THEN NULL ELSE last_reminder_at END,
           auto_reminders_sent = CASE WHEN ? = 1 THEN 0 ELSE auto_reminders_sent END,
           complete_notified_at = CASE WHEN ? = 0 THEN NULL ELSE complete_notified_at END
         WHERE organization_id = ? AND id = ? AND ${unchanged}`
      ).bind(recu || null, du, paid, recu, `${paidOn} 12:00:00`, startsBalance, startsBalance, recu, admin.organizationId, id, recuAvant, payeAvant),
      paymentEntryStatement(env.DB, admin.organizationId, id, { kind: 'correction', totalRecu: recu, totalDu: du, paidOn, previous: existing }),
    ]);
    if (!correctionResult.meta.changes) return conflict();
    const corrected = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first();
    if ((paid && !existing.paye && !isPartiallyPaid(existing)) || (corrected && isInscriptionComplete(corrected) && !isInscriptionComplete(existing))) {
      waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'paiement', source: 'admin', siteUrl: new URL(request.url).origin }));
    }
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?correctionOk=1#dossier` } });
  }

  // Pass'Sport non déduit d'un montant dû saisi au tarif plein (passSportNotDeducted) : montant dû moins 50 €, statut
  // payé recalculé, ligne de correction dans l'historique, suite habituelle (« paiement reçu ») si la fiche devient payée.
  if (data.action === 'passsport-deduire') {
    const { prix } = await getCategoriesConfig(env, admin.organizationId);
    const du = existing.paye ? null : passSportNotDeducted(existing, prix);
    if (du === null) return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}#dossier` } });
    const recu = Number(existing.montant_recu_cents) || 0;
    const paid = recu > 0 && recu >= du ? 1 : 0;
    await ensurePaymentEntriesTable(env.DB);
    const [result] = await env.DB.batch([
      env.DB.prepare(`UPDATE inscriptions SET montant_du_cents = ?, paye = ? WHERE organization_id = ? AND id = ? AND montant_du_cents = ? AND ${unchanged}`)
        .bind(du, paid, admin.organizationId, id, existing.montant_du_cents, recuAvant, payeAvant),
      paymentEntryStatement(env.DB, admin.organizationId, id, { kind: 'correction', totalRecu: recu, totalDu: du, previous: existing }),
    ]);
    if (!result.meta.changes) return conflict();
    if (paid) waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'paiement', source: 'admin', siteUrl: new URL(request.url).origin }));
    waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?correctionOk=1#dossier` } });
  }

  // Note interne du club (2026-10-16), saisie depuis la fiche adhérent : seul ce champ change.
  if (data.action === 'note') {
    const retour = adherentRetour(data.retour);
    const note = String(data.noteInterne ?? '').replace(/\r\n?/g, '\n').trim();
    if (note.length > NOTE_MAX) {
      return new Response('', { status: 302, headers: { Location: `${retour || `/admin/inscriptions/${id}`}?noteError=1#note` } });
    }
    await env.DB.prepare('UPDATE inscriptions SET note_interne = ? WHERE organization_id = ? AND id = ?').bind(note || null, admin.organizationId, id).run();
    return new Response('', { status: 302, headers: { Location: `${retour || `/admin/inscriptions/${id}`}?noteOk=1#note` } });
  }

  // Champs ajoutés le 2026-09-27 : absents d'un ancien formulaire resté ouvert, on garde la valeur enregistrée.
  const keep = (field, column) => (typeof data[field] === 'string' ? data[field].trim() || null : existing[column] ?? null);
  const villeNaissance = keep('villeNaissance', 'ville_naissance');
  const paysNaissance = keep('paysNaissance', 'pays_naissance');
  const cpNaissance = keep('cpNaissance', 'cp_naissance');
  const numeroLicence = keep('numeroLicence', 'numero_licence');
  // Champ absent (ancien formulaire resté ouvert) : on garde le statut enregistré.
  // Versements enregistrés : statut tenu par les montants (onglet Paiement), le formulaire ne le change pas.
  if ((data.paye !== '0' && data.paye !== '1') || Number(existing.montant_recu_cents) > 0 || existing.paiement_exempte) data.paye = existing.paye ? '1' : '0';
  const paye = data.paye === '1' ? 1 : 0;
  const { categories } = await getCategoriesConfig(env, admin.organizationId);

  for (const field of REQUIRED_FIELDS) {
    if (!String(data[field] ?? '').trim()) {
      return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: `Champ manquant : ${field}` }), 400);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: 'E-mail invalide' }), 400);
  }
  if (data.parent2Email?.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.parent2Email.trim())) {
    return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: 'E-mail du second responsable invalide' }), 400);
  }
  if (numeroLicence && !LICENCE_RE.test(numeroLicence)) {
    return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: 'N° de licence invalide (chiffres et lettres uniquement)' }), 400);
  }
  if (cpNaissance && !/^\d{5}$/.test(cpNaissance)) {
    return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: 'Code postal de naissance invalide (5 chiffres)' }), 400);
  }
  if ([villeNaissance, paysNaissance].some((v) => v && v.length > 200)) {
    return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: 'Lieu de naissance trop long' }), 400);
  }
  // Code Pass'Sport : remis en forme et vérifié (_shared/pass-sport.js) ; un code enregistré avant cette règle et
  // laissé tel quel est conservé. Champ absent (ancien formulaire) : valeur enregistrée.
  const passSportInput = typeof data.passSportCode === 'string' ? data.passSportCode.trim() : existing.pass_sport_code || '';
  const passSportCode = passSportInput && passSportInput === existing.pass_sport_code ? passSportInput : normalizePassSportCode(passSportInput);
  if (passSportCode === null) {
    return html(editPage({ ...existing, ...toRow(data) }, categories, { badges: await adminBadges(env, admin), retour: adherentRetour(data.retour), error: PASS_SPORT_ERROR }), 400);
  }
  // Pass'Sport ajouté ou retiré alors qu'un montant dû est enregistré : il suit (± 50 €), statut payé recalculé.
  const dueChange = passSportDueChange(existing, passSportCode);
  const finalPaye = dueChange ? dueChange.paye : paye;

  await env.DB.prepare(
    `UPDATE inscriptions SET
      enfant_prenom = ?, enfant_nom = ?, naissance = ?, categorie = ?, taille_maillot = ?, mode_paiement = ?,
      parent_prenom = ?, parent_nom = ?, email = ?, telephone = ?, adresse = ?, code_postal = ?, ville = ?,
      parent2_prenom = ?, parent2_nom = ?, parent2_email = ?, parent2_telephone = ?, pass_sport_code = ?,
      ville_naissance = ?, pays_naissance = ?, cp_naissance = ?, numero_licence = ?,
      autorisation = ?, droit_image = ?, rgpd = ?, paye = ?, montant_du_cents = ?,
      complete_notified_at = CASE WHEN ? = 0 THEN NULL ELSE complete_notified_at END
     WHERE organization_id = ? AND id = ?`
  )
    .bind(
      data.enfantPrenom.trim(),
      data.enfantNom.trim(),
      data.naissance,
      data.categorie,
      data.tailleMaillot,
      data.modePaiement,
      data.parentPrenom.trim(),
      data.parentNom.trim(),
      data.email.trim(),
      data.telephone?.trim() || null,
      data.adresse?.trim() || null,
      data.codePostal?.trim() || null,
      data.ville?.trim() || null,
      data.parent2Prenom?.trim() || null,
      data.parent2Nom?.trim() || null,
      data.parent2Email?.trim() || null,
      data.parent2Telephone?.trim() || null,
      passSportCode || null,
      villeNaissance,
      paysNaissance,
      cpNaissance,
      numeroLicence,
      data.autorisation ? 1 : 0,
      data.droitImage ? 1 : 0,
      data.rgpd ? 1 : 0,
      finalPaye,
      dueChange ? dueChange.du : existing.montant_du_cents ?? null,
      finalPaye,
      admin.organizationId,
      id
    )
    .run();

  // L'inscription fait autorité : le CRM en reprend les données de personne (voir _shared/crm.js).
  waitUntil(syncInscriptionSafe(env, admin.organizationId, id));

  // Même suite que le bouton « Marquer payé » : e-mail de suivi / « Dossier complet » à la famille.
  // Repasser en non payé (erreur de saisie) remet complete_notified_at à zéro ci-dessus, pour que
  // « Dossier complet » reparte quand le paiement sera réellement reçu.
  if (finalPaye && !existing.paye) {
    waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'paiement', source: 'admin', siteUrl: new URL(request.url).origin }));
  } else if (villeNaissance && paysNaissance && !hasBirthPlace(existing)) {
    // Lieu de naissance complété par le club : peut rendre l'inscription complète (« Dossier complet »).
    waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'naissance', source: 'admin', siteUrl: new URL(request.url).origin }));
  }

  const retour = adherentRetour(data.retour);
  return new Response('', { status: 302, headers: { Location: retour ? `${retour}?savedOk=1` : `/admin/inscriptions/${id}?savedOk=1` } });
}
