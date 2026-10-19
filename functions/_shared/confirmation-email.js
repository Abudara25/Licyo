// Depuis le 2026-10-09, tous les e-mails partent d'abord par SMTP depuis la boîte contact@ d'Infomaniak (_shared/smtp.js,
// secret SMTP_PASSWORD), Brevo restant le secours (voir brevoSend). Historique ci-dessous.
//
// E-mail de RÉCEPTION de l'inscription (pas une confirmation de licence — voir le contenu),
// envoyé via l'API Brevo (compte gratuit, français — préféré à Resend, une entreprise
// américaine, à la demande de l'utilisateur ; clé stockée dans le secret Cloudflare Pages
// BREVO_API_KEY — voir CLAUDE.md). Best-effort : n'importe quelle erreur ici ne doit jamais
// faire échouer l'inscription elle-même, c'est pour ça que sendConfirmationEmail() n'est jamais
// `await`ée directement dans le handler — voir `waitUntil()` dans functions/api/inscriptions.js.
// Expéditeur `contact@clubdemo.licyo.fr`, domaine authentifié DKIM/DMARC côté Brevo — voir
// CLAUDE.md pour le détail de la migration DKIM vers Cloudflare (2026-09-04).
// Le HTML ci-dessous est un e-mail "habillé" aux couleurs du club (maroon/or/crème, cf.
// assets/css/styles.css) plutôt qu'un simple texte — mise en page en table avec styles inline,
// seule approche fiable across les clients mail (Outlook en particulier ignore le CSS externe/
// flexbox/grid). Ne jamais utiliser de <style> externe ni de classes CSS ici : tout doit être en
// attributs/style inline directement sur chaque balise.
import { issueFamilyLink, FAMILY_LINK_DAYS } from './family-links.js';
import { getNotificationEmail, getCategoriesConfig, getFamilyInfo } from './settings-kv.js';
import { isInscriptionComplete, familyHasActionPending, dossierStatus, refusMotifs, hasBirthPlace, photoRefusMotifs } from './inscriptions-db.js';
import { logEmail } from './email-log.js';
import { sendSmtp } from './smtp.js';

const escapeHtml = (str = '') =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Repris de la liste éditable de /admin/categories, mais purement cosmétique (retire les espaces
// autour du tiret, ex. "U6 - U7" → "U6-U7") — pas besoin d'aller chercher le libellé exact d'une
// catégorie potentiellement renommée/supprimée depuis, contrairement à la saison (voir buildEmail).
const formatCategorie = (c = '') => c.replace(/\s*-\s*/g, '-');

// Second responsable légal facultatif (colonnes parent2_*) : il reçoit les mêmes e-mails que le
// premier, et le message s'adresse aux deux. `row` en snake_case, comme en base.
function familyRecipients(row) {
  const recipients = [{ email: row.email, name: `${row.parent_prenom} ${row.parent_nom}` }];
  const second = String(row.parent2_email || '').trim();
  if (second && second.toLowerCase() !== String(row.email).trim().toLowerCase()) {
    recipients.push({ email: second, name: `${row.parent2_prenom || ''} ${row.parent2_nom || ''}`.trim() || undefined });
  }
  return recipients;
}
const greetingName = (row) => (row.parent2_prenom ? `${row.parent_prenom} et ${row.parent2_prenom}` : row.parent_prenom);
const rowFromData = (data) => ({
  email: data.email,
  parent_prenom: data.parentPrenom,
  parent_nom: data.parentNom,
  parent2_prenom: data.parent2Prenom,
  parent2_nom: data.parent2Nom,
  parent2_email: data.parent2Email,
});

// Palette reprise de assets/css/styles.css (:root) pour rester cohérent avec le site.
const MAROON_950 = '#3a0f10';
const MAROON_900 = '#4f1414';
const GOLD_500 = '#f0a030';
const GOLD_400 = '#f4b658';
const GOLD_100 = '#fdf0da';
const GOLD_300 = '#f8d28e';
const CREAM_100 = '#fbf7ee';
const CREAM_200 = '#f3ecd8';
const INK_900 = '#201412';
const INK_700 = '#4a3a36';

// Bandeau d'en-tête : rayures diagonales du .hero du site (styles.css, .hero::before), en image
// répétée — les dégradés CSS sont ignorés par Gmail. Attribut background + style pour couvrir le
// plus de clients ; ceux qui ignorent les deux gardent le fond bordeaux uni. Le logo est un PNG
// (assets/images/email/logo.png) : Gmail convertit le WebP en perdant la transparence (damier).
const headerBackground = (siteUrl) => `bgcolor="${MAROON_900}" background="${siteUrl}/assets/images/email/stripes.png"`;
const headerBackgroundStyle = (siteUrl) =>
  `background-color:${MAROON_900};background-image:url('${siteUrl}/assets/images/email/stripes.png');background-repeat:repeat;`;

// Lien de l'espace famille d'un e-mail : lien neuf à durée limitée (_shared/family-links.js), posé sur la fiche par
// withFamilyLink() juste avant l'envoi ; à défaut, la page /espace-famille, où la famille demande un lien par e-mail.
const suiviUrlOf = (row, siteUrl, hash = '') => (row.family_link ? `${siteUrl}/depot/${row.family_link}${hash}` : `${siteUrl}/espace-famille`);

function buildEmail(data, familyToken, siteUrl, saison, prix = null) {
  const depotUrl = suiviUrlOf({ family_link: familyToken }, siteUrl);
  const nomEnfant = `${data.enfantPrenom} ${data.enfantNom}`;
  const categorie = formatCategorie(data.categorie);

  // Le point important : ne jamais donner l'impression que l'inscription (ou la licence) est
  // déjà acquise. Elle ne l'est qu'une fois le dossier signé déposé, l'adhésion réglée, ET la
  // licence enregistrée par le club auprès de la FFF via Footclubs (démarche faite par le club,
  // pas par la famille, une fois le dossier complet — délai habituel de quelques jours).
  const text = `Bonjour ${greetingName(rowFromData(data))},

Nous avons bien reçu la demande d'inscription de ${nomEnfant} (${categorie}) au Club Démo pour la saison ${saison}.

Important : cette inscription n'est pas encore définitive. Elle sera confirmée une fois :
1. le dossier signé déposé (lien ci-dessous),
2. une photo de votre enfant ajoutée depuis le même lien (de face, sur fond blanc — un mur blanc suffit),
3. l'adhésion réglée (${data.modePaiement}),
4. et la licence de votre enfant enregistrée par le club auprès de la Fédération Française de Football (FFF) via la plateforme Footclubs — cette dernière étape est effectuée par le club une fois le dossier complet, généralement sous quelques jours.

Suivez l'avancement de l'inscription (dossier, photo, paiement) et déposez vos documents ici :
${depotUrl}

Pour ne rien manquer : ajoutez contact@clubdemo.licyo.fr à vos contacts, le club vous écrira à chaque étape. Si cet e-mail était dans vos courriers indésirables, marquez-le comme « non spam ».

Des questions ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo
Stade municipal, 1 rue du Stade, Sportville`;

  const step = (n, label) => `
              <tr>
                <td style="padding:0 0 16px 0;" valign="top" width="36">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr><td width="26" height="26" align="center" valign="middle" style="background-color:${MAROON_900};color:${CREAM_100};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;border-radius:50%;">${n}</td></tr>
                  </table>
                </td>
                <td style="padding:0 0 16px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${INK_900};" valign="top">${label}</td>
              </tr>`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Inscription — Club Démo</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM_100};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_100};">
    Inscription de ${escapeHtml(nomEnfant)} bien reçue — prochaine étape : déposer le dossier signé et une photo.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${GOLD_300};">
          <tr>
            <td ${headerBackground(siteUrl)} style="${headerBackgroundStyle(siteUrl)}padding:28px 32px;text-align:center;">
              <img src="${siteUrl}/assets/images/email/logo.png" width="48" height="48" alt="Club Démo" style="display:block;margin:0 auto 10px auto;border-radius:8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:.02em;">Club Démo</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GOLD_400};text-transform:uppercase;letter-spacing:.12em;margin-top:2px;">Club de démonstration · École de foot</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:${INK_900};">Bonjour ${escapeHtml(greetingName(rowFromData(data)))},</p>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${INK_900};">Nous avons bien reçu la demande d'inscription de <strong>${escapeHtml(nomEnfant)}</strong> (${escapeHtml(categorie)}) au Club Démo pour la saison ${escapeHtml(saison)}.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GOLD_100};border-left:4px solid ${GOLD_500};border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${INK_900};">
                    <strong style="color:${MAROON_900};">Important :</strong> cette inscription n'est pas encore définitive. Elle sera confirmée une fois les étapes ci-dessous complétées.
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:8px;">
                ${step(1, `Déposer le <strong>dossier signé</strong> (bouton ci-dessous).`)}
                ${step(2, `Ajouter une <strong>photo de votre enfant</strong>, de face et sur fond blanc (un mur blanc suffit), depuis le même lien.`)}
                ${step(3, `Régler l'adhésion — mode choisi : <strong>${escapeHtml(data.modePaiement)}</strong>.${data.passSportCode ? ` Avec votre Pass'Sport (code ${escapeHtml(data.passSportCode)}), l'adhésion passe à ${prix ? prix - 50 : 130} €, à régler au club (carte bancaire, espèces ou chèque) en présentant votre code : la réduction ne s'applique pas au paiement en ligne. Nous vérifions chaque code — s'il n'est pas valable, les 50 € restants vous seront demandés avant l'enregistrement de la licence.` : ''}`)}
                ${step(4, `La licence de votre enfant est enregistrée par le club auprès de la Fédération Française de Football (FFF) via la plateforme Footclubs, une fois le dossier complet — généralement sous quelques jours.`)}
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 28px auto;">
                <tr>
                  <td align="center" style="background-color:${GOLD_500};border-radius:8px;">
                    <a href="${depotUrl}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${MAROON_950};text-decoration:none;">Suivre mon inscription</a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};border-radius:8px;margin:0 0 20px 0;">
                <tr>
                  <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${INK_900};">
                    <strong style="color:${MAROON_900};">Pour ne rien manquer :</strong> ajoutez <strong>contact@clubdemo.licyo.fr</strong> à vos contacts, le club vous écrira à chaque étape. Si cet e-mail était dans vos courriers indésirables, marquez-le comme « non spam » : les suivants arriveront directement dans votre boîte.
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:${INK_700};">Des questions ? Répondez directement à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.</p>
              <p style="margin:24px 0 0 0;font-size:14px;line-height:20px;color:${INK_900};">Sportivement,<br><strong>Club Démo</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:${CREAM_200};padding:20px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:${INK_700};text-align:center;">
              Club Démo · Stade municipal, 1 rue du Stade, Sportville, Club de démonstration<br>
              Cet e-mail vous est envoyé suite à votre demande d'inscription sur <a href="${siteUrl}" style="color:${INK_700};">clubdemo.licyo.fr</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: `Inscription de ${nomEnfant} — Club Démo (à finaliser)`, html, text };
}

export async function sendConfirmationEmail(env, data, uploadToken, siteUrl, inscriptionId = null, organizationId = null) {
  if (!mailConfigured(env)) return; // aucun service d'envoi configuré, voir CLAUDE.md

  // Lu côté serveur (pas data.saison envoyé par le client) : reste la source de vérité même si le
  // navigateur de la famille avait chargé /api/categories avant un changement de saison entre-temps.
  const { saison, prix } = await getCategoriesConfig(env, organizationId);
  const { subject, html, text } = buildEmail(data, uploadToken, siteUrl, saison, prix);

  const body = {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(rowFromData(data)),
    subject,
    htmlContent: html,
    textContent: text,
  };

  // best-effort : brevoSend ne lève jamais, un échec d'envoi ne fait pas échouer l'inscription
  return brevoSend(env, body, { kind: 'confirmation', origin: 'famille', inscriptionId, organizationId });
}

