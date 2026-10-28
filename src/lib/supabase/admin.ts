import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { requireEnv } from '@/lib/env';

/**
 * Client service role : contourne la RLS. Réservé aux webhooks, aux formulaires
 * publics déjà validés côté serveur et aux actions super_admin vérifiées.
 * Ne jamais l'utiliser avec un identifiant venu du navigateur sans contrôle d'accès.
 */
export function createAdminClient() {
  return createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
