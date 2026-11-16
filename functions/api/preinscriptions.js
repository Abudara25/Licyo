// Pré-inscription (liste d'intérêt, voir _shared/preinscriptions.js) : GET = état public (places restantes, ouvert
// ou non, années de naissance acceptées), POST = enregistrement. Plafond et anti-doublon garantis par l'insertion
// conditionnelle ; organisation résolue par le domaine, jamais par le navigateur. Mêmes protections que le
// formulaire d'inscription : limite de débit, Turnstile dès que ses clés existent, champs bornés et revérifiés.
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';
import {
  ensurePreinscriptionsTable,
  getPreinscriptionGroups,
  countPreinscriptions,
  countByGroup,
  groupForYear,
  insertPreinscription,
  publicState,
  isGroupOpened,
  cleanBirthPlace,
  cleanBirthPostcode,
  findActiveInscriptionForChild,
} from '../_shared/preinscriptions.js';
import { clientKey, hitRateLimit, verifyTurnstile } from '../_shared/security.js';
import { sendPreinscriptionConfirmation, sendPreinscriptionClubAlert } from '../_shared/confirmation-email.js';
import { SHIRT_SIZES, ensureInscriptionsTable } from '../_shared/inscriptions-db.js';
import { openPreinscriptionGroupIfFull, activeCategoryFor } from '../_shared/preinscription-opening.js';

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

// État public de tous les groupes (plusieurs depuis le 2026-11-04). Les champs du premier groupe restent aussi à la
// racine de la réponse (ancien format, lu par une page restée en cache).
async function loadGroups(env, organizationId) {
  const listed = await getPreinscriptionGroups(env, organizationId);
  if (!listed.length) return { groups: listed, states: [] };
  // Groupe en mode « catégorie automatique » dont la catégorie d'inscription est déjà active : il est ouvert, la
  // famille s'inscrit directement (jamais de pré-inscription et d'inscription concurrentes pour les mêmes années).
  const groups = await Promise.all(
    listed.map(async (g) => (g.autoCategory !== false && !g.openedAt && (await activeCategoryFor(env, organizationId, g)) ? { ...g, categoryActive: true } : g))
  );
  await ensurePreinscriptionsTable(env.DB);
  const counts = await countByGroup(env.DB, organizationId);
  return { groups, states: groups.map((g) => publicState(g, counts[g.groupe] || 0)) };
}

export async function onRequestGet({ request, env }) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return unknownOrganization();
  try {
    const { states } = await loadGroups(env, organization.id);
    const first = states.find((s) => s.open) || states[0] || publicState(null, 0);
    return json({ ...first, groups: states, turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
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
  // Code postal de naissance (2026-11-10) : exigé par le formulaire pour la France ; vide accepté d'une page ouverte
  // avant son ajout (le club le complète, ou le trouve d'après la ville).
  data.cpNaissance = cleanBirthPostcode(body.cpNaissance, data.paysNaissance);
  if (data.cpNaissance === null) return json({ error: 'Code postal de naissance invalide (5 chiffres).' }, 400);
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
    const { groups } = await loadGroups(env, organization.id);
    if (!groups.length) return json({ error: 'Aucune pré-inscription ouverte' }, 404);
    // Le groupe est choisi par le serveur d'après l'année de naissance (années de deux groupes jamais communes).
    const year = Number(data.naissance.slice(0, 4));
    config = groupForYear(groups, year);
    if (!config) {
      const young = groups.every((g) => year > g.anneeMax);
      return json({ error: `Votre enfant, né(e) en ${year}, est trop ${young ? 'jeune' : 'âgé(e)'} pour les groupes en pré-inscription (${groups.map((g) => g.label).join(', ')}).`, age: young ? 'young' : 'old', nogroup: true }, 400);
    }
    if (isGroupOpened(config)) return json({ error: `Le groupe ${config.label} est ouvert : inscrivez votre enfant depuis la page Inscription.`, opened: true, groupe: config.groupe }, 409);
    if (!config.open) return json({ error: `La pré-inscription ${config.label} est fermée.`, closed: true, groupe: config.groupe }, 409);
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
  if (result.status === 'full') return json({ full: true, groupe: config.groupe, error: `Les places de pré-inscription ${config.label} sont toutes prises.` }, 409);

  const siteUrl = new URL(request.url).origin;
  const count = await countPreinscriptions(env.DB, organization.id, config.groupe).catch(() => null);
  waitUntil(sendPreinscriptionConfirmation(env, data, config, siteUrl, organization.id));
  waitUntil(sendPreinscriptionClubAlert(env, data, config, count, siteUrl, organization.id));
  // Dernière place prise : catégorie créée et familles invitées, ou alerte « liste complète » (salle d'attente).
  if (Number.isInteger(count) && count >= config.capacity) {
    waitUntil(openPreinscriptionGroupIfFull(env, organization.id, siteUrl, config.groupe).catch((error) => console.error(`Ouverture du groupe : ${error?.name}`)));
  }
  return json({ ok: true, ...publicState(config, count ?? 0) });
}
