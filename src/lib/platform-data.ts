import 'server-only';
import { createPublicClient } from '@/lib/db/public';
export async function getMembershipTiers() {
  const { data, error } = await createPublicClient()
    .from('membership_tiers')
    .select('*')
    .eq('is_active', true)
    .order('min_members');
  if (error)
    throw new Error('La grille tarifaire est temporairement indisponible.');
  return data ?? [];
}
