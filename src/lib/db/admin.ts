import 'server-only';
import { makeClient, type DbClient } from './client.ts';
import { getDatabase } from './d1.ts';

/**
 * Client « service » : ignore les règles d'accès. Réservé aux webhooks, aux
 * formulaires publics déjà validés côté serveur et aux actions dont les droits
 * ont été vérifiés juste avant. Ne jamais l'utiliser avec un identifiant venu du
 * navigateur sans contrôle d'accès.
 */
export function createAdminClient(): DbClient {
  return makeClient(getDatabase(), { role: 'service' });
}
