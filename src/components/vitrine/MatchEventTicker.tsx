import { CalendarDays } from 'lucide-react';
import type { SportVocabulary } from '@/config/sports-presets';
import type { ClubEvent } from '@/types/database';

const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

/** Bandeau des prochains rendez-vous et derniers résultats, sous l'en-tête. */
export function MatchEventTicker({ events, vocab }: { events: ClubEvent[]; vocab: SportVocabulary }) {
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.event_date).getTime() >= now).slice(0, 3);
  const lastResult = vocab.hasScores
    ? [...events].reverse().find((e) => new Date(e.event_date).getTime() < now && e.score_club != null && e.score_opponent != null)
    : undefined;
  if (upcoming.length === 0 && !lastResult) return null;

  return (
    <div className="border-b bg-club-secondary text-club-secondary-fg">
      <div className="page-container flex gap-6 overflow-x-auto py-2 text-sm [scrollbar-width:none]">
        {lastResult ? (
          <p className="flex shrink-0 items-center gap-2">
            <span className="font-semibold">Dernier résultat :</span>
            {lastResult.title} <strong className="tabular-nums">{lastResult.score_club} - {lastResult.score_opponent}</strong>
          </p>
        ) : null}
        {upcoming.map((e) => (
          <p key={e.id} className="flex shrink-0 items-center gap-2">
            <CalendarDays className="size-4" aria-hidden />
            <span className="font-semibold">{fmt.format(new Date(e.event_date))}</span>
            {e.title}
            {vocab.hasScores ? <span className="opacity-80">({e.is_home ? vocab.home : vocab.away})</span> : null}
          </p>
        ))}
      </div>
    </div>
  );
}
