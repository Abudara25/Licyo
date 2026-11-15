'use client';

import { useMemo, useState } from 'react';
import { Check, EyeOff, FileUp, RotateCcw, Sparkles, Undo2 } from 'lucide-react';
import { autoMatchSafe, importFinancialFile, matchTransaction, setTransactionIgnored, unmatchTransaction, type ImportReport } from '@/actions/finance-import.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import {
  COLUMN_ROLE_LABELS,
  PAYMENT_TYPE_LABELS,
  SOURCES,
  guessMapping,
  normalizeRows,
  type ColumnMapping,
  type ColumnRole,
  type FinancialSource,
  type PaymentType,
} from '@/lib/financial-import';
import { formatEuros } from '@/lib/pricing';
import { useAction } from './useAction';

const euros = (cents: number) => formatEuros(cents / 100);
const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'UTC' });

/** Lit un CSV en UTF-8, ou en Windows-1252 (exports bancaires) si l'UTF-8 est invalide. */
async function readCsv(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  const Papa = (await import('papaparse')).default;
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: 'greedy' });
  return parsed.data.map((r) => r.map((c) => String(c ?? '')));
}

/** Dépôt d'un fichier d'opérations : source, correspondance des colonnes, aperçu, import. */
export function FinancialImportUploader() {
  const [source, setSource] = useState<FinancialSource>('helloasso');
  const [paymentType, setPaymentType] = useState<PaymentType>(SOURCES.helloasso.defaultPaymentType);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const { pending, run } = useAction();

  const headers = table?.[0] ?? [];
  const body = useMemo(() => table?.slice(1) ?? [], [table]);
  const preview = useMemo(() => (table ? normalizeRows(body, mapping, source) : null), [body, mapping, source, table]);

  async function onFile(file?: File) {
    setReport(null);
    setReadError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setReadError('Fichier trop lourd (5 Mo au plus).');
    try {
      const rows = await readCsv(file);
      if (rows.length < 2) return setReadError('Le fichier ne contient pas d’opération.');
      setFileName(file.name);
      setTable(rows);
      setMapping(guessMapping(rows[0], source));
    } catch {
      setReadError('Fichier illisible : exportez-le au format CSV.');
    }
  }

  return (
    <Card>
      <CardHeader title="Importer un fichier d’opérations" description="HelloAsso, relevé bancaire, terminal de paiement, Stripe ou tout tableur exporté en CSV." />
      <CardBody className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="fi-source" label="Source" hint={SOURCES[source].hint}>
            <Select
              id="fi-source"
              value={source}
              onChange={(e) => {
                const s = e.target.value as FinancialSource;
                setSource(s);
                setPaymentType(SOURCES[s].defaultPaymentType);
                if (table) setMapping(guessMapping(table[0], s));
              }}
            >
              {(Object.keys(SOURCES) as FinancialSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCES[s].label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="fi-type" label="Mode de paiement enregistré">
            <Select id="fi-type" value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
              {(Object.keys(PAYMENT_TYPE_LABELS) as PaymentType[]).map((t) => (
                <option key={t} value={t}>
                  {PAYMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <label htmlFor="fi-file" className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-4 text-center text-sm hover:bg-muted">
          <FileUp className="size-5" aria-hidden />
          <span className="font-medium">{fileName || 'Choisir un fichier CSV'}</span>
          <span className="text-xs text-muted-foreground">{table ? `${body.length} ligne${body.length > 1 ? 's' : ''} lue${body.length > 1 ? 's' : ''}` : 'Le fichier est lu sur votre appareil, puis seules les colonnes utiles sont envoyées.'}</span>
          <input id="fi-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {readError ? (
          <p role="alert" className="text-sm text-destructive">
            {readError}
          </p>
        ) : null}

        {table ? (
          <>
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-1 text-sm font-medium">Colonnes du fichier (date et montant obligatoires)</legend>
              {(Object.keys(COLUMN_ROLE_LABELS) as ColumnRole[]).map((role) => (
                <Field key={role} id={`fi-col-${role}`} label={COLUMN_ROLE_LABELS[role]}>
                  <Select
                    id={`fi-col-${role}`}
                    value={mapping[role] ?? ''}
                    onChange={(e) => setMapping((m) => ({ ...m, [role]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  >
                    <option value="">Aucune</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Colonne ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </fieldset>

            {preview ? (
              <div className="grid gap-2 text-sm">
                <p>
                  <strong>{preview.transactions.length}</strong> opération{preview.transactions.length > 1 ? 's' : ''} lisible{preview.transactions.length > 1 ? 's' : ''}
                  {preview.rejected.length ? ` - ${preview.rejected.length} ligne${preview.rejected.length > 1 ? 's' : ''} écartée${preview.rejected.length > 1 ? 's' : ''}` : ''}
                </p>
                <ul className="divide-y rounded-lg border">
                  {preview.transactions.slice(0, 5).map((t) => (
                    <li key={t.line} className="flex flex-wrap justify-between gap-2 p-2">
                      <span className="min-w-0 break-words">
                        {day.format(new Date(t.occurredOn))} - {t.payerName ?? t.payerEmail ?? t.label ?? 'Sans nom'}
                      </span>
                      <span className="font-medium tabular-nums">{euros(t.amountCents)}</span>
                    </li>
                  ))}
                </ul>
                {preview.rejected.slice(0, 3).map((r) => (
                  <p key={r.line} className="text-muted-foreground">
                    Ligne {r.line} : {r.reason}
                  </p>
                ))}
              </div>
            ) : null}

            <Button
              className="w-full sm:w-auto"
              disabled={pending || !preview?.transactions.length}
              onClick={() =>
                run(
                  async () => {
                    const res = await importFinancialFile({ source, paymentType, fileName, rows: body, mapping });
                    if (res.ok && res.data) setReport(res.data);
                    return res;
                  },
                  () => setTable(null),
                )
              }
            >
              Importer {preview?.transactions.length ?? 0} opération{(preview?.transactions.length ?? 0) > 1 ? 's' : ''}
            </Button>
          </>
        ) : null}

        {report ? (
          <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
            {report.inserted} importée{report.inserted > 1 ? 's' : ''}, {report.duplicates} déjà connue{report.duplicates > 1 ? 's' : ''} (ignorée{report.duplicates > 1 ? 's' : ''}),{' '}
            {report.rejectedCount} ligne{report.rejectedCount > 1 ? 's' : ''} écartée{report.rejectedCount > 1 ? 's' : ''}. Rattachez maintenant les opérations ci-dessous.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

export type TransactionRow = {
  id: string;
  occurredOn: string;
  amountCents: number;
  payer: string;
  label: string | null;
  sourceLabel: string;
  status: 'unmatched' | 'matched' | 'ignored';
  familyName: string | null;
  suggestion: { familyId: string; reason: string; score: number } | null;
};

/** Opérations importées : rattachement à une famille, mise de côté, annulation. */
export function TransactionsList({
  rows,
  families,
  canWrite,
  view,
}: {
  rows: TransactionRow[];
  families: { id: string; label: string }[];
  canWrite: boolean;
  view: 'unmatched' | 'matched' | 'ignored';
}) {
  const { pending, run } = useAction();
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, r.suggestion?.familyId ?? ''])));

  return (
    <Card>
      <CardHeader
        title={view === 'unmatched' ? 'Opérations à rapprocher' : view === 'matched' ? 'Opérations rattachées' : 'Opérations mises de côté'}
        description={view === 'unmatched' ? 'Choisissez la famille concernée : l’encaissement est créé et le reste à payer mis à jour.' : undefined}
        action={
          canWrite && view === 'unmatched' && rows.some((r) => r.suggestion?.score === 3) ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => autoMatchSafe())}>
              <Sparkles aria-hidden /> Rapprocher les correspondances sûres
            </Button>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-sm text-muted-foreground">Aucune opération.</p>
        </CardBody>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="grid gap-2 p-3 text-sm md:grid-cols-[1fr_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">{euros(r.amountCents)}</span>
                  <span className="text-muted-foreground">{day.format(new Date(r.occurredOn))}</span>
                  <Badge tone="neutral">{r.sourceLabel}</Badge>
                  {r.suggestion ? <Badge tone={r.suggestion.score === 3 ? 'success' : 'info'}>Suggestion : {r.suggestion.reason}</Badge> : null}
                </div>
                <p className="break-words">{r.payer}</p>
                {r.label ? <p className="break-words text-muted-foreground">{r.label}</p> : null}
                {r.familyName ? <p className="text-muted-foreground">Rattachée à : {r.familyName}</p> : null}
              </div>
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  {view === 'unmatched' ? (
                    <>
                      <Select
                        aria-label={`Famille pour l’opération de ${euros(r.amountCents)}`}
                        className="w-full md:w-64"
                        value={choice[r.id] ?? ''}
                        onChange={(e) => setChoice((c) => ({ ...c, [r.id]: e.target.value }))}
                      >
                        <option value="">Choisir la famille…</option>
                        {families.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" disabled={pending || !choice[r.id]} onClick={() => run(() => matchTransaction(r.id, choice[r.id]))}>
                        <Check aria-hidden /> Rattacher
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setTransactionIgnored(r.id, true))}>
                        <EyeOff aria-hidden /> Mettre de côté
                      </Button>
                    </>
                  ) : view === 'matched' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => confirm('Annuler ce rattachement ? L’encaissement créé sera retiré.') && run(() => unmatchTransaction(r.id))}
                    >
                      <Undo2 aria-hidden /> Annuler le rattachement
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setTransactionIgnored(r.id, false))}>
                      <RotateCcw aria-hidden /> Remettre à rapprocher
                    </Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
