import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient, getClubContext, isManager } from '@/lib/supabase/server';
import { CeAttestationPdf } from '@/lib/pdf/ce-attestation-pdf';

export const runtime = 'nodejs';

/** Attestation CE d'un dossier : réservée au bureau du club (RLS + rôle). */
export async function GET(_req: Request, { params }: { params: Promise<{ familyId: string }> }) {
  const ctx = await getClubContext();
  if (!ctx || !isManager(ctx.role)) return new Response('Accès refusé', { status: 403 });
  const { familyId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(familyId)) return new Response('Introuvable', { status: 404 });
  const supabase = await createClient();
  const { data: family } = await supabase.from('family_registrations').select('*').eq('id', familyId).eq('club_id', ctx.club.id).maybeSingle();
  if (!family) return new Response('Introuvable', { status: 404 });
  if (family.amount_paid <= 0) return new Response('Aucun paiement enregistré sur ce dossier.', { status: 409 });
  const [{ data: members }, { data: categories }] = await Promise.all([
    supabase.from('members').select('*').eq('family_id', family.id).neq('dossier_status', 'rejected'),
    supabase.from('categories').select('id, name, annual_price').eq('club_id', ctx.club.id),
  ]);
  const catById = new Map((categories ?? []).map((c) => [c.id, c]));
  const buffer = await renderToBuffer(
    createElement(CeAttestationPdf, {
      data: {
        club: ctx.club,
        family,
        members: (members ?? []).map((m) => {
          const c = m.category_id ? catById.get(m.category_id) : undefined;
          return { fullName: `${m.first_name} ${m.last_name}`, birthDate: m.birth_date, categoryName: c?.name ?? '-', licensePrice: Number(c?.annual_price ?? 0) };
        }),
        issuedAt: new Date(),
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="attestation-${family.invoice_number ?? family.id.slice(0, 8)}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
