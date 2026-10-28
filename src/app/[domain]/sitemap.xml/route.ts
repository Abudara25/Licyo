import { loadClubOr404 } from '@/lib/tenant';
import { clubSiteUrl } from '@/lib/env';

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

/** Plan du site d'un club (les démos ne sont pas indexées). */
export async function GET(_req: Request, { params }: { params: Promise<{ domain: string }> }) {
  const { club, posts } = await loadClubOr404((await params).domain);
  const base = clubSiteUrl(club);
  const pages = ['', '/equipes-et-cours', '/planning', '/resultats-agenda'];
  if (club.enabled_modules.inscriptions) pages.push('/inscription');
  if (club.enabled_modules.trials) pages.push('/essai');
  if (club.enabled_modules.sponsors) pages.push('/partenaires');
  const urls =
    club.status === 'demo'
      ? []
      : [
          ...pages.map((p) => `<url><loc>${escapeXml(base + p)}</loc><changefreq>weekly</changefreq></url>`),
          ...posts.map((p) => `<url><loc>${escapeXml(`${base}/actualites/${p.slug}`)}</loc><lastmod>${p.published_at.slice(0, 10)}</lastmod></url>`),
        ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
