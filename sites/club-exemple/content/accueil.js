// Accueil : sections qui suivent le bandeau d'accueil.
import { org, orgIf } from '../../segments.js';
import { joinUsBanner } from './shared.js';

const valueCard = (title, text) => ({ title: [title], text: [text] });

export const sections = [
  {
    type: 'content',
    id: 'accueil.premiers-entrainements',
    comment: 'Premiers entraînements',
    background: 'photo',
    image: 'assets/images/photo-entrainement-bg.webp',
    blocks: [
      {
        type: 'heading',
        reveal: true,
        eyebrow: 'Rejoignez-nous',
        title: ['Venez faire un essai'],
        sub: ["Saison 2026-2027 en cours : venez découvrir un entraînement avec votre enfant. La première séance est gratuite et sans engagement."],
      },
      {
        type: 'panel',
        children: [
          {
            type: 'info_list',
            items: [
              {
                icon: 'clock',
                bind: [['data-org-if', 'schedule.any']],
                titleBind: [['data-org-list', 'slots-title']],
                title: ['Tous les ', org('schedule.days', 'jeudis'), ', ', org('schedule.start', '17h'), ' – ', org('schedule.end', '18h')],
                text: ["Séance d'essai gratuite, sans engagement"],
              },
              {
                icon: 'pin',
                bind: [['data-org-if', 'location.name']],
                titleBind: [['data-org', 'location.name']],
                title: ['Stade municipal'],
                textBind: [['data-org', 'location.address'], ['data-org-if', 'location.address']],
                text: ["1 rue du Stade, 99999 Demoville"],
              },
            ],
          },
          { type: 'button', href: '/inscription', label: 'Inscrire mon enfant', style: 'primary', placement: 'start' },
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'accueil.actualites',
    comment: 'Actualités',
    background: 'surface',
    blocks: [
      { type: 'heading', reveal: true, eyebrow: 'Vie du club', title: ['Actualités'], sub: ['Retrouvez les dernières nouvelles du Club Exemple.'] },
      {
        type: 'news_feed',
        variant: 'teaser',
        empty: {
          text: ['Le club vient de se lancer : les premières actus seront publiées très prochainement.'],
          link: { href: '/actualites', label: 'Voir la page actualités' },
        },
        limit: 3,
        more: { href: '/actualites', label: 'Voir toutes les actualités' },
      },
    ],
  },
  {
    type: 'content',
    id: 'accueil.valeurs',
    comment: 'Un club, des valeurs',
    background: 'maroon',
    layout: 'split',
    align: 'center',
    columns: [
      {
        type: 'group',
        children: [
          {
            type: 'heading',
            layout: 'none',
            eyebrow: 'Depuis 2020',
            title: ['Un club, des valeurs'],
            sub: [
              "Né du constat que trop d'enfants de la ville n'avaient pas trouvé leur place dans les clubs existants, le Club Exemple mise sur le plaisir de jouer avant la compétition, dans une ambiance familiale portée par des bénévoles.",
            ],
          },
          { type: 'button', href: '/equipe', label: 'Découvrir notre mission', style: 'primary', placement: 'spaced' },
        ],
      },
      {
        type: 'cards',
        variant: 'soft',
        reveal: 'grid',
        items: [
          valueCard('Plaisir', "Le jeu avant tout, pour progresser en s'amusant."),
          valueCard('Inclusion', 'Une place pour chaque enfant, quel que soit son niveau.'),
          valueCard('Bénévolat', 'Un club fondé et animé à 100% par des passionnés.'),
          valueCard('Famille', 'Une ambiance conviviale, pensée pour petits et parents.'),
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'accueil.partenaires',
    comment: 'Partenaires & Sponsors',
    background: 'surface',
    layout: 'split',
    align: 'center',
    columns: [
      {
        type: 'group',
        children: [
          {
            type: 'heading',
            layout: 'none',
            eyebrow: 'Partenaires & Sponsors',
            title: ['Devenez partenaire du club'],
            sub: [
              "Le Club Exemple vit sa première saison et recherche des commerces et entreprises de la ville pour l'accompagner dans son développement.",
            ],
          },
          {
            type: 'text',
            variant: 'muted',
            content: ['En devenant partenaire, vous soutenez le sport et la jeunesse de Demoville tout en gagnant en visibilité auprès des familles du club.'],
          },
          { type: 'button', href: '/partenaires', label: 'Découvrir le dossier', style: 'primary', placement: 'spaced' },
        ],
      },
      {
        type: 'info_list',
        reveal: true,
        items: [
          { icon: 'tag', title: ['Logo sur le site et les supports du club'], text: ['Une visibilité durable auprès des familles du club.'] },
          { icon: 'megaphone', title: ['Mise en avant sur les réseaux sociaux'], text: ['Mentions et remerciements auprès de la communauté du club.'] },
          { icon: 'people', title: ['Présence lors des événements du club'], text: ['Séances découverte et moments de vie associative.'] },
        ],
      },
    ],
  },
  { type: 'content', id: 'accueil.cta', comment: 'CTA', background: 'cream', blocks: [joinUsBanner] },
];
