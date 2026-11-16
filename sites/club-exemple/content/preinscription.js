// Pré-inscription : liste d'intérêt des futurs groupes (le balisage, les champs et le script sont fixés par
// renderer/preregistration.js ; groupes, plafonds, années et ouverture réglés dans /admin/preinscriptions).
// Plusieurs groupes depuis le 2026-11-04 : le groupe est choisi d'après l'année de naissance et la liste des groupes
// (avec leurs places) est affichée par le script ; les textes restent donc génériques.
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
      ['Filles et garçons : le groupe dépend de ', strong("l'année de naissance")],
      ['Gratuit et sans engagement : rien à payer ni à envoyer aujourd\'hui'],
      ['Chaque groupe ouvre dès qu\'il y a assez d\'enfants'],
      ['Nous vous recontactons pour l\'inscription définitive'],
    ],
    texts: {
      eyebrow: 'Futurs groupes',
      title: 'Pré-inscrire mon enfant',
      intro: [
        'Ces groupes ne sont pas encore ouverts : chacun démarrera quand assez d\'enfants seront intéressés. Laissez-nous vos coordonnées, cela prend une minute.',
      ],
      childFirstName: { label: 'Prénom de l\'enfant', placeholder: 'Prénom' },
      childLastName: { label: 'Nom de l\'enfant', placeholder: 'Nom' },
      birthDate: { label: 'Date de naissance', hint: ['Le groupe est choisi d\'après l\'année de naissance.'] },
      age: {
        young: 'Votre enfant, né(e) en {annee}, est trop jeune pour les groupes en pré-inscription ({groupe}).',
        old: 'Votre enfant, né(e) en {annee}, est trop âgé(e) pour les groupes en pré-inscription ({groupe}).',
        category: "Bonne nouvelle : il ou elle peut déjà s'inscrire en {categorie}.",
        none: "Nous n'avons pas encore de groupe pour son âge : écrivez-nous, nous en parlerons ensemble.",
        inscription: "Aller au formulaire d'inscription",
        contact: 'Nous contacter',
        full: 'Les places de pré-inscription du groupe {groupe} sont toutes prises. Écrivez-nous : nous vous préviendrons si une place se libère.',
        closed: "La pré-inscription du groupe {groupe} n'est pas ouverte pour le moment. Une question ? Écrivez-nous.",
        opened: "Bonne nouvelle : le groupe {groupe} est ouvert. Inscrivez votre enfant directement avec le formulaire d'inscription.",
      },
      birthCountry: { label: 'Pays de naissance', placeholder: 'Pays' },
      birthPostalCode: { label: 'Code postal de naissance', placeholder: '5 chiffres' },
      birthCity: { label: 'Ville de naissance', placeholder: 'Ville de naissance' },
      size: {
        label: 'Taille de maillot',
        placeholder: 'Choisir une taille',
        hint: ['Tenue (maillot, short, survêtement, sac) — taille approximative, à ajuster si besoin.'],
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
        hint: "Il recevra aussi l'e-mail de confirmation et nos nouvelles du groupe.",
      },
      comment: { label: 'Un message pour le club', optional: '(facultatif)', placeholder: 'Ex. : déjà joué en club, disponibilités…' },
      consentPrivacy: [
        'J\'accepte que le club conserve ces informations pour me recontacter au sujet de ce futur groupe (',
        link('/confidentialite', 'politique de confidentialité'),
        ').',
      ],
      note: ['Ce n\'est pas encore une inscription : la place sera confirmée quand le club vous recontactera, avec le dossier et le paiement.'],
      submit: 'Envoyer la pré-inscription',
      success: {
        title: 'Pré-inscription enregistrée, merci !',
        text: ['Un e-mail de confirmation vient de vous être envoyé. Nous vous recontacterons dès qu\'une place sera disponible. Pensez à vérifier vos courriers indésirables.'],
      },
      full: {
        title: 'Les places sont prises',
        text: ['La liste de pré-inscription est complète. Écrivez-nous à ', orgEmail, ' : nous vous préviendrons si une place se libère.'],
        button: 'Nous contacter',
      },
      opened: {
        title: 'Le groupe est ouvert !',
        text: ["Assez d'enfants se sont pré-inscrits : le groupe ouvre. Inscrivez votre enfant directement avec le formulaire d'inscription (dossier, photo et paiement)."],
        button: 'Inscrire mon enfant',
      },
      closed: {
        title: 'Pré-inscription fermée',
        text: ['La pré-inscription n\'est pas ouverte pour le moment. Une question ? Écrivez-nous à ', orgEmail, '.'],
        button: 'Nous contacter',
      },
      aside: {
        label: 'Places disponibles',
        kicker: 'Places disponibles',
        remainingOne: 'place restante',
        remainingMany: 'places restantes',
        of: 'sur',
        help: ['Une question ? ', orgEmail, '. Votre enfant a l\'âge d\'une catégorie déjà ouverte ? Direction la ', link('/inscription', 'page Inscription'), '.'],
      },
    },
  },
];
