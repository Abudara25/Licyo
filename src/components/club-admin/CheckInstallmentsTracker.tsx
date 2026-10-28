'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FileDown, Plus, Search, Trash2 } from 'lucide-react';
import { addInstallment, deleteInstallment, updateInstallment, updateOrderStatus } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import { formatEuros } from '@/lib/pricing';

export type FamilyRow = { id: string; payer: string; email: string; invoice: string | null; total: number; paid: number; status: string; memberNames: string };
export type InstallmentRow = { id: string; familyId: string; payer: string; amount: number; type: string; checkNumber: string | null; date: string; status: string };
export type OrderRow = { id: string; member: string; product: string; size: string; status: string };

const TYPE_LABELS: Record<string, string> = { check: 'Chèque', cash: 'Espèces', transfer: 'Virement', card: 'Carte', pass_sport: "Pass'Sport", caf: 'CAF', other_aid: 'Autre aide' };
const STATUS_LABELS: Record<string, string> = { pending: 'À encaisser', deposited: 'Déposé', cashed: 'Encaissé', rejected: 'Rejeté' };
const monthLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

export function CheckInstallmentsTracker({ families, installments, orders, today }: { families: FamilyRow[]; installments: InstallmentRow[]; orders: OrderRow[]; today: string }) {
  const [tab, setTab] = useState<'checks' | 'families' | 'orders'>('checks');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<FamilyRow | null>(null);
  const [form, setForm] = useState({ amount: '', paymentType: 'check', checkNumber: '', scheduledDepositDate: today, status: 'cashed' });
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) toast.success(res.message ?? 'Enregistré.');
      else toast.error(res.error);
    });

  // Chèques en attente regroupés par mois de dépôt (octobre, novembre, décembre…).
  const byMonth = useMemo(() => {
    const groups = new Map<string, InstallmentRow[]>();
    for (const i of installments.filter((x) => x.status === 'pending')) {
      const key = i.date.slice(0, 7);
      groups.set(key, [...(groups.get(key) ?? []), i]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [installments]);

  const q = query.trim().toLowerCase();
  const filteredFamilies = families.filter((f) => !q || `${f.payer} ${f.memberNames} ${f.invoice ?? ''}`.toLowerCase().includes(q));

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {([['checks', 'Chèques et échéances'], ['families', 'Dossiers'], ['orders', 'Équipements']] as const).map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>{label}</Button>
        ))}
      </div>

      {tab === 'checks' ? (
        byMonth.length === 0 ? (
          <EmptyState title="Aucune échéance en attente" description="Les chèques différés saisis à l'inscription apparaissent ici, par mois de dépôt." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {byMonth.map(([month, rows]) => {
              const late = rows[0].date < today;
              return (
                <Card key={month}>
                  <CardHeader
                    title={<span className="capitalize">{monthLabel(`${month}-01`)}</span>}
                    description={`${rows.length} échéance(s) - ${formatEuros(rows.reduce((s, r) => s + r.amount, 0))}`}
                    action={late ? <Badge tone="warning">À déposer</Badge> : undefined}
                  />
                  <ul className="divide-y">
                    {rows.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{r.payer}</p>
                          <p className="text-xs text-muted-foreground">{TYPE_LABELS[r.type] ?? r.type} - dépôt le {new Date(`${r.date}T00:00:00`).toLocaleDateString('fr-FR')}</p>
                          <label className="mt-1 flex items-center gap-2 text-xs">
                            N°
                            <input
                              aria-label={`Numéro de chèque de ${r.payer}`}
                              defaultValue={r.checkNumber ?? ''}
                              className="min-h-9 w-28 rounded border px-2 text-base"
                              onBlur={(e) => e.target.value !== (r.checkNumber ?? '') && run(() => updateInstallment(r.id, { checkNumber: e.target.value }))}
                            />
                          </label>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold tabular-nums">{formatEuros(r.amount)}</span>
                          <Button size="sm" variant="success" disabled={pending} onClick={() => run(() => updateInstallment(r.id, { status: 'deposited' }))}>Déposé</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              );
            })}
          </div>
        )
      ) : null}

      {tab === 'families' ? (
        <Card>
          <CardHeader
            title="Dossiers de la saison"
            action={
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input aria-label="Rechercher" placeholder="Rechercher" className="pl-9" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            }
          />
          <ul className="divide-y">
            {filteredFamilies.map((f) => {
              const rest = Math.max(0, f.total - f.paid);
              return (
                <li key={f.id} className="grid gap-2 p-3 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="font-medium">{f.payer} <span className="text-xs text-muted-foreground">{f.invoice}</span></p>
                    <p className="truncate text-sm text-muted-foreground">{f.memberNames}</p>
                    <p className="text-sm tabular-nums">
                      {formatEuros(f.paid)} / {formatEuros(f.total)} {rest > 0 ? <Badge tone="warning" className="ml-1">Reste {formatEuros(rest)}</Badge> : <Badge tone="success" className="ml-1">Soldé</Badge>}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {installments.filter((i) => i.familyId === f.id).map((i) => (
                        <li key={i.id} className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                          {TYPE_LABELS[i.type] ?? i.type} {formatEuros(i.amount)}
                          <select aria-label="Statut" value={i.status} onChange={(e) => run(() => updateInstallment(i.id, { status: e.target.value }))} className="min-h-7 rounded bg-transparent text-base md:text-xs">
                            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                          <button type="button" aria-label="Supprimer" className="flex size-7 items-center justify-center" onClick={() => confirm('Supprimer ce règlement ?') && run(() => deleteInstallment(i.id))}>
                            <Trash2 className="size-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setAdding(f); setForm({ ...form, amount: rest ? rest.toFixed(2) : '' }); }}>
                      <Plus aria-hidden /> Règlement
                    </Button>
                    {f.paid > 0 ? (
                      <a href={`/api/pdf/attestation/${f.id}`} target="_blank" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold hover:bg-accent">
                        <FileDown className="size-4" aria-hidden /> Attestation
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {filteredFamilies.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">Aucun dossier.</p></CardBody> : null}
        </Card>
      ) : null}

      {tab === 'orders' ? (
        orders.length === 0 ? (
          <EmptyState title="Aucune commande" description="Les équipements choisis lors de l'inscription apparaissent ici." />
        ) : (
          <Card>
            <ul className="divide-y">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <p><span className="font-medium">{o.member}</span> - {o.product} ({o.size})</p>
                  <Select aria-label={`Statut de ${o.product} pour ${o.member}`} className="w-40" value={o.status} onChange={(e) => run(() => updateOrderStatus(o.id, e.target.value as 'ordered'))}>
                    <option value="to_order">À commander</option>
                    <option value="ordered">Commandé</option>
                    <option value="received">Reçu</option>
                    <option value="delivered">Remis</option>
                  </Select>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : null}

      <Dialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)} title="Ajouter un règlement" description={adding?.payer}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!adding) return;
            run(async () => {
              const res = await addInstallment({ familyId: adding.id, ...form });
              if (res.ok) setAdding(null);
              return res;
            });
          }}
        >
          <Field id="ia" label="Montant (€)"><Input id="ia" type="number" step="0.01" min="0.01" inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field id="it" label="Mode">
            <Select id="it" value={form.paymentType} onChange={(e) => setForm({ ...form, paymentType: e.target.value })}>
              {Object.entries(TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          {form.paymentType === 'check' ? <Field id="in" label="Numéro de chèque"><Input id="in" value={form.checkNumber} onChange={(e) => setForm({ ...form, checkNumber: e.target.value })} /></Field> : null}
          <Field id="id" label="Date (dépôt prévu ou encaissement)"><Input id="id" type="date" required value={form.scheduledDepositDate} onChange={(e) => setForm({ ...form, scheduledDepositDate: e.target.value })} /></Field>
          <Field id="is" label="Statut">
            <Select id="is" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Button type="submit" size="lg" disabled={pending}>Enregistrer</Button>
        </form>
      </Dialog>
    </>
  );
}
