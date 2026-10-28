import type { Metadata } from 'next';
import { getSportPreset } from '@/config/sports-presets';
import { appUrl, clubSiteUrl } from '@/lib/env';
import type { Club } from '@/types/database';

/**
 * Balises meta locales : « {Sport} à {Ville} » est la requête que tapent les
 * parents. L'image de partage est générée par /api/og/social-card.
 */
export function clubMetadata(club: Club, page?: { title?: string; description?: string; path?: string }): Metadata {
  const preset = getSportPreset(club.sport_type);
  const base = clubSiteUrl(club);
  const cities = [club.city, ...club.nearby_cities.slice(0, 3)].join(', ');
  const defaultDescription = `${club.name} : club de ${preset.vocabulary.sportName} à ${club.city} (${club.postal_code}). Horaires, tarifs, ${preset.vocabulary.groups} et inscription en ligne. Pour ${cities}.`;
  const title = page?.title ? `${page.title} | ${club.name}` : `${club.name} - ${preset.label} à ${club.city}`;
  const description = page?.description ?? defaultDescription;
  const ogImage = `${appUrl()}/api/og/social-card?club=${encodeURIComponent(club.slug)}&title=${encodeURIComponent(page?.title ?? club.name)}`;
  const noIndex = club.status === 'demo';

  return {
    metadataBase: new URL(base),
    title,
    description,
    alternates: { canonical: `${base}${page?.path ?? '/'}` },
    openGraph: { type: 'website', locale: 'fr_FR', siteName: club.name, title, description, images: [{ url: ogImage, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
    icons: club.logo_url ? { icon: club.logo_url } : undefined,
    // Les démos ne doivent pas concurrencer le futur vrai site du club.
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    other: { 'geo.region': 'FR', 'geo.placename': club.city },
  };
}
