// Fiche d'une inscription (base D1 "DB") : vue détaillée avec ses actions (paiement, relance, PDF,
// dépôt manuel du dossier, archivage) et, avec ?edit=1, le formulaire de modification. Liée depuis
// les cartes de /admin/inscriptions et depuis /admin/reinscription. Les actions sont traitées par
// functions/admin/inscriptions.js (ou [id]/dossier.js pour le dépôt) et reviennent ici via redirectTo.
import { syncInscriptionSafe } from '../../_shared/crm.js';
import { ensureInscriptionsTable, familyHasActionPending, hasBirthPlace, dossierStatus, refusMotifs, archiveReason, PHOTO_REFUS_MOTIFS, photoRefusMotifs, isPhotoToRedo, ageGroup, ageRangesFrom } from '../../_shared/inscriptions-db.js';
import { photoTag,
  isAuthed,
  loginPage,
  escapeHtml,
  adminHead,
  adminShell,
  adminScripts,
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
  can,
} from '../../_shared/admin-auth.js';
import { getCategoriesConfig } from '../../_shared/settings-kv.js';
import { activeFamilyLinks, revokeFamilyLinks, FAMILY_LINK_DAYS } from '../../_shared/family-links.js';
import { followupUpdate } from '../../_shared/club-followup.js';
import { sendFamilyLinkEmail } from '../../_shared/confirmation-email.js';
import { afterInscriptionChange } from '../../_shared/automations.js';
import { dossierVerificationForms, DOSSIER_CHECKLIST, verifMessage } from '../../_shared/admin-dossier.js';
import { getPreinscriptionConfig, ensurePreinscriptionsTable, findPreinscriptionForChild } from '../../_shared/preinscriptions.js';

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
    ? `<strong>Doublon</strong> : ${escapeHtml(rawName)} est aussi dans la <a class="adm-link" href="/admin/preinscriptions">pré-inscription ${label}</a>.`
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

