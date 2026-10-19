// Pré-inscription U10 : liste d'intérêt d'un futur groupe (le balisage, les champs et le script sont fixés par
// renderer/preregistration.js ; plafond, années et ouverture réglés dans /admin/preinscriptions).
import { link, strong } from '../../segments.js';
import { orgEmail } from './shared.js';

export const sections = [
  {
    type: 'preregistration',
    id: 'pre-inscription-u10.formulaire',
    contactHref: '/contact',
    registrationHref: '/inscription',
    capacity: 15,
    sizes: ['4 ans', '6 ans', '8 ans', '10 ans', '12 ans'],
    asideItems: [
      ['Pour les enfants nés en ', strong('2017'), ', filles et garçons'],
      ['Gratuit et sans engagement : rien à payer ni à envoyer aujourd\'hui'],
      ['Le groupe ouvre dès qu\'il y a assez d\'enfants'],
      ['Nous vous recontactons pour l\'inscription définitive'],
    ],
    texts: {
      eyebrow: 'Futur groupe U10',
      title: 'Pré-inscrire mon enfant',
      intro: [
        'Le groupe U10 n\'est pas encore ouvert : il démarrera quand assez d\'enfants seront intéressés. Laissez-nous vos coordonnées, cela prend une minute.',
      ],
      childFirstName: { label: 'Prénom de l\'enfant', placeholder: 'Prénom' },
      childLastName: { label: 'Nom de l\'enfant', placeholder: 'Nom' },
      birthDate: { label: 'Date de naissance', hint: ['Groupe réservé aux enfants nés en 2017.'] },
      age: {
        young: 'Votre enfant, né(e) en {annee}, est trop jeune pour le groupe {groupe}.',
        old: 'Votre enfant, né(e) en {annee}, est trop âgé(e) pour le groupe {groupe}.',
        category: "Bonne nouvelle : il ou elle peut déjà s'inscrire en {categorie}.",
        none: "Nous n'avons pas encore de groupe pour son âge : écrivez-nous, nous en parlerons ensemble.",
        inscription: "Aller au formulaire d'inscription",
        contact: 'Nous contacter',
      },
      birthCountry: { label: 'Pays de naissance', placeholder: 'Pays' },
      birthCity: { label: 'Ville de naissance', placeholder: 'Ville de naissance' },
      size: {
        label: 'Taille de maillot',
        placeholder: 'Choisir une taille',
        hint: ['Tenue Sportéquip (maillot, short, survêtement, sac) — taille approximative, à ajuster si besoin.'],
      },
      parentFirstName: { label: 'Prénom du parent', placeholder: 'Prénom' },
      parentLastName: { label: 'Nom du parent', placeholder: 'Nom' },
      email: { label: 'E-mail (parent)', placeholder: 'vous@exemple.fr' },
      phone: { label: 'Téléphone (parent)', placeholder: '06 12 34 56 78' },
      secondParent: {
        summary: 'Ajouter un second responsable légal',
        optional: '(facultatif)',
        firstName: { label: 'Prénom du 2e responsable', placeholder: 'Prénom' },
        lastName: { label: 'Nom du 2e responsable', placeholder: 'Nom' },
        email: { label: 'E-mail (2e responsable)', placeholder: 'autre@exemple.fr' },
        phone: { label: 'Téléphone (2e responsable)', placeholder: '06 12 34 56 78' },
        hint: "Il recevra aussi l'e-mail de confirmation et nos nouvelles du groupe U10.",
      },
      comment: { label: 'Un message pour le club', optional: '(facultatif)', placeholder: 'Ex. : déjà joué en club, disponibilités…' },
      consentPrivacy: [
        'J\'accepte que le club conserve ces informations pour me recontacter au sujet du groupe U10 (',
        link('/confidentialite', 'politique de confidentialité'),
        ').',
      ],
      note: ['Ce n\'est pas encore une inscription : la place sera confirmée à l\'ouverture du groupe, avec le dossier et le paiement.'],
      submit: 'Envoyer la pré-inscription',
      success: {
        title: 'Pré-inscription enregistrée, merci !',
        text: ['Un e-mail de confirmation vient de vous être envoyé. Nous vous recontacterons dès que le groupe U10 ouvrira. Pensez à vérifier vos courriers indésirables.'],
      },
      full: {
        title: 'Les 15 places sont prises',
        text: ['La liste de pré-inscription U10 est complète. Écrivez-nous à ', orgEmail, ' : nous vous préviendrons si une place se libère.'],
        button: 'Nous contacter',
      },
      opened: {
        title: 'Le groupe U10 est ouvert !',
        text: ["Assez d'enfants se sont pré-inscrits : le groupe U10 ouvre. Inscrivez votre enfant directement avec le formulaire d'inscription (dossier, photo et paiement)."],
        button: 'Inscrire mon enfant',
      },
      closed: {
        title: 'Pré-inscription fermée',
        text: ['La pré-inscription U10 n\'est pas ouverte pour le moment. Une question ? Écrivez-nous à ', orgEmail, '.'],
        button: 'Nous contacter',
      },
      aside: {
        label: 'Places disponibles',
        kicker: 'Places disponibles',
        remainingOne: 'place restante',
        remainingMany: 'places restantes',
        of: 'sur',
        help: ['Une question ? ', orgEmail, '. Votre enfant est né en 2018 ou après ? Direction la ', link('/inscription', 'page Inscription'), '.'],
      },
    },
  },
];
