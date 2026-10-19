// Réglages d'une organisation, stockés dans le KV "licyo_config" (binding INSCRIPTION_STATUS).
//
// Depuis la consolidation de la phase SaaS (2026-09-23), chaque réglage appartient à UNE organisation :
// clé `org:<organizationId>:<nom>` (ex. org:org_demo:categories_config). Toutes les fonctions de ce module
// exigent l'organizationId, déterminé côté serveur (session admin ou domaine). Aucune clé globale n'est
// plus lue pour une autre organisation que Sportville.
//
// Reprise de l'existant : avant cette date, les clés étaient globales (notification_email,
// categories_config…) et appartenaient à Sportville, seule organisation. Pour Sportville :
// - lecture : clé de l'organisation, sinon ancienne clé globale (aucune donnée perdue au déploiement) ;
// - écriture : clé de l'organisation ET ancienne clé (LEGACY_MIRROR), pour qu'un retour temporaire à
//   l'ancien code retrouve des réglages à jour. À retirer une fois la phase SaaS stabilisée.
// Classement des clés : toutes sont propres à une organisation ; aucune n'est globale à la plateforme.
import { DEMO_ORG_ID } from './schema.js';
import { readGroupsConfig, writeGroupsConfig, bootstrapPublicData } from './public-data.js';

const LEGACY_MIRROR = true;

export const settingKey = (organizationId, name) => `org:${organizationId}:${name}`;

function requireOrganization(organizationId) {
  if (!organizationId || typeof organizationId !== 'string') throw new Error('Réglage KV : organisation requise');
}

const isLegacyTenant = (organizationId) => organizationId === DEMO_ORG_ID;

export async function readSetting(env, organizationId, name) {
  requireOrganization(organizationId);
  const value = await env.INSCRIPTION_STATUS.get(settingKey(organizationId, name));
  if (value !== null && value !== undefined) return value;
  return isLegacyTenant(organizationId) ? env.INSCRIPTION_STATUS.get(name) : null;
}

export async function writeSetting(env, organizationId, name, value, options) {
  requireOrganization(organizationId);
  await env.INSCRIPTION_STATUS.put(settingKey(organizationId, name), value, options);
  if (LEGACY_MIRROR && isLegacyTenant(organizationId)) await env.INSCRIPTION_STATUS.put(name, value, options);
}

export async function deleteSetting(env, organizationId, name) {
  requireOrganization(organizationId);
  await env.INSCRIPTION_STATUS.delete(settingKey(organizationId, name));
  // L'ancienne clé est toujours effacée pour Sportville : sinon la lecture la reprendrait.
  if (isLegacyTenant(organizationId)) await env.INSCRIPTION_STATUS.delete(name);
}

async function readJson(env, organizationId, name) {
  try {
    const stored = await readSetting(env, organizationId, name);
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    if (/organisation requise/.test(error?.message)) throw error;
    return null; // KV indisponible ou JSON corrompu : valeurs par défaut
  }
}

// ---------------------------------------------------------------------------------------------
// E-mail de notification du club (/admin/parametres). Valeur par défaut propre à Sportville ; une
// autre organisation sans réglage n'a aucun destinataire (jamais l'adresse d'une autre organisation).
export const DEFAULT_NOTIFICATION_EMAIL = 'contact@clubdemo.licyo.fr';

export async function getNotificationEmail(env, organizationId) {
  requireOrganization(organizationId);
  try {
    const stored = await readSetting(env, organizationId, 'notification_email');
    if (stored) return stored;
  } catch {
    // KV indisponible : repli ci-dessous.
  }
  return isLegacyTenant(organizationId) ? DEFAULT_NOTIFICATION_EMAIL : '';
}

export async function setNotificationEmail(env, organizationId, value) {
  await writeSetting(env, organizationId, 'notification_email', value);
}

// ---------------------------------------------------------------------------------------------
// Catégories d'âge + saison + tarif (/admin/categories). DEFAULT_CATEGORIES_CONFIG reprend les valeurs
// réelles de Sportville pour la saison 2026-2027 : repli tant que /admin/categories n'a jamais été
// enregistré. Une autre organisation part d'une configuration vide (aucune catégorie, aucun lien).
export const DEFAULT_CATEGORIES_CONFIG = {
  saison: '2026-2027',
  prix: 180,
  // Date limite (YYYY-MM-DD) de la réinscription prioritaire — voir effectiveInscriptionStatus()
  // ci-dessous et functions/admin/categories.js. null = pas de campagne de réinscription en cours.
  dateLimiteReinscription: null,
  // Valeur de "saison" juste avant le dernier changement effectif (bouton « Revenir à la saison
  // précédente » de /admin/categories).
  previousSaison: null,
  // Date (YYYY-MM-DD) à partir de laquelle le formulaire public se ferme tout seul.
  dateFermetureInscriptions: null,
  categories: [
    {
      id: 'u6-u7',
      label: 'U6 - U7',
      anneeMin: 2020,
      anneeMax: 2021,
      helloAssoUrl: 'https://www.helloasso.com/beta/associations/club-demo-licyo/adhesions/adhesion-u6-u7-club-demo',
      helloAssoWidgetUrl: 'https://www.helloasso.com/associations/club-demo-licyo/adhesions/adhesion-u6-u7-club-demo/widget',
      active: true,
    },
    {
      id: 'u8-u9',
      label: 'U8 - U9',
      anneeMin: 2018,
      anneeMax: 2019,
      helloAssoUrl: 'https://www.helloasso.com/beta/associations/club-demo-licyo/adhesions/adhesion-u8-u9-club-demo',
      helloAssoWidgetUrl: 'https://www.helloasso.com/associations/club-demo-licyo/adhesions/adhesion-u8-u9-club-demo/widget',
      active: true,
    },
  ],
};

