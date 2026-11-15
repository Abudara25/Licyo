// Écriture des opérations financières importées (fichier CSV ou API HelloAsso), partagée par les deux voies.
// Doublons ignorés grâce à la clé unique (club_id, dedup_key) : réimporter n'ajoute rien.
// Module sans dépendance à Next.js : testé sur SQLite.

import type { SqlDatabase } from './db/query.ts';
import type { FinancialSource, NormalizedTransaction, PaymentType } from './financial-import.ts';

export async function insertTransactions(
  db: SqlDatabase,
  opts: { clubId: string; source: FinancialSource; paymentType: PaymentType; fileName: string | null; rowCount: number; importedBy: string | null },
  transactions: NormalizedTransaction[],
): Promise<{ importId: string; inserted: number; duplicates: number }> {
  const importId = crypto.randomUUID();
  await db
    .prepare('INSERT INTO financial_imports (id, club_id, source, file_name, row_count, imported_by) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(importId, opts.clubId, opts.source, opts.fileName?.slice(0, 200) ?? null, opts.rowCount, opts.importedBy)
    .run();
  let inserted = 0;
  for (let i = 0; i < transactions.length; i += 100) {
    const chunk = transactions.slice(i, i + 100).map((t) =>
      db
        .prepare(
          `INSERT INTO financial_transactions (id, club_id, import_id, source, dedup_key, external_ref, occurred_on, amount_cents, payer_name, payer_email, label, payment_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (club_id, dedup_key) DO NOTHING RETURNING id`,
        )
        .bind(crypto.randomUUID(), opts.clubId, importId, opts.source, t.dedupKey, t.externalRef, t.occurredOn, t.amountCents, t.payerName, t.payerEmail, t.label, opts.paymentType),
    );
    const results = await db.batch(chunk);
    inserted += results.reduce((n, r) => n + (r.results?.length ?? 0), 0);
  }
  const duplicates = transactions.length - inserted;
  await db.prepare('UPDATE financial_imports SET inserted_count = ?, duplicate_count = ? WHERE id = ?').bind(inserted, duplicates, importId).run();
  return { importId, inserted, duplicates };
}
