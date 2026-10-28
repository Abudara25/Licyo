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
  /** Pratiquant : « joueur », « nageur », « judoka »… */
  athlete: string;
  athletes: string;
  /** Lieu de pratique : « stade », « gymnase », « piscine », « dojo »… */
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

export type DemoEvent = { type: EventType; title: string; daysFromNow: number; isHome: boolean; location: string };
export type DemoPost = { title: string; content: string };

export type SportPreset = {
  id: string;
  label: string;
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

const YOUTH_SIZES = ['6 ans', '8 ans', '10 ans', '12 ans', '14 ans', 'S', 'M', 'L', 'XL'];

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

function individualVocabulary(
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

function genericPosts(sport: string, venue: string, groups: string): [DemoPost, DemoPost, DemoPost] {
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
    emoji: '⚽',
    defaultPrimary: '#1E40AF',
    defaultSecondary: '#FBBF24',
    themePreset: 'stadium',
    federation: 'Fédération Française de Football',
    vocabulary: teamVocabulary('football', 'joueur', 'joueurs', 'stade', 'stades', 'buts', 'Le plaisir du jeu, à tous les âges.'),
    demo: {
      facilityName: 'Stade municipal',
      categories: [
        { name: 'U7 - U9', minAge: 6, maxAge: 8, price: 160, medical: 'health_questionnaire', description: 'Découverte du ballon et du jeu à effectif réduit.' },
        { name: 'U10 - U13', minAge: 9, maxAge: 12, price: 180, medical: 'health_questionnaire', description: 'Apprentissage technique et jeu à 8.' },
        { name: 'U14 - U17', minAge: 13, maxAge: 16, price: 200, medical: 'health_questionnaire', description: 'Jeu à 11 et championnat départemental.' },
        { name: 'Seniors', minAge: 18, maxAge: 45, price: 220, medical: 'medical_cert_competition', description: 'Équipe engagée en championnat de district.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Seniors - Match de championnat', daysFromNow: 5, isHome: true, location: 'Stade municipal' },
        { type: 'tournament', title: 'Tournoi des jeunes', daysFromNow: 19, isHome: true, location: 'Stade municipal' },
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
    emoji: '🏀',
    defaultPrimary: '#C2410C',
    defaultSecondary: '#111827',
    themePreset: 'arena',
    federation: 'Fédération Française de Basket-Ball',
    vocabulary: teamVocabulary('basket', 'joueur', 'joueurs', 'gymnase', 'gymnases', 'points', 'Du mini-basket aux seniors.'),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        { name: 'Mini-basket U7 - U9', minAge: 6, maxAge: 8, price: 150, medical: 'health_questionnaire', description: 'Motricité et premiers paniers.' },
        { name: 'U11 - U13', minAge: 9, maxAge: 12, price: 170, medical: 'health_questionnaire', description: 'Fondamentaux et premiers matchs.' },
        { name: 'U15 - U18', minAge: 13, maxAge: 17, price: 190, medical: 'health_questionnaire', description: 'Championnat départemental jeunes.' },
        { name: 'Seniors', minAge: 18, maxAge: 45, price: 210, medical: 'medical_cert_competition', description: 'Équipes seniors et loisirs.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Seniors - Match de championnat', daysFromNow: 6, isHome: true, location: 'Gymnase municipal' },
        { type: 'club_event', title: 'Fête du mini-basket', daysFromNow: 21, isHome: true, location: 'Gymnase municipal' },
      ],
      posts: genericPosts('basket', 'gymnase', 'équipes'),
      products: [{ name: 'Maillot réversible', price: 22, sizes: YOUTH_SIZES }],
    },
  },
  handball: {
    id: 'handball',
    label: 'Handball',
    emoji: '🤾',
    defaultPrimary: '#0F766E',
    defaultSecondary: '#F59E0B',
    themePreset: 'arena',
    federation: 'Fédération Française de Handball',
    vocabulary: teamVocabulary('handball', 'joueur', 'joueurs', 'gymnase', 'gymnases', 'buts', 'Esprit d\'équipe et intensité.'),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        { name: 'Baby hand', minAge: 4, maxAge: 6, price: 120, medical: 'health_questionnaire', description: 'Éveil moteur par le jeu.' },
        { name: '-11 ans', minAge: 7, maxAge: 10, price: 160, medical: 'health_questionnaire', description: 'Premiers matchs et plateaux.' },
        { name: '-15 ans', minAge: 11, maxAge: 14, price: 180, medical: 'health_questionnaire', description: 'Championnat départemental.' },
        { name: 'Seniors', minAge: 18, maxAge: 45, price: 200, medical: 'medical_cert_competition', description: 'Équipes seniors.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Seniors - Match de championnat', daysFromNow: 4, isHome: false, location: 'Gymnase de la ville voisine' },
        { type: 'tournament', title: 'Tournoi -11 ans', daysFromNow: 18, isHome: true, location: 'Gymnase municipal' },
      ],
      posts: genericPosts('handball', 'gymnase', 'équipes'),
      products: [{ name: 'Maillot du club', price: 25, sizes: YOUTH_SIZES }],
    },
  },
  volleyball: {
    id: 'volleyball',
    label: 'Volley-ball',
    emoji: '🏐',
    defaultPrimary: '#1D4ED8',
    defaultSecondary: '#FACC15',
    themePreset: 'arena',
    federation: 'Fédération Française de Volley',
    vocabulary: teamVocabulary('volley', 'joueur', 'joueurs', 'gymnase', 'gymnases', 'sets', 'Smash, passe, réception : rejoignez l\'équipe.'),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        { name: 'M11 - M13', minAge: 8, maxAge: 12, price: 140, medical: 'health_questionnaire', description: 'Initiation au volley.' },
        { name: 'M15 - M18', minAge: 13, maxAge: 17, price: 160, medical: 'health_questionnaire', description: 'Perfectionnement et compétition jeunes.' },
        { name: 'Seniors compétition', minAge: 18, maxAge: 45, price: 180, medical: 'medical_cert_competition', description: 'Championnat régional.' },
        { name: 'Loisirs mixtes', minAge: 18, maxAge: 70, price: 120, medical: 'health_questionnaire', description: 'Pratique détente et convivialité.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Seniors - Match de championnat', daysFromNow: 7, isHome: true, location: 'Gymnase municipal' },
        { type: 'club_event', title: 'Tournoi loisirs de fin d\'année', daysFromNow: 30, isHome: true, location: 'Gymnase municipal' },
      ],
      posts: genericPosts('volley', 'gymnase', 'équipes'),
      products: [{ name: 'Maillot du club', price: 25, sizes: YOUTH_SIZES }],
    },
  },
  rugby: {
    id: 'rugby',
    label: 'Rugby',
    emoji: '🏉',
    defaultPrimary: '#14532D',
    defaultSecondary: '#FDE047',
    themePreset: 'stadium',
    federation: 'Fédération Française de Rugby',
    vocabulary: teamVocabulary('rugby', 'joueur', 'joueurs', 'stade', 'stades', 'points', 'Respect, engagement, solidarité.'),
    demo: {
      facilityName: 'Stade municipal',
      categories: [
        { name: 'École de rugby M6 - M10', minAge: 5, maxAge: 9, price: 150, medical: 'health_questionnaire', description: 'Jeu sans plaquage puis découverte du contact.' },
        { name: 'M12 - M14', minAge: 10, maxAge: 13, price: 170, medical: 'health_questionnaire', description: 'Rugby éducatif et tournois.' },
        { name: 'Cadets - Juniors', minAge: 14, maxAge: 18, price: 190, medical: 'medical_cert_competition', description: 'Championnat territorial.' },
        { name: 'Seniors', minAge: 18, maxAge: 40, price: 220, medical: 'medical_cert_competition', description: 'Équipe première et réserve.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Seniors - Match de championnat', daysFromNow: 5, isHome: true, location: 'Stade municipal' },
        { type: 'tournament', title: 'Tournoi de l\'école de rugby', daysFromNow: 20, isHome: true, location: 'Stade municipal' },
      ],
      posts: genericPosts('rugby', 'stade', 'équipes'),
      products: [{ name: 'Maillot du club', price: 30, sizes: YOUTH_SIZES }],
    },
  },
  tennis: {
    id: 'tennis',
    label: 'Tennis',
    emoji: '🎾',
    defaultPrimary: '#15803D',
    defaultSecondary: '#EA580C',
    themePreset: 'court',
    federation: 'Fédération Française de Tennis',
    vocabulary: individualVocabulary('tennis', 'rencontre', 'rencontres', 'joueur', 'joueurs', 'court', 'courts', 'groupe', 'groupes', 'École de tennis et jeu libre toute l\'année.'),
    demo: {
      facilityName: 'Courts municipaux',
      categories: [
        { name: 'Mini-tennis', minAge: 4, maxAge: 6, price: 150, medical: 'health_questionnaire', description: 'Balles adaptées et terrain réduit.' },
        { name: 'École de tennis', minAge: 7, maxAge: 12, price: 230, medical: 'health_questionnaire', description: 'Cours collectifs hebdomadaires.' },
        { name: 'Ados', minAge: 13, maxAge: 17, price: 250, medical: 'health_questionnaire', description: 'Perfectionnement et compétition.' },
        { name: 'Adultes', minAge: 18, maxAge: 80, price: 280, medical: 'health_questionnaire', description: 'Cours collectifs et accès aux courts.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'tournament', title: 'Tournoi interne', daysFromNow: 10, isHome: true, location: 'Courts municipaux' },
        { type: 'competition', title: 'Rencontre par équipes', daysFromNow: 17, isHome: false, location: 'Club voisin' },
      ],
      posts: genericPosts('tennis', 'club', 'groupes'),
      products: [{ name: 'Polo du club', price: 28, sizes: YOUTH_SIZES }],
    },
  },
  judo: {
    id: 'judo',
    label: 'Judo',
    emoji: '🥋',
    defaultPrimary: '#1E3A8A',
    defaultSecondary: '#DC2626',
    themePreset: 'dojo',
    federation: 'Fédération Française de Judo',
    vocabulary: individualVocabulary('judo', 'compétition', 'compétitions', 'judoka', 'judokas', 'dojo', 'dojos', 'cours', 'cours', 'Code moral, technique et confiance en soi.'),
    demo: {
      facilityName: 'Dojo municipal',
      categories: [
        { name: 'Éveil judo', minAge: 4, maxAge: 5, price: 140, medical: 'health_questionnaire', description: 'Motricité et premières chutes.' },
        { name: 'Mini-poussins - Poussins', minAge: 6, maxAge: 9, price: 170, medical: 'health_questionnaire', description: 'Apprentissage des techniques de base.' },
        { name: 'Benjamins - Minimes', minAge: 10, maxAge: 14, price: 190, medical: 'health_questionnaire', description: 'Progression vers les ceintures de couleur.' },
        { name: 'Adultes', minAge: 15, maxAge: 70, price: 210, medical: 'medical_cert_competition', description: 'Judo, ju-jitsu et taïso.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Tournoi départemental', daysFromNow: 12, isHome: false, location: 'Dojo départemental' },
        { type: 'club_event', title: 'Passage de grades', daysFromNow: 40, isHome: true, location: 'Dojo municipal' },
      ],
      posts: genericPosts('judo', 'dojo', 'cours'),
      products: [{ name: 'Kimono', price: 35, sizes: ['110', '120', '130', '140', '150', '160', '170', '180'] }],
    },
  },
  natation: {
    id: 'natation',
    label: 'Natation',
    emoji: '🏊',
    defaultPrimary: '#0369A1',
    defaultSecondary: '#22D3EE',
    themePreset: 'pool',
    federation: 'Fédération Française de Natation',
    vocabulary: individualVocabulary('natation', 'compétition', 'compétitions', 'nageur', 'nageurs', 'piscine', 'piscines', 'groupe', 'groupes', 'De l\'aisance aquatique à la compétition.'),
    demo: {
      facilityName: 'Piscine municipale',
      categories: [
        { name: 'École de natation', minAge: 6, maxAge: 9, price: 190, medical: 'health_questionnaire', description: 'Aisance aquatique et premières nages.' },
        { name: 'Avenirs - Jeunes', minAge: 10, maxAge: 13, price: 220, medical: 'health_questionnaire', description: 'Apprentissage des quatre nages.' },
        { name: 'Groupe compétition', minAge: 14, maxAge: 25, price: 260, medical: 'medical_cert_competition', description: 'Entraînements intensifs et meetings.' },
        { name: 'Adultes - Maîtres', minAge: 18, maxAge: 80, price: 230, medical: 'health_questionnaire', description: 'Forme, technique et compétitions maîtres.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Meeting départemental', daysFromNow: 9, isHome: false, location: 'Piscine olympique' },
        { type: 'club_event', title: 'Journée portes ouvertes', daysFromNow: 25, isHome: true, location: 'Piscine municipale' },
      ],
      posts: genericPosts('natation', 'bassin', 'groupes'),
      products: [{ name: 'Bonnet du club', price: 8, sizes: ['Unique'] }],
    },
  },
  gymnastique: {
    id: 'gymnastique',
    label: 'Gymnastique',
    emoji: '🤸',
    defaultPrimary: '#7C3AED',
    defaultSecondary: '#F472B6',
    themePreset: 'arena',
    federation: 'Fédération Française de Gymnastique',
    vocabulary: individualVocabulary('gymnastique', 'compétition', 'compétitions', 'gymnaste', 'gymnastes', 'gymnase', 'gymnases', 'groupe', 'groupes', 'Souplesse, équilibre et dépassement de soi.'),
    demo: {
      facilityName: 'Salle de gymnastique',
      categories: [
        { name: 'Baby gym', minAge: 3, maxAge: 5, price: 150, medical: 'health_questionnaire', description: 'Parcours moteurs ludiques.' },
        { name: 'Gym loisirs enfants', minAge: 6, maxAge: 11, price: 190, medical: 'health_questionnaire', description: 'Agrès et acrobaties.' },
        { name: 'Groupe compétition', minAge: 8, maxAge: 18, price: 260, medical: 'medical_cert_competition', description: 'Préparation aux compétitions fédérales.' },
        { name: 'Gym adultes', minAge: 18, maxAge: 80, price: 170, medical: 'health_questionnaire', description: 'Renforcement et entretien.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Compétition départementale', daysFromNow: 14, isHome: false, location: 'Complexe départemental' },
        { type: 'club_event', title: 'Gala de fin de saison', daysFromNow: 45, isHome: true, location: 'Salle de gymnastique' },
      ],
      posts: genericPosts('la gymnastique', 'gymnase', 'groupes'),
      products: [{ name: 'Justaucorps du club', price: 40, sizes: YOUTH_SIZES }],
    },
  },
  athletisme: {
    id: 'athletisme',
    label: 'Athlétisme',
    emoji: '🏃',
    defaultPrimary: '#B91C1C',
    defaultSecondary: '#FBBF24',
    themePreset: 'stadium',
    federation: 'Fédération Française d\'Athlétisme',
    vocabulary: individualVocabulary('athlétisme', 'compétition', 'compétitions', 'athlète', 'athlètes', 'stade', 'stades', 'groupe', 'groupes', 'Courir, sauter, lancer.'),
    demo: {
      facilityName: 'Stade d\'athlétisme',
      categories: [
        { name: 'Éveil athlétique', minAge: 6, maxAge: 9, price: 140, medical: 'health_questionnaire', description: 'Découverte des familles d\'épreuves.' },
        { name: 'Benjamins - Minimes', minAge: 10, maxAge: 14, price: 170, medical: 'health_questionnaire', description: 'Multi-activités et premiers championnats.' },
        { name: 'Cadets à Seniors', minAge: 15, maxAge: 35, price: 190, medical: 'medical_cert_competition', description: 'Spécialisation et compétition.' },
        { name: 'Running loisirs', minAge: 18, maxAge: 80, price: 120, medical: 'health_questionnaire', description: 'Course sur route et santé.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Cross départemental', daysFromNow: 11, isHome: false, location: 'Parc départemental' },
        { type: 'club_event', title: 'Course populaire du club', daysFromNow: 35, isHome: true, location: 'Stade d\'athlétisme' },
      ],
      posts: genericPosts('l\'athlétisme', 'stade', 'groupes'),
      products: [{ name: 'Débardeur du club', price: 25, sizes: YOUTH_SIZES }],
    },
  },
  badminton: {
    id: 'badminton',
    label: 'Badminton',
    emoji: '🏸',
    defaultPrimary: '#0E7490',
    defaultSecondary: '#A3E635',
    themePreset: 'arena',
    federation: 'Fédération Française de Badminton',
    vocabulary: individualVocabulary('badminton', 'rencontre', 'rencontres', 'joueur', 'joueurs', 'gymnase', 'gymnases', 'créneau', 'créneaux', 'Le sport de raquette le plus rapide du monde.'),
    demo: {
      facilityName: 'Gymnase municipal',
      categories: [
        { name: 'Minibad', minAge: 6, maxAge: 8, price: 110, medical: 'health_questionnaire', description: 'Initiation ludique.' },
        { name: 'Jeunes', minAge: 9, maxAge: 17, price: 130, medical: 'health_questionnaire', description: 'École de badminton labellisée.' },
        { name: 'Adultes compétition', minAge: 18, maxAge: 60, price: 150, medical: 'medical_cert_competition', description: 'Interclubs et tournois.' },
        { name: 'Adultes loisirs', minAge: 18, maxAge: 80, price: 120, medical: 'health_questionnaire', description: 'Jeu libre.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'competition', title: 'Interclubs départementaux', daysFromNow: 8, isHome: true, location: 'Gymnase municipal' },
        { type: 'tournament', title: 'Tournoi de double', daysFromNow: 28, isHome: true, location: 'Gymnase municipal' },
      ],
      posts: genericPosts('badminton', 'gymnase', 'créneaux'),
      products: [{ name: 'T-shirt du club', price: 18, sizes: YOUTH_SIZES }],
    },
  },
  danse: {
    id: 'danse',
    label: 'Danse',
    emoji: '💃',
    defaultPrimary: '#9D174D',
    defaultSecondary: '#FBCFE8',
    themePreset: 'studio',
    federation: 'Fédération Française de Danse',
    vocabulary: {
      ...individualVocabulary('danse', 'spectacle', 'spectacles', 'danseur', 'danseurs', 'studio', 'studios', 'cours', 'cours', 'Exprimez-vous en mouvement.'),
      training: 'cours',
      trainings: 'cours',
      coach: 'professeur',
      coaches: 'professeurs',
      license: 'adhésion',
    },
    demo: {
      facilityName: 'Studio de danse',
      categories: [
        { name: 'Éveil', minAge: 4, maxAge: 6, price: 160, medical: 'health_questionnaire', description: 'Rythme et expression corporelle.' },
        { name: 'Classique enfants', minAge: 7, maxAge: 12, price: 220, medical: 'health_questionnaire', description: 'Technique classique.' },
        { name: 'Modern\'jazz ados', minAge: 12, maxAge: 17, price: 240, medical: 'health_questionnaire', description: 'Chorégraphies et spectacle.' },
        { name: 'Adultes', minAge: 18, maxAge: 80, price: 250, medical: 'health_questionnaire', description: 'Tous niveaux.' },
      ],
      schedules: SIX_SLOTS,
      events: [
        { type: 'club_event', title: 'Spectacle de Noël', daysFromNow: 45, isHome: true, location: 'Salle des fêtes' },
        { type: 'competition', title: 'Rencontres chorégraphiques', daysFromNow: 60, isHome: false, location: 'Théâtre départemental' },
      ],
      posts: genericPosts('la danse', 'studio', 'cours'),
      products: [{ name: 'Tenue de spectacle', price: 35, sizes: YOUTH_SIZES }],
    },
  },
};

export const SPORT_IDS = Object.keys(SPORTS_PRESETS);

/** Renvoie le preset du sport, ou un preset générique « multisport » si inconnu. */
export function getSportPreset(sportType: string | null | undefined): SportPreset {
  if (sportType && SPORTS_PRESETS[sportType]) return SPORTS_PRESETS[sportType];
  return {
    ...SPORTS_PRESETS.football,
    id: 'multisport',
    label: 'Multisport',
    emoji: '🏅',
    themePreset: 'arena',
    federation: '',
    vocabulary: individualVocabulary('sport', 'rencontre', 'rencontres', 'adhérent', 'adhérents', 'salle', 'salles', 'groupe', 'groupes', 'Le sport pour tous.'),
  };
}

/** Années de naissance d'une catégorie de démo pour une saison « 2026-2027 ». */
export function birthYearsForSeason(season: string, cat: Pick<DemoCategory, 'minAge' | 'maxAge'>) {
  const startYear = Number(season.slice(0, 4));
  return { min_birth_year: startYear - cat.maxAge, max_birth_year: startYear - cat.minAge };
}

export const DAY_LABELS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'] as const;
