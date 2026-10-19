// Inscription : textes du formulaire (le balisage, les champs et les scripts sont fixés par
// renderer/registration.js).
import { bind, em, hook, link, linkVariant, org, orgIf, orgList, strong } from '../../segments.js';
import { EMAIL, orgEmail, u10Banner } from './shared.js';

const NBSP = ' ';
const passSportAmount = hook('data-prix-passsport-text', ['130'], [['data-org', 'price.passSportAmount']]);
const seasonAmount = hook('data-prix-text', ['180'], [['data-org', 'price.seasonAmount']]);

export const sections = [
  { type: 'content', id: 'inscription.u10', comment: 'Pré-inscription U10', background: 'cream', tight: true, blocks: [{ ...u10Banner, compact: true }] },
  {
    type: 'registration',
    id: 'inscription.formulaire',
    contactHref: '/contact',
    groupOptions: [
      { value: 'U6 - U7', label: 'U6 - U7 (2020-2021)', bind: [['data-org', 'group.u6-u7.option'], ['data-org-if', 'group.u6-u7.name']] },
      { value: 'U8 - U9', label: 'U8 - U9 (2018-2019)', bind: [['data-org', 'group.u8-u9.option'], ['data-org-if', 'group.u8-u9.name']] },
    ],
    sizes: ['4 ans', '6 ans', '8 ans', '10 ans', '12 ans'],
    paymentLabels: {
      HelloAsso: 'HelloAsso (en ligne)',
      'Carte bancaire': 'Carte bancaire (au club)',
      Espèces: 'Espèces',
      Chèque: 'Chèque',
    },
    asideItems: [
      { content: ['Ouvert aux filles comme aux garçons, quel que soit leur niveau'] },
      { content: ['Licence et tenue complète Sportéquip incluses (maillot, short, survêtement, sac)'] },
      {
        bind: [['data-org-if', 'schedule.any']],
        content: [
          'Entraînement ',
          orgList(
            'slots-sentence',
            'le ',
            org('schedule.day', 'jeudi'),
            ', ',
            org('schedule.start', '17h'),
            ' – ',
            org('schedule.end', '18h'),
            orgIf('location.name', ', au ', org('location.name', 'Stade municipal'))
          ),
        ],
      },
      { content: ["Séance d'essai gratuite possible avant de s'inscrire"] },
      { content: ["Pass'Sport accepté au club : 50 € de moins, dès 6 ans et sous conditions"] },
      { content: ['Paiement en ligne, ou au club par carte bancaire, espèces ou chèque'] },
    ],
    texts: {
      eyebrow: 'Inscription',
      title: 'Le formulaire',
      intro: ['Environ 3 minutes. Places limitées cette saison : inscrivez votre enfant dès maintenant pour lui garantir une place.'],
      steps: ["L'enfant", 'Les parents', 'Validation'],
      childStep: "1. L'enfant",
      parentStep: '2. Les responsables légaux',
      finalStep: '3. Paiement et autorisations',
      next: 'Continuer',
      back: 'Retour',
      childFirstName: { label: "Prénom de l'enfant", placeholder: 'Prénom' },
      childLastName: { label: "Nom de l'enfant", placeholder: 'Nom' },
      birthDate: { label: 'Date de naissance' },
      birthCountry: { label: 'Pays de naissance', placeholder: 'Pays' },
      birthPostalCode: { label: 'Code postal de naissance', placeholder: '5 chiffres' },
      birthCity: { label: 'Ville de naissance', placeholder: 'Ville de naissance', suggestions: 'Communes correspondant au code postal' },
      group: { label: 'Catégorie' },
      ageWarning: [
        'Cette date de naissance ne correspond à aucune catégorie ouverte cette saison. Votre enfant est né en 2017 ? ',
        link('/pre-inscription-u10', 'Pré-inscrivez-le au futur groupe U10'),
        '. Sinon, vérifiez la date ou écrivez-nous à ',
        orgEmail,
        '.',
      ],
      size: {
        label: 'Taille de maillot',
        placeholder: 'Choisir une taille',
        hint: ['Tenue Sportéquip (maillot, short, survêtement, sac) — taille approximative, à ajuster si besoin le jour de la remise.'],
      },
      parentFirstName: { label: 'Prénom du parent', placeholder: 'Prénom' },
      parentLastName: { label: 'Nom du parent', placeholder: 'Nom' },
      email: { label: 'E-mail (parent)', placeholder: 'vous@exemple.fr' },
      phone: { label: 'Téléphone (parent)', placeholder: '06 12 34 56 78' },
      duplicateWarning: [
        "Un enfant portant ce nom et prénom semble déjà inscrit avec cette adresse e-mail. Si c'est une erreur, vérifiez l'orthographe — sinon consultez vos e-mails ou écrivez-nous à ",
        orgEmail,
        '.',
      ],
      secondParent: {
        summary: 'Ajouter un second responsable légal',
        optional: '(facultatif)',
        firstName: { label: 'Prénom du 2e responsable', placeholder: 'Prénom' },
        lastName: { label: 'Nom du 2e responsable', placeholder: 'Nom' },
        email: { label: 'E-mail (2e responsable)', placeholder: 'autre@exemple.fr' },
        phone: { label: 'Téléphone (2e responsable)', placeholder: '06 12 34 56 78' },
        hint: "Il recevra aussi les e-mails de suivi de l'inscription.",
      },
      address: { label: 'Adresse', placeholder: 'Numéro et nom de la rue', suggestions: 'Adresses suggérées' },
      postalCode: { label: 'Code postal', placeholder: '5 chiffres' },
      city: { label: 'Ville', placeholder: 'Ville' },
      payment: { label: 'Mode de paiement', placeholder: 'Choisir un mode de paiement' },
      passSport: {
        label: "Code alphanumérique Pass'Sport",
        optional: 'si applicable',
        placeholder: 'Ex. 24-ABC12345',
        hint: [
          "Aide de l'État de 50 €, dès 6 ans et sous conditions de ressources. Le code vous est envoyé par la CAF ou la MSA. ",
          linkVariant('external', 'https://pass.sports.gouv.fr', 'En savoir plus'),
          '.',
        ],
      },
      passSportNote: [
        "Le Pass'Sport se règle au club : présentez votre code à un responsable, nous retirons 50 € de l'adhésion",
        hook('data-prix-block', [' (', strong(passSportAmount, ' €'), ' au lieu de ', seasonAmount, ' €)'], [['data-org-if', 'price.seasonAmount']]),
        " et vous payez sur place, par carte bancaire, en espèces ou par chèque. Nous vérifions chaque code : s'il n'est pas valable, les 50 € restants vous seront demandés avant l'enregistrement de la licence.",
      ],
      consentParticipation: ["J'autorise mon enfant à participer aux entraînements et activités du Club Démo."],
      consentImage: [
        "J'autorise le club à utiliser des photos/vidéos de mon enfant prises lors des activités du club, à des fins de communication (site, réseaux sociaux). ",
        em('Facultatif.'),
      ],
      consentPrivacy: [
        "J'accepte que ces informations soient utilisées uniquement pour traiter l'inscription de mon enfant au club (voir notre ",
        linkVariant('new-tab', '/confidentialite', 'politique de confidentialité'),
        ').',
      ],
      notes: [
        ['Un questionnaire de santé (ou certificat médical) pourra vous être demandé avant le début de la saison.'],
        [strong('Important :'), " cette inscription ne sera définitive qu'une fois l'adhésion réglée et la licence de votre enfant enregistrée par le club auprès de la FFF."],
      ],
      submit: 'Télécharger mon dossier',
      duplicate: {
        title: 'Dossier déjà envoyé',
        text: [
          "Une inscription existe déjà pour cet enfant avec cette adresse e-mail. Le lien de votre espace famille est renvoyé à l'adresse enregistrée (au plus une fois par heure) : pensez à vérifier les spams. Besoin d'aide ? ",
          orgEmail,
        ],
      },
      nextSteps: {
        title: 'Dossier téléchargé : il reste 3 choses à faire',
        steps: [
          ['Imprimez le dossier téléchargé et faites-le signer.'],
          ['Depuis votre espace famille, déposez-le (photo ou scan) avec une photo de votre enfant, de face sur fond blanc.'],
          ["Réglez l'adhésion selon le mode choisi."],
        ],
        button: 'Ouvrir mon espace famille',
        emailHint: [
          'Le lien vous est aussi envoyé par e-mail. Pensez à ajouter ',
          bind('strong', [['data-org', 'org.email']], EMAIL),
          ' à vos contacts et, si vous ne le trouvez pas, à regarder dans vos courriers indésirables.',
        ],
        fallbackBefore: "Le lien de votre espace famille n'a pas pu être créé (connexion instable) — ",
        fallbackLink: 'envoyez-nous votre dossier par e-mail',
        fallbackAfter: ' à la place.',
        onSiteBefore: 'Merci de prévoir le règlement (',
        onSiteAfter: ') lors de la remise du dossier signé au club',
        onSitePassSport: [' : ', strong(passSportAmount, ' €'), ", Pass'Sport déduit"],
        passSportBefore: "Pass'Sport (code ",
        passSportAfter:
          ') : la réduction de 50 € s\'applique au club, pas en ligne. Présentez votre code à un responsable et réglez sur place — le paiement en ligne ci-dessous encaisserait le tarif complet.',
        widgetHintBefore: 'Le paiement ne s\'affiche pas ? ',
        widgetHintLink: 'Ouvrez-le dans un nouvel onglet',
        widgetHintAfter: '.',
      },
      closed: {
        title: 'Inscriptions fermées pour le moment',
        text: [
          'Les inscriptions pour la saison ',
          hook('data-saison-text', ['2026-2027']),
          ' ne sont pas ouvertes actuellement. Contactez-nous pour être informé(e) dès leur réouverture.',
        ],
        button: 'Nous contacter',
      },
      priority: {
        title: 'Réinscription prioritaire en cours',
        before:
          'Les familles déjà inscrites la saison précédente ont reçu un lien personnel pour réserver la place de leur enfant en priorité. Les nouvelles inscriptions ouvriront au public le ',
        after: '. Contactez-nous pour être informé(e) dès l\'ouverture.',
        button: 'Nous contacter',
      },
      aside: {
        label: "Récapitulatif de l'adhésion",
        kicker: ['Adhésion saison ', hook('data-saison-text', ['2026-2027'])],
        price: [seasonAmount, `${NBSP}€`],
        priceSub: ['ou 3 × ', hook('data-prix-tiers-text', ['60'], [['data-org', 'price.tierAmount']]), `${NBSP}€ sans frais sur HelloAsso`],
        afterTitle: 'Après le formulaire',
        afterSteps: [
          ['Vous signez le dossier téléchargé.'],
          ['Vous le déposez avec une photo de votre enfant, depuis votre espace famille.'],
          ["Vous réglez l'adhésion."],
        ],
        help: ['Une question ? ', orgEmail, { br: true }, link('/entrainements', "Plan d'accès au stade"), { br: true }, link('/pre-inscription-u10', 'Né en 2017 ? Pré-inscription U10')],
        noteStrong: 'Plus nous serons nombreux, plus vite nous pourrons ouvrir de nouveaux créneaux les prochaines années.',
        note: 'Chaque inscription compte pour montrer à la ville la demande des familles.',
      },
    },
  },
];
