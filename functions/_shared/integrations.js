// Identifiants des services externes, PAR ORGANISATION (consolidation de la phase SaaS, 2026-09-23).
//
// Il n'existe pas encore de stockage d'intégrations par organisation (centre d'intégrations, secrets
// chiffrés) : les seuls identifiants sont les secrets Cloudflare historiques (HELLOASSO_WEBHOOK_SECRET,
// HELLOASSO_CLIENT_ID, HELLOASSO_CLIENT_SECRET), créés pour Sportville. Ils ne valent donc QUE pour
// Sportville ; toute autre organisation n'a aucune intégration HelloAsso (notifications refusées,
// pas de relecture API) tant que ce stockage n'existe pas. Avant l'arrivée d'une deuxième organisation :
// stocker ses secrets chiffrés (clé maîtresse en secret Cloudflare) et les lire ici, jamais en clair
// dans le KV ni renvoyés au navigateur.
import { DEMO_ORG_ID } from './schema.js';
import { timingSafeEqual } from './security.js';

export function helloAssoCredentials(env, organizationId) {
  if (organizationId !== DEMO_ORG_ID) return { webhookSecret: null, clientId: null, clientSecret: null };
  return {
    webhookSecret: env.HELLOASSO_WEBHOOK_SECRET || null,
    clientId: env.HELLOASSO_CLIENT_ID || null,
    clientSecret: env.HELLOASSO_CLIENT_SECRET || null,
  };
}

// Clé de l'URL de notification comparée, en temps constant, au secret de l'organisation du domaine.
export function isValidHelloAssoKey(env, organizationId, key) {
  const { webhookSecret } = helloAssoCredentials(env, organizationId);
  return Boolean(webhookSecret && typeof key === 'string' && key && timingSafeEqual(key, webhookSecret));
}
