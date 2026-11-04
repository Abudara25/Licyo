import type { SportVocabulary } from '@/config/sports-presets';

export type NavLink = { href: string; label: string };

/** Menu du site club (utilisable côté serveur et client). */
export function buildNav(
  prefix: string,
  vocab: SportVocabulary,
  modules: {
    trials: boolean;
    sponsors: boolean;
    events?: boolean;
    gallery?: boolean;
    private_lessons?: boolean;
    member_portal?: boolean;
  },
): NavLink[] {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return [
    { href: `${prefix}/equipes-et-cours`, label: cap(vocab.groups) },
    { href: `${prefix}/planning`, label: 'Horaires' },
    ...(modules.events !== false
      ? [
          {
            href: `${prefix}/resultats-agenda`,
            label: vocab.hasScores ? 'Résultats et agenda' : 'Agenda',
          },
        ]
      : []),
    ...(modules.sponsors
      ? [{ href: `${prefix}/partenaires`, label: 'Partenaires' }]
      : []),
    ...(modules.gallery
      ? [{ href: `${prefix}/galerie`, label: 'Galerie' }]
      : []),
    ...(modules.private_lessons
      ? [{ href: `${prefix}/cours-particuliers`, label: 'Cours particuliers' }]
      : []),
    ...(modules.member_portal
      ? [
          {
            href:
              (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000') +
              '/espace-adherent',
            label: 'Espace adhérent',
          },
        ]
      : []),
    ...(modules.trials
      ? [{ href: `${prefix}/essai`, label: 'Essai gratuit' }]
      : []),
  ];
}