// Saison en cours d'après la date (une saison commence en juillet) : jamais la saison de Sportville.
function currentSeasonLabel(now = new Date()) {
  const year = now.getUTCFullYear();
  const start = now.getUTCMonth() >= 6 ? year : year - 1;
  return `${start}-${start + 1}`;
}

export const EMPTY_CATEGORIES_CONFIG = {
  saison: currentSeasonLabel(),
  prix: null,
  dateLimiteReinscription: null,
  previousSaison: null,
  dateFermetureInscriptions: null,
  categories: [],
};

// Catégories (groupes) et tarif : D1 est la SOURCE DE VÉRITÉ (_shared/public-data.js) ; saison et dates
// restent dans le KV. Le KV garde une copie des catégories pour Sportville seulement (LEGACY_MIRROR,
// retour arrière vers l'ancien code) : jamais une source métier.
//
// Trois états :
// - D1 fonctionne et la donnée existe : c'est elle qui compte ;
// - D1 fonctionne et la donnée est absente (groupe supprimé, pas de tarif) : elle est réellement absente,
//   on ne la remplace ni par le KV ni par une valeur par défaut ;
// - D1 réellement en panne : repli sur la configuration KV (Sportville : ses valeurs historiques par
//   défaut ; toute autre organisation : configuration vide, jamais les valeurs de Sportville).
// Premier accès d'une organisation : ses tables D1 sont remplies depuis sa configuration KV, une seule fois.
export async function getCategoriesConfig(env, organizationId) {
  const kvConfig = await readKvCategoriesConfig(env, organizationId);
  if (!env.DB) return kvConfig;
  try {
    let stored = await readGroupsConfig(env, organizationId);
    if (!stored && kvConfig.categories.length) {
      await bootstrapPublicData(env, organizationId, kvConfig);
      stored = await readGroupsConfig(env, organizationId);
    }
    if (!stored) return { ...kvConfig, categories: [], prix: null, configVersion: 0 };
    return { ...kvConfig, categories: stored.categories, prix: stored.prix, configVersion: stored.version };
  } catch (error) {
    console.warn(`Catégories : D1 indisponible pour ${organizationId}, repli sur le KV (${error?.message})`);
    return kvConfig;
  }
}

async function readKvCategoriesConfig(env, organizationId) {
  requireOrganization(organizationId);
  const defaults = isLegacyTenant(organizationId) ? DEFAULT_CATEGORIES_CONFIG : EMPTY_CATEGORIES_CONFIG;
  const parsed = await readJson(env, organizationId, 'categories_config');
  // Complétée par les valeurs par défaut : une config enregistrée sans "saison" ne doit jamais produire
  // une inscription sans saison.
  if (parsed && Array.isArray(parsed.categories) && parsed.categories.length) {
    return { ...defaults, ...parsed, saison: String(parsed.saison || '').trim() || defaults.saison };
  }
  return defaults;
}

// Écriture en D1 d'abord (source de vérité) : si elle échoue, rien n'est écrit dans le KV. Le KV n'est
// qu'une copie de compatibilité, écrite au mieux : une panne du KV APRÈS le succès de D1 ne fait pas
// échouer la modification (elle est enregistrée), elle est seulement journalisée, et la copie se
// reconstruit depuis D1 avec rebuildLegacyMirror. expectedVersion : voir writeGroupsConfig (conflit).
export async function setCategoriesConfig(env, organizationId, config, { expectedVersion } = {}) {
  requireOrganization(organizationId);
  const { configVersion, ...toStore } = config; // version de contrôle : jamais recopiée dans le KV
  if (env.DB) await writeGroupsConfig(env, organizationId, toStore, { expectedVersion });
  try {
    await writeSetting(env, organizationId, 'categories_config', JSON.stringify(toStore));
  } catch (error) {
    if (!env.DB) throw error; // sans D1, le KV est la seule source : l'échec doit remonter
    console.warn(`Catégories : copie KV non mise à jour pour ${organizationId} (${error?.message}) ; rebuildLegacyMirror la reconstruira depuis D1`);
  }
}

