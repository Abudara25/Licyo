import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { z } from 'zod';
import { QuoteSaasPdf } from '@/lib/pdf/quote-saas-pdf';
import { PLANS } from '@/lib/stripe/client';
import { getAuthContext } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

const SETUP_FEE = 0;

function quoteNumber() {
  const d = new Date();
  return `DEV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/**
 * Devis PDF.
 * - Public (page /tarifs) : ?plan=…&club=…&ville=…&email=…
 * - Super-admin (CRM) : ?prospect=<id> ; le numéro est enregistré sur le prospect.
 */
export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  let data: { clubName: string; city: string; contactName?: string | null; email?: string | null; plan: keyof typeof PLANS };
  let number = quoteNumber();

  if (params.prospect) {
    const auth = await getAuthContext();
    if (!auth?.isSuperAdmin) return new Response('Accès refusé', { status: 403 });
    const admin = createAdminClient();
    const { data: p } = await admin.from('saas_prospects').select('*').eq('id', z.string().uuid().parse(params.prospect)).maybeSingle();
    if (!p) return new Response('Prospect introuvable', { status: 404 });
    number = p.quote_number ?? number;
    await admin.from('saas_prospects').update({ quote_number: number, stage: p.stage === 'won' ? 'won' : 'quote_sent' }).eq('id', p.id);
    data = { clubName: p.club_name, city: p.city, contactName: p.contact_name, email: p.email, plan: params.plan === 'vitrine' ? 'vitrine' : 'integral' };
  } else {
    const parsed = z
      .object({
        plan: z.enum(['vitrine', 'integral']),
        club: z.string().trim().min(2).max(120),
        ville: z.string().trim().min(1).max(80),
        contact: z.string().trim().max(80).optional(),
        email: z.string().trim().email().max(120).optional().or(z.literal('')),
      })
      .safeParse(params);
    if (!parsed.success) return new Response('Paramètres du devis incomplets.', { status: 400 });
    data = { clubName: parsed.data.club, city: parsed.data.ville, contactName: parsed.data.contact, email: parsed.data.email || null, plan: parsed.data.plan };
  }

  const plan = PLANS[data.plan];
  const buffer = await renderToBuffer(
    createElement(QuoteSaasPdf, {
      data: {
        quoteNumber: number,
        date: new Date(),
        clubName: data.clubName,
        contactName: data.contactName,
        city: data.city,
        email: data.email,
        planName: plan.name,
        monthlyPrice: plan.monthly,
        features: plan.features,
        setupFee: SETUP_FEE,
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="devis-${number}.pdf"`, 'Cache-Control': 'no-store' },
  });
}
