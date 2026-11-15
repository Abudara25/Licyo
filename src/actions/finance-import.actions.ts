'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, getClubContext, type ClubContext } from '@/lib/db/server';
import { getDatabase } from '@/lib/db/d1';
import { syncFamilyPaid } from '@/lib/finance-sync';
import { grantsCan } from '@/lib/permissions';
import { normalizeRows, suggestMatch } from '@/lib/financial-import';
import { familyCandidates } from '@/lib/finance-candidates';
import type { ActionResult } from '@/lib/validation';
import { insertTransactions } from '@/lib/financial-store';

const SOURCE = z.enum(['helloasso', 'bank', 'sumup', 'stripe', 'other']);
const PAYMENT_TYPE = z.enum(['card', 'check', 'cash', 'transfer', 'pass_sport', 'caf', 'other_aid']);
const MAX_ROWS = 5000;
const PATH = '/club-admin/tresorerie/import';

async function financeCtx(): Promise<ClubContext> {
  const ctx = await getClubContext();
  if (!ctx) throw new Error('Session expirée : reconnectez-vous.');
  if (!grantsCan(ctx.grants, 'finance.write')) throw new Error('Action réservée aux personnes qui gèrent les paiements.');
  return ctx;
}

async function run<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (error) {
    if (error && typeof error === 'object' && 'digest' in error) throw error;
    return { ok: false, error: error instanceof Error ? error.message : 'Une erreur est survenue.' };
  }
}

export type ImportReport = { inserted: number; duplicates: number; rejected: { line: number; reason: string }[]; rejectedCount: number };

/**
 * Importe un fichier d'opérations. Le navigateur envoie les cellules brutes et la correspondance des colonnes ;
 * tout est relu ici (normalizeRows). Les doublons (même clé) sont ignorés : réimporter un fichier n'ajoute rien.
 */
export async function importFinancialFile(input: unknown): Promise<ActionResult<ImportReport>> {
  return run(async () => {
    const ctx = await financeCtx();
    const v = z
      .object({
        source: SOURCE,
        paymentType: PAYMENT_TYPE,
        fileName: z.string().max(200).optional(),
        rows: z.array(z.array(z.string().max(500)).max(60)).max(MAX_ROWS, `Fichier trop long (${MAX_ROWS} lignes au plus).`),
        mapping: z.record(z.enum(['date', 'amount', 'firstName', 'lastName', 'payerName', 'email', 'reference', 'label', 'status']), z.number().int().min(0).max(59)),
      })
      .parse(input);
    const { transactions, rejected } = normalizeRows(v.rows, v.mapping, v.source);
    if (!transactions.length) return { ok: false, error: rejected[0]?.reason ?? 'Aucune opération lisible dans ce fichier.' };

    const { inserted, duplicates } = await insertTransactions(
      getDatabase(),
      { clubId: ctx.club.id, source: v.source, paymentType: v.paymentType, fileName: v.fileName ?? null, rowCount: v.rows.length, importedBy: ctx.auth.userId },
      transactions,
    );
    revalidatePath(PATH);
    return {
      ok: true,
      data: { inserted, duplicates, rejected: rejected.slice(0, 20), rejectedCount: rejected.length },
      message: `${inserted} opération${inserted > 1 ? 's' : ''} importée${inserted > 1 ? 's' : ''}${duplicates ? `, ${duplicates} déjà connue${duplicates > 1 ? 's' : ''}` : ''}.`,
    };
  });
}

/** Rattache une opération à une famille : crée l'encaissement correspondant et met à jour le règlement. */
export async function matchTransaction(transactionId: string, familyId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await financeCtx();
    const supabase = await createClient();
    const txId = z.string().uuid().parse(transactionId);
    const famId = z.string().uuid().parse(familyId);
    const [{ data: tx }, { data: family }] = await Promise.all([
      supabase.from('financial_transactions').select('*').eq('id', txId).eq('club_id', ctx.club.id).maybeSingle(),
      supabase.from('family_registrations').select('id').eq('id', famId).eq('club_id', ctx.club.id).maybeSingle(),
    ]);
    if (!tx || !family) return { ok: false, error: 'Opération ou famille introuvable.' };
    if (tx.status !== 'unmatched') return { ok: false, error: 'Cette opération est déjà traitée.' };
    if (tx.amount_cents < 0) return { ok: false, error: 'Remboursement : à enregistrer dans la trésorerie de la famille.' };
    const installmentId = crypto.randomUUID();
    const { error } = await supabase.from('payment_installments').insert({
      id: installmentId,
      club_id: ctx.club.id,
      family_id: famId,
      amount: tx.amount_cents / 100,
      payment_type: tx.payment_type,
      check_number: tx.external_ref?.slice(0, 30) ?? null,
      scheduled_deposit_date: tx.occurred_on,
      status: 'cashed',
      source: tx.source,
    });
    if (error) return { ok: false, error: 'Encaissement impossible à créer.' };
    const { data: updated } = await supabase
      .from('financial_transactions')
      .update({ status: 'matched', family_id: famId, installment_id: installmentId })
      .eq('id', txId)
      .eq('status', 'unmatched')
      .select('id');
    if (!updated?.length) {
      // Traitée entre-temps par quelqu'un d'autre : on retire l'encaissement créé pour ne rien compter deux fois.
      await supabase.from('payment_installments').delete().eq('id', installmentId);
      return { ok: false, error: 'Cette opération vient d’être traitée par quelqu’un d’autre.' };
    }
    await syncFamilyPaid(supabase, famId);
    revalidatePath(PATH);
    revalidatePath('/club-admin/tresorerie');
    return { ok: true, message: 'Opération rattachée : encaissement enregistré.' };
  });
}

