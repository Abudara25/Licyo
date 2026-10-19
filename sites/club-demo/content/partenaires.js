// Partenaires.
import { accent } from '../../segments.js';
import { EMAIL, partners } from './shared.js';

const card = (title, text) => ({ title: [title], text: [text] });
const need = (number, title, text) => ({ number, title: [title], text: [text] });

export const sections = [
  {
    type: 'content',
    id: 'partenaires.soutiens',
    comment: 'Nos partenaires',
    background: 'cream',
    blocks: [
      {
        type: 'heading',
        eyebrow: 'Ils nous soutiennent',
        title: ['Nos partenaires'],
        sub: ['Merci à ceux qui accompagnent le club dès sa première saison. Sportéquip fournit les tenues que portent nos joueurs sur le terrain.'],
      },
      { type: 'partners', items: partners },
    ],
  },
  {
    type: 'content',
    id: 'partenaires.presentation',
    comment: 'Qui sommes-nous',
    background: 'surface',
    blocks: [
      {
        type: 'heading',
        layout: 'start',
        eyebrow: 'Qui sommes-nous',
        title: ['Un club neuf, une énergie rare'],
        sub: [
          "Le Club Démo est né en 2020 dans le Club de démonstration. Porté par des passionnés, il se prépare à accueillir ses premiers joueurs et leurs familles autour d'un même projet : faire vivre le football local, transmettre des valeurs de respect, de collectif et de dépassement de soi.",
        ],
      },
      { type: 'image', ratio: '21/9', src: 'assets/images/photo-ballon-premium.jpg', alt: 'Ballon de football en clair-obscur', width: 1200, height: 514 },
      {
        type: 'text',
        variant: 'muted-wide',
        reveal: true,
        content: [
          "Comme tout club qui démarre, notre plus grand défi est financier. Nous devons équiper nos futures catégories, acheter du matériel d'entraînement, offrir de véritables maillots à nos premiers joueurs et disposer d'un terrain digne de ce nom pour progresser. C'est là que votre soutien change tout : grâce à des partenaires engagés, nous offrons aux jeunes du territoire un cadre de jeu de qualité — et à votre entreprise une visibilité forte auprès d'une communauté locale grandissante.",
        ],
      },
      {
        type: 'cards',
        variant: 'stat',
        columns: 3,
        reveal: 'grid',
        items: [card('2020', 'Année de création'), card('100%', 'Bénévole & associatif'), card('95', "Loi 1901 · Club de démonstration")],
      },
      {
        type: 'callout',
        variant: 'dark-lead',
        eyebrow: 'Notre ambition',
        content: [
          "Être présent pour les enfants de Sportville : leur offrir un club où grandir, s'épanouir et prendre du plaisir sur le terrain, dans les meilleures conditions et avec les bonnes valeurs.",
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'partenaires.besoins',
    comment: 'Nos besoins concrets',
    background: 'cream',
    blocks: [
      {
        type: 'heading',
        layout: 'start',
        eyebrow: 'Où va votre soutien',
        title: ['Nos besoins concrets'],
        sub: ['Chaque euro versé finance directement le développement du club. Voici où va votre contribution.'],
      },
      {
        type: 'info_list',
        reveal: true,
        items: [
          need(
            '1',
            'Maillots & équipements',
            "Doter chaque catégorie de jeux de maillots complets, shorts, chaussettes et survêtements aux couleurs du club — un signe de fierté et d'appartenance pour nos futurs joueurs."
          ),
          need('2', 'Matériel sportif', "Ballons, plots, chasubles, buts mobiles, trousses de soin et matériel d'entraînement pour faire progresser nos catégories dans de bonnes conditions."),
          need('3', "Location d'un terrain", "Financer la location d'un terrain (terrain synthétique, gymnase) pour permettre à nos catégories de s'entraîner toute la saison."),
          need('4', 'Vie du club', 'Organiser tournois, événements et moments de convivialité qui font grandir la communauté autour du club et animent le quartier.'),
        ],
      },
      {
        type: 'callout',
        variant: 'accent',
        content: [
          accent('Chaque don compte.'),
          " Qu'il s'agisse d'un soutien financier, d'un don de matériel ou d'une prise en charge d'équipement, toute contribution nous aide à franchir un cap.",
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'partenaires.contreparties',
    comment: 'Vos contreparties',
    background: 'surface',
    blocks: [
      {
        type: 'heading',
        layout: 'start',
        eyebrow: 'Ce que nous vous offrons',
        title: ['Vos contreparties'],
        sub: ['Nous construisons chaque partenariat sur mesure, selon votre engagement. Voici les visibilités que nous proposons.'],
      },
      {
        type: 'cards',
        reveal: 'grid',
        items: [
          card('Logo sur les maillots', 'Votre marque portée sur le terrain par nos futurs jeunes joueurs — la visibilité la plus forte et la plus fière.'),
          card('Visibilité réseaux', 'Présence sur nos réseaux sociaux : publications de remerciement et mise en avant de nos partenaires auprès de notre communauté.'),
          card('Logo sur nos supports', 'Votre logo sur notre site, nos affiches et nos supports de communication tout au long de la saison.'),
          card('Événements & tournois', 'Votre marque associée à nos tournois et moments forts du club, au plus près des familles et des jeunes du quartier.'),
        ],
      },
      {
        type: 'callout',
        variant: 'dark',
        eyebrow: 'Partenariat sur mesure',
        content: [
          'Chaque soutien est unique. Don financier, matériel ou équipement : nous construisons ensemble une contrepartie à la hauteur de votre engagement, et vous mettons en avant comme il se doit auprès de notre communauté.',
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'partenaires.cta',
    comment: 'CTA',
    background: 'cream',
    tight: true,
    blocks: [
      {
        type: 'cta_banner',
        title: 'Prêt(e) à nous rejoindre ?',
        text: [
          'Discutons ensemble de la manière dont votre entreprise peut soutenir le Club Démo. Chaque partenariat est construit sur mesure, à la hauteur de votre engagement.',
        ],
        actions: [
          { href: 'tel:+33600000000', label: '06 00 00 00 00', track: 'phone_click' },
          { href: `mailto:${EMAIL}`, label: 'Nous écrire' },
        ],
      },
    ],
  },
];
