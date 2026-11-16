// Exemples d'e-mails (2026-10-09, /admin/parametres) : envoie un exemplaire de chaque e-mail du site (famille et club)
// à une adresse de test, avec des DONNÉES FICTIVES uniquement (aucune vraie famille). Tous les destinataires sont
// remplacés par l'adresse de test et l'objet est préfixé « [Exemple] » (voir env.__sampleTo dans brevoSend).
// Aucune écriture en base hormis le journal des e-mails : la fiche fictive a un jeton (ensureUploadToken n'écrit rien)
// et un identifiant 0, qui ne correspond à aucune inscription.
import {
  sendConfirmationEmail,
  sendAdminNotification,
  sendReminderEmail,
  sendReinscriptionEmail,
  sendPasswordChangeCode,
  sendAdminInviteEmail,
  sendFollowUpEmail,
  sendClubUploadAlert,
  sendPhotoRefusedEmail,
  sendDossierRefusedEmail,
  sendClubPaymentModeAlert,
  sendClubPassSportAlert,
  sendHelloAssoAlert,
  sendWeeklySummary,
  sendPreinscriptionConfirmation,
  sendPreinscriptionClubAlert,
  sendPreinscriptionGroupOpened,
  sendPreinscriptionGroupOpenedClub,
  sendPreinscriptionWaitlistFullClub,
  sendPreinscriptionDeadlineReminder,
  sendPreinscriptionExpired,
  sendPreinscriptionExpiredClub,
  sendCronFailureAlert,
  sendClubMessage,
  sendContactMessage,
  sendFamilyLinkEmail,
  sendPreinscriptionTransferEmail,
  sendPartialPaymentEmail,
  sendEducateurLinkEmail,
  sendEducateurClubAlert,
  sendNewsletter,
} from './confirmation-email.js';
import { DOSSIER_REFUS_MOTIFS, PHOTO_REFUS_MOTIFS } from './inscriptions-db.js';

const FAKE_TOKEN = '00000000-0000-4000-8000-000000000000';

export function sampleRow(organizationId, to) {
  return {
    id: 0,
    organization_id: organizationId,
    enfant_prenom: 'Léa',
    enfant_nom: 'Exemple',
    naissance: '2019-05-12',
    ville_naissance: 'Demoville',
    pays_naissance: 'France',
    categorie: 'U8 - U9',
    taille_maillot: '8 ans',
    mode_paiement: 'HelloAsso',
    parent_prenom: 'Camille',
    parent_nom: 'Exemple',
    email: to,
    telephone: '06 00 00 00 00',
    adresse: "1 rue de l'Exemple",
    code_postal: '99999',
    ville: 'Demoville',
    saison: '2026-2027',
    upload_token: FAKE_TOKEN,
    reinscription_token: FAKE_TOKEN,
    created_at: '2026-10-01 10:00:00',
    paye: 0,
  };
}

export function sampleData(to) {
  return {
    enfantPrenom: 'Léa',
    enfantNom: 'Exemple',
    naissance: '2019-05-12',
    villeNaissance: 'Demoville',
    paysNaissance: 'France',
    categorie: 'U8 - U9',
    tailleMaillot: '8 ans',
    modePaiement: 'HelloAsso',
    parentPrenom: 'Camille',
    parentNom: 'Exemple',
    email: to,
    telephone: '06 00 00 00 00',
    adresse: "1 rue de l'Exemple",
    codePostal: '99999',
    ville: 'Demoville',
    autorisation: true,
    rgpd: true,
    droitImage: false,
  };
}

const SAMPLE_EDUCATEUR = (organizationId, to) => ({ id: 0, organization_id: organizationId, prenom: 'Sam', nom: 'Exemple', email: to, role: 'educateur', categories: 'U8 - U9' });

const PREINSCRIPTION = { groupe: 'U10', label: 'U10', capacity: 15, anneeMin: 2017, anneeMax: 2017, open: true };