function fichePage(row, { saison, ageCtx, prix, siteUrl, messages, preinscription, preinscriptionListed, badges, familyLinks = null }) {
  const rawName = `${row.enfant_prenom} ${row.enfant_nom}`;
  const name = escapeHtml(rawName);
  const dossier = dossierStatus(row);
  const docReceived = dossier !== 'manquant';
  const payOk = Boolean(row.paye);
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

  const actions = archived
    ? `${actionForm({ action: 'restore', id: row.id, redirectTo: self }, { label: 'Restaurer', iconName: 'refresh', className: 'adm-btn-primary' })}
      ${editBtn}${pdfBtn}${mailsBtn}
      <span class="adm-actionbar-spacer"></span>
      ${actionForm(
        { action: 'delete', id: row.id, view: 'archive' },
        { label: 'Supprimer définitivement', iconName: 'trash', className: 'adm-btn-danger-solid', confirm: `Supprimer définitivement ${rawName} ? Cette action est irréversible, contrairement à l'archivage.` }
      )}`
    : `${actionForm(
        { action: 'toggle-paye', id: row.id, redirectTo: self },
        payOk
          ? { label: 'Marquer non payé', iconName: 'card', className: 'adm-btn-ghost', confirm: `Marquer ${rawName} comme NON payé ?` }
          : { label: 'Marquer payé', iconName: 'check', className: 'adm-btn-primary', confirm: `Confirmer que ${rawName} a payé ?` }
      )}
      ${editBtn}${writeBtn}${pdfBtn}${mailsBtn}
      ${
        familyHasActionPending(row)
          ? actionForm(
              { action: 'bulk-reminder', ids: row.id, redirectTo: self },
              { label: 'Relancer', iconName: 'send', className: 'adm-btn-ghost', confirm: `Envoyer une relance par e-mail à ${row.email} (dossier, photo ou paiement manquant) ?` }
            )
          : ''
      }
      <span class="adm-actionbar-spacer"></span>
      <details class="adm-refuse adm-archive" data-dismiss>
        <summary class="adm-btn adm-btn-danger">${icon('archive')}Archiver</summary>
        <form method="POST" action="/admin/inscriptions" class="adm-refuse-form adm-archive-form admin-confirm-form">
          <input type="hidden" name="action" value="archive">
          <input type="hidden" name="id" value="${row.id}">
          <input type="hidden" name="redirectTo" value="${escapeHtml(self)}">
          ${archiveReasonFields('fiche')}
          <button type="submit" class="adm-btn adm-btn-danger-solid adm-btn-block" data-confirm="${escapeHtml(`Mettre ${rawName} à la corbeille ? Le profil reste récupérable à tout moment.`)}">${icon('archive')}Mettre à la corbeille</button>
        </form>
      </details>`;

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

  const parent = `<section class="adm-surface adm-fiche-parent">
    <h2 class="adm-h2">${icon('phone')}${hasParent2 ? 'Responsables légaux' : 'Responsable légal'}</h2>
    <dl class="adm-kv">
      ${kv('Nom', `${escapeHtml(row.parent_prenom)} ${escapeHtml(row.parent_nom)}`)}
      ${kv('Téléphone', row.telephone ? escapeHtml(row.telephone) : '—')}
      ${kv('E-mail', escapeHtml(row.email))}
      ${kv('Adresse', adresse)}
    </dl>
    ${contactActions({ phone: row.telephone, email: row.email, name: hasParent2 ? `${row.parent_prenom} ${row.parent_nom}` : '', inscriptionId: row.id })}
    ${
      hasParent2
        ? `<dl class="adm-kv adm-kv-next">
      ${kv('2e responsable', `${escapeHtml(row.parent2_prenom || '')} ${escapeHtml(row.parent2_nom || '')}`)}
      ${kv('Téléphone (2e)', row.parent2_telephone ? escapeHtml(row.parent2_telephone) : '—')}
      ${kv('E-mail (2e)', row.parent2_email ? escapeHtml(row.parent2_email) : '—')}
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

  const dossierSection = `<section class="adm-surface adm-fiche-dossier" id="dossier">
    <h2 class="adm-h2">${icon('file')}Dossier &amp; paiement</h2>
    <dl class="adm-kv">
      ${kv('Document', dossierTag(row))}
      ${docReceived ? kv('Reçu le', formatDateFr(row.dossier_uploaded_at, LONG_DATE)) : ''}
      ${dossier === 'valide' && row.dossier_verified_at ? kv('Vérifié le', formatDateFr(row.dossier_verified_at, LONG_DATE)) : ''}
      ${kv('Paiement', statusTag(payOk, PAIEMENT_TAG))}
      ${kv('Mode de paiement', escapeHtml(row.mode_paiement || '—'))}
      ${kv("Code Pass'Sport", row.pass_sport_code ? `${escapeHtml(row.pass_sport_code)} <small>· 50 € à déduire</small>` : '—')}
      ${row.helloasso_order_id ? kv('Validé par HelloAsso', `commande n° ${escapeHtml(row.helloasso_order_id)}`) : ''}
      ${row.last_reminder_at ? kv('Dernière relance', `${formatDateFr(row.last_reminder_at, LONG_DATE)}${row.auto_reminders_sent ? ` (${row.auto_reminders_sent} auto.)` : ''}`) : ''}
      ${familyLinksRow(row, familyLinks, messages)}
    </dl>
    ${verification}
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

  const flashes = [
    messages.savedOk && flash('ok', 'Fiche mise à jour.'),
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
  active: archived ? 'archive' : 'inscriptions',
  badges,
  back: archived ? { href: '/admin/inscriptions?view=archive', label: 'Corbeille' } : { href: '/admin/inscriptions', label: 'Inscriptions' },
  lead: avatar(row, 'lg'),
  eyebrow: "Fiche d'inscription",
  title: name,
  subtitle: `${ageAndCategory(ageGroup(row.naissance, ageCtx), row.categorie)} · inscription du ${formatDateFr(row.created_at, LONG_DATE)}${archived ? ` · archivée le ${formatDateFr(row.archived_at, LONG_DATE)}${archiveReason(row) ? ` (${escapeHtml(archiveReason(row))})` : ''}` : ''}`,
  meta: `<div class="adm-hero-tags"><span>Document</span>${dossierTag(row)}<span>Photo</span>${photoTag(row)}<span>Paiement</span>${statusTag(payOk, PAIEMENT_TAG)}</div>`,
})}
<main id="adm-main" class="adm-wrap adm-main">
  ${flashes}
  <div class="adm-surface adm-actionbar">${actions}</div>
  ${transferBlock(row, preinscription, rawName, preinscriptionListed)}
  <div class="adm-fiche-grid">${enfant}${parent}${dossierSection}${photo}</div>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js" integrity="sha512-plOdviVmws4Y3JAvbnpfKb2hVxKM1lCwsi3vmElYRj+tiDLffZ4FVUj5a8vyKJ9pIgl8JCAHEJ4D1iUKBecswg==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
