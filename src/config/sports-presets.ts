import type { EventType, MedicalRequirement } from '@/types/database';

/**
 * Vocabulaire propre à chaque sport. Les composants ne contiennent jamais
 * « match », « joueur » ou « stade » en dur : ils lisent ce dictionnaire.
 */
export type SportVocabulary = {
  sportName: string;
  /** Rencontre officielle : « match », « compétition », « combat »… */
  competition: string;
  competitions: string;
  /** Pratiquant : « joueur », « boxeur », « judoka »… */
  athlete: string;
  athletes: string;
  /** Lieu de pratique : « stade », « gymnase », « salle », « dojo »… */
  venue: string;
  venues: string;
  training: string;
  trainings: string;
  /** Groupe d'entraînement : « équipe », « groupe », « cours »… */
  group: string;
  groups: string;
  coach: string;
  coaches: string;
  /** Unité de score affichée après un résultat : « buts », « points »… */
  scoreUnit: string;
  /** Vrai si les rencontres opposent deux équipes avec un score. */
  hasScores: boolean;
  home: string;
  away: string;
  license: string;
  tagline: string;
};

export type DemoCategory = {
  name: string;
  /** Âges au 1er janvier de la première année de saison. */
  minAge: number;
  maxAge: number;
  price: number;
  medical: MedicalRequirement;
  description: string;
};

export type DemoEvent = {
  type: EventType;
  title: string;
  daysFromNow: number;
  isHome: boolean;
  location: string;
};
export type DemoPost = { title: string; content: string };

/** Licyo cible les sports collectifs et les sports de combat / arts martiaux (pas les sports individuels). */
export type SportFamily = 'collectif' | 'combat';

export const SPORT_FAMILY_LABELS: Record<SportFamily, string> = {
  collectif: 'Sports collectifs',
  combat: 'Sports de combat et arts martiaux',
};

export type SportPreset = {
  id: string;
  label: string;
  family: SportFamily;
  emoji: string;
  defaultPrimary: string;
  defaultSecondary: string;
  themePreset: string;
  federation: string;
  vocabulary: SportVocabulary;
  demo: {
    facilityName: string;
    categories: [DemoCategory, DemoCategory, DemoCategory, DemoCategory];
    /** 6 créneaux : [index de catégorie, jour ISO 1-7, début, fin]. */
    schedules: [number, number, string, string][];
    events: [DemoEvent, DemoEvent];
    posts: [DemoPost, DemoPost, DemoPost];
    products: { name: string; price: number; sizes: string[] }[];
  };
};

const YOUTH_SIZES = [
  '6 ans',
  '8 ans',
  '10 ans',
  '12 ans',
  '14 ans',
  'S',
  'M',
  'L',
  'XL',
];

function teamVocabulary(
  sportName: string,
  athlete: string,
  athletes: string,
  venue: string,
  venues: string,
  scoreUnit: string,
  tagline: string,
): SportVocabulary {
  return {
    sportName,
    competition: 'match',
    competitions: 'matchs',
    athlete,
    athletes,
    venue,
    venues,
    training: 'entraînement',
    trainings: 'entraînements',
    group: 'équipe',
    groups: 'équipes',
    coach: 'éducateur',
    coaches: 'éducateurs',
    scoreUnit,
    hasScores: true,
    home: 'domicile',
    away: 'extérieur',
    license: 'licence',
    tagline,
  };
}

function combatVocabulary(
  sportName: string,
  competition: string,
  competitions: string,
  athlete: string,
  athletes: string,
  venue: string,
  venues: string,
  group: string,
  groups: string,
  tagline: string,
): SportVocabulary {
  return {
    sportName,
    competition,
    competitions,
    athlete,
    athletes,
    venue,
    venues,
    training: 'entraînement',
    trainings: 'entraînements',
    group,
    groups,
    coach: 'entraîneur',
    coaches: 'entraîneurs',
    scoreUnit: 'points',
    hasScores: false,
    home: 'à domicile',
    away: 'en déplacement',
    license: 'licence',
    tagline,
  };
}