// Renvoie [{ label, ok }] dans l'ordre d'envoi.
export async function sendEmailSamples(env, organizationId, siteUrl, to) {
  const e = { ...env, __sampleTo: to };
  const row = sampleRow(organizationId, to);
  const data = sampleData(to);
  const firstKey = (obj) => Object.keys(obj)[0];
  const samples = [
    ['Famille : confirmation d’inscription', () => sendConfirmationEmail(e, data, FAKE_TOKEN, siteUrl, null, organizationId)],
    ['Famille : relance', () => sendReminderEmail(e, row, siteUrl, 'manuel')],
    ['Famille : suivi, dossier validé', () => sendFollowUpEmail(e, { ...row, dossier_uploaded_at: '2026-10-02 10:00:00', dossier_status: 'valide' }, siteUrl, { step: 'dossier', origin: 'manuel' })],
    ['Famille : suivi, photo reçue', () => sendFollowUpEmail(e, { ...row, photo_uploaded_at: '2026-10-02 10:00:00' }, siteUrl, { step: 'photo', origin: 'manuel' })],
    ['Famille : suivi, paiement reçu', () => sendFollowUpEmail(e, { ...row, paye: 1 }, siteUrl, { step: 'paiement', origin: 'manuel' })],
    [
      'Famille : dossier complet',
      () =>
        sendFollowUpEmail(e, { ...row, paye: 1, dossier_uploaded_at: '2026-10-02 10:00:00', dossier_status: 'valide', photo_uploaded_at: '2026-10-02 10:00:00' }, siteUrl, {
          complete: true,
          origin: 'manuel',
        }),
    ],
    ['Famille : dossier refusé', () => sendDossierRefusedEmail(e, { ...row, dossier_uploaded_at: '2026-10-02 10:00:00', dossier_status: 'refuse', dossier_refus_motifs: firstKey(DOSSIER_REFUS_MOTIFS) }, siteUrl)],
    ['Famille : photo à refaire', () => sendPhotoRefusedEmail(e, { ...row, photo_refused_at: '2026-10-02 10:00:00', photo_refus_motifs: firstKey(PHOTO_REFUS_MOTIFS) }, siteUrl)],
    ['Famille : nouveau lien espace famille', () => sendFamilyLinkEmail(e, row, siteUrl, 'manuel')],
    ['Famille : lien de réinscription', () => sendReinscriptionEmail(e, row, siteUrl, '2027-06-30', false)],
    ['Famille : rappel de réinscription', () => sendReinscriptionEmail(e, row, siteUrl, '2027-06-30', true)],
    ['Famille : pré-inscription', () => sendPreinscriptionConfirmation(e, data, PREINSCRIPTION, siteUrl, organizationId)],
    [
      'Famille : message du club',
      () =>
        sendClubMessage(e, row, {
          subject: 'Entraînement du jeudi décalé',
          message: "Exceptionnellement, l'entraînement de jeudi aura lieu de 17h30 à 18h30.\n\nMerci de prévoir une gourde. Plus d'infos sur https://club-exemple.example/entrainements",
          siteUrl,
          organizationId,
        }),
    ],
    ['Famille : ouverture du groupe', () => sendPreinscriptionGroupOpened(e, row, PREINSCRIPTION, siteUrl, organizationId)],
    ["Famille : place libérée (liste d'attente)", () => sendPreinscriptionGroupOpened(e, { ...row, invite_deadline_at: '2026-11-11 10:00:00' }, PREINSCRIPTION, siteUrl, organizationId, { waitlist: true })],
    ['Famille : rappel, inscription à finaliser', () => sendPreinscriptionDeadlineReminder(e, { ...row, invite_deadline_at: '2026-11-11 10:00:00' }, PREINSCRIPTION, siteUrl, organizationId, ['dossier signé', 'première cotisation'])],
    ['Famille : versement reçu, reste à payer', () => sendPartialPaymentEmail(e, { ...row, mode_paiement: 'Carte bancaire', montant_du_cents: 18000, montant_recu_cents: 6000 }, siteUrl, { montant: 6000 })],
    ['Famille : pré-inscription transférée en inscription', () => sendPreinscriptionTransferEmail(e, { ...row, categorie: 'U10', infos_famille_requises: 1, autorisation: 0, rgpd: 0, mode_paiement: null }, siteUrl)],
    ["Famille : délai d'inscription dépassé", () => sendPreinscriptionExpired(e, row, PREINSCRIPTION, siteUrl, organizationId)],
    ['Club : places libérées', () => sendPreinscriptionExpiredClub(e, [{ row, config: PREINSCRIPTION }], siteUrl, organizationId)],
    ['Club : nouvelle inscription', () => sendAdminNotification(e, data, siteUrl, null, organizationId)],
    ['Club : dossier signé à vérifier', () => sendClubUploadAlert(e, row, siteUrl, 'dossier')],
    ['Club : photo reçue', () => sendClubUploadAlert(e, row, siteUrl, 'photo')],
    ['Club : mode de paiement changé', () => sendClubPaymentModeAlert(e, { ...row, mode_paiement: 'Espèces' }, siteUrl, 'HelloAsso')],
    ["Club : code Pass'Sport ajouté", () => sendClubPassSportAlert(e, { ...row, pass_sport_code: '26-AB12-CD34' }, siteUrl)],
    [
      'Club : paiement HelloAsso à rattacher',
      () => sendHelloAssoAlert(e, siteUrl, { orderId: 123456, payer: { firstName: 'Camille', lastName: 'Exemple', email: to }, participants: ['Léa Exemple'], amount: 18000, reason: 'exemple', organizationId }),
    ],
    [
      'Club : récapitulatif du lundi',
      () =>
        sendWeeklySummary(
          e,
          siteUrl,
          { organizationId, saison: '2026-2027', nouvelles: [{ id: 0, name: 'Léa Exemple', categorie: 'U8 - U9', complete: false }], total: 1, complet: 0, dossierAVerifier: 1, missingDossier: 0, missingPhoto: 1, missingPaiement: 1 },
          'manuel'
        ),
    ],
    ['Club : nouvelle pré-inscription', () => sendPreinscriptionClubAlert(e, data, PREINSCRIPTION, 3, siteUrl, organizationId)],
    ['Club : groupe ouvert', () => sendPreinscriptionGroupOpenedClub(e, PREINSCRIPTION, { count: 15, invited: 15, created: true }, siteUrl, organizationId)],
    ["Club : liste d'attente complète", () => sendPreinscriptionWaitlistFullClub(e, PREINSCRIPTION, { count: 15, category: 'U8 - U9' }, siteUrl, organizationId)],
    ['Club : automatisation en échec', () => sendCronFailureAlert(e, siteUrl, { at: new Date().toISOString(), step: 'automations', organizationId })],
    [
      'Club : message du formulaire de contact',
      () =>
        sendContactMessage(e, { nom: 'Camille Exemple', email: to, sujet: 'Autre demande', message: 'Bonjour,\n\nÀ quelle heure ouvre le stade le jeudi ?\n\nMerci !' }, { siteUrl, organizationId }),
    ],
    ['Éducateur : lien de la fiche', () => sendEducateurLinkEmail(e, SAMPLE_EDUCATEUR(organizationId, to), siteUrl, { sampleUrl: `${siteUrl}/educateur/e${'0'.repeat(43)}` })],
    ['Club : fiche éducateur remplie', () => sendEducateurClubAlert(e, { ...SAMPLE_EDUCATEUR(organizationId, to), submitted_at: '2026-11-12 10:00:00' }, siteUrl)],
    ['Famille : newsletter', () => sendNewsletter(e, { email: to, prenom: 'Sam', nom: 'Exemple' }, { subject: 'Les nouvelles du club', message: 'Voici les nouvelles du mois.\n\nÀ bientôt au stade !', siteUrl, unsubscribeUrl: `${siteUrl}/newsletter/desinscription/exemple` })],
    ['Club : code de confirmation', () => sendPasswordChangeCode(e, '000000', siteUrl, organizationId)],
    ['Club : invitation à l’espace admin', () => sendAdminInviteEmail(e, { email: to, name: 'Camille Exemple', roleLabel: 'Secrétaire', url: `${siteUrl}/admin/invitation/exemple`, days: 7, organizationId })],
  ];
  const results = [];
  for (const [label, send] of samples) {
    let ok = false;
    try {
      ok = Boolean(await send());
    } catch {
      ok = false;
    }
    results.push({ label, ok });
  }
  return results;
}