// Notifie le club d'une nouvelle inscription (sans ça, il ne la découvre qu'en consultant
// /admin/inscriptions). Habillage « club » : voir clubEmail() plus bas.
export async function sendAdminNotification(env, data, siteUrl, inscriptionId = null, organizationId = null) {
  const to = await clubRecipients(env, organizationId);
  if (!to.length) return false;

  const nomEnfant = `${data.enfantPrenom} ${data.enfantNom}`;
  const categorie = formatCategorie(data.categorie);
  const naissance = /^\d{4}-\d{2}-\d{2}$/.test(data.naissance || '') ? data.naissance.split('-').reverse().join('/') : data.naissance;
  const second = data.parent2Prenom || data.parent2Nom;
  const cta = { label: 'Voir la fiche', url: inscriptionId ? `${siteUrl}/admin/inscriptions/${inscriptionId}` : `${siteUrl}/admin/inscriptions` };
  const mailto = (email) => `<a href="mailto:${escapeHtml(email)}" style="color:${MAROON_900};">${escapeHtml(email)}</a>`;

  const html = clubEmail({
    siteUrl,
    preheader: `${nomEnfant} (${categorie}) vient de s'inscrire sur le site.`,
    eyebrow: 'Espace admin · Nouvelle inscription',
    title: nomEnfant,
    subtitle: `${categorie} · né(e) le ${naissance}`,
    body: `${clubParagraph('Une nouvelle inscription vient d’arriver sur le site.')}
              ${clubInfoRows([
                ['Responsable légal', escapeHtml(`${data.parentPrenom} ${data.parentNom}`)],
                ['E-mail', mailto(data.email)],
                ['Téléphone', escapeHtml(data.telephone || '—')],
                second && ['2e responsable', escapeHtml(`${data.parent2Prenom || ''} ${data.parent2Nom || ''}`.trim())],
                second && data.parent2Email && ['E-mail (2e)', mailto(data.parent2Email)],
                second && data.parent2Telephone && ['Téléphone (2e)', escapeHtml(data.parent2Telephone)],
                ['Paiement', escapeHtml(data.modePaiement || '—')],
                data.passSportCode && ["Pass'Sport", `${escapeHtml(data.passSportCode)} — 50 € à déduire`],
              ])}
              ${clubCallout('Il reste à la famille : dossier signé, photo et paiement. Vous serez prévenu à chaque dépôt.')}`,
    cta,
  });

  const text = clubText(
    `Nouvelle inscription reçue sur le site :

Enfant : ${nomEnfant} (${categorie})
Naissance : ${naissance}
Parent : ${data.parentPrenom} ${data.parentNom}
E-mail : ${data.email}
Téléphone : ${data.telephone || '—'}${
      second ? `\n2e responsable légal : ${data.parent2Prenom || ''} ${data.parent2Nom || ''} — ${data.parent2Email || 'pas d’e-mail'} — ${data.parent2Telephone || 'pas de téléphone'}` : ''
    }
Mode de paiement : ${data.modePaiement}${data.passSportCode ? `
Pass'Sport : ${data.passSportCode} (50 € à déduire)` : ''}`,
    cta
  );

  // Best-effort : brevoSend ne lève jamais, un échec d'envoi ne fait pas échouer l'inscription.
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `Nouvelle inscription : ${nomEnfant}`,
    htmlContent: html,
    textContent: text,
  }, { kind: 'club_inscription', origin: 'famille', inscriptionId, organizationId });
}

// Relance d'une inscription incomplète (dossier, photo et/ou paiement manquants) : manuelle depuis
// /admin/inscriptions ou la fiche, ou automatique (runReminders dans _shared/automations.js).
// Chaque étape manquante a sa carte avec un bouton qui mène droit au bon endroit (page de suivi
// /depot/<token>#dossier|#photo, lien HelloAsso de la catégorie), les étapes validées restent
// visibles en vert pour montrer l'avancement. Même habillage que buildEmail() ci-dessus (dupliqué,
// voir la note en tête de fichier).
const STADE_MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Stade+municipal+1+rue+du+Stade+00000+Sportville';

function buildReminderEmail(row, siteUrl, { helloAssoUrl = '', prix = null } = {}) {
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const prenom = row.enfant_prenom;
  const categorie = formatCategorie(row.categorie);
  const suiviUrl = suiviUrlOf(row, siteUrl);
  const mode = row.mode_paiement || '';
  const payOnline = mode === 'HelloAsso' && /^https:\/\//.test(helloAssoUrl);
  const prixText = prix ? `${prix} € (ou 3 × ${Math.round((prix / 3) * 100) / 100} € sans frais sur HelloAsso)` : '';

  const dossier = dossierStatus(row);
  const motifs = refusMotifs(row);
  const steps = [
    {
      key: 'naissance',
      ok: hasBirthPlace(row),
      okLabel: 'Renseigné',
      title: 'Lieu de naissance',
      text: `La ville et le pays de naissance de ${prenom} sont nécessaires pour sa licence : il suffit de les indiquer sur votre espace famille (moins d'une minute).`,
      cta: suiviUrl && { label: 'Indiquer le lieu de naissance', url: `${suiviUrl}#naissance` },
    },
    {
      key: 'dossier',
      ok: dossier === 'valide',
      // Déposé, en attente de vérification par le club : rien à faire pour la famille.
      pending: dossier === 'a_verifier',
      title: 'Dossier signé',
      text:
        dossier === 'refuse'
          ? `Le dossier reçu n'a pas pu être validé${motifs.length ? ` : ${motifs.join(' ')}` : '.'} Complétez-le puis déposez-le à nouveau.`
          : "Imprimez le dossier d'inscription, remplissez le lieu et la date, signez-le, puis déposez-le : un scan ou une simple photo du document suffit.",
      cta: suiviUrl && { label: dossier === 'refuse' ? 'Déposer le dossier corrigé' : 'Déposer le dossier', url: `${suiviUrl}#dossier` },
      alt: suiviUrl && { intro: "Vous n'avez plus le dossier ?", label: 'Le retélécharger', url: `${suiviUrl}?telecharger=1#dossier` },
    },
    {
      key: 'photo',
      ok: Boolean(row.photo_uploaded_at),
      okLabel: 'Reçue',
      title: `Photo de ${prenom}`,
      text: `De face, sur un fond blanc (un mur blanc fait parfaitement l'affaire), bien éclairée et sans casquette. Une photo prise avec un téléphone convient très bien. Elle reste réservée au club.`,
      cta: suiviUrl && { label: 'Ajouter la photo', url: `${suiviUrl}#photo` },
    },
    {
      key: 'paiement',
      ok: Boolean(row.paye),
      okLabel: 'Payé',
      title: "Paiement de l'adhésion",
      text: `${
        payOnline
          ? `Vous avez choisi de régler en ligne avec HelloAsso (carte bancaire)${prixText ? ` : ${prixText}` : ''}.`
          : `${mode ? `Vous avez choisi de régler par ${mode.toLowerCase()}${prix ? ` (${prix} €)` : ''} : ` : ''}${
              mode === 'Carte bancaire' ? 'sur place' : 'à remettre'
            }, auprès d'un responsable du club, par exemple lors d'un entraînement, le jeudi de 17h à 18h au Stade municipal.`
      }${
        row.pass_sport_code
          ? ` Pass'Sport (code ${escapeHtml(row.pass_sport_code)}) : 50 € de moins, à régler au club en présentant votre code (la réduction ne s'applique pas au paiement en ligne). Nous vérifions chaque code — s'il n'est pas valable, les 50 € restants vous seront demandés avant l'enregistrement de la licence.`
          : ''
      }`,
      cta: payOnline && { label: 'Payer sur HelloAsso', url: helloAssoUrl },
      alt: suiviUrl && {
        intro: mode === 'HelloAsso' ? 'Vous préférez régler en espèces ou par chèque ?' : 'Vous préférez payer en ligne par carte (en 3 fois sans frais possible) ?',
        label: 'Changer de mode de paiement',
        url: `${suiviUrl}#paiement`,
      },
    },
  ];
  const missing = steps.filter((s) => !s.ok && !s.pending);
  const done = steps.filter((s) => s.ok).length;
  const percent = Math.round((done / steps.length) * 100);
  const remaining = missing.length > 1 ? `il reste ${missing.length} étapes` : 'il reste une seule étape';

  const text = `Bonjour ${greetingName(row)},

Petit rappel concernant l'inscription de ${nomEnfant} (${categorie}) au Club Démo : ${remaining} pour la finaliser${done ? ` (${done} sur ${steps.length} déjà validée${done > 1 ? 's' : ''})` : ''}.

${missing
  .map((s) => `• ${s.title}\n  ${s.text}${s.cta ? `\n  ${s.cta.label} : ${s.cta.url}` : ''}${s.alt ? `\n  ${s.alt.intro} ${s.alt.label} : ${s.alt.url}` : ''}`)
  .join('\n\n')}
${steps.some((s) => s.pending) ? '\nLe dossier signé est bien reçu : le club le vérifie en ce moment, rien à faire de votre côté pour cette étape.\n' : ''}${suiviUrl ? `\nSuivre l'inscription et déposer vos documents : ${suiviUrl}\n` : ''}
Infos pratiques
- Entraînements : le jeudi de 17h à 18h
- Stade municipal, 1 rue du Stade, Sportville : ${STADE_MAPS_URL}
- Ce qu'il faut prévoir : ${siteUrl}/entrainements.html

