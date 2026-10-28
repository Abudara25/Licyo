import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';
import { createClient, getClubContext } from '@/lib/supabase/server';
import { ForumPosterPdf } from '@/lib/pdf/forum-poster-pdf';
import { DAY_LABELS, getSportPreset } from '@/config/sports-presets';
import { clubSiteUrl } from '@/lib/env';

export const runtime = 'nodejs';

/** Affiche du forum des associations, avec QR code vers l'inscription. */
export async function GET() {
  const ctx = await getClubContext();
  if (!ctx) return new Response('Accès refusé', { status: 403 });
  const supabase = await createClient();
  const [{ data: categories }, { data: schedules }] = await Promise.all([
    supabase.from('categories').select('*').eq('club_id', ctx.club.id).order('display_order'),
    supabase.from('schedules').select('*').eq('club_id', ctx.club.id).order('day_of_week').order('start_time'),
  ]);
  const preset = getSportPreset(ctx.club.sport_type);
  const site = clubSiteUrl(ctx.club);
  const target = ctx.club.enabled_modules.inscriptions ? `${site}/inscription` : site;
  const qrDataUrl = await QRCode.toDataURL(target, { width: 600, margin: 1, errorCorrectionLevel: 'M' });
  const startYear = Number(ctx.club.current_season.slice(0, 4));
  const catName = new Map((categories ?? []).map((c) => [c.id, c.name]));

  const buffer = await renderToBuffer(
    createElement(ForumPosterPdf, {
      data: {
        clubName: ctx.club.name,
        primaryColor: ctx.club.primary_color,
        secondaryColor: ctx.club.secondary_color,
        logoUrl: ctx.club.logo_url,
        sportLabel: preset.label,
        tagline: preset.vocabulary.tagline,
        siteUrl: target,
        qrDataUrl,
        groupsLabel: preset.vocabulary.groups,
        categories: (categories ?? []).map((c) => ({ name: c.name, ages: `${startYear - c.max_birth_year}-${startYear - c.min_birth_year} ans`, price: Number(c.annual_price) })),
        scheduleLines: (schedules ?? []).map((s) => `${DAY_LABELS[s.day_of_week]} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)} : ${catName.get(s.category_id) ?? ''}`),
      },
    }) as Parameters<typeof renderToBuffer>[0],
  );
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="affiche-${ctx.club.slug}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
