// Identifiants des services externes, PAR ORGANISATION, chiffrés (phase 1 de la feuille de route, 2026-10-20).
//
// Chaque club enregistre ses propres identifiants HelloAsso depuis /admin/parametres : secret de l'URL de notification
// (généré par la plateforme), identifiant et secret API. Ils sont stockés dans le KV du club (clé
// org:<organisation>:integration_helloasso), CHIFFRÉS en AES-GCM avec une clé dérivée du secret de plateforme
// SECRETS_KEY (variable Cloudflare, jamais commitée). Sans SECRETS_KEY, rien ne peut être enregistré ni lu : aucune
// intégration n'est active. Les secrets ne sont jamais renvoyés au navigateur (seulement « enregistré » / « absent »),
// ni écrits dans un journal. Il n'existe plus de secret Cloudflare global HELLOASSO_* valable pour un club en particulier.
import { readSetting, writeSetting, deleteSetting } from './settings-kv.js';
import { timingSafeEqual, randomToken } from './security.js';

const SETTING = 'integration_helloasso';
const VERSION = 'v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const secretsConfigured = (env) => typeof env.SECRETS_KEY === 'string' && env.SECRETS_KEY.length >= 16;

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// Clé AES propre à l'organisation : HKDF(SECRETS_KEY, sel = identifiant de l'organisation). Un texte chiffré copié
// d'un club à l'autre ne se déchiffre pas.
async function keyFor(env, organizationId) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(env.SECRETS_KEY), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(`licyo:${organizationId}`), info: encoder.encode('integrations') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptForOrganization(env, organizationId, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFor(env, organizationId), encoder.encode(JSON.stringify(value)));
  return `${VERSION}.${toB64(iv)}.${toB64(data)}`;
}

export async function decryptForOrganization(env, organizationId, stored) {
  const [version, iv, data] = String(stored || '').split('.');
  if (version !== VERSION || !iv || !data) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, await keyFor(env, organizationId), fromB64(data));
    return JSON.parse(decoder.decode(plain));
  } catch {
    return null; // clé changée ou texte altéré : traité comme absent
  }
}

const EMPTY = Object.freeze({ webhookSecret: null, clientId: null, clientSecret: null });

export async function helloAssoCredentials(env, organizationId) {
  if (!organizationId || !secretsConfigured(env)) return { ...EMPTY };
  let stored = null;
  try {
    stored = await readSetting(env, organizationId, SETTING);
  } catch {
    return { ...EMPTY };
  }
  const value = stored ? await decryptForOrganization(env, organizationId, stored) : null;
  return {
    webhookSecret: typeof value?.webhookSecret === 'string' && value.webhookSecret ? value.webhookSecret : null,
    clientId: typeof value?.clientId === 'string' && value.clientId ? value.clientId : null,
    clientSecret: typeof value?.clientSecret === 'string' && value.clientSecret ? value.clientSecret : null,
  };
}

const API_FIELD = /^[A-Za-z0-9._~+/=-]{4,200}$/;

// Mise à jour partielle : seuls les champs fournis (non undefined) changent ; null efface. Le secret de notification
// est toujours tiré par la plateforme (generateWebhookSecret), jamais saisi.
export async function saveHelloAssoCredentials(env, organizationId, changes) {
  if (!secretsConfigured(env)) throw new Error('SECRETS_KEY absent : impossible de chiffrer les identifiants');
  const current = await helloAssoCredentials(env, organizationId);
  const next = { ...current };
  for (const field of ['webhookSecret', 'clientId', 'clientSecret']) {
    if (changes[field] === undefined) continue;
    if (changes[field] === null || changes[field] === '') next[field] = null;
    else if (field === 'webhookSecret' || API_FIELD.test(changes[field])) next[field] = changes[field];
    else throw new Error(`Valeur invalide : ${field}`);
  }
  if (!next.webhookSecret && !next.clientId && !next.clientSecret) {
    await deleteSetting(env, organizationId, SETTING);
    return next;
  }
  await writeSetting(env, organizationId, SETTING, await encryptForOrganization(env, organizationId, next));
  return next;
}

export const generateWebhookSecret = () => randomToken(32);

// Clé de l'URL de notification comparée, en temps constant, au secret de l'organisation du domaine.
export async function isValidHelloAssoKey(env, organizationId, key) {
  const { webhookSecret } = await helloAssoCredentials(env, organizationId);
  return Boolean(webhookSecret && typeof key === 'string' && key && timingSafeEqual(key, webhookSecret));
}
