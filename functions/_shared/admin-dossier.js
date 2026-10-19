// Formulaires de vérification du dossier signé (valider / refuser avec motifs), partagés par la fiche
// (functions/admin/inscriptions/[id].js) et l'aperçu du document (functions/admin/inscriptions/[id]/apercu.js) :
// on valide ou on refuse là où on regarde le document. Les deux postent vers [id]/verification.js.
// `chain` : depuis l'aperçu, après l'action, ouvrir le dossier suivant à vérifier (voir verification.js).
import { escapeHtml, icon } from './admin-auth.js';
import { DOSSIER_REFUS_MOTIFS } from './inscriptions-db.js';

export function dossierVerificationForms({ self, dossier, rawName, openRefuse = false, chain = false, idPrefix = 'refus' }) {
  const chainField = chain ? '<input type="hidden" name="suite" value="1">' : '';
  const validateForm =
    dossier === 'valide'
      ? ''
      : `<form method="POST" action="${self}/verification">
        <input type="hidden" name="action" value="valider">${chainField}
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}${dossier === 'refuse' ? 'Valider quand même' : 'Valider le dossier'}</button>
      </form>`;
  const refuseForm =
    dossier === 'refuse'
      ? ''
      : `<details class="adm-refuse"${openRefuse ? ' open' : ''}>
        <summary class="adm-btn adm-btn-danger adm-btn-block">${icon('alert')}${dossier === 'valide' ? 'Refuser finalement ce dossier' : 'Refuser le dossier'}</summary>
        <form method="POST" action="${self}/verification" class="adm-refuse-form admin-confirm-form">
          <input type="hidden" name="action" value="refuser">${chainField}
          <fieldset>
            <legend>Qu'est-ce qui ne va pas ?</legend>
            ${Object.entries(DOSSIER_REFUS_MOTIFS)
              .map(([key, label]) => `<label class="adm-check"><input type="checkbox" name="motifs" value="${key}"><span>${escapeHtml(label)}</span></label>`)
              .join('')}
          </fieldset>
          <label class="adm-field" for="${idPrefix}-commentaire">Précision pour la famille <small>(facultatif)</small>
            <textarea id="${idPrefix}-commentaire" name="commentaire" rows="3" maxlength="500" placeholder="Ex. : il manque la signature en page 2."></textarea>
          </label>
          <label class="adm-check"><input type="checkbox" name="notifier" checked><span>Prévenir la famille par e-mail</span></label>
          <button type="submit" class="adm-btn adm-btn-danger-solid adm-btn-block" data-confirm="${escapeHtml(`Refuser le dossier de ${rawName} ? Si la case est cochée, la famille reçoit un e-mail avec les motifs et le lien pour renvoyer le dossier corrigé.`)}">${icon('send')}Refuser le dossier</button>
        </form>
      </details>`;
  return `${validateForm}
      ${refuseForm}`;
}

// Points à contrôler, rappelés là où l'on regarde le document.
export const DOSSIER_CHECKLIST = 'Contrôlez : signature du responsable légal, lieu et date (« Fait à …, le … »), document complet et lisible.';

// Message affiché après une vérification (paramètre verifOk de la redirection).
export const VERIF_MESSAGES = {
  valide: ['ok', 'Dossier validé.'],
  refuse: ['ok', 'Dossier refusé (famille non prévenue).'],
  'refuse-mail': ['ok', 'Dossier refusé : la famille a reçu un e-mail avec les motifs et le lien pour renvoyer le dossier.'],
  'refuse-mail-echec': ['error', "Dossier refusé, mais l'e-mail à la famille n'a pas pu partir (service d'envoi non configuré ou envoi refusé) : prévenez-la directement."],
};
export const verifMessage = (key) => VERIF_MESSAGES[key] || ['ok', 'Dossier mis à jour.'];