function genericPosts(
  sport: string,
  venue: string,
  groups: string,
): [DemoPost, DemoPost, DemoPost] {
  return [
    {
      title: 'Les inscriptions de la saison sont ouvertes',
      content: `Les inscriptions sont ouvertes pour toutes nos ${groups}. Le dossier se remplit en ligne en quelques minutes, pièces justificatives comprises. Les places sont limitées dans certains créneaux : n'attendez pas la rentrée.`,
    },
    {
      title: `Venez essayer le ${sport} gratuitement`,
      content: `Chaque nouvel adhérent peut participer à une séance d'essai gratuite avant de s'inscrire. Réservez votre créneau en ligne et présentez-vous au ${venue} avec une tenue de sport et une bouteille d'eau.`,
    },
    {
      title: 'Merci à nos bénévoles',
      content: `Le club vit grâce à ses bénévoles : encadrement, buvette, déplacements, organisation des événements. Vous avez un peu de temps ? Contactez le bureau, toutes les bonnes volontés sont les bienvenues.`,
    },
  ];
}

const SIX_SLOTS: [number, number, string, string][] = [
  [0, 3, '14:00', '15:00'],
  [0, 6, '10:00', '11:00'],
  [1, 3, '15:30', '17:00'],
  [1, 5, '17:30', '19:00'],
  [2, 2, '18:00', '19:30'],
  [3, 4, '19:30', '21:00'],
];

