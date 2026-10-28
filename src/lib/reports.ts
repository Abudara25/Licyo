import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { AgReportData } from '@/lib/pdf/ag-municipality-report-pdf';
import type { Club } from '@/types/database';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const METHOD_LABELS: Record<string, string> = {
  card: 'Carte bancaire',
  check: 'Chèque',
  cash: 'Espèces',
  transfer: 'Virement',
  pass_sport: "Pass'Sport",
  caf: 'Aide CAF',
  other_aid: 'Autre aide',
};

const normalizeCity = (c: string) =>
  c
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');

/**
 * Bilan de saison : effectifs validés, résidents de la commune (subventions)
 * et livre des recettes à partir des règlements encaissés.
 * Requêtes via le client de l'utilisateur : la RLS limite aux données du club.
 */
export async function buildAgReport(supabase: Supabase, club: Club, season: string): Promise<AgReportData> {
  const [{ data: members }, { data: families }, { data: categories }, { data: installments }] = await Promise.all([
    supabase.from('members').select('id, is_minor, gender, category_id, family_id').eq('club_id', club.id).eq('season', season).eq('dossier_status', 'validated'),
    supabase.from('family_registrations').select('id, city, postal_code, payer_first_name, payer_last_name, invoice_number').eq('club_id', club.id).eq('season', season),
    supabase.from('categories').select('id, name, display_order').eq('club_id', club.id).order('display_order'),
    supabase.from('payment_installments').select('*').eq('club_id', club.id).in('status', ['deposited', 'cashed']).order('scheduled_deposit_date'),
  ]);
  const ms = members ?? [];
  const familyById = new Map((families ?? []).map((f) => [f.id, f]));
  const clubCity = normalizeCity(club.city);
  const residents = ms.filter((m) => {
    const f = m.family_id ? familyById.get(m.family_id) : undefined;
    return f && (normalizeCity(f.city) === clubCity || f.postal_code === club.postal_code);
  }).length;

  const byCity = new Map<string, number>();
  for (const m of ms) {
    const f = m.family_id ? familyById.get(m.family_id) : undefined;
    const city = f?.city?.trim() || 'Non renseignée';
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
  }

  // Livre des recettes : uniquement les règlements des dossiers de la saison.
  const seasonInstallments = (installments ?? []).filter((i) => familyById.has(i.family_id));
  const byMethod = new Map<string, { amount: number; count: number }>();
  for (const i of seasonInstallments) {
    const label = METHOD_LABELS[i.payment_type] ?? i.payment_type;
    const cur = byMethod.get(label) ?? { amount: 0, count: 0 };
    byMethod.set(label, { amount: cur.amount + Number(i.amount), count: cur.count + 1 });
  }
  const total = seasonInstallments.reduce((s, i) => s + Number(i.amount), 0);

  return {
    club,
    season,
    generatedAt: new Date(),
    totals: {
      members: ms.length,
      minors: ms.filter((m) => m.is_minor).length,
      adults: ms.filter((m) => !m.is_minor).length,
      female: ms.filter((m) => m.gender === 'F').length,
      male: ms.filter((m) => m.gender === 'M').length,
      other: ms.filter((m) => m.gender === 'X').length,
    },
    residents: { count: residents, percent: ms.length ? Math.round((residents / ms.length) * 1000) / 10 : 0 },
    byCategory: (categories ?? []).map((c) => ({ name: c.name, count: ms.filter((m) => m.category_id === c.id).length })),
    byCity: [...byCity.entries()].map(([city, count]) => ({ city, count })).sort((a, b) => b.count - a.count),
    receiptsByMethod: [...byMethod.entries()].map(([label, v]) => ({ label, amount: Math.round(v.amount * 100) / 100, count: v.count })),
    receipts: seasonInstallments.map((i) => {
      const f = familyById.get(i.family_id)!;
      return {
        date: i.scheduled_deposit_date,
        reference: f.invoice_number ?? '-',
        payer: `${f.payer_last_name} ${f.payer_first_name}`,
        method: `${METHOD_LABELS[i.payment_type] ?? i.payment_type}${i.check_number ? ` n° ${i.check_number}` : ''}`,
        amount: Number(i.amount),
      };
    }),
    totalReceipts: Math.round(total * 100) / 100,
  };
}