// Reconstruit la copie KV des catégories (ancienne clé de Sportville comprise) depuis D1 : à lancer après
// une panne du KV. Sans effet si D1 n'a rien d'enregistré pour l'organisation. Renvoie true si écrite.
export async function rebuildLegacyMirror(env, organizationId) {
  requireOrganization(organizationId);
  const stored = await readGroupsConfig(env, organizationId);
  if (!stored) return false;
  const kvConfig = await readKvCategoriesConfig(env, organizationId);
  await writeSetting(env, organizationId, 'categories_config', JSON.stringify({ ...kvConfig, categories: stored.categories, prix: stored.prix }));
  return true;
}

// ---------------------------------------------------------------------------------------------
// Statut d'ouverture du formulaire public (bouton Fermer / Rouvrir de /admin/inscriptions).
export async function getInscriptionStatus(env, organizationId) {
  requireOrganization(organizationId);
  try {
    return await readSetting(env, organizationId, 'inscription_status');
  } catch {
    return null;
  }
}

export async function setInscriptionStatus(env, organizationId, status) {
  await writeSetting(env, organizationId, 'inscription_status', status);
}

// Statut d'ouverture "effectif" du formulaire public : une date de fermeture automatique atteinte prime
// sur tout ; un statut brut "open" l'emporte ensuite ; une date limite de réinscription dépassée rouvre
// automatiquement au public. Pas de Cron Trigger : simple comparaison de date à chaque requête.
export const todayIso = () => new Date().toISOString().slice(0, 10);

export function effectiveInscriptionStatus(rawStatus, dateLimiteReinscription, dateFermetureInscriptions) {
  const today = todayIso();
  if (dateFermetureInscriptions && today >= dateFermetureInscriptions) return 'closed';
  if (rawStatus === 'open') return 'open';
  if (dateLimiteReinscription && today >= dateLimiteReinscription) return 'open';
  return 'closed';
}

// Statut effectif d'une organisation (formulaire public ET contrôle serveur de functions/api/inscriptions.js) :
// { status, rawStatus, dateLimiteReinscription, dateFermetureInscriptions }. KV illisible : statut brut « open »
// (même règle que l'affichage du formulaire ; les dates de fermeture et de réinscription s'appliquent quand même).
export async function getEffectiveInscriptionStatus(env, organizationId) {
  let rawStatus = 'open';
  try {
    const value = await getInscriptionStatus(env, organizationId);
    if (value === 'open' || value === 'closed') rawStatus = value;
  } catch {
    // KV indisponible : statut brut par défaut.
  }
  const { dateLimiteReinscription, dateFermetureInscriptions } = await getCategoriesConfig(env, organizationId);
  return {
    status: effectiveInscriptionStatus(rawStatus, dateLimiteReinscription, dateFermetureInscriptions),
    rawStatus,
    dateLimiteReinscription,
    dateFermetureInscriptions,
  };
}

// ---------------------------------------------------------------------------------------------
// Automatisations (/admin/parametres, voir _shared/automations.js) : activées par défaut, elles ne font
// rien tant que leur prérequis manque (BREVO_API_KEY, secrets HelloAsso, service programmé).
export const DEFAULT_AUTOMATIONS = { familyEmails: true, clubUploadAlerts: true, helloassoAutoPay: true, autoReminders: true, weeklySummary: true };

export async function getAutomationsConfig(env, organizationId) {
  requireOrganization(organizationId);
  return { ...DEFAULT_AUTOMATIONS, ...((await readJson(env, organizationId, 'automations_config')) || {}) };
}

export async function setAutomationsConfig(env, organizationId, config) {
  await writeSetting(env, organizationId, 'automations_config', JSON.stringify(config));
}

// Infos envoyées aux familles une fois le paiement reçu (/admin/parametres, e-mails de suivi) : lien
// d'invitation au groupe WhatsApp. Aucune valeur par défaut (vide = bloc absent de l'e-mail).
export async function getFamilyInfo(env, organizationId) {
  requireOrganization(organizationId);
  const stored = (await readJson(env, organizationId, 'family_info')) || {};
  return { whatsappUrl: normalizeWhatsappUrl(stored.whatsappUrl) || '' };
}

export async function setFamilyInfo(env, organizationId, { whatsappUrl }) {
  await writeSetting(env, organizationId, 'family_info', JSON.stringify({ whatsappUrl: whatsappUrl || '' }));
}

// Seuls les liens d'invitation à un groupe (https://chat.whatsapp.com/<code>) sont acceptés ; les
// paramètres ajoutés par l'appli (?mode=…) sont retirés. Renvoie null si le lien n'en est pas un.
export function normalizeWhatsappUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const code = url.pathname.replace(/^\/(invite\/)?/, '').replace(/\/$/, '');
  if (url.protocol !== 'https:' || url.hostname !== 'chat.whatsapp.com' || url.username || url.password || url.port) return null;
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) return null;
  return `https://chat.whatsapp.com/${code}`;
}

// Dernier passage des tâches programmées (functions/api/cron.js) et date du dernier récapitulatif.
export async function getCronState(env, organizationId) {
  requireOrganization(organizationId);
  return (await readJson(env, organizationId, 'cron_state')) || {};
}

export async function setCronState(env, organizationId, state) {
  await writeSetting(env, organizationId, 'cron_state', JSON.stringify(state));
}