export const SPORTS_PRESETS: Record<string, SportPreset> = {
  football: {
    id: 'football',
    label: 'Football',
    family: 'collectif',
    emoji: '⚽',
    defaultPrimary: '#1E40AF',
    defaultSecondary: '#FBBF24',
    themePreset: 'stadium',
    federation: 'Fédération Française de Football',
    vocabulary: teamVocabulary(
      'football',
      'joueur',
      'joueurs',
      'stade',
      'stades',
      'buts',
      'Le plaisir du jeu, à tous les âges.',
    ),
    demo: {
      facilityName: 'Stade municipal',
      categories: [
        {
          name: 'U7 - U9',
          minAge: 6,
          maxAge: 8,
          price: 160,
          medical: 'health_questionnaire',
          description: 'Découverte du ballon et du jeu à effectif réduit.',
        },
        {
          name: 'U10 - U13',
          minAge: 9,
          maxAge: 12,
          price: 180,
          medical: 'health_questionnaire',
          description: 'Apprentissage technique et jeu à 8.',
        },
        {
          name: 'U14 - U17',
          minAge: 13,
          maxAge: 16,
          price: 200,
          medical: 'health_questionnaire',
          description: 'Jeu à 11 et championnat départemental.',
        },
        {
          name: 'Seniors',
          minAge: 18,
          maxAge: 45,
          price: 220,
          medical: 'medical_cert_competition',
          description: 'Équipe engagée en championnat de district.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'competition',
          title: 'Seniors - Match de championnat',
          daysFromNow: 5,
          isHome: true,
          location: 'Stade municipal',
        },
        {
          type: 'tournament',
          title: 'Tournoi des jeunes',
          daysFromNow: 19,
          isHome: true,
          location: 'Stade municipal',
        },
      ],
      posts: genericPosts('football', 'stade', 'équipes'),
      products: [
        { name: 'Maillot du club', price: 25, sizes: YOUTH_SIZES },
        { name: 'Survêtement', price: 45, sizes: YOUTH_SIZES },
      ],
    },
  },
  basketball: {
    id: 'basketball',
    label: 'Basket-ball',
    family: 'collectif',
    emoji: '🏀',
    defaultPrimary: '#C2410C',
    defaultSecondary: '#111827',
    themePreset: 'arena',
    federation: 'Fédération Française de Basket-Ball',
    vocabulary: teamVocabulary(
      'basket',
      'joueur',
      'joueurs',
      'gymnase',
      'gymnases',
      'points',
      'Du mini-basket aux seniors.',
    ),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        {
          name: 'Mini-basket U7 - U9',
          minAge: 6,
          maxAge: 8,
          price: 150,
          medical: 'health_questionnaire',
          description: 'Motricité et premiers paniers.',
        },
        {
          name: 'U11 - U13',
          minAge: 9,
          maxAge: 12,
          price: 170,
          medical: 'health_questionnaire',
          description: 'Fondamentaux et premiers matchs.',
        },
        {
          name: 'U15 - U18',
          minAge: 13,
          maxAge: 17,
          price: 190,
          medical: 'health_questionnaire',
          description: 'Championnat départemental jeunes.',
        },
        {
          name: 'Seniors',
          minAge: 18,
          maxAge: 45,
          price: 210,
          medical: 'medical_cert_competition',
          description: 'Équipes seniors et loisirs.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'competition',
          title: 'Seniors - Match de championnat',
          daysFromNow: 6,
          isHome: true,
          location: 'Gymnase municipal',
        },
        {
          type: 'club_event',
          title: 'Fête du mini-basket',
          daysFromNow: 21,
          isHome: true,
          location: 'Gymnase municipal',
        },
      ],
      posts: genericPosts('basket', 'gymnase', 'équipes'),
      products: [{ name: 'Maillot réversible', price: 22, sizes: YOUTH_SIZES }],
    },
  },
  handball: {
    id: 'handball',
    label: 'Handball',
    family: 'collectif',
    emoji: '🤾',
    defaultPrimary: '#0F766E',
    defaultSecondary: '#F59E0B',
    themePreset: 'arena',
    federation: 'Fédération Française de Handball',
    vocabulary: teamVocabulary(
      'handball',
      'joueur',
      'joueurs',
      'gymnase',
      'gymnases',
      'buts',
      "Esprit d'équipe et intensité.",
    ),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        {
          name: 'Baby hand',
          minAge: 4,
          maxAge: 6,
          price: 120,
          medical: 'health_questionnaire',
          description: 'Éveil moteur par le jeu.',
        },
        {
          name: '-11 ans',
          minAge: 7,
          maxAge: 10,
          price: 160,
          medical: 'health_questionnaire',
          description: 'Premiers matchs et plateaux.',
        },
        {
          name: '-15 ans',
          minAge: 11,
          maxAge: 14,
          price: 180,
          medical: 'health_questionnaire',
          description: 'Championnat départemental.',
        },
        {
          name: 'Seniors',
          minAge: 18,
          maxAge: 45,
          price: 200,
          medical: 'medical_cert_competition',
          description: 'Équipes seniors.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'competition',
          title: 'Seniors - Match de championnat',
          daysFromNow: 4,
          isHome: false,
          location: 'Gymnase de la ville voisine',
        },
        {
          type: 'tournament',
          title: 'Tournoi -11 ans',
          daysFromNow: 18,
          isHome: true,
          location: 'Gymnase municipal',
        },
      ],
      posts: genericPosts('handball', 'gymnase', 'équipes'),
      products: [{ name: 'Maillot du club', price: 25, sizes: YOUTH_SIZES }],
    },
  },
  volleyball: {
    id: 'volleyball',
    label: 'Volley-ball',
    family: 'collectif',
    emoji: '🏐',
    defaultPrimary: '#1D4ED8',
    defaultSecondary: '#FACC15',
    themePreset: 'arena',
    federation: 'Fédération Française de Volley',
    vocabulary: teamVocabulary(
      'volley',
      'joueur',
      'joueurs',
      'gymnase',
      'gymnases',
      'sets',
      "Smash, passe, réception : rejoignez l'équipe.",
    ),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        {
          name: 'M11 - M13',
          minAge: 8,
          maxAge: 12,
          price: 140,
          medical: 'health_questionnaire',
          description: 'Initiation au volley.',
        },
        {
          name: 'M15 - M18',
          minAge: 13,
          maxAge: 17,
          price: 160,
          medical: 'health_questionnaire',
          description: 'Perfectionnement et compétition jeunes.',
        },
        {
          name: 'Seniors compétition',
          minAge: 18,
          maxAge: 45,
          price: 180,
          medical: 'medical_cert_competition',
          description: 'Championnat régional.',
        },
        {
          name: 'Loisirs mixtes',
          minAge: 18,
          maxAge: 70,
          price: 120,
          medical: 'health_questionnaire',
          description: 'Pratique détente et convivialité.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'competition',
          title: 'Seniors - Match de championnat',
          daysFromNow: 7,
          isHome: true,
          location: 'Gymnase municipal',
        },
        {
          type: 'club_event',
          title: "Tournoi loisirs de fin d'année",
          daysFromNow: 30,
          isHome: true,
          location: 'Gymnase municipal',
        },
      ],
      posts: genericPosts('volley', 'gymnase', 'équipes'),
      products: [{ name: 'Maillot du club', price: 25, sizes: YOUTH_SIZES }],
    },
  },
  rugby: {
    id: 'rugby',
    label: 'Rugby',
    family: 'collectif',
    emoji: '🏉',
    defaultPrimary: '#14532D',
    defaultSecondary: '#FDE047',
    themePreset: 'stadium',
    federation: 'Fédération Française de Rugby',
    vocabulary: teamVocabulary(
      'rugby',
      'joueur',
      'joueurs',
      'stade',
      'stades',
      'points',
      'Respect, engagement, solidarité.',
    ),
    demo: {
      facilityName: 'Stade municipal',
      categories: [
        {
          name: 'École de rugby M6 - M10',
          minAge: 5,
          maxAge: 9,
          price: 150,
          medical: 'health_questionnaire',
          description: 'Jeu sans plaquage puis découverte du contact.',
        },
        {
          name: 'M12 - M14',
          minAge: 10,
          maxAge: 13,
          price: 170,
          medical: 'health_questionnaire',
          description: 'Rugby éducatif et tournois.',
        },
        {
          name: 'Cadets - Juniors',
          minAge: 14,
          maxAge: 18,
          price: 190,
          medical: 'medical_cert_competition',
          description: 'Championnat territorial.',
        },
        {
          name: 'Seniors',
          minAge: 18,
          maxAge: 40,
          price: 220,
          medical: 'medical_cert_competition',
          description: 'Équipe première et réserve.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'competition',
          title: 'Seniors - Match de championnat',
          daysFromNow: 5,
          isHome: true,
          location: 'Stade municipal',
        },
        {
          type: 'tournament',
          title: "Tournoi de l'école de rugby",
          daysFromNow: 20,
          isHome: true,
          location: 'Stade municipal',
        },
      ],
      posts: genericPosts('rugby', 'stade', 'équipes'),
      products: [{ name: 'Maillot du club', price: 30, sizes: YOUTH_SIZES }],
    },
  },
  judo: {
    id: 'judo',
    label: 'Judo',
    family: 'combat',
    emoji: '🥋',
    defaultPrimary: '#1E3A8A',
    defaultSecondary: '#DC2626',
    themePreset: 'dojo',
    federation: 'Fédération Française de Judo',
    vocabulary: combatVocabulary(
      'judo',
      'compétition',
      'compétitions',
      'judoka',
      'judokas',
      'dojo',
      'dojos',
      'cours',
      'cours',
      'Code moral, technique et confiance en soi.',
    ),
    demo: {
      facilityName: 'Dojo municipal',
      categories: [
        {
          name: 'Éveil judo',
          minAge: 4,
          maxAge: 5,
          price: 140,
          medical: 'health_questionnaire',
          description: 'Motricité et premières chutes.',
        },
        {
          name: 'Mini-poussins - Poussins',
          minAge: 6,
          maxAge: 9,
          price: 170,
          medical: 'health_questionnaire',
          description: 'Apprentissage des techniques de base.',
        },
        {
          name: 'Benjamins - Minimes',
          minAge: 10,
          maxAge: 14,
          price: 190,
          medical: 'health_questionnaire',
          description: 'Progression vers les ceintures de couleur.',
        },
        {
          name: 'Adultes',
          minAge: 15,
          maxAge: 70,
          price: 210,
          medical: 'medical_cert_competition',
          description: 'Judo, ju-jitsu et taïso.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'competition',
          title: 'Tournoi départemental',
          daysFromNow: 12,
          isHome: false,
          location: 'Dojo départemental',
        },
        {
          type: 'club_event',
          title: 'Passage de grades',
          daysFromNow: 40,
          isHome: true,
          location: 'Dojo municipal',
        },
      ],
      posts: genericPosts('judo', 'dojo', 'cours'),
      products: [
        {
          name: 'Kimono',
          price: 35,
          sizes: ['110', '120', '130', '140', '150', '160', '170', '180'],
        },
      ],
    },
  },
  'boxe': {
    id: 'boxe',
    label: 'Boxe anglaise',
    family: 'combat',
    emoji: '🥊',
    defaultPrimary: '#991B1B',
    defaultSecondary: '#F59E0B',
    themePreset: 'dojo',
    federation: 'Fédération Française de Boxe',
    vocabulary: combatVocabulary('boxe', 'combat', 'combats', 'boxeur', 'boxeurs', 'salle', 'salles', 'section', 'sections', 'Technique, respect et dépassement de soi.'),
    demo: {
      facilityName: 'Salle de boxe municipale',
      categories: [
        { name: 'Boxe éducative', minAge: 7, maxAge: 11, price: 160, medical: 'health_questionnaire', description: 'Sans touche appuyée.' },
        { name: 'Ados', minAge: 12, maxAge: 17, price: 190, medical: 'medical_cert_standard', description: 'Technique, cardio et premiers assauts.' },
        { name: 'Adultes loisir', minAge: 18, maxAge: 60, price: 230, medical: 'medical_cert_standard', description: 'Boxe loisir sans compétition.' },
        { name: 'Compétiteurs', minAge: 16, maxAge: 40, price: 260, medical: 'medical_cert_competition', description: 'Préparation aux combats amateurs.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Gala régional', daysFromNow: 21, isHome: false, location: 'Salle des sports' },
        { type: 'club_event', title: 'Interclubs', daysFromNow: 45, isHome: true, location: 'Salle de boxe municipale' },
      ],
      posts: genericPosts('boxe', 'salle', 'cours'),
      products: [
        { name: 'Gants', price: 45, sizes: ['8 oz', '10 oz', '12 oz', '14 oz'] },
        { name: 'Protège-dents', price: 10, sizes: ['Junior', 'Adulte'] },
      ],
    },
  },
  'muaythai': {
    id: 'muaythai',
    label: 'Muay thaï',
    family: 'combat',
    emoji: '🥊',
    defaultPrimary: '#B91C1C',
    defaultSecondary: '#111827',
    themePreset: 'dojo',
    federation: 'Fédération Française de Kick Boxing, Muay Thaï et Disciplines Associées',
    vocabulary: combatVocabulary('muay thaï', 'combat', 'combats', 'pratiquant', 'pratiquants', 'salle', 'salles', 'section', 'sections', 'Discipline, respect et esprit de combat.'),
    demo: {
      facilityName: 'Salle de combat municipale',
      categories: [
        { name: 'Enfants', minAge: 6, maxAge: 12, price: 250, medical: 'health_questionnaire', description: 'Apprentissage ludique, sans touche appuyée.' },
        { name: 'Ados', minAge: 13, maxAge: 17, price: 270, medical: 'medical_cert_standard', description: 'Technique, cardio et premiers assauts.' },
        { name: 'Adultes', minAge: 18, maxAge: 60, price: 290, medical: 'medical_cert_standard', description: 'Muay thaï et K1 loisir, séances mixtes.' },
        { name: 'Compétiteurs', minAge: 16, maxAge: 40, price: 320, medical: 'medical_cert_competition', description: 'Préparation aux combats amateurs.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Championnat régional', daysFromNow: 18, isHome: false, location: 'Palais des sports' },
        { type: 'club_event', title: 'Passage de grades', daysFromNow: 50, isHome: true, location: 'Salle de combat municipale' },
      ],
      posts: genericPosts('muay thaï', 'salle', 'cours'),
      products: [
        { name: 'Short de combat', price: 35, sizes: ['XS', 'S', 'M', 'L', 'XL'] },
        { name: 'Gants', price: 45, sizes: ['8 oz', '10 oz', '12 oz', '14 oz'] },
      ],
    },
  },
  'karate': {
    id: 'karate',
    label: 'Karaté',
    family: 'combat',
    emoji: '🥋',
    defaultPrimary: '#1F2937',
    defaultSecondary: '#DC2626',
    themePreset: 'dojo',
    federation: 'Fédération Française de Karaté et Disciplines Associées',
    vocabulary: combatVocabulary('karaté', 'compétition', 'compétitions', 'karatéka', 'karatékas', 'dojo', 'dojos', 'cours', 'cours', 'Rigueur, maîtrise et confiance en soi.'),
    demo: {
      facilityName: 'Dojo municipal',
      categories: [
        { name: 'Baby karaté', minAge: 4, maxAge: 5, price: 140, medical: 'health_questionnaire', description: 'Motricité et premiers gestes.' },
        { name: 'Enfants', minAge: 6, maxAge: 11, price: 170, medical: 'health_questionnaire', description: 'Kihon, kata et jeux d\'opposition.' },
        { name: 'Ados', minAge: 12, maxAge: 17, price: 190, medical: 'health_questionnaire', description: 'Kata, kumite et préparation aux grades.' },
        { name: 'Adultes', minAge: 18, maxAge: 70, price: 210, medical: 'medical_cert_standard', description: 'Karaté traditionnel et self-défense.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Coupe départementale', daysFromNow: 15, isHome: false, location: 'Gymnase départemental' },
        { type: 'club_event', title: 'Passage de ceintures', daysFromNow: 60, isHome: true, location: 'Dojo municipal' },
      ],
      posts: genericPosts('karaté', 'dojo', 'cours'),
      products: [
        { name: 'Karatégi', price: 35, sizes: ['110', '120', '130', '140', '150', '160', '170', '180'] },
      ],
    },
  },
  'taekwondo': {
    id: 'taekwondo',
    label: 'Taekwondo',
    family: 'combat',
    emoji: '🥋',
    defaultPrimary: '#1D4ED8',
    defaultSecondary: '#DC2626',
    themePreset: 'dojo',
    federation: 'Fédération Française de Taekwondo et Disciplines Associées',
    vocabulary: combatVocabulary('taekwondo', 'compétition', 'compétitions', 'pratiquant', 'pratiquants', 'dojang', 'dojangs', 'cours', 'cours', 'Souplesse, précision et respect.'),
    demo: {
      facilityName: 'Dojang municipal',
      categories: [
        { name: 'Baby', minAge: 4, maxAge: 6, price: 140, medical: 'health_questionnaire', description: 'Éveil et coordination.' },
        { name: 'Enfants', minAge: 7, maxAge: 11, price: 170, medical: 'health_questionnaire', description: 'Poomsae et premiers combats.' },
        { name: 'Ados', minAge: 12, maxAge: 17, price: 190, medical: 'health_questionnaire', description: 'Combat et préparation aux grades.' },
        { name: 'Adultes', minAge: 18, maxAge: 60, price: 210, medical: 'medical_cert_standard', description: 'Taekwondo loisir et compétition.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Open régional', daysFromNow: 20, isHome: false, location: 'Palais des sports' },
        { type: 'club_event', title: 'Passage de grades', daysFromNow: 55, isHome: true, location: 'Dojang municipal' },
      ],
      posts: genericPosts('taekwondo', 'dojang', 'cours'),
      products: [
        { name: 'Dobok', price: 35, sizes: ['110', '120', '130', '140', '150', '160', '170', '180'] },
      ],
    },
  },
};

