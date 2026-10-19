// Contact.
import { linkVariant, org, orgIf } from '../../segments.js';
import { mapLabels, orgEmail } from './shared.js';

export const sections = [
  {
    type: 'content',
    id: 'contact.main',
    background: 'surface',
    layout: 'split',
    align: 'start',
    columns: [
      {
        type: 'group',
        children: [
          {
            type: 'heading',
            layout: 'none',
            eyebrow: 'Écrivez-nous',
            title: ['Envoyer un message'],
            sub: ['Bénévolat, partenariat ou simple question : dites-nous en plus.'],
          },
          {
            type: 'contact_form',
            name: { label: 'Votre nom', placeholder: 'Prénom Nom' },
            email: { label: 'E-mail', placeholder: 'vous@exemple.fr' },
            subject: { label: 'Sujet', options: ['Je souhaite devenir bénévole', 'Devenir partenaire / sponsor', 'Autre demande'] },
            message: { label: 'Message', placeholder: 'Une question, une précision...' },
            consent: [
              "J'accepte que ces informations soient utilisées uniquement pour traiter ma demande (voir notre ",
              linkVariant('new-tab', '/confidentialite', 'politique de confidentialité'),
              ').',
            ],
            submit: 'Envoyer mon message',
            sent: { title: 'Message envoyé', text: 'Merci ! Nous vous répondrons par e-mail sous 48 h.' },
          },
        ],
      },
      {
        type: 'group',
        children: [
          { type: 'heading', layout: 'none', eyebrow: 'Infos pratiques', title: ['Nous trouver'] },
          {
            type: 'info_list',
            items: [
              {
                icon: 'pin',
                bind: [['data-org-if', 'location.name']],
                titleBind: [['data-org', 'location.name']],
                title: ['Stade municipal'],
                textBind: [['data-org', 'location.address'], ['data-org-if', 'location.address']],
                text: ["1 rue du Stade, 00000 Sportville"],
              },
              {
                icon: 'clock',
                bind: [['data-org-if', 'schedule.any']],
                titleBind: [['data-org-list', 'slots-title']],
                title: [org('schedule.Day', 'Jeudi'), ', ', org('schedule.start', '17h'), ' – ', org('schedule.end', '18h')],
                text: [
                  'Premier entraînement le 10 septembre 2026.',
                  orgIf(
                    'schedule.single',
                    " Un second créneau (jour non fixé) est envisagé dès la saison suivante, sous réserve d'assez d'adhérents pour financer la location d'un terrain supplémentaire"
                  ),
                ],
              },
              { icon: 'mail', bind: [['data-org-if', 'org.email']], title: ['E-mail'], text: [orgEmail, ' — Réponse sous 48h'] },
              {
                icon: 'phone',
                bind: [['data-org-if', 'org.phone']],
                title: ['Téléphone'],
                text: [{ link: { href: 'tel:+33600000000', bind: [['data-org', 'org.phone'], ['data-org-attr', 'href:org.tel']], children: ['06 00 00 00 00'] } }],
              },
            ],
          },
          { type: 'map', labels: mapLabels },
        ],
      },
    ],
  },
];
