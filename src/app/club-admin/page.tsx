import Link from 'next/link';
import { requireClubContext, createClient, isManager } from '@/lib/supabase/server';
import { getSportPreset } from '@/config/sports-presets';
import { formatEuros } from '@/lib/pricing';
import { todayIso } from '@/lib/season';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { Card, CardBody, CardHeader, Stat } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

export default async function ClubDashboard({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const { erreur } = await searchParams;
  const { club, role } = await requireClubContext();
  const supabase = await createClient();
  const v = getSportPreset(club.sport_type).vocabulary;
  const season = club.current_season;
  const month = todayIso().slice(0, 7);

  const [members, pending, trials, families, nextInstallments, views, nextEvents] = await Promise.all([
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('season', season).eq('dossier_status', 'validated'),
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('season', season).in('dossier_status', ['pending_review', 'needs_correction']),
    supabase.from('members').select('id', { count: 'exact', head: true }).eq('club_id', club.id).eq('dossier_status', 'trial_requested'),
    isManager(role) ? supabase.from('family_registrations').select('final_total_amount, amount_paid').eq('club_id', club.id).eq('season', season) : Promise.resolve({ data: [] }),
    isManager(role) ? supabase.from('payment_installments').select('amount').eq('club_id', club.id).eq('status', 'pending').lte('scheduled_deposit_date', todayIso()) : Promise.resolve({ data: [] }),
    supabase.from('anonymous_page_views').select('views_count').eq('club_id', club.id).eq('view_month', month),
    supabase.from('events').select('*').eq('club_id', club.id).gte('event_date', new Date().toISOString()).order('event_date').limit(4),
  ]);

  const expected = (families.data ?? []).reduce((s, f) => s + Number(f.final_total_amount), 0);
  const paid = (families.data ?? []).reduce((s, f) => s + Number(f.amount_paid), 0);
  const toDeposit = (nextInstallments.data ?? []).reduce((s, i) => s + Number(i.amount), 0);
  const monthViews = (views.data ?? []).reduce((s, r) => s + r.views_count, 0);

  return (
    <>
      <PageHeader title="Tableau de bord" description={`Saison ${season}`} />
      {erreur === 'droits' ? <p role="alert" className="mb-4 rounded-lg bg-amber-50 p-3 text-amber-900">Cette page est réservée au bureau du club.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`${v.athletes.charAt(0).toUpperCase() + v.athletes.slice(1)} validés`} value={members.count ?? 0} />
        <Stat label="Dossiers à traiter" value={pending.count ?? 0} hint={trials.count ? `+ ${trials.count} essai(s) demandé(s)` : undefined} />
        {isManager(role) ? <Stat label="Encaissé / attendu" value={formatEuros(paid)} hint={`sur ${formatEuros(expected)}`} /> : null}
        <Stat label="Visites du site ce mois" value={monthViews} hint="Sans cookie" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="À faire" />
          <CardBody className="grid gap-2">
            {(pending.count ?? 0) > 0 ? (
              <Link href="/club-admin/inscriptions" className={buttonVariants({ variant: 'outline', className: 'h-auto justify-between whitespace-normal py-2 text-left' })}>
                Vérifier {pending.count} dossier(s) <span aria-hidden>→</span>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun dossier en attente.</p>
            )}
            {isManager(role) && toDeposit > 0 ? (
              <Link href="/club-admin/tresorerie" className={buttonVariants({ variant: 'outline', className: 'h-auto justify-between whitespace-normal py-2 text-left' })}>
                Chèques à déposer : {formatEuros(toDeposit)} <span aria-hidden>→</span>
              </Link>
            ) : null}
            <a href="/api/pdf/poster" target="_blank" className={buttonVariants({ variant: 'outline', className: 'h-auto justify-between whitespace-normal py-2 text-left' })}>
              Imprimer l'affiche du forum des associations <span aria-hidden>→</span>
            </a>
            {isManager(role) ? (
              <a href="/api/pdf/ag-report" target="_blank" className={buttonVariants({ variant: 'outline', className: 'h-auto justify-between whitespace-normal py-2 text-left' })}>
                Bilan AG et mairie (PDF) <span aria-hidden>→</span>
              </a>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Prochains rendez-vous" action={<Link href="/club-admin/sportif" className="inline-flex min-h-11 items-center text-sm font-semibold underline">Gérer</Link>} />
          <CardBody>
            {(nextEvents.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Aucun événement programmé.</p> : null}
            <ul className="divide-y">
              {(nextEvents.data ?? []).map((e) => (
                <li key={e.id} className="py-2">
                  <p className="font-medium">{e.title}</p>
                  <p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(e.event_date))}</p>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
