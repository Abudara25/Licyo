// Import financier générique : tout fichier CSV d'opérations (HelloAsso, banque, SumUp, Stripe, tableur maison).
//
// 1. Le navigateur lit le fichier (papaparse) et envoie les cellules brutes + la correspondance des colonnes.
// 2. Le serveur normalise ici chaque ligne (montant et date au format français ou ISO), écarte les lignes illisibles
//    ou non payées, et calcule une clé anti-doublon : la référence de l'opération si la source en fournit une, sinon
//    date + montant + payeur + libellé + rang de l'occurrence dans le fichier. Réimporter le même fichier n'ajoute rien.
// 3. Le trésorier rattache chaque opération à une famille ; des SUGGESTIONS l'aident (e-mail identique, nom présent dans
//    le libellé, montant égal au reste à payer). Rien n'est crédité sans confirmation humaine (sauf le bouton
//    « rapprocher les correspondances sûres », qui n'utilise que l'e-mail identique et un montant couvert).
// Module pur : testé dans tests/financial-import.test.ts.

export type FinancialSource = 'helloasso' | 'bank' | 'sumup' | 'stripe' | 'other';
export type PaymentType = 'card' | 'check' | 'cash' | 'transfer' | 'pass_sport' | 'caf' | 'other_aid';
export type ColumnRole = 'date' | 'amount' | 'firstName' | 'lastName' | 'payerName' | 'email' | 'reference' | 'label' | 'status';

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  date: 'Date',
  amount: 'Montant',
  firstName: 'Prénom du payeur',
  lastName: 'Nom du payeur',
  payerName: 'Payeur (nom complet)',
  email: 'E-mail du payeur',
  reference: 'Référence de l’opération',
  label: 'Libellé',
  status: 'Statut',
};

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  card: 'Carte / paiement en ligne',
  transfer: 'Virement',
  check: 'Chèque',
  cash: 'Espèces',
  pass_sport: 'Pass’Sport',
  caf: 'Aide CAF',
  other_aid: 'Autre aide',
};

type SourcePreset = { label: string; defaultPaymentType: PaymentType; hint: string; aliases: Partial<Record<ColumnRole, string[]>> };

const COMMON: Partial<Record<ColumnRole, string[]>> = {
  date: ['date', 'date de paiement', 'date operation', 'date de l operation', 'date valeur', 'created', 'date de la commande'],
  amount: ['montant', 'montant ttc', 'montant total', 'amount', 'credit', 'total'],
  firstName: ['prenom', 'prenom payeur', 'first name', 'prenom du payeur'],
  lastName: ['nom', 'nom payeur', 'last name', 'nom du payeur'],
  payerName: ['payeur', 'client', 'customer', 'nom complet', 'titulaire'],
  email: ['email', 'e mail', 'email payeur', 'courriel', 'customer email', 'email du payeur'],
  reference: ['reference', 'ref', 'numero', 'id', 'transaction id', 'numero de commande', 'reference commande'],
  label: ['libelle', 'description', 'motif', 'objet', 'formule', 'nom de la campagne'],
  status: ['statut', 'status', 'etat', 'statut du paiement'],
};

export const SOURCES: Record<FinancialSource, SourcePreset> = {
  helloasso: {
    label: 'HelloAsso',
    defaultPaymentType: 'card',
    hint: 'Export « Paiements » ou « Commandes » de votre campagne d’adhésion (fichier CSV).',
    aliases: { reference: ['reference commande', 'numero de commande', 'reference du paiement', 'id du paiement'], payerName: ['payeur'], label: ['formule', 'nom de la campagne', 'tarif'] },
  },
  bank: {
    label: 'Relevé bancaire',
    defaultPaymentType: 'transfer',
    hint: 'Export CSV du compte du club. Seuls les crédits (montants positifs) concernent les adhésions.',
    aliases: { label: ['libelle', 'libelle operation', 'detail'], amount: ['credit', 'montant'] },
  },
  sumup: {
    label: 'SumUp / terminal de paiement',
    defaultPaymentType: 'card',
    hint: 'Export des transactions du terminal.',
    aliases: { reference: ['code transaction', 'transaction id', 'id de transaction'], label: ['description', 'produit'] },
  },
  stripe: {
    label: 'Stripe',
    defaultPaymentType: 'card',
    hint: 'Export des paiements Stripe (hors inscriptions déjà payées en ligne sur Licyo).',
    aliases: { reference: ['id', 'payment intent id'], email: ['customer email'], payerName: ['customer name', 'card name'] },
  },
  other: {
    label: 'Autre (tableur, logiciel de compta…)',
    defaultPaymentType: 'transfer',
    hint: 'Tout fichier CSV : indiquez au moins la date et le montant.',
    aliases: {},
  },
};

