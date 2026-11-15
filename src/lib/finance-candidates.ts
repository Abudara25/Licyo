import 'server-only';
import type { ServerDbClient } from '@/lib/db/server';
import type { FamilyCandidate } from '@/lib/financial-import';

/** Candidats au rapprochement : familles de la saison avec leur reste à payer et le nom des adhérents. */
export async function familyCandidates(supabase: ServerDbClient, clubId: string, season: string): Promise<FamilyCandidate[]> {
  const [{ data: families }, { data: members }, { data: installments }] = await Promise.all([
    supabase.from('family_registrations').select('id, payer_first_name, payer_last_name, payer_email, final_total_amount, amount_paid').eq('club_id', clubId).eq('season', season),
    supabase.from('members').select('family_id, first_name, last_name').eq('club_id', clubId).eq('season', season),
    supabase.from('payment_installments').select('family_id, amount, status').eq('club_id', clubId).eq('status', 'pending'),
  ]);
  return (families ?? []).map((f) => {
    const pending = (installments ?? []).filter((i) => i.family_id === f.id).reduce((s, i) => s + Number(i.amount), 0);
    return {
      id: f.id,
      payerFirstName: f.payer_first_name,
      payerLastName: f.payer_last_name,
      payerEmail: f.payer_email,
      dueCents: Math.max(0, Math.round((Number(f.final_total_amount) - Number(f.amount_paid) - pending) * 100)),
      outstandingCents: Math.max(0, Math.round((Number(f.final_total_amount) - Number(f.amount_paid)) * 100)),
      memberNames: (members ?? []).filter((m) => m.family_id === f.id).map((m) => `${m.first_name} ${m.last_name}`),
    };
  });
}