/** Annule un rattachement : l'encaissement créé est retiré, l'opération redevient à rapprocher. */
export async function unmatchTransaction(transactionId: string): Promise<ActionResult> {
  return run(async () => {
    const ctx = await financeCtx();
    const supabase = await createClient();
    const { data: tx } = await supabase.from('financial_transactions').select('*').eq('id', z.string().uuid().parse(transactionId)).eq('club_id', ctx.club.id).maybeSingle();
    if (!tx || tx.status !== 'matched' || !tx.family_id) return { ok: false, error: 'Opération non rattachée.' };
    await supabase.from('financial_transactions').update({ status: 'unmatched', family_id: null, installment_id: null }).eq('id', tx.id);
    if (tx.installment_id) await supabase.from('payment_installments').delete().eq('id', tx.installment_id).eq('club_id', ctx.club.id);
    await syncFamilyPaid(supabase, tx.family_id);
    revalidatePath(PATH);
    revalidatePath('/club-admin/tresorerie');
    return { ok: true, message: 'Rattachement annulé.' };
  });
}

/** Opération sans rapport avec les adhésions (partenaire, buvette…) : mise de côté, ou remise à rapprocher. */
export async function setTransactionIgnored(transactionId: string, ignored: boolean): Promise<ActionResult> {
  return run(async () => {
    const ctx = await financeCtx();
    const supabase = await createClient();
    const { data } = await supabase
      .from('financial_transactions')
      .update({ status: ignored ? 'ignored' : 'unmatched' })
      .eq('id', z.string().uuid().parse(transactionId))
      .eq('club_id', ctx.club.id)
      .eq('status', ignored ? 'unmatched' : 'ignored')
      .select('id');
    if (!data?.length) return { ok: false, error: 'Opération introuvable ou déjà traitée.' };
    revalidatePath(PATH);
    return { ok: true };
  });
}

/**
 * Rapproche d'un coup les correspondances SÛRES : même e-mail, une seule famille, montant couvert par le reste à payer.
 * Tout le reste attend une décision humaine.
 */
export async function autoMatchSafe(): Promise<ActionResult<{ matched: number }>> {
  return run(async () => {
    const ctx = await financeCtx();
    const supabase = await createClient();
    const families = await familyCandidates(supabase, ctx.club.id, ctx.club.current_season);
    const { data: txs } = await supabase.from('financial_transactions').select('*').eq('club_id', ctx.club.id).eq('status', 'unmatched').limit(1000);
    let matched = 0;
    const consumed = new Map<string, number>();
    for (const tx of txs ?? []) {
      if (tx.amount_cents <= 0 || !tx.payer_email) continue;
      const remaining = families.map((f) => ({ ...f, dueCents: f.dueCents - (consumed.get(f.id) ?? 0) }));
      const s = suggestMatch({ payerEmail: tx.payer_email, payerName: tx.payer_name, label: tx.label, amountCents: tx.amount_cents }, remaining);
      const family = s?.score === 3 ? remaining.find((f) => f.id === s.familyId) : undefined;
      if (!family || tx.amount_cents > family.dueCents) continue;
      const res = await matchTransaction(tx.id, family.id);
      if (res.ok) {
        matched++;
        consumed.set(family.id, (consumed.get(family.id) ?? 0) + tx.amount_cents);
      }
    }
    revalidatePath(PATH);
    return { ok: true, data: { matched }, message: matched ? `${matched} opération${matched > 1 ? 's' : ''} rapprochée${matched > 1 ? 's' : ''} automatiquement.` : 'Aucune correspondance sûre : rattachez les opérations une par une.' };
  });
}