/** Statuts considérés comme « payé » (les autres lignes sont écartées : refusé, annulé, en attente…). */
const PAID_STATUSES = ['valide', 'paye', 'payee', 'autorise', 'effectue', 'succeeded', 'paid', 'ok', 'succes', 'reussi', 'encaisse', 'accepte'];

export function normalizeHeader(h: string): string {
  return h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export type ColumnMapping = Partial<Record<ColumnRole, number>>;

/** Correspondance proposée : pour chaque rôle, la première colonne dont l'en-tête correspond (source puis commun). */
export function guessMapping(headers: string[], source: FinancialSource): ColumnMapping {
  const norm = headers.map(normalizeHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const role of Object.keys(COLUMN_ROLE_LABELS) as ColumnRole[]) {
    const candidates = [...(SOURCES[source].aliases[role] ?? []), ...(COMMON[role] ?? [])];
    for (const c of candidates) {
      const index = norm.findIndex((h, i) => !used.has(i) && h === c);
      if (index >= 0) {
        mapping[role] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

/** « 1 234,56 € », « -12.5 », « 1.234,56 », « 150 » → centimes ; null si illisible. */
export function parseAmountCents(raw: string): number | null {
  let s = String(raw ?? '').replace(/[\s  €$]|EUR/gi, '').trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) s = s.replace(/,/g, '');
  else if (lastComma < 0 && (s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return negative ? -cents : cents;
}

/** « 15/11/2026 », « 15-11-26 », « 2026-11-15 », « 15/11/2026 10:32 » → « 2026-11-15 » ; null si illisible. */
export function parseDate(raw: string): string | null {
  const s = String(raw ?? '').trim();
  let y: number, m: number, d: number;
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (y < 100) y += 2000;
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d || y < 2000 || y > 2100) return null;
  return date.toISOString().slice(0, 10);
}

export type NormalizedTransaction = {
  line: number;
  dedupKey: string;
  externalRef: string | null;
  occurredOn: string;
  amountCents: number;
  payerName: string | null;
  payerEmail: string | null;
  label: string | null;
};

export type RejectedLine = { line: number; reason: string };

const clean = (v: unknown, max: number) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Lignes du fichier (sans l'en-tête) → opérations normalisées et lignes écartées avec leur motif.
 * `line` est le numéro de ligne dans le fichier (en-tête = 1).
 */
export function normalizeRows(
  rows: string[][],
  mapping: ColumnMapping,
  source: FinancialSource,
): { transactions: NormalizedTransaction[]; rejected: RejectedLine[] } {
  if (mapping.date === undefined || mapping.amount === undefined) {
    return { transactions: [], rejected: [{ line: 1, reason: 'Indiquez au moins les colonnes Date et Montant.' }] };
  }
  const cell = (row: string[], role: ColumnRole) => (mapping[role] === undefined ? '' : (row[mapping[role]!] ?? ''));
  const transactions: NormalizedTransaction[] = [];
  const rejected: RejectedLine[] = [];
  const occurrences = new Map<string, number>();
  rows.forEach((row, i) => {
    const line = i + 2;
    if (row.every((c) => !String(c ?? '').trim())) return; // ligne vide
    if (mapping.status !== undefined) {
      const status = normalizeHeader(cell(row, 'status'));
      if (status && !PAID_STATUSES.some((p) => status === p || status.startsWith(`${p} `))) {
        rejected.push({ line, reason: `Statut « ${cell(row, 'status')} » : opération non payée, ignorée.` });
        return;
      }
    }
    const occurredOn = parseDate(cell(row, 'date'));
    if (!occurredOn) {
      rejected.push({ line, reason: `Date illisible : « ${cell(row, 'date')} ».` });
      return;
    }
    const amountCents = parseAmountCents(cell(row, 'amount'));
    if (amountCents === null) {
      rejected.push({ line, reason: `Montant illisible : « ${cell(row, 'amount')} ».` });
      return;
    }
    if (amountCents === 0) {
      rejected.push({ line, reason: 'Montant nul.' });
      return;
    }
    if (amountCents < 0 && source === 'bank') {
      rejected.push({ line, reason: 'Débit du compte : ne concerne pas les adhésions.' });
      return;
    }
    const first = clean(cell(row, 'firstName'), 80);
    const last = clean(cell(row, 'lastName'), 80);
    const payerName = clean(cell(row, 'payerName'), 160) ?? (clean([first, last].filter(Boolean).join(' '), 160));
    const rawEmail = clean(cell(row, 'email'), 254)?.toLowerCase() ?? null;
    const payerEmail = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail) ? rawEmail : null;
    const externalRef = clean(cell(row, 'reference'), 120);
    const label = clean(cell(row, 'label'), 300);
    const base = externalRef
      ? `${source}:ref:${externalRef}`
      : `${source}:${occurredOn}:${amountCents}:${normalizeHeader(payerName ?? '')}:${normalizeHeader(label ?? '').slice(0, 80)}`;
    const n = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, n);
    // Deux lignes identiques sans référence (deux enfants à 150 € le même jour) restent deux opérations distinctes.
    const dedupKey = (externalRef ? base : `${base}#${n}`).slice(0, 300);
    transactions.push({ line, dedupKey, externalRef, occurredOn, amountCents, payerName, payerEmail, label });
  });
  return { transactions, rejected };
}

/** dueCents : reste à payer hors chèques déjà remis ; outstandingCents : reste à encaisser (chèques compris). */
export type FamilyCandidate = { id: string; payerFirstName: string; payerLastName: string; payerEmail: string; dueCents: number; outstandingCents?: number; memberNames: string[] };
export type MatchSuggestion = { familyId: string; score: 3 | 2 | 1; reason: string };

/**
 * Famille la plus probable pour une opération :
 * 3 = même e-mail ; 2 = nom du payeur (ou d'un adhérent) dans le payeur ou le libellé ET montant ≤ reste à payer ;
 * 1 = nom seulement. Ambiguïté (plusieurs familles au meilleur score) = aucune suggestion.
 */
export function suggestMatch(
  tx: Pick<NormalizedTransaction, 'payerEmail' | 'payerName' | 'label' | 'amountCents'>,
  families: readonly FamilyCandidate[],
): MatchSuggestion | null {
  const text = ` ${normalizeHeader(`${tx.payerName ?? ''} ${tx.label ?? ''}`)} `;
  const scored = families.map((f) => {
    if (tx.payerEmail && f.payerEmail.toLowerCase() === tx.payerEmail) return { f, score: 3 as const, reason: 'Même e-mail' };
    const names = [f.payerLastName, ...f.memberNames.map((n) => n.split(' ').slice(-1)[0])].map(normalizeHeader).filter((n) => n.length >= 3);
    const named = names.some((n) => text.includes(` ${n} `));
    if (named && tx.amountCents > 0 && tx.amountCents <= f.dueCents) return { f, score: 2 as const, reason: 'Nom et montant cohérents' };
    if (named) return { f, score: 1 as const, reason: 'Nom présent' };
    return null;
  }).filter((x): x is NonNullable<typeof x> => x !== null);
  if (!scored.length) return null;
  const best = Math.max(...scored.map((s) => s.score));
  const top = scored.filter((s) => s.score === best);
  if (top.length !== 1) return null;
  return { familyId: top[0].f.id, score: top[0].score, reason: top[0].reason };
}