Des questions ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo`;

  const button = (cta, primary) => `
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0 0;">
                        <tr>
                          <td align="center" style="background-color:${primary ? GOLD_500 : MAROON_900};border-radius:8px;">
                            <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;padding:11px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${primary ? MAROON_950 : '#ffffff'};text-decoration:none;">${escapeHtml(cta.label)} &rarr;</a>
                          </td>
                        </tr>
                      </table>`;

  let n = 0;
  const stepsHtml = steps
    .map((s) => {
      if (s.ok) {
        return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;background-color:${GREEN_100};border-radius:10px;">
                <tr>
                  <td width="44" valign="middle" style="padding:12px 0 12px 16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="26" height="26" align="center" valign="middle" style="background-color:${GREEN_700};color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;border-radius:50%;">&#10003;</td></tr></table>
                  </td>
                  <td valign="middle" style="padding:12px 16px 12px 10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${GREEN_700};"><strong>${escapeHtml(s.title)}</strong></td>
                  <td align="right" valign="middle" style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${GREEN_700};">${s.okLabel || 'Validé'}</td>
                </tr>
              </table>`;
      }
      if (s.pending) {
        return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;background-color:${CREAM_100};border-radius:10px;">
                <tr>
                  <td valign="middle" style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK_900};"><strong>${escapeHtml(s.title)}</strong><br><span style="font-size:13px;color:${INK_700};">Bien reçu, en cours de vérification par le club.</span></td>
                  <td align="right" valign="middle" style="padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#8a4b12;white-space:nowrap;">En vérification</td>
                </tr>
              </table>`;
      }
      n++;
      return `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;background-color:#ffffff;border:1px solid ${GOLD_300};border-left:4px solid ${GOLD_500};border-radius:10px;">
                <tr>
                  <td width="44" valign="top" style="padding:16px 0 16px 16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="26" height="26" align="center" valign="middle" style="background-color:${MAROON_900};color:${CREAM_100};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;border-radius:50%;">${n}</td></tr></table>
                  </td>
                  <td valign="top" style="padding:16px 18px 16px 10px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:15px;line-height:22px;font-weight:bold;color:${MAROON_900};">${escapeHtml(s.title)} <span style="display:inline-block;margin-left:6px;padding:2px 9px;border-radius:999px;background-color:${GOLD_100};color:#8a4b12;font-size:11px;line-height:16px;vertical-align:middle;">À faire</span></div>
                    <div style="margin-top:4px;font-size:13px;line-height:20px;color:${INK_700};">${escapeHtml(s.text)}</div>${s.cta ? button(s.cta, n === 1) : ''}${
                      s.alt
                        ? `
                    <div style="margin-top:12px;font-size:13px;line-height:19px;color:${INK_700};">${escapeHtml(s.alt.intro)} <a href="${escapeHtml(s.alt.url)}" target="_blank" style="color:${MAROON_900};font-weight:bold;">${escapeHtml(s.alt.label)}</a></div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>`;
    })
    .join('');

  const info = (label, value) => `
                <tr>
                  <td valign="top" width="96" style="padding:5px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:${INK_700};text-transform:uppercase;letter-spacing:.06em;">${label}</td>
                  <td valign="top" style="padding:5px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:19px;color:${INK_900};">${value}</td>
                </tr>`;
  const link = (url, label) => `<a href="${escapeHtml(url)}" target="_blank" style="color:${MAROON_900};font-weight:bold;">${label}</a>`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Rappel — Club Démo</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM_100};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_100};">
    Inscription de ${escapeHtml(nomEnfant)} : ${remaining}, tout se fait en quelques minutes depuis votre page de suivi.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${GOLD_300};">
          <tr>
            <td ${headerBackground(siteUrl)} style="${headerBackgroundStyle(siteUrl)}padding:28px 28px 26px 28px;text-align:center;">
              <img src="${siteUrl}/assets/images/email/logo.png" width="56" height="56" alt="Club Démo" style="display:block;margin:0 auto 10px auto;border-radius:8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GOLD_400};text-transform:uppercase;letter-spacing:.14em;">Club Démo · Saison ${escapeHtml(row.saison || '')}</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:bold;color:#ffffff;margin-top:8px;">Encore un petit effort&nbsp;!</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${GOLD_300};margin-top:4px;">L'inscription de ${escapeHtml(prenom)} est presque terminée</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${INK_900};">Bonjour ${escapeHtml(greetingName(row))},</p>
              <p style="margin:0 0 22px 0;font-size:15px;line-height:22px;color:${INK_900};">Petit rappel concernant l'inscription de <strong>${escapeHtml(nomEnfant)}</strong> (${escapeHtml(categorie)}) : ${remaining} pour la finaliser. Tout se fait en quelques minutes, depuis votre téléphone.</p>
              ${
                done
                  ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px 0;">
                <tr>
                  <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${INK_900};">${done} étape${done > 1 ? 's' : ''} validée${done > 1 ? 's' : ''} sur ${steps.length}</td>
                  <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MAROON_900};">${percent}&nbsp;%</td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;background-color:${CREAM_200};border-radius:999px;">
                <tr>
                  <td width="${percent}%" height="8" style="background-color:${GOLD_500};border-radius:999px;font-size:0;line-height:0;">&nbsp;</td>
                  <td height="8" style="font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>`
                  : ''
              }
              ${stepsHtml}
              ${
                suiviUrl
                  ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 26px auto;">
                <tr>
                  <td align="center" style="border:2px solid ${MAROON_900};border-radius:8px;">
                    <a href="${suiviUrl}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${MAROON_900};text-decoration:none;">Voir le suivi de mon inscription</a>
                  </td>
                </tr>
              </table>`
                  : '<div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>'
              }
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;background-color:${CREAM_100};border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MAROON_900};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Infos pratiques</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${info('Quand', 'Le jeudi, de 17h à 18h')}
                      ${info('Où', `Stade municipal, 1 rue du Stade, Sportville<br>${link(STADE_MAPS_URL, 'Voir sur la carte')}`)}
                      ${info('À prévoir', `Tenue adaptée à la météo, stabilisés ou crampons moulés, gourde d'eau — ${link(`${siteUrl}/entrainements.html`, 'tous les détails')}`)}
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:${INK_700};">Des questions ? Répondez directement à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.</p>
              <p style="margin:20px 0 24px 0;font-size:14px;line-height:20px;color:${INK_900};">Sportivement,<br><strong>Club Démo</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:${CREAM_200};padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:${INK_700};text-align:center;">
              <a href="https://www.instagram.com/clubdemo" target="_blank" style="color:${MAROON_900};font-weight:bold;text-decoration:none;">Instagram</a> &nbsp;·&nbsp;
              <a href="https://www.facebook.com/clubdemo" target="_blank" style="color:${MAROON_900};font-weight:bold;text-decoration:none;">Facebook</a> &nbsp;·&nbsp;
              <a href="${siteUrl}" target="_blank" style="color:${MAROON_900};font-weight:bold;text-decoration:none;">clubdemo.licyo.fr</a><br>
              Club Démo · Stade municipal, 1 rue du Stade, Sportville, Club de démonstration<br>
              Cet e-mail vous est envoyé suite à votre demande d'inscription.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject: `Rappel — inscription de ${nomEnfant} : ${remaining}`, html, text };
}

// Avant d'écrire à la famille : identifiant interne (upload_token, créé pour les anciennes fiches qui n'en ont pas,
// sert aux fichiers R2) et lien neuf à durée limitée vers l'espace famille (family_link, jamais enregistré en clair).
async function ensureUploadToken(env, row) {
  const withId = await ensureInternalToken(env, row);
  if (!env.DB || !withId.id || !withId.organization_id) return withId;
  try {
    return { ...withId, family_link: await issueFamilyLink(env.DB, withId.organization_id, withId.id) };
  } catch {
    return withId; // lien vers /espace-famille à la place
  }
}

async function ensureInternalToken(env, row) {
  if (row.upload_token || !env.DB || !row.id || !row.organization_id) return row;
  const token = crypto.randomUUID();
  try {
    await env.DB.prepare('UPDATE inscriptions SET upload_token = ? WHERE organization_id = ? AND id = ? AND upload_token IS NULL')
      .bind(token, row.organization_id, row.id)
      .run();
    const fresh = await env.DB.prepare('SELECT upload_token FROM inscriptions WHERE organization_id = ? AND id = ?').bind(row.organization_id, row.id).first();
    return { ...row, upload_token: fresh?.upload_token || null };
  } catch {
    return row;
  }
}

// Contrairement à sendConfirmationEmail/sendAdminNotification (best-effort, fire-and-forget via
// waitUntil), l'appelant (functions/admin/inscriptions.js, action=bulk-reminder) a besoin du
// résultat pour compter succès/échecs et l'afficher dans la bannière — donc `await`ée, retourne
// true/false comme sendPasswordChangeCode.
// origin : 'manuel' (bouton de l'admin), 'auto' (runReminders) ou 'doublon' — seulement pour le journal.
export async function sendReminderEmail(env, row, siteUrl, origin = 'manuel') {
  if (!mailConfigured(env)) return false;
  if (!familyHasActionPending(row)) return false; // complet, ou seul le club a encore quelque chose à vérifier

  const withToken = await ensureUploadToken(env, row);
  const config = await getCategoriesConfig(env, row.organization_id);
  const categorie = (config.categories || []).find((c) => c.label === row.categorie);
  const { subject, html, text } = buildReminderEmail(
    { ...withToken, saison: withToken.saison || config.saison },
    siteUrl,
    { helloAssoUrl: categorie?.helloAssoUrl || '', prix: config.prix }
  );
  const body = {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(row),
    subject,
    htmlContent: html,
    textContent: text,
  };

  return brevoSend(env, body, { kind: 'relance', origin, inscriptionId: row.id, organizationId: row.organization_id });
}

// Réinscription prioritaire, envoyée depuis /admin/reinscription (sélection multiple → "Envoyer le
// lien de réinscription", action=bulk-reinscription sur functions/admin/inscriptions.js) sur les
// fiches de la saison qui se termine — donne à chaque famille déjà inscrite un lien personnel
// (/reinscription/<token>, voir functions/reinscription/[token].js) pour réserver la place de son
// enfant avant l'ouverture au public. Reprend la même structure visuelle que buildReminderEmail()
// ci-dessus (dupliquée, voir la note en tête de fichier sur le choix de ne pas factoriser ces
// templates). isRappel (bool) : même contenu, wording adapté pour une relance envoyée à une famille
// déjà contactée mais qui n'a pas encore réservé sa place (action=bulk-reinscription-rappel,
// déclenchée à la main par un responsable du club depuis /admin/reinscription, autant de fois que
// nécessaire avant la date limite — pas d'automatisation programmée, voir CLAUDE.md/la discussion
// avec l'utilisateur sur les limites d'infra Cron Trigger pour ce projet).
function buildReinscriptionEmail(row, siteUrl, dateLimiteReinscription, isRappel) {
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const lienUrl = `${siteUrl}/reinscription/${row.reinscription_token}`;
  const deadlinePhrase = dateLimiteReinscription
    ? ` avant le ${escapeHtml(dateLimiteReinscription.split('-').reverse().join('/'))}`
    : '';
  const intro = isRappel
    ? `Petit rappel : la place de ${nomEnfant} au Club Démo est toujours réservée en priorité pour la saison prochaine, mais nous n'avons pas encore reçu votre confirmation.`
    : `En tant que famille déjà inscrite, ${nomEnfant} bénéficie d'une place prioritaire pour la saison prochaine au Club Démo — avant l'ouverture des inscriptions au public.`;

  const text = `Bonjour ${greetingName(row)},

${intro}

Pour réserver sa place${deadlinePhrase}, cliquez sur ce lien personnel (les informations de l'an dernier sont déjà pré-remplies, il ne reste qu'à les vérifier) :
${lienUrl}

Des questions ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo
Stade municipal, 1 rue du Stade, Sportville`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Réinscription prioritaire — Club Démo</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM_100};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_100};">
    Réservez la place de ${escapeHtml(nomEnfant)} pour la saison prochaine, en priorité.
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${GOLD_300};">
          <tr>
            <td ${headerBackground(siteUrl)} style="${headerBackgroundStyle(siteUrl)}padding:28px 32px;text-align:center;">
              <img src="${siteUrl}/assets/images/email/logo.png" width="48" height="48" alt="Club Démo" style="display:block;margin:0 auto 10px auto;border-radius:8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:.02em;">Club Démo</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GOLD_400};text-transform:uppercase;letter-spacing:.12em;margin-top:2px;">Club de démonstration · École de foot</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:${INK_900};">Bonjour ${escapeHtml(greetingName(row))},</p>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${INK_900};">${
                isRappel
                  ? `Petit rappel : la place de <strong>${escapeHtml(nomEnfant)}</strong> est toujours réservée en priorité pour la saison prochaine, mais nous n'avons pas encore reçu votre confirmation.`
                  : `En tant que famille déjà inscrite, <strong>${escapeHtml(nomEnfant)}</strong> bénéficie d'une place prioritaire pour la saison prochaine — avant l'ouverture des inscriptions au public.`
              }</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${GOLD_100};border-left:4px solid ${GOLD_500};border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${INK_900};">
                    Réservez sa place${deadlinePhrase} : les informations de l'an dernier sont déjà pré-remplies, il ne reste qu'à les vérifier.
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 28px auto;">
                <tr>
                  <td align="center" style="background-color:${GOLD_500};border-radius:8px;">
                    <a href="${lienUrl}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${MAROON_950};text-decoration:none;">${isRappel ? 'Confirmer' : 'Réserver'} la place de ${escapeHtml(row.enfant_prenom)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:${INK_700};">Des questions ? Répondez directement à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.</p>
              <p style="margin:24px 0 0 0;font-size:14px;line-height:20px;color:${INK_900};">Sportivement,<br><strong>Club Démo</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:${CREAM_200};padding:20px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:${INK_700};text-align:center;">
              Club Démo · Stade municipal, 1 rue du Stade, Sportville, Club de démonstration<br>
              Cet e-mail vous est envoyé suite à votre inscription précédente sur <a href="${siteUrl}" style="color:${INK_700};">clubdemo.licyo.fr</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: isRappel ? `Rappel — réinscription prioritaire de ${nomEnfant} — Club Démo` : `Réinscription prioritaire — ${nomEnfant} — Club Démo`,
    html,
    text,
  };
}

// Contrairement à sendConfirmationEmail/sendAdminNotification (best-effort, fire-and-forget via
// waitUntil), l'appelant (functions/admin/inscriptions.js, action=bulk-reinscription(-rappel)) a
// besoin du résultat pour compter succès/échecs et l'afficher dans la bannière — donc `await`ée,
// retourne true/false comme sendReminderEmail. row.reinscription_token doit déjà être généré et
// enregistré avant cet appel (voir onRequestPost dans functions/admin/inscriptions.js).
export async function sendReinscriptionEmail(env, row, siteUrl, dateLimiteReinscription, isRappel = false) {
  if (!mailConfigured(env)) return false;
  if (!row.reinscription_token) return false;

  const { subject, html, text } = buildReinscriptionEmail(row, siteUrl, dateLimiteReinscription, isRappel);
  const body = {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(row),
    subject,
    htmlContent: html,
    textContent: text,
  };

  return brevoSend(env, body, { kind: isRappel ? 'reinscription_rappel' : 'reinscription', origin: 'manuel', inscriptionId: row.id, organizationId: row.organization_id });
}

