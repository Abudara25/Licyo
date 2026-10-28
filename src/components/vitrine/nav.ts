import type { SportVocabulary } from '@/config/sports-presets';

export type NavLink = { href: string; label: string };

/** Menu du site club (utilisable côté serveur et client). */
export function buildNav(prefix: string, vocab: SportVocabulary, modules: { trials: boolean; sponsors: boolean }): NavLink[] {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    { href: `${prefix}/equipes-et-cours`, label: cap(vocab.groups) },
    { href: `${prefix}/planning`, label: 'Horaires' },
    { href: `${prefix}/resultats-agenda`, label: vocab.hasScores ? 'Résultats et agenda' : 'Agenda' },
    ...(modules.sponsors ? [{ href: `${prefix}/partenaires`, label: 'Partenaires' }] : []),
    ...(modules.trials ? [{ href: `${prefix}/essai`, label: 'Essai gratuit' }] : []),
  ];
}
