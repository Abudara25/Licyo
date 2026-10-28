import 'server-only';
import { unstable_cache } from 'next/cache';
import { notFound } from 'next/navigation';
import { rootDomain } from '@/lib/env';
import { createPublicClient } from '@/lib/supabase/public';
import type { Category, Club, ClubEvent, ClubProduct, Facility, Post, Schedule, Sponsor } from '@/types/database';

export const DOMAINS_TAG = 'club-domains';
export const clubTag = (slug: string) => `club-${slug}`;
const REVALIDATE_SECONDS = 3600;

/**
 * Le segment [domain] reçoit l'hôte réécrit par le middleware :
 * « slug.licyo.fr », « www.club.fr », ou simplement « slug » (aperçu local).
 */
export function parseDomainParam(raw: string): { slug?: string; customDomain?: string } {
  const host = decodeURIComponent(raw).toLowerCase().replace(/:\d+$/, '');
  const root = rootDomain().replace(/:\d+$/, '');
  if (host.endsWith(`.${root}`)) return { slug: host.slice(0, -(root.length + 1)) };
  if (!host.includes('.')) return { slug: host };
  return { customDomain: host.replace(/^www\./, '') };
}

const resolveSlug = unstable_cache(
  async (domain: string): Promise<string | null> => {
    const { slug, customDomain } = parseDomainParam(domain);
    const supabase = createPublicClient();
    if (slug) {
      const { data } = await supabase.from('clubs').select('slug').eq('slug', slug).maybeSingle();
      return data?.slug ?? null;
    }
    const { data } = await supabase
      .from('clubs')
      .select('slug')
      .in('custom_domain', [customDomain!, `www.${customDomain}`])
      .maybeSingle();
    return data?.slug ?? null;
  },
  ['resolve-club-slug'],
  { tags: [DOMAINS_TAG], revalidate: REVALIDATE_SECONDS },
);

export type PublicClubData = {
  club: Club;
  categories: Category[];
  schedules: Schedule[];
  facilities: Facility[];
  events: ClubEvent[];
  posts: Post[];
  sponsors: Sponsor[];
  products: ClubProduct[];
};

/** Toutes les données publiques d'un club, mises en cache sous le tag `club-${slug}`. */
export function getPublicClubData(slug: string): Promise<PublicClubData | null> {
  return unstable_cache(
    async () => {
      const supabase = createPublicClient();
      const { data: club } = await supabase.from('clubs').select('*').eq('slug', slug).maybeSingle();
      if (!club) return null;
      const id = club.id;
      const [categories, schedules, facilities, events, posts, sponsors, products] = await Promise.all([
        supabase.from('categories').select('*').eq('club_id', id).order('display_order').order('max_birth_year', { ascending: false }),
        supabase.from('schedules').select('*').eq('club_id', id).order('day_of_week').order('start_time'),
        supabase.from('facilities').select('*').eq('club_id', id).order('name'),
        supabase.from('events').select('*').eq('club_id', id).order('event_date'),
        supabase.from('posts').select('*').eq('club_id', id).order('published_at', { ascending: false }).limit(50),
        supabase.from('sponsors').select('*').eq('club_id', id).order('display_order'),
        supabase.from('club_products').select('*').eq('club_id', id).order('name'),
      ]);
      return {
        club,
        categories: categories.data ?? [],
        schedules: schedules.data ?? [],
        facilities: facilities.data ?? [],
        events: events.data ?? [],
        posts: posts.data ?? [],
        sponsors: sponsors.data ?? [],
        products: products.data ?? [],
      };
    },
    ['public-club-data', slug],
    { tags: [clubTag(slug)], revalidate: REVALIDATE_SECONDS },
  )();
}

/** Résout le club du segment [domain] ou renvoie une 404. */
export async function loadClubOr404(domain: string): Promise<PublicClubData> {
  const slug = await resolveSlug(domain);
  if (!slug) notFound();
  const data = await getPublicClubData(slug);
  if (!data) notFound();
  return data;
}

/** Préfixe des liens internes d'un site club : vide sur son hôte, « /slug » en aperçu local. */
export function sitePrefix(domain: string): string {
  const host = decodeURIComponent(domain);
  return host.includes('.') ? '' : `/${host}`;
}