// Code de double vérification avant un changement de mot de passe admin (voir
// functions/admin/parametres.js et _shared/settings-kv.js). Contrairement aux e-mails ci-dessus,
// un échec d'envoi ici DOIT bloquer le changement — sans lui, personne ne serait informé qu'un
// mot de passe a été modifié. L'appelant vérifie donc le retour (true/false) plutôt que d'ignorer
// l'erreur.
// Seul le code à usage unique est envoyé : JAMAIS le mot de passe, ni l'ancien ni le nouveau (la fonction
// ne le reçoit même pas ; vérifié par tests/emails.test.mjs). Texte volontairement sobre, sans « mot de
// passe » dans l'objet : c'est le vocabulaire type de l'hameçonnage, que les filtres anti-spam pénalisent.
export async function sendPasswordChangeCode(env, code, siteUrl = 'https://clubdemo.licyo.fr', organizationId = null) {
  const to = await clubRecipients(env, organizationId);
  if (!to.length) return false;

  const html = clubEmail({
    siteUrl,
    preheader: "Code à usage unique, valable 15 minutes.",
    eyebrow: 'Espace admin · Sécurité',
    title: 'Code de confirmation',
    body: `${clubParagraph("Une modification des accès à l'espace admin vient d'être demandée depuis la page Paramètres. Pour la valider, saisissez ce code sur cette même page :")}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;">
                <tr>
                  <td align="center" style="padding:18px;background-color:${CREAM_100};border:1px dashed ${GOLD_500};border-radius:10px;font-family:'Courier New',Courier,monospace;font-size:34px;line-height:40px;font-weight:bold;letter-spacing:.3em;color:${MAROON_900};">${escapeHtml(code)}</td>
                </tr>
              </table>
              <p style="margin:0 0 18px 0;text-align:center;font-size:13px;line-height:19px;color:${INK_700};">Code à usage unique, valable 15 minutes. Ce n'est pas un identifiant de connexion.</p>
              ${clubCallout("Vous n'êtes pas à l'origine de cette demande ? Ne saisissez pas ce code : rien ne change tant qu'il n'a pas été saisi. Aucun e-mail du club ne vous demandera jamais vos identifiants.")}`,
  });

  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: "Espace admin : votre code de confirmation",
    htmlContent: html,
    textContent: clubText(
      `Une modification des accès à l'espace admin de clubdemo.licyo.fr vient d'être demandée depuis la page Paramètres.\n\nCode de confirmation : ${code}\n\nCode à usage unique, valable 15 minutes. Si vous n'êtes pas à l'origine de cette demande, ne saisissez pas ce code : rien ne change tant qu'il n'a pas été saisi.`
    ),
  }, { kind: 'code_admin', origin: 'manuel', organizationId });
}

// ---------------------------------------------------------------------------------------------
// E-mails des automatisations (déclenchés par _shared/automations.js et _shared/helloasso.js).

// Un service d'envoi est configuré : messagerie Infomaniak (SMTP_PASSWORD) ou Brevo (BREVO_API_KEY).
export const mailConfigured = (env) => Boolean(env.SMTP_PASSWORD || env.BREVO_API_KEY);

// Point de passage unique de tous les envois : chacun est inscrit au journal (_shared/email-log.js,
// affiché dans /admin/events) avec le type donné par `log` ({ kind, origin, inscriptionId }).
// Depuis le 2026-10-09 : d'abord la boîte contact@ d'Infomaniak en SMTP (pas de suivi des ouvertures, IP et domaine
// du club), puis Brevo en secours si l'envoi SMTP a échoué AVANT la transmission du message (jamais après : il a pu
// partir, un second envoi ferait un doublon). Le nom de la fonction est resté pour ne rien changer ailleurs.
async function brevoSend(env, body, log = null) {
  if (!mailConfigured(env)) return false;
  // Exemples d'e-mails (email-samples.js) : tout part vers l'adresse de test, objet préfixé, jamais rattaché à une
  // fiche. Posé uniquement par le code (objet env recopié), jamais par une variable Cloudflare.
  if (env.__sampleTo) {
    body = { ...body, to: [{ email: env.__sampleTo }], subject: `[Exemple] ${body.subject}` };
    log = log && { ...log, origin: 'manuel', inscriptionId: null };
  }
  let result = null;
  if (env.SMTP_PASSWORD) {
    result = await sendSmtp(env, body);
    if (!result.ok) console.warn(`E-mail : SMTP en échec (${result.error})${!result.dataSent && env.BREVO_API_KEY ? ', envoi par Brevo' : ''}`);
  }
  if (result && (result.ok || result.dataSent || !env.BREVO_API_KEY)) {
    await logEmail(env, body, log, result);
    return result.ok;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    result = { ok: res.ok, status: res.status, messageId: payload?.messageId, error: res.ok ? null : payload?.message || `HTTP ${res.status}` };
  } catch (error) {
    result = { ok: false, status: null, error: error?.message || 'Erreur réseau' };
  }
  await logEmail(env, body, log, result);
  return result.ok;
}

// Destinataires internes de l'organisation (adresse de notification de /admin/parametres).
async function clubRecipients(env, organizationId) {
  if (!organizationId) return [];
  return (await getNotificationEmail(env, organizationId))
    .split(',')
    .map((e) => ({ email: e.trim() }))
    .filter((r) => r.email);
}

const GREEN_100 = '#e3f2e6';
const GREEN_700 = '#2f6b3a';

// ---------------------------------------------------------------------------------------------
// E-mails internes au club (adresse de notification de /admin/parametres, contact@ par défaut) :
// même habillage que les e-mails famille (bandeau rayé, blason), en plus compact, avec un bouton
// qui mène droit à l'endroit à traiter dans l'admin. Chaque e-mail garde sa version texte.

const clubInfoRows = (rows) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${rows
    .filter(Boolean)
    .map(
      ([label, value]) => `
                <tr>
                  <td valign="top" style="padding:9px 12px 9px 0;border-bottom:1px solid ${CREAM_200};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${INK_700};white-space:nowrap;">${label}</td>
                  <td valign="top" align="right" style="padding:9px 0;border-bottom:1px solid ${CREAM_200};font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:19px;font-weight:bold;color:${INK_900};">${value}</td>
                </tr>`
    )
    .join('')}
              </table>`;

const clubCallout = (html, { tone = 'gold' } = {}) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${tone === 'green' ? GREEN_100 : GOLD_100};border-left:4px solid ${tone === 'green' ? GREEN_700 : GOLD_500};border-radius:8px;margin:0 0 22px 0;">
                <tr>
                  <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:${INK_900};">${html}</td>
                </tr>
              </table>`;

const clubPill = (label, ok) =>
  `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;line-height:16px;font-weight:bold;background-color:${ok ? GREEN_100 : GOLD_100};color:${ok ? GREEN_700 : '#8a4b12'};">${label}</span>`;

