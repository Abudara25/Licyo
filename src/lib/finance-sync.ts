import 'server-only';
import type { ServerDbClient } from '@/lib/db/server';

/**
 * Recalcule le montant encaissé d'un dossier familial à partir de son échéancier (encaissements déposés ou encaissés),
 * puis son statut de règlement et son mode de paiement. Partagé par la trésorerie et l'import financier.
 */
export async function syncFamilyPaid(supabase: ServerDbClient, familyId: string): Promise<void> {
  const [{ data: family }, { data: rows }] = await Promise.all([
    supabase.from('family_registrations').select('final_total_amount, stripe_checkout_session_id').eq('id', familyId).single(),
    supabase.from('payment_installments').select('amount, status, payment_type').eq('family_id', familyId),
  ]);
  if (!family) return;
  const paid = (rows ?? []).filter((r) => r.status === 'deposited' || r.status === 'cashed').reduce((s, r) => s + Number(r.amount), 0);
  const amount = Math.round(paid * 100) / 100;
  const total = Number(family.final_total_amount);
  const types = new Set((rows ?? []).filter((r) => r.status !== 'rejected').map((r) => r.payment_type));
  await supabase
    .from('family_registrations')
    .update({
      amount_paid: amount,
      payment_status: amount >= total ? 'paid' : amount > 0 ? 'partial' : 'unpaid',
      payment_method:
        types.size > 1
          ? 'mixed'
          : types.size === 1
            ? [...types][0] === 'caf' || [...types][0] === 'other_aid'
              ? 'mixed'
              : ([...types][0] as 'check')
            : undefined,
    })
    .eq('id', familyId);
}
