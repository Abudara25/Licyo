import { requireClubContext, createClient, MANAGER_ROLES } from '@/lib/supabase/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { CheckInstallmentsTracker, type FamilyRow, type InstallmentRow, type OrderRow } from '@/components/club-admin/CheckInstallmentsTracker';
import { Stat } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { formatEuros } from '@/lib/pricing';
import { todayIso } from '@/lib/season';

export default async function TreasuryPage() {
  const { club } = await requireClubContext(MANAGER_ROLES);
  const supabase = await createClient();
  const [{ data: families }, { data: installments }, { data: members }, { data: orders }, { data: products }] = await Promise.all([
    supabase.from('family_registrations').select('*').eq('club_id', club.id).eq('season', club.current_season).order('payer_last_name'),
    supabase.from('payment_installments').select('*').eq('club_id', club.id).order('scheduled_deposit_date'),
    supabase.from('members').select('id, first_name, last_name, family_id, dossier_status').eq('club_id', club.id).eq('season', club.current_season),
    supabase.from('member_product_orders').select('*').eq('club_id', club.id).order('created_at', { ascending: false }),
    supabase.from('club_products').select('id, name').eq('club_id', club.id),
  ]);

  // Les dossiers d'essai (montant nul) n'ont rien à faire en trésorerie.
  const fams = (families ?? []).filter((f) => Number(f.final_total_amount) > 0 || Number(f.amount_paid) > 0);
  const famById = new Map(fams.map((f) => [f.id, f]));
  const memberById = new Map((members ?? []).map((m) => [m.id, m]));
  const productById = new Map((products ?? []).map((p) => [p.id, p.name]));

  const familyRows: FamilyRow[] = fams.map((f) => ({
    id: f.id,
    payer: `${f.payer_last_name} ${f.payer_first_name}`,
    email: f.payer_email,
    invoice: f.invoice_number,
    total: Number(f.final_total_amount),
    paid: Number(f.amount_paid),
    status: f.payment_status,
    memberNames: (members ?? []).filter((m) => m.family_id === f.id).map((m) => m.first_name).join(', '),
  }));
  const installmentRows: InstallmentRow[] = (installments ?? [])
    .filter((i) => famById.has(i.family_id))
    .map((i) => {
      const f = famById.get(i.family_id)!;
      return { id: i.id, familyId: i.family_id, payer: `${f.payer_last_name} ${f.payer_first_name}`, amount: Number(i.amount), type: i.payment_type, checkNumber: i.check_number, date: i.scheduled_deposit_date, status: i.status };
    });
  const orderRows: OrderRow[] = (orders ?? [])
    .filter((o) => memberById.has(o.member_id))
    .map((o) => {
      const m = memberById.get(o.member_id)!;
      return { id: o.id, member: `${m.first_name} ${m.last_name}`, product: productById.get(o.product_id) ?? 'Article', size: o.selected_size, status: o.delivery_status };
    });

  const expected = familyRows.reduce((s, f) => s + f.total, 0);
  const paid = familyRows.reduce((s, f) => s + f.paid, 0);
  const pendingChecks = installmentRows.filter((i) => i.status === 'pending').reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <PageHeader
        title="Trésorerie"
        description={`Règlements des cotisations - saison ${club.current_season}`}
        actions={
          <a href="/api/pdf/ag-report" target="_blank" className={buttonVariants({ variant: 'outline' })}>
            Bilan AG et mairie (PDF)
          </a>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Encaissé" value={formatEuros(paid)} />
        <Stat label="Reste à percevoir" value={formatEuros(Math.max(0, expected - paid))} />
        <Stat label="Chèques en attente" value={formatEuros(pendingChecks)} />
      </div>
      <CheckInstallmentsTracker families={familyRows} installments={installmentRows} orders={orderRows} today={todayIso()} />
    </>
  );
}
