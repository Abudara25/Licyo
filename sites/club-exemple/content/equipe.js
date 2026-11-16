// Le Club (/equipe).
import { linkVariant, org, orgIf } from '../../segments.js';
import { joinUsBanner } from './shared.js';

// Une carte par catégorie (une année de naissance chacune depuis le 2026-11-12).
const groupCard = (slug, name, year, age, description) => ({
  bind: [['data-org-if', `group.${slug}.name`]],
  titleBind: [['data-org', `group.${slug}.name`]],
  title: [name],
  text: [`${age}, nés en `, org(`group.${slug}.yearMin`, year), ` · ${description}`],
});

export const sections = [
  {
    type: 'content',
    id: 'equipe.mission',
    comment: 'Mission / Encadrement',
    background: 'photo',
    image: 'assets/images/photo-filet-but.jpg',
    layout: 'split',
    align: 'start',
    columns: [
      {
        type: 'group',
        children: [
          {
            type: 'heading',
            layout: 'none',
            eyebrow: 'Notre mission',
            title: ['Un club ouvert à tous les enfants de la ville'],
            sub: [
              "Le Club Exemple est né d'un constat simple : trop d'enfants de la ville n'avaient pas trouvé de place dans les clubs existants. Ici, chaque enfant trouve sa place, quel que soit son niveau.",
            ],
          },
          { type: 'text', content: ["Notre priorité n'est pas la compétition mais le plaisir de jouer, ensemble, dans un cadre familial et bienveillant."] },
        ],
      },
      {
        type: 'profile_card',
        eyebrow: "L'encadrement",
        initial: 'P',
        name: 'Le Président',
        role: 'Fondateur du club',
        points: ["Certificat Fédéral d'Initiateur, délivré par la FFF", "3 ans de pratique dans l'encadrement d'un club de football"],
      },
    ],
  },
  {
    type: 'content',
    id: 'equipe.categories',
    comment: 'Catégories',
    background: 'cream',
    blocks: [
      {
        type: 'heading',
        bind: [['data-org-if', 'groups.any']],
        eyebrow: 'Nos catégories',
        titleBind: [['data-org-list', 'groups-names']],
        title: ['U6, U7, U8 et U9'],
        sub: [
          'Nos catégories de la saison, ouvertes aux filles comme aux garçons',
          orgIf(
            'schedule.single',
            ' et réunies sur un même créneau. Si la demande est au rendez-vous, un créneau supplémentaire pourra être envisagé dès la saison suivante'
          ),
          '.',
        ],
      },
      {
        type: 'cards',
        reveal: 'items',
        items: [
          groupCard('u6', 'U6', '2021', '5 ans', 'Découverte du ballon, motricité et plaisir avant tout.'),
          groupCard('u7', 'U7', '2020', '6 ans', 'Premiers jeux à plusieurs, coordination et plaisir de jouer.'),
          groupCard('u8', 'U8', '2019', '7 ans', 'Premiers pas vers le jeu collectif, dans la bonne humeur.'),
          groupCard('u9', 'U9', '2018', '8 ans', 'Jeu collectif, passes et premiers repères sur le terrain.'),
        ],
      },
      {
        type: 'text',
        variant: 'centered-note',
        content: [
          orgIf(
            'price.season',
            'Adhésion : ',
            { bind: { tag: 'strong', variant: 'accent', attrs: [['data-org', 'price.season']], children: ['180 €'] } },
            " la saison, licence et tenue complète incluses (maillot, short, survêtement, sac). Pass'Sport accepté (50 € de moins). "
          ),
          linkVariant('card', '/inscription', 'Inscrire mon enfant'),
        ],
      },
    ],
  },
  {
    type: 'content',
    id: 'equipe.benevoles',
    comment: 'Appel aux bénévoles',
    background: 'maroon',
    blocks: [
      {
        type: 'heading',
        eyebrow: '100% bénévole',
        title: ['Le bureau se construit avec vous'],
        sub: [
          'Le club grandit et a besoin de bonnes volontés : éducateurs, dirigeants, parents motivés. Chaque profil compte pour faire vivre cette première saison.',
        ],
        children: [{ type: 'button', href: '/contact', label: 'Devenir bénévole', style: 'primary', placement: 'centered' }],
      },
    ],
  },
  { type: 'content', id: 'equipe.cta', comment: 'CTA', background: 'cream', tight: true, blocks: [joinUsBanner] },
];

