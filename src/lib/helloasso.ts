// Connexion directe à l'API HelloAsso v5 (https://dev.helloasso.com) : les paiements reçus par le club arrivent
// dans l'import financier (financial_transactions, source « helloasso ») sans passer par un fichier CSV.
//
// - Authentification : identifiant et secret API du club (client_credentials), jeton demandé à chaque passage.
// - Lecture : GET /v5/organizations/{slug}/payments, paiements « Authorized », par pages de 100, du plus ancien au
//   plus récent, avec un recouvrement de 3 jours sur le passage précédent (les doublons sont ignorés).
// - Doublons : clé « helloasso:payment:<id> » ; un paiement déjà importé par fichier (référence = n° de paiement
//   ou de commande) n'est pas réimporté.
// - Le rapprochement avec les familles reste celui de l'import (suggestions, correspondances sûres).
// Module sans dépendance à Next.js : `fetch` est injecté, testé avec un faux serveur (tests/helloasso.test.ts).

import type { SqlDatabase } from './db/query.ts';
import type { NormalizedTransaction } from './financial-import.ts';
import { insertTransactions } from './financial-store.ts';

export const HELLOASSO_API = 'https://api.helloasso.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const FIRST_SYNC_DAYS = 400;
const OVERLAP_DAYS = 3;
const DAY = 86400000;

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export type HelloAssoCredentials = { organizationSlug: string; clientId: string; clientSecret: string };

export class HelloAssoError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

/** Slug de l'organisation : tel qu'il apparaît dans l'adresse HelloAsso (…/associations/<slug>). */
export function organizationSlugFrom(input: string): string | null {
  const s = input.trim();
  const fromUrl = /helloasso(?:-sandbox)?\.com\/associations\/([a-z0-9-]+)/i.exec(s)?.[1];
  const slug = (fromUrl ?? s).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/.test(slug) ? slug : null;
}

export async function helloAssoToken(fetchFn: Fetch, creds: HelloAssoCredentials, base = HELLOASSO_API): Promise<string> {
  const res = await fetchFn(`${base}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: 'client_credentials' }).toString(),
  });
  if (!res.ok) {
    throw new HelloAssoError(
      res.status === 400 || res.status === 401 ? 'Identifiants API HelloAsso refusés : vérifiez l’identifiant et le secret.' : `HelloAsso indisponible (erreur ${res.status}).`,
      res.status,
    );
  }
  const body = (await res.json()) as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) throw new HelloAssoError('Réponse HelloAsso inattendue (jeton absent).');
  return body.access_token;
}

type ApiPayment = {
  id?: unknown;
  amount?: unknown;
  date?: unknown;
  state?: unknown;
  paymentMeans?: unknown;
  payer?: { email?: unknown; firstName?: unknown; lastName?: unknown } | null;
  order?: { id?: unknown; formSlug?: unknown; formType?: unknown } | null;
  items?: { name?: unknown }[] | null;
};

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const parisDate = (iso: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date(iso));
const FORM_TYPES: Record<string, string> = { Membership: 'Adhésion', Event: 'Événement', Donation: 'Don', Shop: 'Boutique', PaymentForm: 'Paiement', CrowdFunding: 'Collecte', Checkout: 'Paiement' };

/** Paiement de l'API → opération normalisée ; null si non encaissé ou illisible. */
export function mapPayment(p: ApiPayment): NormalizedTransaction | null {
  if (p.state !== 'Authorized') return null;
  const id = typeof p.id === 'number' || typeof p.id === 'string' ? String(p.id) : null;
  const amount = typeof p.amount === 'number' && Number.isInteger(p.amount) ? p.amount : null;
  const date = typeof p.date === 'string' && !Number.isNaN(Date.parse(p.date)) ? p.date : null;
  if (!id || !amount || amount <= 0 || !date) return null;
  const first = str(p.payer?.firstName, 80);
  const last = str(p.payer?.lastName, 80);
  const email = str(p.payer?.email, 254)?.toLowerCase() ?? null;
  const items = (p.items ?? []).map((i) => str(i?.name, 80)).filter(Boolean);
  const kind = typeof p.order?.formType === 'string' ? (FORM_TYPES[p.order.formType] ?? p.order.formType) : null;
  const label = [kind, str(p.order?.formSlug, 80), items.join(', ') || null].filter(Boolean).join(' - ').slice(0, 300) || null;
  return {
    line: 0,
    dedupKey: `helloasso:payment:${id}`,
    externalRef: id,
    occurredOn: parisDate(date),
    amountCents: amount,
    payerName: [first, last].filter(Boolean).join(' ') || null,
    payerEmail: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    label,
  };
}

/** Paiements « Authorized » depuis une date, toutes pages (bornées), du plus ancien au plus récent. */
export async function fetchPayments(fetchFn: Fetch, token: string, slug: string, from: Date, base = HELLOASSO_API): Promise<{ payments: ApiPayment[]; truncated: boolean }> {
  const payments: ApiPayment[] = [];
  let continuationToken: string | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ from: from.toISOString(), pageSize: String(PAGE_SIZE), states: 'Authorized', sortOrder: 'Asc', sortField: 'Date' });
    if (continuationToken) q.set('continuationToken', continuationToken);
    else q.set('pageIndex', String(page));
    const res = await fetchFn(`${base}/v5/organizations/${encodeURIComponent(slug)}/payments?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!res.ok) {
      throw new HelloAssoError(
        res.status === 403 ? 'Accès refusé par HelloAsso : la clé API doit avoir le droit de lire les paiements de cette association.' : res.status === 404 ? 'Association introuvable sur HelloAsso : vérifiez l’adresse (slug).' : `HelloAsso indisponible (erreur ${res.status}).`,
        res.status,
      );
    }
    const body = (await res.json()) as { data?: ApiPayment[]; pagination?: { totalPages?: number; continuationToken?: string | null } };
    const data = Array.isArray(body.data) ? body.data : [];
    payments.push(...data);
    const totalPages = body.pagination?.totalPages ?? 0;
    continuationToken = body.pagination?.continuationToken ?? null;
    if (!data.length || data.length < PAGE_SIZE || (!continuationToken && page >= totalPages)) return { payments, truncated: false };
  }
  return { payments, truncated: true };
}