function clubEmail({ siteUrl, preheader = '', eyebrow, title, subtitle = '', body, cta = null, footerHtml = null }) {
  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px auto 8px auto;">
                <tr>
                  <td align="center" style="background-color:${GOLD_500};border-radius:8px;">
                    <a href="${escapeHtml(cta.url)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${MAROON_950};text-decoration:none;">${escapeHtml(cta.label)} &rarr;</a>
                  </td>
                </tr>
              </table>`
    : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Club Démo</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM_100};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_100};">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${GOLD_300};">
          <tr>
            <td ${headerBackground(siteUrl)} style="${headerBackgroundStyle(siteUrl)}padding:24px 26px 22px 26px;text-align:center;">
              <img src="${siteUrl}/assets/images/email/logo.png" width="48" height="48" alt="Club Démo" style="display:block;margin:0 auto 10px auto;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GOLD_400};text-transform:uppercase;letter-spacing:.14em;">${escapeHtml(eyebrow)}</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:21px;line-height:27px;font-weight:bold;color:#ffffff;margin-top:8px;">${escapeHtml(title)}</div>
              ${subtitle ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${GOLD_300};margin-top:4px;">${escapeHtml(subtitle)}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 26px 22px 26px;font-family:Arial,Helvetica,sans-serif;">
              ${body}
              ${button}
            </td>
          </tr>
          <tr>
            <td style="background-color:${CREAM_200};padding:16px 26px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:${INK_700};text-align:center;">
              ${footerHtml ?? `Message automatique du site <a href="${siteUrl}" target="_blank" style="color:${MAROON_900};font-weight:bold;text-decoration:none;">clubdemo.licyo.fr</a>, réservé aux responsables du club.<br>
              <a href="${siteUrl}/admin/parametres" target="_blank" style="color:${MAROON_900};text-decoration:underline;">Gérer les alertes et l'adresse de réception</a>`}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const clubText = (text, cta) => `${text}${cta ? `\n\n${cta.label} : ${cta.url}` : ''}\n\n— Message automatique du site clubdemo.licyo.fr`;
const clubParagraph = (html) => `<p style="margin:0 0 18px 0;font-size:15px;line-height:22px;color:${INK_900};">${html}</p>`;


// Suivi famille : une étape validée par le club (dossier ou photo reçus par e-mail, paiement reçu),
// ou le dossier complet. Récapitule les étapes avec leur état et renvoie vers la page de suivi.
// Bloc « Et maintenant ? » des e-mails de suivi, dès que le paiement est reçu : e-mail de la FFF pour
// finaliser la licence, groupe WhatsApp (lien réglé dans /admin/parametres) et infos pratiques.
// Jamais « inscription définitive » avant la licence FFF (voir CLAUDE.md).
function nextStepsContent(row, siteUrl, { complete, whatsappUrl }) {
  const prenom = row.enfant_prenom;
  // Règle du questionnaire de santé du sportif mineur : tout « non » = aucun certificat médical.
  const sante = 'Questionnaire de santé : si vous répondez « non » à toutes les questions, vous n’avez rien d’autre à fournir, aucun certificat médical n’est demandé. Si vous répondez « oui » à au moins une question, un certificat médical sera nécessaire.';
  const items = [
    {
      title: 'E-mail de la FFF pour la licence',
      text: complete
        ? `Dans les prochains jours, vous allez recevoir un e-mail de la Fédération Française de Football (FFF) pour finaliser en ligne la licence de ${prenom} : vérifier les informations, répondre au questionnaire de santé, puis valider. Sans cette étape, la licence ne peut pas être enregistrée. Pensez à regarder vos courriers indésirables.`
        : `Une fois toutes les étapes validées, le club demandera la licence de ${prenom} : vous recevrez alors un e-mail de la Fédération Française de Football (FFF) pour la finaliser en ligne (vérifier les informations, répondre au questionnaire de santé, puis valider). Pensez à regarder vos courriers indésirables.`,
      note: sante,
    },
  ];
  if (whatsappUrl) {
    items.push({
      title: 'Le groupe WhatsApp du club',
      text: 'Rejoignez-le pour recevoir les infos des entraînements : annulations, changements, événements.',
      ctas: [{ label: 'Rejoindre le groupe WhatsApp', url: whatsappUrl, color: '#1f8f4e' }],
    });
  }
  // Règle des parents : formulée avec chaleur (voir CLAUDE.md, « Ce qu'il faut prévoir » d'Entraînements).
  items.push({
    title: 'Une règle pour les parents',
    text: `Pendant la séance, seuls les éducateurs encadrent les enfants : merci de ne pas intervenir sur le terrain, même avec les meilleures intentions. Vos encouragements depuis le bord du terrain sont les bienvenus ! C'est ce qui permet à ${prenom} de se concentrer, de gagner en autonomie et de prendre du plaisir avec son équipe.`,
  });
  items.push({
    title: 'Suivez le club sur les réseaux',
    text: 'Abonnez-vous à Club Démo sur Instagram et Facebook : photos, nouvelles du club, événements. Un petit geste qui aide beaucoup un club tenu par des bénévoles !',
    ctas: [
      { label: 'Instagram', url: 'https://www.instagram.com/clubdemo', color: '#c13584' },
      { label: 'Facebook', url: 'https://www.facebook.com/clubdemo', color: '#1877f2' },
    ],
  });
  return { items, mapsUrl: STADE_MAPS_URL, prevoirUrl: `${siteUrl}/entrainements` };
}

function nextStepsText({ items, mapsUrl, prevoirUrl }) {
  return `Et maintenant ?
${items.map((i) => `- ${i.title} : ${i.text}${i.note ? `\n  ${i.note}` : ''}${(i.ctas || []).map((c) => `\n  ${c.label} : ${c.url}`).join('')}`).join('\n')}

Infos pratiques
- Entraînements : le jeudi de 17h à 18h
- Stade municipal, 1 rue du Stade, Sportville : ${mapsUrl}
- Ce qu'il faut prévoir : ${prevoirUrl}`;
}

function nextStepsHtml({ items, mapsUrl, prevoirUrl }) {
  const itemHtml = (i, n) => `
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px 0;background-color:#ffffff;border:1px solid ${GOLD_300};border-radius:10px;">
                <tr>
                  <td width="44" valign="top" style="padding:16px 0 16px 16px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="26" height="26" align="center" valign="middle" style="background-color:${MAROON_900};color:${CREAM_100};font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;border-radius:50%;">${n}</td></tr></table>
                  </td>
                  <td valign="top" style="padding:16px 18px 16px 10px;font-family:Arial,Helvetica,sans-serif;">
                    <div style="font-size:15px;line-height:22px;font-weight:bold;color:${MAROON_900};">${escapeHtml(i.title)}</div>
                    <div style="margin-top:4px;font-size:13px;line-height:20px;color:${INK_700};">${escapeHtml(i.text)}</div>${
                      i.note
                        ? `
                    <div style="margin-top:10px;padding:10px 12px;background-color:${GREEN_100};border-left:3px solid ${GREEN_700};border-radius:6px;font-size:13px;line-height:19px;color:${INK_900};">${escapeHtml(i.note)}</div>`
                        : ''
                    }${(i.ctas || [])
                      .map(
                        (c) => `
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:12px 8px 0 0;">
                      <tr>
                        <td align="center" style="background-color:${c.color};border-radius:8px;">
                          <a href="${escapeHtml(c.url)}" target="_blank" style="display:inline-block;padding:11px 22px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(c.label)} &rarr;</a>
                        </td>
                      </tr>
                    </table>`
                      )
                      .join('')}
                  </td>
                </tr>
              </table>`;
  const info = (label, value) => `
                      <tr>
                        <td valign="top" width="96" style="padding:5px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:${INK_700};text-transform:uppercase;letter-spacing:.06em;">${label}</td>
                        <td valign="top" style="padding:5px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:19px;color:${INK_900};">${value}</td>
                      </tr>`;
  const link = (url, label) => `<a href="${escapeHtml(url)}" target="_blank" style="color:${MAROON_900};font-weight:bold;">${label}</a>`;
  return `
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MAROON_900};text-transform:uppercase;letter-spacing:.08em;margin:4px 0 10px 0;">Et maintenant&nbsp;?</div>
              ${items.map((i, k) => itemHtml(i, k + 1)).join('')}
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 22px 0;background-color:${CREAM_100};border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MAROON_900};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Infos pratiques</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${info('Quand', 'Le jeudi, de 17h à 18h')}
                      ${info('Où', `Stade municipal, 1 rue du Stade, Sportville<br>${link(mapsUrl, 'Voir sur la carte')}`)}
                      ${info('À prévoir', `Tenue adaptée à la météo, stabilisés ou crampons moulés, gourde d'eau — ${link(prevoirUrl, 'tous les détails')}`)}
                    </table>
                  </td>
                </tr>
              </table>`;
}

function buildFollowUpEmail(row, siteUrl, { complete, step, whatsappUrl = '' }) {
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const suiviUrl = suiviUrlOf(row, siteUrl);
  const dossier = dossierStatus(row);
  // [libellé, état] — état : 'ok' | 'pending' (dossier en vérification) | 'todo' ; STATE_LABELS pour l'affichage.
  const steps = [
    ['Dossier signé', dossier === 'valide' ? 'ok' : dossier === 'a_verifier' ? 'pending' : 'todo'],
    [`Photo de ${row.enfant_prenom}`, row.photo_uploaded_at ? 'ok' : 'todo', 'Reçue'],
    ["Paiement de l'adhésion", row.paye ? 'ok' : 'todo', 'Payé'],
  ];
  const STATE_LABELS = { ok: 'Validé', pending: 'En vérification', todo: 'En attente' };
  const stateLabel = (state, okLabel) => (state === 'ok' && okLabel ? okLabel : STATE_LABELS[state]);
  const remaining = steps.filter(([, state]) => state === 'todo').map(([label]) => label);
  const intro = complete
    ? `Bonne nouvelle : toutes les étapes de l'inscription de ${nomEnfant} sont validées.`
    : {
        dossier: `Nous avons vérifié et validé le dossier signé de ${nomEnfant}, merci !`,
        photo: `Nous avons bien reçu la photo de ${nomEnfant}.`,
        paiement: `Nous avons bien reçu le paiement de l'adhésion de ${nomEnfant}, merci !`,
      }[step];
  // Jamais "inscription définitive" avant la licence FFF (voir CLAUDE.md et buildEmail ci-dessus).
  const next = complete
    ? `Le club enregistre maintenant la licence de ${row.enfant_prenom} auprès de la Fédération Française de Football (FFF) via Footclubs, généralement sous quelques jours : l'inscription sera définitive à ce moment-là.`
    : remaining.length
      ? `Il reste : ${remaining.join(', ')}.`
      : "Le club vérifie encore le dossier signé : nous revenons vers vous dès qu'il est validé.";
  const subject = complete
    ? `Dossier complet — ${nomEnfant} — Club Démo`
    : `Inscription de ${nomEnfant} : ${{ dossier: 'dossier signé validé', photo: 'photo reçue', paiement: 'paiement reçu' }[step]}`;

  const nextSteps = row.paye ? nextStepsContent(row, siteUrl, { complete, whatsappUrl }) : null;

  const text = `Bonjour ${greetingName(row)},

${intro}

${steps.map(([label, state, okLabel]) => `- ${label} : ${stateLabel(state, okLabel).toLowerCase()}`).join('\n')}

${next}
${nextSteps ? `\n${nextStepsText(nextSteps)}\n` : ''}
Suivre l'inscription : ${suiviUrl}

Des questions ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo`;

  const stepRows = steps
    .map(
      ([label, state, okLabel]) => `
                <tr>
                  <td style="padding:10px 0;border-bottom:1px solid ${CREAM_200};font-family:Arial,Helvetica,sans-serif;font-size:14px;color:${INK_900};">${escapeHtml(label)}</td>
                  <td align="right" style="padding:10px 0;border-bottom:1px solid ${CREAM_200};font-family:Arial,Helvetica,sans-serif;"><span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:bold;background-color:${state === 'ok' ? GREEN_100 : GOLD_100};color:${state === 'ok' ? GREEN_700 : '#8a4b12'};">${stateLabel(state, okLabel)}</span></td>
                </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM_100};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_100};">
    ${escapeHtml(intro)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${GOLD_300};">
          <tr>
            <td ${headerBackground(siteUrl)} style="${headerBackgroundStyle(siteUrl)}padding:28px 32px;text-align:center;">
              <img src="${siteUrl}/assets/images/email/logo.png" width="48" height="48" alt="Club Démo" style="display:block;margin:0 auto 10px auto;border-radius:8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#ffffff;letter-spacing:.02em;">Club Démo</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GOLD_400};text-transform:uppercase;letter-spacing:.12em;margin-top:2px;">Club de démonstration · École de foot</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px 32px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:22px;color:${INK_900};">Bonjour ${escapeHtml(greetingName(row))},</p>
              <p style="margin:0 0 20px 0;font-size:15px;line-height:22px;color:${INK_900};">${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">${stepRows}
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${complete ? GREEN_100 : GOLD_100};border-left:4px solid ${complete ? GREEN_700 : GOLD_500};border-radius:8px;margin:0 0 24px 0;">
                <tr>
                  <td style="padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:19px;color:${INK_900};">${escapeHtml(next)}</td>
                </tr>
              </table>${nextSteps ? nextStepsHtml(nextSteps) : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 28px auto;">
                <tr>
                  <td align="center" style="background-color:${GOLD_500};border-radius:8px;">
                    <a href="${suiviUrl}" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${MAROON_950};text-decoration:none;">Suivre mon inscription</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:${INK_700};">Des questions ? Répondez directement à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.</p>
              <p style="margin:24px 0 0 0;font-size:14px;line-height:20px;color:${INK_900};">Sportivement,<br><strong>Club Démo</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:${CREAM_200};padding:20px 32px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:17px;color:${INK_700};text-align:center;">
              Cet e-mail vous est envoyé suite à votre demande d'inscription sur <a href="${siteUrl}" style="color:${INK_700};">clubdemo.licyo.fr</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

// step : 'dossier' | 'photo' | 'paiement' (ignoré si complete)
export async function sendFollowUpEmail(env, row, siteUrl, { complete = false, step, origin = 'auto' } = {}) {
  if (!row.upload_token) return false;
  row = await ensureUploadToken(env, row);
  let whatsappUrl = '';
  try {
    if (row.paye && row.organization_id) ({ whatsappUrl } = await getFamilyInfo(env, row.organization_id));
  } catch {
    // KV indisponible : e-mail envoyé sans le lien WhatsApp.
  }
  const { subject, html, text } = buildFollowUpEmail(row, siteUrl, { complete, step, whatsappUrl });
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(row),
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: complete ? 'complet' : 'suivi', origin, inscriptionId: row.id, organizationId: row.organization_id });
}

// Alerte interne : une famille vient de déposer son dossier signé ou la photo de l'enfant depuis sa
// page de suivi.
export async function sendClubUploadAlert(env, row, siteUrl, kind) {
  const to = await clubRecipients(env, row.organization_id);
  if (!to.length) return false;
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const categorie = formatCategorie(row.categorie);
  const fiche = `${siteUrl}/admin/inscriptions/${row.id}`;
  const isPhoto = kind === 'photo';
  // Le bouton ouvre le document lui-même, où l'on valide ou refuse directement.
  const cta = isPhoto ? { label: 'Voir la fiche', url: fiche } : { label: 'Vérifier le dossier', url: `${fiche}/apercu` };
  const aVerifier = 'signature du responsable légal, lieu et date, document complet et lisible. Puis « Valider » ou « Refuser » à côté du document (un refus prévient la famille par e-mail).';

  const html = clubEmail({
    siteUrl,
    preheader: isPhoto ? `Photo de ${nomEnfant} reçue.` : `Dossier signé de ${nomEnfant} à vérifier.`,
    eyebrow: `Espace admin · ${isPhoto ? 'Photo reçue' : 'Dossier à vérifier'}`,
    title: nomEnfant,
    subtitle: categorie,
    body: isPhoto
      ? clubParagraph(`La famille de <strong>${escapeHtml(nomEnfant)}</strong> vient de déposer la photo de l’enfant depuis sa page de suivi.`)
      : `${clubParagraph(`La famille de <strong>${escapeHtml(nomEnfant)}</strong> vient de déposer le dossier signé depuis sa page de suivi.`)}
              ${clubCallout(`<strong style="color:${MAROON_900};">À vérifier :</strong> ${aVerifier}`)}`,
    cta,
  });

  const text = isPhoto
    ? `La famille de ${nomEnfant} (${categorie}) vient de déposer la photo de l’enfant en ligne.`
    : `La famille de ${nomEnfant} (${categorie}) vient de déposer le dossier signé en ligne.\n\nÀ vérifier : ${aVerifier}`;

  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `${isPhoto ? 'Photo déposée' : 'Dossier signé à vérifier'} : ${nomEnfant}`,
    htmlContent: html,
    textContent: clubText(text, cta),
  }, { kind: 'club_depot', origin: 'famille', inscriptionId: row.id, organizationId: row.organization_id });
}

// Dossier refusé par le club (functions/admin/inscriptions/[id]/verification.js) : explique à la famille ce
// qui manque et la renvoie vers sa page de suivi pour déposer le dossier corrigé. Ton volontairement
// bienveillant : ce n'est pas un reproche, le dossier est simplement incomplet.
function buildDossierRefusedEmail(row, siteUrl) {
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const suiviUrl = suiviUrlOf(row, siteUrl);
  const motifs = refusMotifs(row);
  const commentaire = String(row.dossier_refus_commentaire || '').trim();
  const subject = `Dossier de ${nomEnfant} à compléter — Club Démo`;
  const intro = `Merci pour l'envoi du dossier d'inscription de ${nomEnfant} ! En le vérifiant, nous avons remarqué qu'il n'est pas encore complet, nous ne pouvons donc pas le valider pour le moment.`;
  const checks = ['Le lieu et la date remplis (« Fait à …, le … »)', 'La signature du responsable légal', 'Le document entier et bien lisible (une photo nette suffit)'];

  const text = `Bonjour ${greetingName(row)},

${intro}

Ce qu'il manque :
${motifs.map((m) => `- ${m}`).join('\n')}${commentaire ? `\n\nPrécision du club : ${commentaire}` : ''}

Avant de le renvoyer, vérifiez :
${checks.map((c) => `- ${c}`).join('\n')}

Déposer le dossier corrigé : ${suiviUrl}#dossier
Vous n'avez plus le dossier ? Le retélécharger : ${suiviUrl}?telecharger=1#dossier

Des questions ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo
Stade municipal, 1 rue du Stade, Sportville`;

  const bullet = (content, color) => `
                <tr>
                  <td width="22" valign="top" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;font-weight:bold;color:${color};">•</td>
                  <td valign="top" style="padding:4px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${INK_900};">${content}</td>
                </tr>`;

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${CREAM_100};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CREAM_100};">
    Le dossier de ${escapeHtml(nomEnfant)} est presque bon : il manque ${escapeHtml(motifs[0] ? motifs[0].charAt(0).toLowerCase() + motifs[0].slice(1) : 'un élément')}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${CREAM_100};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${GOLD_300};">
          <tr>
            <td ${headerBackground(siteUrl)} style="${headerBackgroundStyle(siteUrl)}padding:28px 28px 26px 28px;text-align:center;">
              <img src="${siteUrl}/assets/images/email/logo.png" width="56" height="56" alt="Club Démo" style="display:block;margin:0 auto 10px auto;border-radius:8px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${GOLD_400};text-transform:uppercase;letter-spacing:.14em;">Club Démo · Dossier d'inscription</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:bold;color:#ffffff;margin-top:8px;">Un petit oubli dans le dossier</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${GOLD_300};margin-top:4px;">Quelques minutes suffisent pour le corriger</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;">
              <p style="margin:0 0 14px 0;font-size:15px;line-height:22px;color:${INK_900};">Bonjour ${escapeHtml(greetingName(row))},</p>
              <p style="margin:0 0 22px 0;font-size:15px;line-height:22px;color:${INK_900};">${escapeHtml(intro)}</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;background-color:#fdecea;border-left:4px solid #b3261e;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#8c1d18;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Ce qu'il manque</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${motifs.map((m) => bullet(escapeHtml(m), '#b3261e')).join('')}
                    </table>${
                      commentaire
                        ? `
                    <div style="margin-top:10px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:${INK_900};"><strong>Précision du club :</strong> ${escapeHtml(commentaire)}</div>`
                        : ''
                    }
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px 0;background-color:${CREAM_100};border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MAROON_900};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Avant de le renvoyer, vérifiez</div>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${checks.map((c) => bullet(escapeHtml(c), GREEN_700)).join('')}
                    </table>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px auto 12px auto;">
                <tr>
                  <td align="center" style="background-color:${GOLD_500};border-radius:8px;">
                    <a href="${suiviUrl}#dossier" target="_blank" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${MAROON_950};text-decoration:none;">Déposer le dossier corrigé &rarr;</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 24px 0;text-align:center;font-size:13px;line-height:19px;color:${INK_700};">Vous n'avez plus le dossier ? <a href="${suiviUrl}?telecharger=1#dossier" target="_blank" style="color:${MAROON_900};font-weight:bold;">Le retélécharger</a></p>
              <p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:${INK_700};">Des questions ? Répondez directement à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.</p>
              <p style="margin:20px 0 24px 0;font-size:14px;line-height:20px;color:${INK_900};">Sportivement,<br><strong>Club Démo</strong></p>
            </td>
          </tr>
          <tr>
            <td style="background-color:${CREAM_200};padding:20px 28px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:18px;color:${INK_700};text-align:center;">
              Club Démo · Stade municipal, 1 rue du Stade, Sportville, Club de démonstration<br>
              Cet e-mail vous est envoyé suite à votre demande d'inscription sur <a href="${siteUrl}" style="color:${INK_700};">clubdemo.licyo.fr</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}

// Photo à refaire (demandée par le club depuis la fiche) : motifs, consignes (fond blanc, visage seul, de face) et
// bouton vers la carte photo de l'espace famille.
export const PHOTO_GUIDELINES = [
  'Sur un fond blanc ou très clair : un mur blanc fait parfaitement l’affaire',
  'Uniquement le visage, de face, des épaules au haut de la tête',
  'Bien éclairée, nette, sans ombre sur le visage',
  'Sans casquette ni lunettes de soleil, personne d’autre sur la photo',
];

export function buildPhotoRefusedEmail(row, siteUrl) {
  const prenom = row.enfant_prenom;
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const depot = suiviUrlOf(row, siteUrl, '#photo');
  const motifs = photoRefusMotifs(row);
  const commentaire = String(row.photo_refus_commentaire || '').trim();
  const subject = `Photo de ${prenom} à refaire — Club Démo`;
  const intro = `Merci pour la photo de ${nomEnfant} ! Elle ne convient pas tout à fait pour sa licence : pourriez-vous en envoyer une nouvelle ?`;
  const list = (items) => `<ul style="margin:0 0 18px 0;padding-left:20px;font-size:14px;line-height:21px;color:${INK_900};">${items.map((i) => `<li style="margin:0 0 4px 0;">${escapeHtml(i)}</li>`).join('')}</ul>`;
  const html = clubEmail({
    siteUrl,
    preheader: intro,
    eyebrow: 'Club Démo · Photo de l’enfant',
    title: `Une nouvelle photo de ${prenom}`,
    subtitle: 'Deux minutes avec un téléphone suffisent',
    body: `${clubParagraph(`Bonjour ${escapeHtml(greetingName(row))},`)}
              ${clubParagraph(escapeHtml(intro))}
              ${motifs.length || commentaire ? clubCallout(`<strong>Ce qui ne va pas :</strong>${motifs.length ? list(motifs) : '<br>'}${commentaire ? `<strong>Précision du club :</strong> ${escapeHtml(commentaire)}` : ''}`) : ''}
              <p style="margin:0 0 8px 0;font-size:15px;line-height:22px;font-weight:bold;color:${MAROON_900};">Pour une photo réussie</p>
              ${list(PHOTO_GUIDELINES)}`,
    cta: { label: 'Envoyer la nouvelle photo', url: depot },
    footerHtml: `Club Démo · Stade municipal, 1 rue du Stade, Sportville<br>Cet e-mail vous est envoyé suite à votre demande d'inscription sur <a href="${siteUrl}" target="_blank" style="color:${INK_700};">clubdemo.licyo.fr</a>.`,
  });
  const text = `Bonjour ${greetingName(row)},

${intro}
${motifs.length ? `\nCe qui ne va pas :\n${motifs.map((m) => `- ${m}`).join('\n')}\n` : ''}${commentaire ? `\nPrécision du club : ${commentaire}\n` : ''}
Pour une photo réussie :
${PHOTO_GUIDELINES.map((g) => `- ${g}`).join('\n')}

Envoyer la nouvelle photo : ${depot}

Des questions ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo`;
  return { subject, html, text };
}