${adminScripts('pdf-inscription', 'admin-nav', 'admin-inscriptions')}
</body></html>`;
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
          <select id="paye" name="paye">
            <option value="0" ${row.paye ? '' : 'selected'}>Non payé</option>
            <option value="1" ${row.paye ? 'selected' : ''}>Payé</option>
          </select>
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
${adminScripts('admin-nav')}
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
  const preinscription = await getPreinscriptionConfig(env, admin.organizationId);
  let preinscriptionListed = false;
  if (preinscription && !row.archived_at) {
    await ensurePreinscriptionsTable(env.DB);
    preinscriptionListed = Boolean(
      await findPreinscriptionForChild(env.DB, admin.organizationId, preinscription.groupe, { enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance })
    );
  }
  const ageCtx = ageRangesContext(saison, categories, preinscription);
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
      },
      preinscription,
      preinscriptionListed,
      familyLinks: await activeFamilyLinks(env.DB, admin.organizationId, row.id).catch(() => null),
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
  // Suivi licence et tenue (fiche adhérent, _shared/club-followup.js) : seules ces quatre dates changent.
  if (data.action === 'suivi-club') {
    await followupUpdate(env.DB, admin.organizationId, id, data).run();
    const retour = adherentRetour(data.retour);
    return new Response('', { status: 302, headers: { Location: retour ? `${retour}?suiviOk=1#suivi-club` : `/admin/inscriptions/${id}?savedOk=1` } });
  }

  if (data.action === 'family-link-send') {
    const ok = await sendFamilyLinkEmail(env, existing, new URL(request.url).origin, 'manuel');
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?${ok ? 'linkSent' : 'linkError'}=1#dossier` } });
  }
  if (data.action === 'family-link-revoke') {
    await revokeFamilyLinks(env.DB, admin.organizationId, id);
    return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?linksRevoked=1#dossier` } });
  }

  if (data.action === 'licence') {
    const numero = String(data.numeroLicence ?? '').trim();
    // Depuis la fiche adhérent (2026-10-14) : retour sur cette fiche, chemin strictement contrôlé.
    const retour = adherentRetour(data.retour);
    if (numero && !LICENCE_RE.test(numero)) {
      return new Response('', { status: 302, headers: { Location: retour ? `${retour}?licenceError=1#licence` : `/admin/inscriptions/${id}?licenceError=1` } });
    }
    await env.DB.prepare('UPDATE inscriptions SET numero_licence = ? WHERE organization_id = ? AND id = ?').bind(numero || null, admin.organizationId, id).run();
    return new Response('', { status: 302, headers: { Location: retour ? `${retour}?licenceOk=1` : `/admin/inscriptions/${id}?savedOk=1` } });
  }

  // Note interne du club (2026-10-16), saisie depuis la fiche adhérent : seul ce champ change.
  if (data.action === 'note') {
    const retour = adherentRetour(data.retour);
    const note = String(data.noteInterne ?? '').replace(/\r\n?/g, '\n').trim();
    if (note.length > NOTE_MAX) {
      return new Response('', { status: 302, headers: { Location: `${retour || `/admin/inscriptions/${id}`}?noteError=1#note` } });
    }
    await env.DB.prepare('UPDATE inscriptions SET note_interne = ? WHERE organization_id = ? AND id = ?').bind(note || null, admin.organizationId, id).run();
    return new Response('', { status: 302, headers: { Location: `${retour || `/admin/inscriptions/${id}`}?noteOk=1` } });
  }

  // Champs ajoutés le 2026-09-27 : absents d'un ancien formulaire resté ouvert, on garde la valeur enregistrée.
  const keep = (field, column) => (typeof data[field] === 'string' ? data[field].trim() || null : existing[column] ?? null);
  const villeNaissance = keep('villeNaissance', 'ville_naissance');
  const paysNaissance = keep('paysNaissance', 'pays_naissance');
  const cpNaissance = keep('cpNaissance', 'cp_naissance');
  const numeroLicence = keep('numeroLicence', 'numero_licence');
  // Champ absent (ancien formulaire resté ouvert) : on garde le statut enregistré.
  // Sans la permission finance.write (rôles sans trésorerie), le statut de paiement n'est jamais modifié ici.
  if ((data.paye !== '0' && data.paye !== '1') || !can(admin, 'finance.write')) data.paye = existing.paye ? '1' : '0';
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

  await env.DB.prepare(
    `UPDATE inscriptions SET
      enfant_prenom = ?, enfant_nom = ?, naissance = ?, categorie = ?, taille_maillot = ?, mode_paiement = ?,
      parent_prenom = ?, parent_nom = ?, email = ?, telephone = ?, adresse = ?, code_postal = ?, ville = ?,
      parent2_prenom = ?, parent2_nom = ?, parent2_email = ?, parent2_telephone = ?, pass_sport_code = ?,
      ville_naissance = ?, pays_naissance = ?, cp_naissance = ?, numero_licence = ?,
      autorisation = ?, droit_image = ?, rgpd = ?, paye = ?,
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
      data.passSportCode?.trim() || null,
      villeNaissance,
      paysNaissance,
      cpNaissance,
      numeroLicence,
      data.autorisation ? 1 : 0,
      data.droitImage ? 1 : 0,
      data.rgpd ? 1 : 0,
      paye,
      paye,
      admin.organizationId,
      id
    )
    .run();

  // L'inscription fait autorité : le CRM en reprend les données de personne (voir _shared/crm.js).
  waitUntil(syncInscriptionSafe(env, admin.organizationId, id));

  // Même suite que le bouton « Marquer payé » : e-mail de suivi / « Dossier complet » à la famille.
  // Repasser en non payé (erreur de saisie) remet complete_notified_at à zéro ci-dessus, pour que
  // « Dossier complet » reparte quand le paiement sera réellement reçu.
  if (paye && !existing.paye) {
    waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'paiement', source: 'admin', siteUrl: new URL(request.url).origin }));
  } else if (villeNaissance && paysNaissance && !hasBirthPlace(existing)) {
    // Lieu de naissance complété par le club : peut rendre l'inscription complète (« Dossier complet »).
    waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: existing, step: 'naissance', source: 'admin', siteUrl: new URL(request.url).origin }));
  }

  const retour = adherentRetour(data.retour);
  return new Response('', { status: 302, headers: { Location: retour ? `${retour}?savedOk=1` : `/admin/inscriptions/${id}?savedOk=1` } });
}