/** syncedUntil : date à enregistrer comme dernier passage (date du dernier paiement lu si la lecture a été tronquée). */
export type SyncResult = { recus: number; nouveaux: number; dejaConnus: number; ignores: number; tronque: boolean; syncedUntil: string };

/**
 * Synchronise un club : lit les paiements depuis le dernier passage (recouvrement de 3 jours) ou sur 400 jours la
 * première fois, puis les ajoute à l'import financier. Rejouable sans doublon.
 */
export async function syncHelloAsso(
  db: SqlDatabase,
  clubId: string,
  creds: HelloAssoCredentials,
  lastSyncAt: string | null,
  now: Date,
  fetchFn: Fetch,
  base = HELLOASSO_API,
): Promise<SyncResult> {
  const token = await helloAssoToken(fetchFn, creds, base);
  const from = lastSyncAt ? new Date(Date.parse(lastSyncAt) - OVERLAP_DAYS * DAY) : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);
  const { payments, truncated } = await fetchPayments(fetchFn, token, creds.organizationSlug, from, base);
  const mapped = payments.map(mapPayment);
  const valid = mapped.filter((t): t is NormalizedTransaction => t !== null);
  // Déjà importés par fichier CSV (référence = n° de paiement ou de commande) : écartés.
  const refs = [...new Set(payments.flatMap((p) => [p.id, p.order?.id]).filter((v) => v !== undefined && v !== null).map(String))];
  const known = new Set<string>();
  for (let i = 0; i < refs.length; i += 200) {
    const chunk = refs.slice(i, i + 200);
    const rows = await db
      .prepare(`SELECT external_ref FROM financial_transactions WHERE club_id = ? AND source = 'helloasso' AND dedup_key NOT LIKE 'helloasso:payment:%' AND external_ref IN (${chunk.map(() => '?').join(',')})`)
      .bind(clubId, ...chunk)
      .all<{ external_ref: string }>();
    for (const r of rows.results ?? []) known.add(r.external_ref);
  }
  const fresh = valid.filter((t) => {
    const p = payments.find((x) => String(x.id) === t.externalRef);
    return !known.has(t.externalRef!) && !(p?.order?.id !== undefined && known.has(String(p.order.id)));
  });
  const stored = fresh.length
    ? await insertTransactions(db, { clubId, source: 'helloasso', paymentType: 'card', fileName: 'API HelloAsso', rowCount: payments.length, importedBy: null }, fresh)
    : { inserted: 0, duplicates: 0 };
  return {
    recus: payments.length,
    nouveaux: stored.inserted,
    dejaConnus: stored.duplicates + (valid.length - fresh.length),
    ignores: mapped.length - valid.length,
    tronque: truncated,
    syncedUntil: truncated && typeof payments.at(-1)?.date === 'string' ? new Date(payments.at(-1)!.date as string).toISOString() : now.toISOString(),
  };
}
