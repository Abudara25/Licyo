// Entraînements.
import { accent, br, link, nowrap, org, orgIf, orgList, strong } from '../../segments.js';
import { mapLabels } from './shared.js';

const ADDRESS = "1 rue du Stade, 00000 Sportville";
const STADIUM = 'Stade municipal';

export const sections = [
  {
    type: 'content',
    id: 'entrainements.creneaux',
    comment: 'Créneaux',
    background: 'surface',
    blocks: [
      { type: 'heading', layout: 'start', eyebrow: 'Cette saison', title: ['Nos créneaux'] },
      {
        type: 'cards',
        reveal: 'items',
        items: [
          {
            bind: [['data-org-if', 'schedule.any'], ['data-org-cards', 'slots']],
            badge: {
              bind: [['data-org-list', 'groups-badge'], ['data-org-if', 'groups.any']],
              content: [nowrap('U6-U7'), ' & ', nowrap('U8-U9'), ' · ', nowrap('nés de 2018 à 2021')],
            },
            titleBind: [['data-org-list', 'slots-title']],
            title: [org('schedule.Day', 'Jeudi'), ', ', org('schedule.startLong', '17h00'), ' – ', org('schedule.endLong', '18h00')],
            text: [
              'Créneau confirmé pour la saison 2026-2027',
              orgIf('location.name', ', au ', org('location.name', STADIUM)),
              '. Premier entraînement : ',
              strong('jeudi 10 septembre 2026'),
              '.',
            ],
          },
          {
            bind: [['data-org-if', 'schedule.single']],
            badge: { content: ['Saison suivante'] },
            title: ['Un second créneau ?'],
            text: [
              "Aucun jour n'est fixé pour l'instant : un second créneau nécessite de louer un terrain supplémentaire, ce qui dépend du nombre d'adhérents rejoignant le club cette saison.",
            ],
          },
        ],
      },
      {
        type: 'callout',
        variant: 'note',
        content: [
          accent("Une séance d'essai gratuite est possible avant de s'inscrire."),
          br,
          "Venez découvrir un entraînement avec votre enfant, sans engagement, pour voir si l'aventure lui plaît.",
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'entrainements.lieu',
    comment: 'Lieu',
    background: 'cream',
    blocks: [
      {
        type: 'heading',
        eyebrow: 'Où nous trouver',
        titleBind: [['data-org', 'location.name']],
        title: [STADIUM],
        subBind: [['data-org', 'location.address'], ['data-org-if', 'location.address']],
        sub: [ADDRESS],
      },
      { type: 'map', variant: 'wide', labels: mapLabels },
    ],
  },
  {
    type: 'content',
    id: 'entrainements.prevoir',
    comment: "Ce qu'il faut prévoir",
    background: 'cream',
    blocks: [
      { type: 'heading', eyebrow: 'Avant de venir', title: ["Ce qu'il faut prévoir"] },
      {
        type: 'image',
        ratio: '16/9',
        src: 'assets/images/photo-entrainement-plots.jpg',
        alt: "Plots et échelle de rythme installés sur un terrain d'entraînement",
        width: 1200,
        height: 675,
      },
      {
        type: 'info_list',
        layout: 'compact',
        width: 'narrow',
        reveal: true,
        items: [
          {
            icon: 'shirt',
            title: ['Une tenue adaptée à la météo'],
            text: ['La saison est longue : prévoyez plusieurs couches en hiver et une tenue légère en cas de forte chaleur.'],
          },
          {
            icon: 'shoe',
            title: ['Des chaussures adaptées'],
            text: ["Plutôt des stabilisés (« stabils ») ou des crampons moulés que des baskets, selon l'état du terrain."],
          },
          { icon: 'drop', title: ["Une gourde d'eau"], text: ['Et beaucoup de bonne humeur !'] },
          {
            icon: 'shield-check',
            title: ['Votre confiance envers les coachs'],
            text: [
              "Vos encouragements depuis le bord du terrain font toujours plaisir : les coachs se chargent d'animer la séance, pour que chaque enfant en profite pleinement.",
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'entrainements.faq',
    comment: 'FAQ',
    background: 'surface',
    blocks: [
      { type: 'heading', eyebrow: 'Questions fréquentes', title: ['Tout savoir avant de venir'] },
      {
        type: 'faq',
        items: [
          {
            bind: [['data-org-if', 'groups.any']],
            question: 'Quel âge faut-il pour rejoindre le Club Démo ?',
            answer: [
              'Filles et garçons sont les bienvenus : ',
              orgList('groups-sentence', 'le club accueille les enfants nés en 2020 ou 2021 en catégorie U6-U7 et ceux nés en 2018 ou 2019 en catégorie U8-U9'),
              ', pour la saison 2026-2027.',
            ],
          },
          {
            bind: [['data-org-if', 'schedule.any']],
            question: 'Où et quand ont lieu les entraînements ?',
            answerBind: [['data-org-list', 'slots-sentence']],
            answer: [
              'Tous les ',
              org('schedule.days', 'jeudis'),
              ' de ',
              org('schedule.start', '17h'),
              ' à ',
              org('schedule.end', '18h'),
              orgIf('location.name', ' au ', org('location.name', STADIUM), orgIf('location.address', ', ', org('location.address', ADDRESS))),
              '.',
            ],
          },
          {
            question: "Puis-je assister à un entraînement avant d'inscrire mon enfant ?",
            answer: ["Oui, une séance d'essai gratuite et sans engagement est possible avant de s'inscrire."],
          },
          {
            bind: [['data-org-if', 'price.season']],
            question: "Quel est le prix de l'adhésion ?",
            answer: [
              org('price.season', '180 €'),
              ' la saison, licence et tenue complète incluses (maillot, short, survêtement, sac). Nous acceptons le ',
              strong("Pass'Sport"),
              ' : 50 € de moins, dès 6 ans et sous conditions de ressources.',
            ],
          },
          {
            question: 'Comment inscrire mon enfant au club ?',
            answer: ['En ligne via le ', link('/inscription', "formulaire d'inscription"), ' du site, avec paiement par HelloAsso, chèque ou espèces.'],
          },
          {
            bind: [['data-org-if', 'schedule.single']],
            question: "Le club propose-t-il un second créneau d'entraînement ?",
            answer: [
              'Pas pour cette saison : un seul créneau (',
              org('schedule.day', 'jeudi'),
              ' ',
              org('schedule.start', '17h'),
              '-',
              org('schedule.end', '18h'),
              ") est disponible. Un second créneau est envisagé pour une saison suivante, selon le nombre d'adhérents et la possibilité de louer un terrain supplémentaire.",
            ],
          },
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'entrainements.cta',
    comment: 'CTA',
    background: 'surface',
    tight: true,
    blocks: [
      {
        type: 'cta_banner',
        title: 'Prêt(e) à nous rejoindre ?',
        text: ['Inscrivez votre enfant ou venez simplement découvrir un entraînement.'],
        actions: [{ href: '/inscription', label: 'Inscrire mon enfant' }],
      },
    ],
  },
];
