import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { loadClubOr404, sitePrefix } from '@/lib/tenant';
import { clubCssVariables } from '@/lib/utils/color-contrast';
import { getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { serializeJsonLd, sportsClubJsonLd } from '@/lib/seo-geo/json-ld';
import { ClubHeader } from '@/components/vitrine/ClubHeader';
import { buildNav } from '@/components/vitrine/nav';
import { ClubFooter } from '@/components/vitrine/ClubFooter';
import { MatchEventTicker } from '@/components/vitrine/MatchEventTicker';
import { PageViewTracker } from '@/components/vitrine/PageViewTracker';

type Props = { children: React.ReactNode; params: Promise<{ domain: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { domain } = await params;
  const { club } = await loadClubOr404(domain);
  return clubMetadata(club);
}

export default async function ClubLayout({ children, params }: Props) {
  const { domain } = await params;
  const data = await loadClubOr404(domain);
  const { club } = data;
  const preset = getSportPreset(club.sport_type);
  const prefix = sitePrefix(domain);
  const links = buildNav(prefix, preset.vocabulary, { trials: club.enabled_modules.trials, sponsors: club.enabled_modules.sponsors });

  return (
    <div style={clubCssVariables(club.primary_color, club.secondary_color) as CSSProperties} className="flex min-h-dvh flex-col">
      <a href="#contenu" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2 focus:text-black">
        Aller au contenu
      </a>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(sportsClubJsonLd(data)) }} />
      <ClubHeader
        name={club.name}
        logoUrl={club.logo_url}
        prefix={prefix}
        links={links}
        showRegister={club.enabled_modules.inscriptions}
        isDemo={club.status === 'demo'}
      />
      <MatchEventTicker events={data.events} vocab={preset.vocabulary} />
      <main id="contenu" className="flex-1">
        {children}
      </main>
      <ClubFooter club={club} facilities={data.facilities} links={links} />
      <PageViewTracker clubId={club.id} prefix={prefix} />
    </div>
  );
}
