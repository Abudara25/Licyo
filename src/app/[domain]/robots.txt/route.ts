import { loadClubOr404 } from '@/lib/tenant';
import { clubSiteUrl } from '@/lib/env';

/** Les démos ne sont pas indexées ; les liens magiques jamais. */
export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { club } = await loadClubOr404((await params).domain);
  const body =
    club.status === 'demo'
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nDisallow: /correction/\nDisallow: /renouvellement/\nDisallow: /convocation/\n\nSitemap: ${clubSiteUrl(club)}/sitemap.xml\n`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