export async function sendPhotoRefusedEmail(env, row, siteUrl) {
  const withToken = await ensureUploadToken(env, row);
  if (!withToken.upload_token) return false;
  const { subject, html, text } = buildPhotoRefusedEmail(withToken, siteUrl);
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(withToken),
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: 'photo_refusee', origin: 'manuel', inscriptionId: row.id, organizationId: row.organization_id });
}

// Nouveau lien vers l'espace famille (2026-10-16) : demandé par la famille depuis un lien expiré ou la page
// /espace-famille, ou envoyé par le club depuis la fiche. Toujours aux adresses enregistrées sur la fiche, jamais à
// une adresse saisie : sans accès à la boîte de la famille, personne ne peut obtenir de lien.
export function buildFamilyLinkEmail(row, siteUrl) {
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const url = suiviUrlOf(row, siteUrl);
  const subject = `Votre lien vers l'espace famille — ${nomEnfant}`;
  const intro = `Voici votre lien personnel vers l'espace famille de ${nomEnfant} : vous y suivez l'inscription et déposez le dossier signé et la photo.`;
  const html = clubEmail({
    siteUrl,
    preheader: intro,
    eyebrow: 'Club Démo · Espace famille',
    title: `Inscription de ${row.enfant_prenom}`,
    subtitle: `Lien valable ${FAMILY_LINK_DAYS} jours`,
    body: `${clubParagraph(`Bonjour ${escapeHtml(greetingName(row))},`)}
              ${clubParagraph(escapeHtml(intro))}
              ${clubCallout(`Ce lien est personnel : ne le transférez pas. Il reste valable ${FAMILY_LINK_DAYS} jours ; ensuite, la page vous propose d'en recevoir un nouveau à cette adresse.`)}
              ${clubParagraph(escapeHtml("Vous n'avez rien demandé ? Ignorez simplement cet e-mail : personne d'autre que vous ne reçoit ce lien."))}`,
    cta: { label: 'Ouvrir mon espace famille', url },
    footerHtml: `Club Démo · Stade municipal, 1 rue du Stade, Sportville<br>Cet e-mail vous est envoyé suite à votre demande d'inscription sur <a href="${siteUrl}" target="_blank" style="color:${INK_700};">clubdemo.licyo.fr</a>.`,
  });
  const text = `Bonjour ${greetingName(row)},

${intro}

Ouvrir mon espace famille : ${url}

Ce lien est personnel : ne le transférez pas. Il reste valable ${FAMILY_LINK_DAYS} jours ; ensuite, la page vous propose d'en recevoir un nouveau à cette adresse.

Vous n'avez rien demandé ? Ignorez simplement cet e-mail : personne d'autre que vous ne reçoit ce lien.

Sportivement,
Club Démo`;
  return { subject, html, text };
}

export async function sendFamilyLinkEmail(env, row, siteUrl, origin = 'famille') {
  if (!mailConfigured(env)) return false;
  const withLink = await ensureUploadToken(env, row); // sans lien neuf (base indisponible) : lien vers /espace-famille
  const { subject, html, text } = buildFamilyLinkEmail(withLink, siteUrl);
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(withLink),
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: 'lien_famille', origin, inscriptionId: row.id, organizationId: row.organization_id });
}

// Attendue par l'appelant, qui affiche si l'e-mail est bien parti (true/false).
export async function sendDossierRefusedEmail(env, row, siteUrl) {
  const withToken = await ensureUploadToken(env, row);
  if (!withToken.upload_token) return false;
  const { subject, html, text } = buildDossierRefusedEmail(withToken, siteUrl);
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(withToken),
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: 'dossier_refuse', origin: 'manuel', inscriptionId: row.id, organizationId: row.organization_id });
}

// Alerte interne : une famille a changé son mode de paiement depuis sa page de suivi.
export async function sendClubPaymentModeAlert(env, row, siteUrl, previousMode) {
  const to = await clubRecipients(env, row.organization_id);
  if (!to.length) return false;
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const categorie = formatCategorie(row.categorie);
  const cta = { label: 'Voir la fiche', url: `${siteUrl}/admin/inscriptions/${row.id}` };

  const html = clubEmail({
    siteUrl,
    preheader: `${nomEnfant} : ${previousMode || 'non renseigné'} → ${row.mode_paiement}`,
    eyebrow: 'Espace admin · Mode de paiement',
    title: nomEnfant,
    subtitle: categorie,
    body: `${clubParagraph('La famille a changé son mode de paiement depuis sa page de suivi.')}
              ${clubInfoRows([
                ['Avant', `<span style="color:${INK_700};font-weight:normal;text-decoration:line-through;">${escapeHtml(previousMode || 'non renseigné')}</span>`],
                ['Maintenant', escapeHtml(row.mode_paiement || '—')],
              ])}`,
    cta,
  });

  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `Mode de paiement changé : ${nomEnfant}`,
    htmlContent: html,
    textContent: clubText(`La famille de ${nomEnfant} (${categorie}) a changé son mode de paiement : ${previousMode || 'non renseigné'} → ${row.mode_paiement}.`, cta),
  }, { kind: 'club_paiement', origin: 'famille', inscriptionId: row.id, organizationId: row.organization_id });
}

