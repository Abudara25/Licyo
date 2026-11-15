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
  // Mode gratuit (LICYO_LITE) : pas de générateur d'images dans le Worker ; l'aperçu de partage reprend la photo
  // d'accueil ou le logo du club. Build complet : image générée aux couleurs du club.
  const lite = process.env.NEXT_PUBLIC_LICYO_LITE === '1';
  const clubPicture = club.hero_image_url ?? club.logo_url;
  const ogImage = lite
    ? clubPicture
      ? new URL(clubPicture, base).toString()
      : null
    : `${appUrl()}/api/og/social-card?club=${encodeURIComponent(club.slug)}&title=${encodeURIComponent(page?.title ?? club.name)}`;
  const noIndex = club.status === 'demo';

  return {
    metadataBase: new URL(base),
    title,
    description,
    alternates: { canonical: `${base}${page?.path ?? '/'}` },
    openGraph: { type: 'website', locale: 'fr_FR', siteName: club.name, title, description, images: ogImage ? [lite ? { url: ogImage } : { url: ogImage, width: 1200, height: 630 }] : undefined },
    twitter: { card: ogImage ? 'summary_large_image' : 'summary', title, description, images: ogImage ? [ogImage] : undefined },
    icons: club.logo_url ? { icon: club.logo_url } : undefined,
    // Les démos ne doivent pas concurrencer le futur vrai site du club.
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    other: { 'geo.region': 'FR', 'geo.placename': club.city },
  };
}
