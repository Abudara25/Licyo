import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { getSportPreset } from '@/config/sports-presets';
import { clubMetadata } from '@/lib/seo-geo/metadata';
import { eventJsonLd, serializeJsonLd } from '@/lib/seo-geo/json-ld';
import { PageTitle } from '@/components/vitrine/PageTitle';
import type { ClubEvent, EventType } from '@/types/database';

type Props = { params: Promise<{ domain: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { club } = await loadClubOr404((await params).domain);
  const v = getSportPreset(club.sport_type).vocabulary;
  return clubMetadata(club, { title: v.hasScores ? 'Résultats et agenda' : 'Agenda', path: '/resultats-agenda' });
}

const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

export default async function EventsPage({ params }: Props) {
  const { domain } = await params;
  const data = await loadClubOr404(domain);
  const { club, events, categories } = data;
  const v = getSportPreset(club.sport_type).vocabulary;
  const typeLabel: Record<EventType, string> = {
    competition: v.competition.charAt(0).toUpperCase() + v.competition.slice(1),
    tournament: 'Tournoi',
    training_camp: 'Stage',
    club_event: 'Vie du club',
    meeting: 'Réunion',
  };
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.event_date).getTime() >= now);
  const past = events.filter((e) => new Date(e.event_date).getTime() < now).reverse().slice(0, 30);
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name;

  const Item = ({ e, showScore }: { e: ClubEvent; showScore: boolean }) => (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {typeLabel[e.event_type]}{categoryName(e.category_id) ? ` - ${categoryName(e.category_id)}` : ''}
        </p>
        <p className="font-semibold">{e.title}</p>
        <p className="text-sm text-muted-foreground">
          {fmt.format(new Date(e.event_date))}
          {e.location_text ? ` - ${e.location_text}` : ''}
          {v.hasScores && e.event_type === 'competition' ? ` (${e.is_home ? v.home : v.away})` : ''}
        </p>
      </div>
      {showScore && v.hasScores && e.score_club != null && e.score_opponent != null ? (
        <p className="rounded-lg bg-club-primary px-3 py-1 text-lg font-bold tabular-nums text-club-primary-fg" aria-label={`Score ${e.score_club} à ${e.score_opponent}`}>
          {e.score_club} - {e.score_opponent}
        </p>
      ) : null}
    </li>
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(upcoming.slice(0, 10).map((e) => eventJsonLd(e, data))) }} />
      <PageTitle title={v.hasScores ? 'Résultats et agenda' : 'Agenda'} intro={`${v.competitions.charAt(0).toUpperCase() + v.competitions.slice(1)}, tournois et rendez-vous du club.`} />
      <div className="page-container mt-8 grid gap-10 lg:grid-cols-2">
        <section aria-labelledby="a-venir">
          <h2 id="a-venir" className="text-xl font-bold">À venir</h2>
          {upcoming.length === 0 ? <p className="mt-2 text-muted-foreground">Aucun rendez-vous programmé.</p> : null}
          <ul className="mt-3 grid gap-3">{upcoming.map((e) => <Item key={e.id} e={e} showScore={false} />)}</ul>
        </section>
        <section aria-labelledby="passes">
          <h2 id="passes" className="text-xl font-bold">{v.hasScores ? 'Derniers résultats' : 'Rendez-vous passés'}</h2>
          {past.length === 0 ? <p className="mt-2 text-muted-foreground">Rien pour le moment.</p> : null}
          <ul className="mt-3 grid gap-3">{past.map((e) => <Item key={e.id} e={e} showScore />)}</ul>
        </section>
      </div>
    </>
  );
}
