// Formulaire d'inscription (inscription.html et /reinscription/<token>) : enregistre la demande dans D1
// et envoie l'e-mail de réception à la famille et l'alerte au club (Brevo). Le résultat (uploadToken : lien famille)
// sert au lien de l'espace famille (functions/depot/[token].js).
// Protections : limite de débit par connexion, Cloudflare Turnstile (dès que ses clés sont définies),
// formats et tranche d'âge revérifiés ici, anti-doublon par saison — et jamais de lien de suivi dans la
// réponse à un doublon (il est renvoyé par e-mail aux adresses déjà enregistrées).
import { ensureInscriptionsTable, findExistingInscription, buildDedupKey, isInscriptionComplete, SHIRT_SIZES as SIZES } from '../_shared/inscriptions-db.js';
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';
import { sendConfirmationEmail, sendAdminNotification, sendReminderEmail, sendFollowUpEmail } from '../_shared/confirmation-email.js';
import { issueFamilyLink, ensureFamilyLinksTable, isReinscriptionLinkValid } from '../_shared/family-links.js';
import { getCategoriesConfig, getEffectiveInscriptionStatus } from '../_shared/settings-kv.js';
import { clientKey, hitRateLimit, verifyTurnstile } from '../_shared/security.js';
import { syncInscriptionSafe } from '../_shared/crm.js';