export const SPORT_IDS = Object.keys(SPORTS_PRESETS);

/** Renvoie le preset du sport, ou un preset générique « multisport » si inconnu. */
export function getSportPreset(
  sportType: string | null | undefined,
): SportPreset {
  if (sportType && SPORTS_PRESETS[sportType]) return SPORTS_PRESETS[sportType];
  return {
    ...SPORTS_PRESETS.football,
    id: 'multisport',
    family: 'collectif',
    label:
      sportType && sportType !== 'multisport'
        ? sportType.charAt(0).toUpperCase() + sportType.slice(1)
        : 'Multisport',
    emoji: '🏅',
    themePreset: 'arena',
    federation: '',
    demo: {
      facilityName: 'Espace de pratique',
      categories: [
        {
          name: 'Découverte',
          minAge: 6,
          maxAge: 12,
          price: 0,
          medical: 'health_questionnaire',
          description: 'Découvrir et progresser ensemble.',
        },
        {
          name: 'Adolescents',
          minAge: 13,
          maxAge: 17,
          price: 0,
          medical: 'health_questionnaire',
          description: 'Une pratique adaptée.',
        },
        {
          name: 'Adultes',
          minAge: 18,
          maxAge: 99,
          price: 0,
          medical: 'health_questionnaire',
          description: 'Tous niveaux.',
        },
        {
          name: 'Loisir',
          minAge: 6,
          maxAge: 99,
          price: 0,
          medical: 'health_questionnaire',
          description: 'Le plaisir de pratiquer.',
        },
      ],
      schedules: SIX_SLOTS,
      events: [
        {
          type: 'club_event',
          title: 'Rencontre de début de saison',
          daysFromNow: 14,
          isHome: true,
          location: 'Au club',
        },
        {
          type: 'training_camp',
          title: 'Journée de découverte',
          daysFromNow: 30,
          isHome: true,
          location: 'Au club',
        },
      ],
      posts: genericPosts('la pratique sportive', 'espace', 'séances'),
      products: [],
    },
    vocabulary: combatVocabulary(
      sportType || 'sport',
      'rencontre',
      'rencontres',
      'adhérent',
      'adhérents',
      'salle',
      'salles',
      'groupe',
      'groupes',
      'Le sport pour tous.',
    ),
  };
}

/** Années de naissance d'une catégorie de démo pour une saison « 2026-2027 ». */
export function birthYearsForSeason(
  season: string,
  cat: Pick<DemoCategory, 'minAge' | 'maxAge'>,
) {
  const startYear = Number(season.slice(0, 4));
  return {
    min_birth_year: startYear - cat.maxAge,
    max_birth_year: startYear - cat.minAge,
  };
}

export const DAY_LABELS = [
  '',
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;
