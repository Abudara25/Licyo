import { ImageResponse } from 'next/og';
import { getPublicClubData } from '@/lib/tenant';
import { getSportPreset } from '@/config/sports-presets';
import { readableTextColor, safeHex } from '@/lib/utils/color-contrast';

export const runtime = 'nodejs';

/** Image de partage 1200×630 aux couleurs du club (réseaux sociaux, messageries). */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const slug = (params.get('club') ?? '').slice(0, 60);
  const title = (params.get('title') ?? '').slice(0, 90);
  const data = /^[a-z0-9-]+$/.test(slug) ? await getPublicClubData(slug) : null;
  const primary = safeHex(data?.club.primary_color, '#18181B');
  const secondary = safeHex(data?.club.secondary_color, '#FBBF24');
  const fg = readableTextColor(primary);
  const preset = getSportPreset(data?.club.sport_type);

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: primary, color: fg }}>
        <div style={{ display: 'flex', fontSize: 30, opacity: 0.9 }}>{data ? `${preset.label} à ${data.club.city}` : 'Licyo'}</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05 }}>{title || data?.club.name || 'Le site de votre club'}</div>
          {data && title && title !== data.club.name ? <div style={{ fontSize: 36, marginTop: 16 }}>{data.club.name}</div> : null}
        </div>
        <div style={{ display: 'flex', height: 18, width: 240, background: secondary, borderRadius: 9 }} />
      </div>
    ),
    { width: 1200, height: 630, headers: { 'Cache-Control': 'public, max-age=86400' } },
  );
}
