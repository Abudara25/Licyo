// Le Club (/equipe).
import { linkVariant, org, orgIf } from '../../segments.js';
import { joinUsBanner } from './shared.js';

const groupCard = (slug, name, yearMin, yearMax, description, age) => ({
  bind: [['data-org-if', `group.${slug}.name`]],
  titleBind: [['data-org', `group.${slug}.name`]],
  title: [name],
  text: [`${age}, nés en `, org(`group.${slug}.yearMin`, yearMin), ' ou ', org(`group.${slug}.yearMax`, yearMax), ` · ${description}`],
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
              "Le Club Démo est né d'un constat simple : trop d'enfants de la ville n'avaient pas trouvé de place dans les clubs existants. Ici, chaque enfant trouve sa place, quel que soit son niveau.",
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
        title: ['U6-U7 et U8-U9'],
        sub: [
          'Le club ouvre ses deux premières catégories dès cette saison, ouvertes aux filles comme aux garçons',
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
          groupCard('u6-u7', 'U6 - U7', '2020', '2021', 'Découverte du jeu, motricité et plaisir avant tout.', '5-6 ans'),
          groupCard('u8-u9', 'U8 - U9', '2018', '2019', 'Premiers pas vers le jeu collectif, dans la bonne humeur.', '7-8 ans'),
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
            " la saison, licence et tenue complète Sportéquip incluses (maillot, short, survêtement, sac). Pass'Sport accepté (50 € de moins). "
          ),
          'Places limitées cette saison. ',
          linkVariant('card', '/inscription', 'Inscrire mon enfant'),
        ],
      },
      {
        type: 'text',
        variant: 'centered-note',
        content: [
          "Votre enfant est né en 2017 ? Un groupe U10 (15 places) est en projet : il ouvrira dès qu'assez d'enfants seront intéressés. ",
          linkVariant('card', '/pre-inscription-u10', 'Le pré-inscrire'),
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
          'Le club démarre et a besoin de bonnes volontés : éducateurs, dirigeants, parents motivés. Chaque profil compte pour faire grandir cette première saison.',
        ],
        children: [{ type: 'button', href: '/contact', label: 'Devenir bénévole', style: 'primary', placement: 'centered' }],
      },
    ],
  },
  { type: 'content', id: 'equipe.cta', comment: 'CTA', background: 'cream', tight: true, blocks: [joinUsBanner] },
];

