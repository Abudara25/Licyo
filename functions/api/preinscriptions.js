// Pré-inscription (liste d'intérêt, voir _shared/preinscriptions.js) : GET = état public (places restantes, ouvert
// ou non, années de naissance acceptées), POST = enregistrement. Plafond et anti-doublon garantis par l'insertion
// conditionnelle ; organisation résolue par le domaine, jamais par le navigateur. Mêmes protections que le
// formulaire d'inscription : limite de débit, Turnstile dès que ses clés existent, champs bornés et revérifiés.
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';
import {
  ensurePreinscriptionsTable,
  getPreinscriptionConfig,
  countPreinscriptions,
  insertPreinscription,
  publicState,
  cleanBirthPlace,
  findActiveInscriptionForChild,
} from '../_shared/preinscriptions.js';
import { clientKey, hitRateLimit, verifyTurnstile } from '../_shared/security.js';
import { sendPreinscriptionConfirmation, sendPreinscriptionClubAlert } from '../_shared/confirmation-email.js';
import { SHIRT_SIZES, ensureInscriptionsTable } from '../_shared/inscriptions-db.js';
import { openPreinscriptionGroupIfFull } from '../_shared/preinscription-opening.js';

const REQUIRED = ['enfantPrenom', 'enfantNom', 'naissance', 'parentPrenom', 'parentNom', 'email', 'telephone'];
// Second responsable légal facultatif : s'il est renseigné, prénom et nom sont requis et l'e-mail (facultatif) doit
// être valide, puisqu'il reçoit aussi l'e-mail de confirmation (mêmes règles que functions/api/inscriptions.js).
const PARENT2 = ['parent2Prenom', 'parent2Nom', 'parent2Email', 'parent2Telephone'];
const MAX_FIELD_LENGTH = 200;
const MAX_COMMENT_LENGTH = 500;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBMIT_LIMIT = { limit: 6, windowSeconds: 60 * 60 };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function loadState(env, organizationId) {
  const config = await getPreinscriptionConfig(env, organizationId);
  if (!config) return { config: null, state: publicState(null, 0) };
  await ensurePreinscriptionsTable(env.DB);
  const count = await countPreinscriptions(env.DB, organizationId, config.groupe);
  return { config, state: publicState(config, count) };
}

export async function onRequestGet({ request, env }) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return unknownOrganization();
  try {
    const { state } = await loadState(env, organization.id);
    return json({ ...state, turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
  } catch {
    return json({ error: 'Service momentanément indisponible' }, 503);
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

  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return unknownOrganization();

  try {
    const { allowed } = await hitRateLimit(env.DB, `preinscription:${await clientKey(request)}`, SUBMIT_LIMIT);
    if (!allowed) return json({ error: 'Trop de demandes envoyées depuis cette connexion. Réessayez dans une heure.' }, 429);
  } catch {
    // Panne de la limite : on n'empêche pas une famille de se pré-inscrire.
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, request))) {
    return json({ error: 'La vérification anti-robot a échoué. Rechargez la page et réessayez.', turnstile: true }, 403);
  }

  const data = {};
  for (const field of [...REQUIRED, ...PARENT2, 'commentaire']) {
    const value = typeof body[field] === 'string' ? body[field].trim() : '';
    if (value.length > (field === 'commentaire' ? MAX_COMMENT_LENGTH : MAX_FIELD_LENGTH)) return json({ error: `Champ trop long : ${field}` }, 400);
    data[field] = value;
  }
  for (const field of REQUIRED) if (!data[field]) return json({ error: `Champ manquant : ${field}` }, 400);
  if (body.rgpd !== true) return json({ error: 'Consentement requis' }, 400);
  if (!EMAIL_RE.test(data.email)) return json({ error: 'E-mail invalide' }, 400);
  if (PARENT2.some((field) => data[field])) {
    if (!data.parent2Prenom || !data.parent2Nom) return json({ error: 'Prénom et nom du second responsable légal requis' }, 400);
    if (data.parent2Email && !EMAIL_RE.test(data.parent2Email)) return json({ error: 'E-mail du second responsable légal invalide' }, 400);
  }
  // Lieu de naissance (mêmes noms de champs que le formulaire d'inscription) : obligatoire, texte libre borné.
  data.paysNaissance = cleanBirthPlace(body.paysNaissance);
  data.villeNaissance = cleanBirthPlace(body.villeNaissance);
  if (!data.paysNaissance || !data.villeNaissance) return json({ error: 'Indiquez le pays et la ville de naissance (100 caractères au plus).' }, 400);
  // Taille de tenue : même liste fermée que le formulaire d'inscription.
  data.tailleMaillot = typeof body.tailleMaillot === 'string' ? body.tailleMaillot.trim() : '';
  if (!SHIRT_SIZES.includes(data.tailleMaillot)) return json({ error: 'Choisissez une taille de maillot.' }, 400);
  const birth = new Date(`${data.naissance}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.naissance) || !Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== data.naissance || birth.getTime() > Date.now()) {
    return json({ error: 'Date de naissance invalide' }, 400);
  }

  let config;
  let result;
  try {
    ({ config } = await loadState(env, organization.id));
    if (!config) return json({ error: 'Aucune pré-inscription ouverte' }, 404);
    if (config.openedAt) return json({ error: `Le groupe ${config.label} est ouvert : inscrivez votre enfant depuis la page Inscription.`, opened: true }, 409);
    if (!config.open) return json({ error: 'La pré-inscription est fermée.', closed: true }, 409);
    const year = Number(data.naissance.slice(0, 4));
    if (year < config.anneeMin || year > config.anneeMax) {
      const young = year > config.anneeMax;
      return json({ error: `Votre enfant, né(e) en ${year}, est trop ${young ? 'jeune' : 'âgé(e)'} pour le groupe ${config.label}.`, age: young ? 'young' : 'old' }, 400);
    }
    // Enfant déjà inscrit au club (inscription active) : pas de pré-inscription en plus, le club gère le changement
    // de groupe depuis la fiche (« Transférer en pré-inscription »).
    await ensureInscriptionsTable(env.DB);
    if (await findActiveInscriptionForChild(env.DB, organization.id, data)) {
      return json({ alreadyRegistered: true, error: `${data.enfantPrenom} est déjà inscrit(e) au club : pas besoin de pré-inscription. Nous vous recontacterons au sujet du groupe ${config.label}.` }, 409);
    }
    result = await insertPreinscription(env.DB, organization.id, config, data);
  } catch {
    return json({ error: "Échec de l'enregistrement" }, 500);
  }

  if (result.status === 'duplicate') return json({ duplicate: true, error: 'Cet enfant est déjà sur la liste de pré-inscription.' }, 409);
  if (result.status === 'full') return json({ full: true, error: 'Les places de pré-inscription sont toutes prises.' }, 409);

  const siteUrl = new URL(request.url).origin;
  const count = await countPreinscriptions(env.DB, organization.id, config.groupe).catch(() => null);
  waitUntil(sendPreinscriptionConfirmation(env, data, config, siteUrl, organization.id));
  waitUntil(sendPreinscriptionClubAlert(env, data, config, count, siteUrl, organization.id));
  // Dernière place prise : le groupe devient une catégorie et les familles sont invitées à s'inscrire.
  if (Number.isInteger(count) && count >= config.capacity) {
    waitUntil(openPreinscriptionGroupIfFull(env, organization.id, siteUrl).catch((error) => console.error(`Ouverture du groupe : ${error?.name}`)));
  }
  return json({ ok: true, ...publicState(config, count ?? 0) });
}