const REQUIRED_FIELDS = ['enfantPrenom', 'enfantNom', 'naissance', 'categorie', 'tailleMaillot', 'modePaiement', 'parentPrenom', 'parentNom', 'email', 'telephone'];
// Lieu de naissance (2026-09-27, requis par la licence FFF) : obligatoire dans le formulaire, mais accepté vide ici
// pour ne pas refuser l'envoi d'une page ouverte avant sa mise en ligne ; le club le complète alors sur la fiche.
const TEXT_FIELDS = [...REQUIRED_FIELDS, 'villeNaissance', 'paysNaissance', 'cpNaissance', 'adresse', 'codePostal', 'ville', 'parent2Prenom', 'parent2Nom', 'parent2Email', 'parent2Telephone', 'passSportCode'];
const MAX_FIELD_LENGTH = 200;
const SHIRT_SIZES = new Set(SIZES);
const PAYMENT_METHODS = new Set(['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Largement au-dessus d'un usage normal (une famille qui inscrit plusieurs enfants).
const SUBMIT_LIMIT = { limit: 6, windowSeconds: 60 * 60 };
const CHECK_LIMIT = { limit: 40, windowSeconds: 60 * 60 };
const RESEND_LIMIT = { limit: 1, windowSeconds: 60 * 60 };

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Une panne D1 ne doit jamais empêcher une inscription : erreur = pas de limite.
async function overLimit(env, request, name, limits) {
  try {
    const { allowed } = await hitRateLimit(env.DB, `${name}:${await clientKey(request)}`, limits);
    return !allowed;
  } catch {
    return false;
  }
}

// Doublon : renvoie le lien de suivi aux adresses de la fiche existante (au plus une fois par heure),
// avec l'e-mail de relance habituel, ou celui de dossier complet si tout est déjà reçu.
async function resendTrackingLink(env, organizationId, uploadToken, siteUrl) {
  try {
    const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND upload_token = ?').bind(organizationId, uploadToken).first();
    if (!row) return;
    const { allowed } = await hitRateLimit(env.DB, `resend:${row.id}`, RESEND_LIMIT);
    if (!allowed) return;
    if (isInscriptionComplete(row)) await sendFollowUpEmail(env, row, siteUrl, { complete: true, origin: 'doublon' });
    else await sendReminderEmail(env, row, siteUrl, 'doublon');
  } catch {
    // best-effort
  }
}

// Réinscription par lien personnel : jeton UUID d'une fiche de cette organisation, pour le même enfant.
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function validReinscription(env, organizationId, token, data) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return false;
  try {
    await ensureInscriptionsTable(env.DB);
    await ensureFamilyLinksTable(env.DB);
    const row = await env.DB.prepare('SELECT naissance, reinscription_token, reinscription_token_expires_at FROM inscriptions WHERE organization_id = ? AND reinscription_token = ?').bind(organizationId, token).first();
    // Lien expiré : plus de passe-droit pendant la fermeture des inscriptions.
    return Boolean(row) && isReinscriptionLinkValid(row) && row.naissance === data.naissance;
  } catch {
    return false;
  }
}

// Contrôle en direct pendant la saisie (assets/js/inscription.js) : ne renvoie qu'un booléen.
export async function onRequestGet({ request, env }) {
  if (await overLimit(env, request, 'dupcheck', CHECK_LIMIT)) return json({ error: 'Trop de vérifications' }, 429);
  const { searchParams } = new URL(request.url);
  const enfantPrenom = searchParams.get('enfantPrenom') || '';
  const enfantNom = searchParams.get('enfantNom') || '';
  const email = searchParams.get('email') || '';
  const naissance = searchParams.get('naissance') || '';

  if (!enfantPrenom.trim() || !enfantNom.trim() || !email.trim()) {
    return json({ error: 'Paramètres manquants' }, 400);
  }

  try {
    const organization = await resolveOrganization(request, env);
    if (!organization) return unknownOrganization();
    await ensureInscriptionsTable(env.DB);
    const { saison } = await getCategoriesConfig(env, organization.id);
    const existing = await findExistingInscription(env.DB, organization.id, { enfantPrenom, enfantNom, naissance, email }, saison);
    return json({ duplicate: Boolean(existing) });
  } catch {
    return json({ error: 'Échec de la vérification' }, 500);
  }
}

export async function onRequestPost({ request, env, waitUntil }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'JSON invalide' }, 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'JSON invalide' }, 400);

  if (await overLimit(env, request, 'inscription', SUBMIT_LIMIT)) {
    return json({ error: 'Trop de demandes envoyées depuis cette connexion. Réessayez dans une heure, ou écrivez-nous à contact@clubdemo.licyo.fr.' }, 429);
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, request))) {
    return json({ error: 'La vérification anti-robot a échoué. Rechargez la page et réessayez.', turnstile: true }, 403);
  }

  // Copie nettoyée : seuls les champs attendus, en texte, bornés en longueur.
  const data = {};
  for (const field of TEXT_FIELDS) {
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (value.length > MAX_FIELD_LENGTH) return json({ error: `Champ trop long : ${field}` }, 400);
    data[field] = value;
  }
  for (const field of ['autorisation', 'droitImage', 'rgpd']) data[field] = body[field] === true;

  for (const field of REQUIRED_FIELDS) {
    if (!data[field]) return json({ error: `Champ manquant : ${field}` }, 400);
  }
  if (!data.autorisation || !data.rgpd) return json({ error: 'Autorisations requises' }, 400);
  if (!EMAIL_RE.test(data.email)) return json({ error: 'E-mail invalide' }, 400);
  // Second responsable légal facultatif : s'il est renseigné, prénom et nom sont requis, et son e-mail
  // (facultatif) doit être valide puisqu'il reçoit les e-mails de suivi.
  const parent2 = [data.parent2Prenom, data.parent2Nom, data.parent2Email, data.parent2Telephone];
  if (parent2.some(Boolean)) {
    if (!parent2[0] || !parent2[1]) return json({ error: 'Prénom et nom du second responsable légal requis' }, 400);
    if (parent2[2] && !EMAIL_RE.test(parent2[2])) return json({ error: 'E-mail du second responsable légal invalide' }, 400);
  }
  // Format contrôlé : les années alimentent les filtres de /admin/inscriptions.
  const birthDate = new Date(data.naissance + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.naissance) || !Number.isFinite(birthDate.getTime()) ||
      birthDate.toISOString().slice(0, 10) !== data.naissance || birthDate.getTime() > Date.now()) {
    return json({ error: 'Date de naissance invalide' }, 400);
  }
  if (data.cpNaissance && !/^\d{5}$/.test(data.cpNaissance)) return json({ error: 'Code postal de naissance invalide' }, 400);
  if (!SHIRT_SIZES.has(data.tailleMaillot)) return json({ error: 'Taille de maillot invalide' }, 400);
  if (!PAYMENT_METHODS.has(data.modePaiement)) return json({ error: 'Mode de paiement invalide' }, 400);

  // Organisation du domaine qui reçoit le formulaire : jamais une valeur envoyée par le navigateur.
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return unknownOrganization();
  const organizationId = organization.id;

  // Inscriptions fermées (réglage manuel, date de fermeture automatique, ou réinscription prioritaire en cours) : le
  // formulaire public est masqué, mais un envoi direct à l'API était accepté (relevé par une revue Codex, 2026-10-08).
  // Seule exception : une réinscription par lien personnel (/reinscription/<token>), accessible en tout temps, dont le
  // jeton doit appartenir à cette organisation et au même enfant (même date de naissance).
  const { status } = await getEffectiveInscriptionStatus(env, organizationId);
  if (status !== 'open' && !(await validReinscription(env, organizationId, body.reinscriptionToken, data))) {
    return json({ error: 'Les inscriptions sont fermées pour le moment. Écrivez-nous à contact@clubdemo.licyo.fr pour être prévenu(e) de leur réouverture.', closed: true }, 403);
  }

  // Saison et catégories lues côté serveur, jamais celles envoyées par le navigateur.
  const { saison, categories } = await getCategoriesConfig(env, organizationId);

  // Seule protection fiable contre une catégorie qui ne correspond pas à l'âge (JS désactivé, requête rejouée).
  const anneeNaissance = Number(data.naissance.slice(0, 4));
  const categorieValide = categories.some(
    (c) => c.active && c.label === data.categorie && anneeNaissance >= c.anneeMin && anneeNaissance <= c.anneeMax
  );
  if (!categorieValide) return json({ error: 'La date de naissance ne correspond pas à la catégorie sélectionnée' }, 400);

  const siteUrl = new URL(request.url).origin;
  try {
    await ensureInscriptionsTable(env.DB);
    // Anti-doublon par saison : même enfant (prénom, nom, naissance) et même e-mail de parent.
    const existing = await findExistingInscription(env.DB, organizationId, data, saison);
    if (existing) {
      waitUntil(resendTrackingLink(env, organizationId, existing.upload_token, siteUrl));
      return json({ duplicate: true, linkResent: true }, 409);
    }
  } catch {
    return json({ error: 'Échec de la vérification' }, 500);
  }

  const uploadToken = crypto.randomUUID();
  const dedupKey = buildDedupKey({ enfantPrenom: data.enfantPrenom, enfantNom: data.enfantNom, email: data.email });

  let inscriptionId = null;
  try {
    const inserted = await env.DB.prepare(
      `INSERT INTO inscriptions
        (organization_id, enfant_prenom, enfant_nom, naissance, categorie, taille_maillot, mode_paiement, parent_prenom, parent_nom, email, telephone, adresse, code_postal, ville, autorisation, droit_image, rgpd, upload_token, dedup_key, saison, parent2_prenom, parent2_nom, parent2_email, parent2_telephone, pass_sport_code, ville_naissance, pays_naissance, cp_naissance)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM inscriptions
         WHERE organization_id = ? AND dedup_key = ? AND naissance = ? AND (saison = ? OR saison IS NULL)
       )`
    )
      .bind(
        organizationId,
        data.enfantPrenom,
        data.enfantNom,
        data.naissance,
        data.categorie,
        data.tailleMaillot,
        data.modePaiement,
        data.parentPrenom,
        data.parentNom,
        data.email,
        data.telephone || null,
        data.adresse || null,
        data.codePostal || null,
        data.ville || null,
        data.autorisation ? 1 : 0,
        data.droitImage ? 1 : 0,
        data.rgpd ? 1 : 0,
        uploadToken,
        dedupKey,
        saison,
        data.parent2Prenom || null,
        data.parent2Nom || null,
        data.parent2Email || null,
        data.parent2Telephone || null,
        data.passSportCode || null,
        data.villeNaissance || null,
        data.paysNaissance || null,
        data.cpNaissance || null,
        organizationId,
        dedupKey,
        data.naissance,
        saison
      )
      .run();
    // La pré-vérification améliore la réponse, mais cette écriture conditionnelle garantit
    // l'anti-doublon même si deux requêtes ont lu simultanément une absence de fiche.
    if (inserted.meta.changes === 0) {
      const existing = await findExistingInscription(env.DB, organizationId, data, saison);
      if (!existing) throw new Error('Inscription concurrente introuvable');
      waitUntil(resendTrackingLink(env, organizationId, existing.upload_token, siteUrl));
      return json({ duplicate: true, linkResent: true }, 409);
    }
    inscriptionId = inserted.meta.last_row_id;
  } catch {
    return json({ error: "Échec de l'enregistrement" }, 500);
  }

  // CRM (phase 3) : l'inscription est déjà enregistrée et ne peut plus être perdue ; la synchronisation vers le
  // modèle contacts/adhésions ne doit jamais la faire échouer (syncInscriptionSafe ne lève pas). Si elle échoue, la
  // réconciliation (cron quotidien ou bouton de /admin/adherents) la rattrape.
  waitUntil(syncInscriptionSafe(env, organizationId, inscriptionId));
  // waitUntil : les e-mails partent après la réponse, sans la retarder.
  // Lien personnel à durée limitée vers l'espace famille (_shared/family-links.js), jamais le jeton interne
  // upload_token. Le champ garde son nom pour assets/js/inscription.js. Sans lien (base indisponible), la page et
  // l'e-mail renvoient vers /espace-famille.
  const familyToken = await issueFamilyLink(env.DB, organizationId, inscriptionId).catch(() => null);
  waitUntil(sendConfirmationEmail(env, data, familyToken, siteUrl, inscriptionId, organizationId));
  waitUntil(sendAdminNotification(env, data, siteUrl, inscriptionId, organizationId));
  return json({ ok: true, uploadToken: familyToken });
}
