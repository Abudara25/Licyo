import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { z } from 'zod';
import { QuoteSaasPdf } from '@/lib/pdf/quote-saas-pdf';
import { getAuthContext } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getMembershipTiers } from '@/lib/platform-data';
import { tierForMembers } from '@/lib/platform';
export const runtime = 'nodejs';
export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  let clubName: string,
    city: string,
    contactName: string | null = null,
    email: string | null = null,
    effectif: number,
    prospectId: string | null = null;
  let number =
    'DEV-' +
    new Date().getUTCFullYear() +
    '-' +
    crypto.randomUUID().slice(0, 8).toUpperCase();
  if (params.prospect) {
    const auth = await getAuthContext();
    if (!auth?.isSuperAdmin)
      return new Response('Accès refusé', { status: 403 });
    if (!z.string().uuid().safeParse(params.prospect).success)
      return new Response('Prospect invalide', { status: 400 });
    const { data: p } = await createAdminClient()
      .from('saas_prospects')
      .select('*')
      .eq('id', params.prospect)
      .maybeSingle();
    if (!p) return new Response('Prospect introuvable', { status: 404 });
    clubName = p.club_name;
    city = p.city;
    contactName = p.contact_name;
    email = p.email;
    effectif = p.member_count;
    prospectId = p.id;
    number = p.quote_number ?? number;
  } else {
    const p = z
      .object({
        club: z.string().trim().min(2).max(120),
        ville: z.string().trim().min(1).max(80),
        contact: z.string().trim().max(80).optional(),
        email: z.string().email().optional().or(z.literal('')),
        effectif: z.coerce.number().int().min(0).max(1000000),
      })
      .safeParse(params);
    if (!p.success)
      return new Response('Indiquez le club, la ville et son effectif.', {
        status: 400,
      });
    clubName = p.data.club;
    city = p.data.ville;
    contactName = p.data.contact ?? null;
    email = p.data.email ?? null;
    effectif = p.data.effectif;
  }
  const tier = tierForMembers(await getMembershipTiers(), effectif);
  if (!tier || tier.monthly_cents === null)
    return new Response(
      'Le tarif de cet effectif doit être défini dans Offres et effectifs avant de générer le devis.',
      { status: 409 },
    );
  const buffer = await renderToBuffer(
    createElement(QuoteSaasPdf, {
      data: {
        quoteNumber: number,
        date: new Date(),
        clubName,
        contactName,
        city,
        email,
        planName: tier.name + ' · ' + effectif + ' adhérents',
        monthlyPrice: tier.monthly_cents / 100,
        features: [
          'Un site parmi les modèles Club, Arena et Studio',
          'Back-office de gestion du club',
          'Espace adhérent et famille',
          'Modules activables selon vos besoins',
        ],
        setupFee: 0,
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );
  if (prospectId) {
    const { error } = await createAdminClient()
      .from('saas_prospects')
      .update({ quote_number: number })
      .eq('id', prospectId);
    if (error)
      return new Response('Impossible d’enregistrer la référence du devis.', {
        status: 500,
      });
  }
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="devis-' + number + '.pdf"',
      'Cache-Control': 'no-store',
    },
  });
}
