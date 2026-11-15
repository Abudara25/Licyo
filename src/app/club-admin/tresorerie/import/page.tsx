import Link from 'next/link';
import { requireModule } from '@/lib/module-access';
import { can, createClient, requireClubContext } from '@/lib/db/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { FinancialImportUploader, TransactionsList, type TransactionRow } from '@/components/club-admin/FinancialImport';
import { familyCandidates } from '@/lib/finance-candidates';
import { SOURCES, suggestMatch } from '@/lib/financial-import';
import { formatEuros } from '@/lib/pricing';

type Props = { searchParams: Promise<{ vue?: string }> };

const VIEWS = { 'a-rapprocher': 'unmatched', rattachees: 'matched', 'mises-de-cote': 'ignored' } as const;

/** Import financier : fichiers d'opérations (HelloAsso, banque, terminal…) et rapprochement avec les familles. */
export default async function FinancialImportPage({ searchParams }: Props) {
  await requireModule('payments');
  const ctx = await requireClubContext('finance.read');
  const { club } = ctx;
  const { vue = 'a-rapprocher' } = await searchParams;
  const view = VIEWS[vue as keyof typeof VIEWS] ?? 'unmatched';
  const db = await createClient();
  const [{ data: txs }, { data: counts }, families] = await Promise.all([
    db.from('financial_transactions').select('*').eq('club_id', club.id).eq('status', view).order('occurred_on', { ascending: false }).limit(300),
    db.from('financial_transactions').select('status').eq('club_id', club.id).limit(20000),
    familyCandidates(db, club.id, club.current_season),
  ]);
  const familyName = new Map(families.map((f) => [f.id, `${f.payerLastName.toUpperCase()} ${f.payerFirstName}`]));
  // Familles d'une autre saison déjà rattachées : nom relu pour l'affichage.
  const otherIds = [...new Set((txs ?? []).map((t) => t.family_id).filter((id): id is string => Boolean(id) && !familyName.has(id!)))];
  if (otherIds.length) {
    const { data: others } = await db.from('family_registrations').select('id, payer_first_name, payer_last_name, season').in('id', otherIds);
    for (const o of others ?? []) familyName.set(o.id, `${o.payer_last_name.toUpperCase()} ${o.payer_first_name} (${o.season})`);
  }
  const rows: TransactionRow[] = (txs ?? []).map((t) => ({
    id: t.id,
    occurredOn: t.occurred_on,
    amountCents: t.amount_cents,
    payer: t.payer_name ?? t.payer_email ?? 'Payeur non indiqué',
    label: t.label,
    sourceLabel: SOURCES[t.source].label,
    status: t.status,
    familyName: t.family_id ? (familyName.get(t.family_id) ?? null) : null,
    suggestion: t.status === 'unmatched' ? suggestMatch({ payerEmail: t.payer_email, payerName: t.payer_name, label: t.label, amountCents: t.amount_cents }, families) : null,
  }));
  const count = (s: string) => (counts ?? []).filter((c) => c.status === s).length;
  const familyOptions = families
    .map((f) => {
      const outstanding = f.outstandingCents ?? f.dueCents;
      const status = !outstanding ? 'réglé' : f.dueCents < outstanding ? `reste ${formatEuros(outstanding / 100)} · chèques prévus` : `reste ${formatEuros(outstanding / 100)}`;
      return { id: f.id, label: `${f.payerLastName.toUpperCase()} ${f.payerFirstName} - ${status}` };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const canWrite = can(ctx, 'finance.write');

  return (
    <>
      <PageHeader
        title="Import des paiements"
        description="Importez les opérations reçues hors de Licyo, puis rattachez-les aux familles."
        actions={
          <Link href="/club-admin/tresorerie" className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium">
            Trésorerie
          </Link>
        }
      />
      <div className="grid gap-6">
        {canWrite ? <FinancialImportUploader /> : null}
        <nav aria-label="Opérations" className="flex flex-wrap gap-2">
          {(Object.entries(VIEWS) as [string, string][]).map(([slug, status]) => (
            <Link
              key={slug}
              href={`?vue=${slug}`}
              aria-current={status === view ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium ${status === view ? 'bg-primary text-primary-foreground' : 'bg-white'}`}
            >
              {status === 'unmatched' ? 'À rapprocher' : status === 'matched' ? 'Rattachées' : 'Mises de côté'} ({count(status)})
            </Link>
          ))}
        </nav>
        <TransactionsList key={view} rows={rows} families={familyOptions} canWrite={canWrite} view={view} />
      </div>
    </>
  );
}