// Paiement HelloAsso reçu mais pas (ou pas entièrement) rattaché à une inscription : à traiter à la main.
export async function sendHelloAssoAlert(env, siteUrl, { orderId, payer, participants, amount, reason, organizationId = null }) {
  const to = await clubRecipients(env, organizationId);
  if (!to.length) return false;
  const montant = Number.isFinite(amount) ? `${(amount / 100).toFixed(2).replace('.', ',')} €` : '—';
  const payeur = `${payer?.firstName || ''} ${payer?.lastName || ''}`.trim();
  const cta = { label: 'Ouvrir les inscriptions', url: `${siteUrl}/admin/inscriptions` };

  const html = clubEmail({
    siteUrl,
    preheader: `Paiement de ${montant} (${payeur || 'payeur inconnu'}) à rattacher à une inscription.`,
    eyebrow: 'Espace admin · Paiement HelloAsso',
    title: 'Paiement à rattacher',
    subtitle: montant,
    body: `${clubParagraph(`Un paiement HelloAsso n'a pas pu être rattaché automatiquement à une inscription (${escapeHtml(reason)}).`)}
              ${clubInfoRows([
                ['Commande', `n°&nbsp;${escapeHtml(String(orderId))}`],
                ['Payeur', escapeHtml(payeur || '—')],
                ['E-mail', payer?.email ? `<a href="mailto:${escapeHtml(payer.email)}" style="color:${MAROON_900};">${escapeHtml(payer.email)}</a>` : '—'],
                ['Participant(s)', escapeHtml(participants.join(', ') || '—')],
                ['Montant', montant],
              ])}
              ${clubCallout(`<strong style="color:${MAROON_900};">À faire :</strong> retrouver la fiche de l'enfant et cliquer sur « Marquer payé ».`)}`,
    cta,
  });

  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `Paiement HelloAsso à rattacher : ${payeur}`.trim(),
    htmlContent: html,
    textContent: clubText(
      `Un paiement HelloAsso n'a pas pu être rattaché automatiquement à une inscription (${reason}).

Commande n° ${orderId}
Payeur : ${payeur} <${payer?.email || '—'}>
Participant(s) : ${participants.join(', ') || '—'}
Montant : ${montant}

À faire : retrouver la fiche et cliquer sur « Marquer payé ».`,
      cta
    ),
  }, { kind: 'club_helloasso', origin: 'auto', organizationId });
}

// Récapitulatif hebdomadaire envoyé au club (voir buildWeeklySummary dans _shared/automations.js).
export async function sendWeeklySummary(env, siteUrl, summary, origin = 'auto') {
  const to = await clubRecipients(env, summary.organizationId);
  if (!to.length) return false;
  const count = summary.nouvelles.length;
  const plural = count > 1 ? 's' : '';
  const cta = { label: 'Dossiers incomplets', url: `${siteUrl}/admin/inscriptions?etat=incomplet` };

  const tile = (value, label) =>
    `<td width="25%" align="center" valign="top" style="padding:14px 4px;background-color:${CREAM_100};border-radius:10px;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:26px;line-height:30px;font-weight:bold;color:${MAROON_900};">${value}</div><div style="font-size:12px;line-height:16px;color:${INK_700};margin-top:2px;">${label}</div></td>`;
  const gap = '<td width="8" style="font-size:0;line-height:0;">&nbsp;</td>';
  const heading = (label) =>
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${MAROON_900};text-transform:uppercase;letter-spacing:.08em;margin:0 0 4px 0;">${label}</div>`;
  const nouvellesHtml = count
    ? clubInfoRows(
        summary.nouvelles.map((n) => [
          `<a href="${siteUrl}/admin/inscriptions/${n.id}" target="_blank" style="color:${MAROON_900};font-weight:bold;text-decoration:none;">${escapeHtml(n.name)}</a> <span style="color:${INK_700};">· ${escapeHtml(formatCategorie(n.categorie))}</span>`,
          clubPill(n.complete ? 'Complet' : 'À compléter', n.complete),
        ])
      )
    : clubParagraph(`<span style="color:${INK_700};">Aucune nouvelle inscription cette semaine.</span>`);
  const aVerifier = summary.dossierAVerifier
    ? `<a href="${siteUrl}/admin/inscriptions?dossier=a_verifier" target="_blank" style="color:${MAROON_900};">${summary.dossierAVerifier}</a>`
    : '0';

  const html = clubEmail({
    siteUrl,
    preheader: `${count} nouvelle${plural} inscription${plural}, ${summary.complet} complète${summary.complet > 1 ? 's' : ''} sur ${summary.total}.`,
    eyebrow: `Espace admin · Saison ${summary.saison || ''}`,
    title: 'Récapitulatif de la semaine',
    subtitle: `${count} nouvelle${plural} inscription${plural} ces 7 derniers jours`,
    body: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;">
                <tr>${tile(summary.total, 'Inscriptions')}${gap}${tile(summary.complet, 'Complètes')}${gap}${tile(summary.total - summary.complet, 'Incomplètes')}${gap}${tile(summary.dossierAVerifier, 'À vérifier')}</tr>
              </table>
              ${heading('Nouvelles inscriptions')}
              ${nouvellesHtml}
              ${heading('Ce qui manque')}
              ${clubInfoRows([
                ['Dossier signé à vérifier', aVerifier],
                ['Dossier signé manquant ou refusé', summary.missingDossier],
                ['Photo manquante', summary.missingPhoto],
                ['Paiement en attente', summary.missingPaiement],
              ])}`,
    cta,
  });

  const nouvelles = count
    ? summary.nouvelles.map((n) => `- ${n.name} (${formatCategorie(n.categorie)}) — ${n.complete ? 'complet' : 'à compléter'}`).join('\n')
    : '- aucune';

  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `Récapitulatif de la semaine — ${count} nouvelle${plural} inscription${plural}`,
    htmlContent: html,
    textContent: clubText(
      `Récapitulatif des inscriptions — saison ${summary.saison}

Nouvelles inscriptions ces 7 derniers jours : ${count}
${nouvelles}

Où en sont les ${summary.total} inscriptions actives :
- Complètes : ${summary.complet}
- Dossier signé à vérifier par le club : ${summary.dossierAVerifier}${summary.dossierAVerifier ? ` (${siteUrl}/admin/inscriptions?dossier=a_verifier)` : ''}
- Dossier signé manquant ou refusé : ${summary.missingDossier}
- Photo manquante : ${summary.missingPhoto}
- Paiement en attente : ${summary.missingPaiement}`,
      cta
    ),
  }, { kind: 'recap', origin, organizationId: summary.organizationId });
}

// ---------------------------------------------------------------------------------------------
// Pré-inscription (liste d'intérêt d'un groupe pas encore ouvert, voir _shared/preinscriptions.js). Jamais présentée
// comme une inscription : pas de place garantie, pas de paiement, le club recontacte la famille si le groupe ouvre.

const preinscriptionYears = (config) => (config.anneeMin === config.anneeMax ? `né(e) en ${config.anneeMin}` : `né(e) entre ${config.anneeMin} et ${config.anneeMax}`);

export function buildPreinscriptionConfirmation(data, config, siteUrl) {
  const nomEnfant = `${data.enfantPrenom} ${data.enfantNom}`;
  const subject = `Pré-inscription ${config.label} de ${data.enfantPrenom} — Club Démo`;
  const intro = `Nous avons bien reçu la pré-inscription de ${nomEnfant} pour le futur groupe ${config.label}.`;
  const next = `Le groupe ${config.label} ouvrira dès qu'assez d'enfants seront pré-inscrits (${config.capacity} places au maximum). Nous vous recontacterons à ce moment-là pour l'inscription définitive (dossier et paiement). D'ici là, vous n'avez rien à payer ni à envoyer.`;
  const html = clubEmail({
    siteUrl,
    preheader: intro,
    eyebrow: `Pré-inscription ${config.label}`,
    title: nomEnfant,
    subtitle: preinscriptionYears(config),
    body: `${clubParagraph(`Bonjour ${escapeHtml(greetingName(rowFromData(data)))},`)}
              ${clubParagraph(escapeHtml(intro))}
              ${clubCallout(escapeHtml(next))}
              ${clubParagraph(`Ce n'est pas encore une inscription : la place n'est confirmée qu'à l'ouverture du groupe. Une question ? Répondez à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.`)}
              ${clubParagraph('Sportivement,<br><strong>Club Démo</strong>')}`,
    footerHtml: `Club Démo · Stade municipal, 1 rue du Stade, Sportville<br>Cet e-mail vous est envoyé suite à votre pré-inscription sur <a href="${siteUrl}" target="_blank" style="color:${INK_700};">clubdemo.licyo.fr</a>.`,
  });
  const text = `Bonjour ${greetingName(rowFromData(data))},

${intro}

${next}

Ce n'est pas encore une inscription : la place n'est confirmée qu'à l'ouverture du groupe. Une question ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo`;
  return { subject, html, text };
}

export async function sendPreinscriptionConfirmation(env, data, config, siteUrl, organizationId) {
  const { subject, html, text } = buildPreinscriptionConfirmation(data, config, siteUrl);
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    // Les deux responsables légaux reçoivent la confirmation (le second s'il a donné son e-mail).
    to: familyRecipients(rowFromData(data)),
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: 'preinscription', origin: 'famille', organizationId });
}

export async function sendPreinscriptionClubAlert(env, data, config, count, siteUrl, organizationId) {
  const to = await clubRecipients(env, organizationId);
  if (!to.length) return false;
  const nomEnfant = `${data.enfantPrenom} ${data.enfantNom}`;
  const naissance = data.naissance.split('-').reverse().join('/');
  const total = Number.isInteger(count) ? `${count} / ${config.capacity}` : '—';
  const cta = { label: 'Voir les pré-inscriptions', url: `${siteUrl}/admin/preinscriptions` };
  const mailto = `<a href="mailto:${escapeHtml(data.email)}" style="color:${MAROON_900};">${escapeHtml(data.email)}</a>`;
  const html = clubEmail({
    siteUrl,
    preheader: `${nomEnfant} est pré-inscrit(e) en ${config.label} (${total}).`,
    eyebrow: `Espace admin · Pré-inscription ${config.label}`,
    title: nomEnfant,
    subtitle: `Né(e) le ${naissance}`,
    body: `${clubInfoRows([
                ['Pré-inscrits', `<strong>${escapeHtml(total)}</strong>`],
                ['Lieu de naissance', escapeHtml(`${data.villeNaissance} (${data.paysNaissance})`)],
                ['Taille de tenue', escapeHtml(data.tailleMaillot || '—')],
                ['Responsable légal', escapeHtml(`${data.parentPrenom} ${data.parentNom}`)],
                ['E-mail', mailto],
                ['Téléphone', escapeHtml(data.telephone)],
                data.parent2Prenom && ['2e responsable', escapeHtml(`${data.parent2Prenom} ${data.parent2Nom}`)],
                data.parent2Email && ['E-mail (2e)', `<a href="mailto:${escapeHtml(data.parent2Email)}" style="color:${MAROON_900};">${escapeHtml(data.parent2Email)}</a>`],
                data.parent2Telephone && ['Téléphone (2e)', escapeHtml(data.parent2Telephone)],
                data.commentaire && ['Message', escapeHtml(data.commentaire)],
              ])}
              ${Number.isInteger(count) && count >= config.capacity ? clubCallout(`Les ${config.capacity} places sont prises : le formulaire affiche désormais « complet ».`, { tone: 'green' }) : ''}`,
    cta,
  });
  const text = clubText(
    `Nouvelle pré-inscription ${config.label} : ${nomEnfant} (né(e) le ${naissance})
Pré-inscrits : ${total}
Lieu de naissance : ${data.villeNaissance} (${data.paysNaissance})
Taille de tenue : ${data.tailleMaillot || '—'}
Parent : ${data.parentPrenom} ${data.parentNom}
E-mail : ${data.email}
Téléphone : ${data.telephone}${data.parent2Prenom ? `
2e responsable : ${data.parent2Prenom} ${data.parent2Nom} — ${data.parent2Email || 'pas d’e-mail'} — ${data.parent2Telephone || 'pas de téléphone'}` : ''}${data.commentaire ? `
Message : ${data.commentaire}` : ''}`,
    cta
  );
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `Pré-inscription ${config.label} : ${nomEnfant} (${total})`,
    htmlContent: html,
    textContent: text,
  }, { kind: 'club_preinscription', origin: 'famille', organizationId });
}

