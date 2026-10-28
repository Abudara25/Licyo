import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { createClient, getClubContext, isManager } from '@/lib/supabase/server';
import { AgMunicipalityReportPdf } from '@/lib/pdf/ag-municipality-report-pdf';
import { buildAgReport } from '@/lib/reports';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const ctx = await getClubContext();
  if (!ctx || !isManager(ctx.role)) return new Response('Accès refusé', { status: 403 });
  const season = new URL(req.url).searchParams.get('saison') ?? ctx.club.current_season;
  if (!/^\d{4}-\d{4}$/.test(season)) return new Response('Saison invalide', { status: 400 });
  const data = await buildAgReport(await createClient(), ctx.club, season);
  const buffer = await renderToBuffer(createElement(AgMunicipalityReportPdf, { data }) as Parameters<typeof renderToBuffer>[0]);
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="bilan-${ctx.club.slug}-${season}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
