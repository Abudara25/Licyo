/** Catalogue commun : les modèles visuels ne conditionnent pas les fonctionnalités. */
export const SITE_TEMPLATES = [
  {
    id: 'club',
    name: 'Club',
    eyebrow: 'L’esprit collectif',
    description:
      'Une présence lumineuse et éditoriale. L’histoire du club, ses groupes et sa communauté au premier plan.',
    color: '#145a4a',
  },
  {
    id: 'arena',
    name: 'Arena',
    eyebrow: 'L’énergie du terrain',
    description:
      'Une identité affirmée, des contrastes forts et une place de choix pour vos rendez-vous.',
    color: '#ea5a32',
  },
  {
    id: 'studio',
    name: 'Studio',
    eyebrow: 'Le mouvement vous ressemble',
    description:
      'Un univers doux et épuré pour valoriser vos disciplines, vos cours et votre équipe.',
    color: '#7161b8',
  },
] as const;
export type SiteTemplate = (typeof SITE_TEMPLATES)[number]['id'];
export function resolveTemplate(value: string): SiteTemplate {
  return SITE_TEMPLATES.some((t) => t.id === value)
    ? (value as SiteTemplate)
    : value === 'stadium'
      ? 'arena'
      : 'club';
}
export const MODULES = [
  {
    id: 'inscriptions',
    name: 'Inscriptions',
    description: 'Dossiers, pièces justificatives et réinscriptions.',
    category: 'Gestion',
  },
  {
    id: 'payments',
    name: 'Paiements',
    description: 'Cotisations, échéanciers et encaissements.',
    category: 'Gestion',
  },
  {
    id: 'attendance',
    name: 'Présences',
    description: 'Feuille d’appel et contacts d’urgence.',
    category: 'Sport',
  },
  {
    id: 'trials',
    name: 'Séances d’essai',
    description: 'Faire découvrir votre pratique aux nouveaux adhérents.',
    category: 'Sport',
  },
  {
    id: 'events',
    name: 'Événements et convocations',
    description: 'Rencontres, compétitions, stages et réponses des familles.',
    category: 'Sport',
  },
  {
    id: 'private_lessons',
    name: 'Cours particuliers',
    description: 'Demandes de cours, disponibilités et objectifs.',
    category: 'Sport',
  },
  {
    id: 'boutique',
    name: 'Équipements',
    description: 'Tenues et articles proposés à l’inscription.',
    category: 'Communauté',
  },
  {
    id: 'sponsors',
    name: 'Partenaires',
    description: 'Visibilité des soutiens et demandes de partenariat.',
    category: 'Communauté',
  },
  {
    id: 'news',
    name: 'Actualités',
    description: 'La vie du club, racontée sur votre site.',
    category: 'Site',
  },
  {
    id: 'gallery',
    name: 'Galerie',
    description: 'Albums photo et moments partagés.',
    category: 'Site',
  },
  {
    id: 'member_portal',
    name: 'Espace adhérent',
    description: 'Dossiers, documents et paiements de chaque famille.',
    category: 'Gestion',
  },
] as const;
export type ModuleId = (typeof MODULES)[number]['id'];
export type ModuleSettings = Record<string, boolean>;
export function moduleEnabled(settings: ModuleSettings, id: string): boolean {
  return settings[id] ?? ['events', 'news', 'member_portal'].includes(id);
}
export function defaultModules(
  sport: string,
): import('../types/database').EnabledModules {
  return {
    vitrine: true,
    social_generator: true,
    ...Object.fromEntries(
      MODULES.map((m) => [
        m.id,
        !['private_lessons', 'gallery'].includes(m.id) ||
          (m.id === 'private_lessons' &&
            /muay|box|judo|karate|tennis/.test(sport)),
      ]),
    ),
  } as import('../types/database').EnabledModules;
}
export type MembershipTier = {
  id: string;
  name: string;
  min_members: number;
  max_members: number | null;
  monthly_cents: number | null;
  stripe_price_id: string | null;
  is_active: boolean;
};
export const INITIAL_TIERS: MembershipTier[] = [
  {
    id: 'essentiel',
    name: 'Essentiel',
    min_members: 0,
    max_members: 100,
    monthly_cents: null,
    stripe_price_id: null,
    is_active: true,
  },
  {
    id: 'collectif',
    name: 'Collectif',
    min_members: 101,
    max_members: 300,
    monthly_cents: null,
    stripe_price_id: null,
    is_active: true,
  },
  {
    id: 'elan',
    name: 'Élan',
    min_members: 301,
    max_members: 700,
    monthly_cents: null,
    stripe_price_id: null,
    is_active: true,
  },
  {
    id: 'sur-mesure',
    name: 'Sur mesure',
    min_members: 701,
    max_members: null,
    monthly_cents: null,
    stripe_price_id: null,
    is_active: true,
  },
];
export function tierForMembers(tiers: MembershipTier[], count: number) {
  if (!Number.isSafeInteger(count) || count < 0) return undefined;
  return tiers
    .filter(
      (t) =>
        t.is_active &&
        count >= t.min_members &&
        (t.max_members === null || count <= t.max_members),
    )
    .sort((a, b) => b.min_members - a.min_members)[0];
}
export function priceLabel(cents: number | null) {
  return cents === null
    ? 'Tarif à définir'
    : new Intl.NumberFormat('fr-FR', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: cents % 100 ? 2 : 0,
      }).format(cents / 100);
}
