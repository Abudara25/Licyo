import 'server-only';
import { createPublicClient } from '@/lib/supabase/public';
import { INITIAL_TIERS } from '@/lib/platform';
export async function getMembershipTiers() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    return INITIAL_TIERS;
  const { data, error } = await createPublicClient()
    .from('membership_tiers')
    .select('*')
    .eq('is_active', true)
    .order('min_members');
  if (error)
    throw new Error('La grille tarifaire est temporairement indisponible.');
  return data ?? [];
}