// Formulaire de contact du site (functions/api/contact.js, remplace FormSubmit le 2026-10-09) : le message part
// depuis la boîte du club vers son adresse publique (organizations.email, à défaut l'adresse de notification), avec
// « Reply-To » = le visiteur : « Répondre » dans la messagerie lui écrit directement. message : { nom, email, sujet,
// message } déjà nettoyés et bornés par l'API.
export async function sendContactMessage(env, message, { to: contactEmail = '', siteUrl, organizationId } = {}) {
  const to = contactEmail ? [{ email: contactEmail }] : await clubRecipients(env, organizationId);
  if (!to.length) return false;
  const paragraphs = message.message
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => clubParagraph(escapeHtml(p).replace(/\n/g, '<br>')))
    .join('');
  const mailto = `<a href="mailto:${escapeHtml(message.email)}" style="color:${MAROON_900};">${escapeHtml(message.email)}</a>`;
  const html = clubEmail({
    siteUrl,
    preheader: `${message.sujet} — ${message.nom}`,
    eyebrow: 'Site · Formulaire de contact',
    title: message.nom,
    subtitle: message.sujet,
    body: `${clubInfoRows([
                ['Nom', escapeHtml(message.nom)],
                ['E-mail', mailto],
                ['Sujet', escapeHtml(message.sujet)],
              ])}
              ${paragraphs}
              ${clubCallout('Pour répondre, utilisez simplement « Répondre » : votre réponse partira à cette personne.')}`,
  });
  const text = clubText(`Nouveau message depuis le formulaire de contact du site.

Nom : ${message.nom}
E-mail : ${message.email}
Sujet : ${message.sujet}

${message.message}

Pour répondre, utilisez « Répondre » : la réponse partira à cette personne.`);
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    replyTo: { email: message.email, name: message.nom },
    subject: `Contact : ${message.sujet} — ${message.nom}`,
    htmlContent: html,
    textContent: text,
  }, { kind: 'club_contact', origin: 'famille', organizationId });
}

// Ouverture automatique du groupe (preinscription-opening.js) : les places de pré-inscription sont toutes prises, le
// groupe devient une catégorie comme les autres. Chaque famille pré-inscrite est invitée à faire l'inscription
// définitive (formulaire habituel : dossier, photo, paiement). row : ligne de la table preinscriptions.
export function buildPreinscriptionGroupOpened(row, config, siteUrl) {
  const nomEnfant = `${row.enfant_prenom} ${row.enfant_nom}`;
  const subject = `Le groupe ${config.label} ouvre : inscrivez ${row.enfant_prenom} — Club Démo`;
  const intro = `Bonne nouvelle : assez d'enfants sont pré-inscrits, le groupe ${config.label} ouvre pour la saison !`;
  const next = `Pour confirmer la place de ${row.enfant_prenom}, faites maintenant l'inscription définitive sur le site : le formulaire habituel, puis le dossier signé, la photo et le paiement. La catégorie ${config.label} est proposée automatiquement d'après la date de naissance.`;
  const url = `${siteUrl}/inscription`;
  const html = clubEmail({
    siteUrl,
    preheader: intro,
    eyebrow: `Groupe ${config.label}`,
    title: nomEnfant,
    subtitle: preinscriptionYears(config),
    body: `${clubParagraph(`Bonjour ${escapeHtml(greetingName(row))},`)}
              ${clubParagraph(escapeHtml(intro))}
              ${clubCallout(escapeHtml(next))}
              ${clubParagraph(`La pré-inscription n'était pas une inscription : tant que le formulaire n'est pas rempli, la place n'est pas confirmée. Une question ? Répondez à cet e-mail ou écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${MAROON_900};">contact@clubdemo.licyo.fr</a>.`)}
              ${clubParagraph('Sportivement,<br><strong>Club Démo</strong>')}`,
    cta: { label: `Inscrire ${row.enfant_prenom}`, url },
    footerHtml: `Club Démo · Stade municipal, 1 rue du Stade, Sportville<br>Cet e-mail vous est envoyé suite à votre pré-inscription sur <a href="${siteUrl}" target="_blank" style="color:${INK_700};">clubdemo.licyo.fr</a>.`,
  });
  const text = `Bonjour ${greetingName(row)},

${intro}

${next}

Inscrire ${row.enfant_prenom} : ${url}

La pré-inscription n'était pas une inscription : tant que le formulaire n'est pas rempli, la place n'est pas confirmée. Une question ? Répondez à cet e-mail ou écrivez-nous à contact@clubdemo.licyo.fr.

Sportivement,
Club Démo`;
  return { subject, html, text };
}

export async function sendPreinscriptionGroupOpened(env, row, config, siteUrl, organizationId) {
  const { subject, html, text } = buildPreinscriptionGroupOpened(row, config, siteUrl);
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: familyRecipients(row),
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: 'preinscription_ouverture', origin: 'auto', organizationId });
}

// Alerte club : groupe créé (ou déjà présent) et familles invitées ; rappelle ce qui reste à régler à la main.
export async function sendPreinscriptionGroupOpenedClub(env, config, { count, invited, created }, siteUrl, organizationId) {
  const to = await clubRecipients(env, organizationId);
  if (!to.length) return false;
  const cta = { label: 'Vérifier les catégories', url: `${siteUrl}/admin/categories` };
  const todo = `À vérifier dans Catégories : le lien de paiement HelloAsso du groupe ${config.label} (sans lien propre, le paiement en ligne utilise la campagne de la première catégorie) et les créneaux d'entraînement.`;
  const html = clubEmail({
    siteUrl,
    preheader: `Les ${config.capacity} places sont prises : le groupe ${config.label} est ouvert.`,
    eyebrow: `Espace admin · Groupe ${config.label}`,
    title: `Groupe ${config.label} ouvert`,
    subtitle: preinscriptionYears(config),
    body: `${clubInfoRows([
                ['Pré-inscrits', `<strong>${escapeHtml(`${count} / ${config.capacity}`)}</strong>`],
                ['Catégorie', created ? 'Créée automatiquement, ouverte aux inscriptions' : 'Déjà présente, ouverte aux inscriptions'],
                ['Familles invitées', `<strong>${escapeHtml(String(invited))}</strong> (e-mail avec le lien d'inscription)`],
              ])}
              ${clubCallout(escapeHtml(todo))}`,
    cta,
  });
  const text = clubText(
    `Groupe ${config.label} ouvert automatiquement (${count} / ${config.capacity} pré-inscrits).
Catégorie : ${created ? 'créée automatiquement' : 'déjà présente'}, ouverte aux inscriptions.
Familles invitées : ${invited}.
${todo}`,
    cta
  );
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: `Groupe ${config.label} ouvert : ${invited} famille(s) invitée(s)`,
    htmlContent: html,
    textContent: text,
  }, { kind: 'club_preinscription_ouverture', origin: 'auto', organizationId });
}

// Alerte interne (2026-10-09) : l'automatisation quotidienne (/api/cron) a échoué. Du 27 septembre au 8 octobre 2026,
// elle a échoué chaque matin sans que personne ne le voie. Envoyée au plus une fois par jour (voir recordCronFailure
// dans functions/api/cron.js). Aucune donnée personnelle : la date, l'étape et un lien vers les paramètres.
const CRON_STEP_LABELS = {
  organisation: 'Connexion à la base de données',
  automations: 'Relances et récapitulatif du lundi',
  crm: 'Synchronisation des adhérents',
  mirror: 'Copie des catégories',
};
export const cronStepLabel = (step) =>
  String(step || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => CRON_STEP_LABELS[s] || s)
    .join(', ') || 'Inconnue';

export async function sendCronFailureAlert(env, siteUrl, { at, step, organizationId }) {
  const to = await clubRecipients(env, organizationId);
  if (!to.length) return false;
  const when = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(at));
  const etape = cronStepLabel(step);
  const cta = { label: 'Ouvrir les paramètres', url: `${siteUrl}/admin/parametres` };

  const html = clubEmail({
    siteUrl,
    preheader: `Échec de l'automatisation quotidienne (${etape}).`,
    eyebrow: 'Espace admin · Automatisations',
    title: 'Automatisation en échec',
    subtitle: when,
    body: `${clubParagraph("L'automatisation quotidienne du site (relances automatiques, récapitulatif du lundi, synchronisation des adhérents) n'a pas fonctionné ce matin.")}
              ${clubInfoRows([
                ['Date', escapeHtml(when)],
                ['Étape en échec', escapeHtml(etape)],
              ])}
              ${clubCallout(`<strong style="color:${MAROON_900};">À faire :</strong> vérifier la ligne « Automatisations » dans les paramètres. Les relances dues peuvent être envoyées à la main depuis cette page. Si l'échec se répète, prévenir la personne qui gère le site.`)}`,
    cta,
  });

  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo — Site' },
    to,
    subject: "Espace admin : l'automatisation quotidienne a échoué",
    htmlContent: html,
    textContent: clubText(
      `L'automatisation quotidienne du site n'a pas fonctionné.

Date : ${when}
Étape en échec : ${etape}

À faire : vérifier la ligne « Automatisations » dans les paramètres ; les relances dues peuvent être envoyées à la main. Si l'échec se répète, prévenir la personne qui gère le site.`,
      cta
    ),
  }, { kind: 'club_cron', origin: 'auto', organizationId });
}

// ---------------------------------------------------------------------------------------------
// Message libre du club (2026-10-09, /admin/email) : écrit dans l'admin, envoyé famille par famille depuis contact@.
// Texte brut saisi par le responsable : échappé, paragraphes séparés par une ligne vide, liens http(s) cliquables.
const linkify = (escaped) =>
  escaped.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)»]/g, (url) => `<a href="${url}" target="_blank" style="color:${MAROON_900};font-weight:bold;word-break:break-all;">${url}</a>`);

export function buildClubMessage(row, { subject, message, siteUrl, greet = true }) {
  const paragraphs = String(message).replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  const greeting = greet && row?.parent_prenom ? `Bonjour ${greetingName(row)},` : '';
  const html = clubEmail({
    siteUrl,
    preheader: paragraphs[0].slice(0, 120),
    eyebrow: 'Club Démo · Message du club',
    title: subject,
    body: `${greeting ? clubParagraph(escapeHtml(greeting)) : ''}
              ${paragraphs.map((p) => clubParagraph(linkify(escapeHtml(p)).replace(/\n/g, '<br>'))).join('\n              ')}`,
    footerHtml: `Club Démo · Stade municipal, 1 rue du Stade, Sportville<br>Pour nous répondre, répondez simplement à cet e-mail ou écrivez à <a href="mailto:contact@clubdemo.licyo.fr" style="color:${INK_700};">contact@clubdemo.licyo.fr</a>.`,
  });
  const text = `${greeting ? `${greeting}\n\n` : ''}${paragraphs.join('\n\n')}\n\n—\nClub Démo · ${siteUrl.replace(/^https?:\/\//, '')}`;
  return { subject, html, text };
}

// to : destinataires imposés (essai envoyé au club) ; sinon les responsables de la fiche.
export async function sendClubMessage(env, row, { subject, message, siteUrl, greet = true, to = null, inscriptionId = null, organizationId = null }) {
  const { html, text } = buildClubMessage(row, { subject, message, siteUrl, greet });
  const recipients = to || familyRecipients(row);
  if (!recipients.length) return false;
  return brevoSend(env, {
    sender: { email: 'contact@clubdemo.licyo.fr', name: 'Club Démo' },
    to: recipients,
    subject,
    htmlContent: html,
    textContent: text,
  }, { kind: 'message_club', origin: 'manuel', inscriptionId, organizationId });
}

export { clubRecipients as clubRecipientsFor };
