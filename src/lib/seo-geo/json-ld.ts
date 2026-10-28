import { getSportPreset, DAY_LABELS } from '@/config/sports-presets';
import { clubSiteUrl } from '@/lib/env';
import type { PublicClubData } from '@/lib/tenant';
import type { ClubEvent, Post } from '@/types/database';

const SCHEMA_DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Schéma SportsClub (SportsOrganization) pour la page d'accueil du club. */
export function sportsClubJsonLd({ club, facilities, schedules, categories }: PublicClubData) {
  const preset = getSportPreset(club.sport_type);
  const url = clubSiteUrl(club);
  const facility = facilities[0];
  const sameAs = Object.values(club.social_links ?? {}).filter((v): v is string => typeof v === 'string' && v.startsWith('http'));
  const minPrice = categories.length ? Math.min(...categories.map((c) => c.annual_price)) : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsClub',
    '@id': `${url}/#club`,
    name: club.name,
    url,
    logo: club.logo_url ?? undefined,
    image: club.hero_image_url ?? club.logo_url ?? undefined,
    sport: preset.label,
    email: club.contact_email,
    telephone: club.contact_phone ?? undefined,
    memberOf: club.federation_name ? { '@type': 'SportsOrganization', name: club.federation_name } : undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: facility?.address,
      addressLocality: club.city,
      postalCode: club.postal_code,
      addressCountry: 'FR',
    },
    geo:
      facility?.latitude != null && facility?.longitude != null
        ? { '@type': 'GeoCoordinates', latitude: facility.latitude, longitude: facility.longitude }
        : undefined,
    areaServed: [club.city, ...club.nearby_cities].map((name) => ({ '@type': 'City', name })),
    openingHoursSpecification: schedules.map((s) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: `https://schema.org/${SCHEMA_DAYS[s.day_of_week]}`,
      opens: s.start_time.slice(0, 5),
      closes: s.end_time.slice(0, 5),
    })),
    priceRange: minPrice !== undefined ? `À partir de ${minPrice} € / an` : undefined,
    sameAs: sameAs.length ? sameAs : undefined,
  };
}

export function eventJsonLd(event: ClubEvent, data: PublicClubData) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: event.title,
    startDate: event.event_date,
    eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'Place', name: event.location_text ?? data.club.city, address: data.club.city },
    organizer: { '@type': 'SportsClub', name: data.club.name, url: clubSiteUrl(data.club) },
  };
}

export function articleJsonLd(post: Post, data: PublicClubData) {
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: post.title,
    datePublished: post.published_at,
    image: post.cover_image_url ?? undefined,
    publisher: { '@type': 'Organization', name: data.club.name, logo: data.club.logo_url ?? undefined },
    mainEntityOfPage: `${clubSiteUrl(data.club)}/actualites/${post.slug}`,
  };
}

/** Sérialisation sûre dans une balise <script> (aucune fermeture de balise possible). */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function scheduleLabel(dayOfWeek: number, start: string, end: string): string {
  return `${DAY_LABELS[dayOfWeek]} ${start.slice(0, 5).replace(':', 'h')} - ${end.slice(0, 5).replace(':', 'h')}`;
}
