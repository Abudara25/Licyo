// Mentions légales et politique de confidentialité : texte long découpé en articles (pastille, titre,
// paragraphes en segments).
import { link, linkVariant, strong } from '../../segments.js';
import { EMAIL } from './shared.js';

const mail = link(`mailto:${EMAIL}`, EMAIL);
const legal = (id, items) => [{ type: 'content', id, background: 'surface', width: 'narrow', blocks: [{ type: 'articles', items }] }];

export const mentionsSections = legal('mentions-legales.articles', [
  {
    eyebrow: 'Éditeur du site',
    title: 'Qui édite ce site',
    paragraphs: [
      [
        'Ce site est édité par le ',
        strong('Club Démo'),
        ", association loi 1901, dont le siège social se situe 1 place de la Mairie, 00000 Sportville. Les entraînements et activités du club se déroulent au Stade municipal, 1 rue du Stade, Sportville.",
      ],
      ['Numéro RNA : W000000000.'],
      ['Directeur de la publication : le Président du Club Démo.'],
      ['Contact : ', mail],
    ],
  },
  {
    eyebrow: 'Hébergement',
    title: 'Hébergeur',
    paragraphs: [['Cloudflare, Inc. — 101 Townsend St, San Francisco, CA 94107, États-Unis.']],
  },
  {
    eyebrow: 'Contenu',
    title: 'Propriété intellectuelle',
    paragraphs: [
      [
        "L'ensemble des textes, du logo et des éléments graphiques de ce site est la propriété du Club Démo, sauf mention contraire. Toute reproduction sans autorisation est interdite.",
      ],
      [
        'Certaines photographies illustratives (terrain, ballon, équipement) proviennent de banques d\'images libres de droits (Pexels) et ne représentent pas de joueurs, familles ou bénévoles réels du club.',
      ],
    ],
  },
  {
    eyebrow: 'Liens',
    title: "Liens vers d'autres sites",
    paragraphs: [
      [
        "Ce site contient des liens vers des services tiers (HelloAsso pour le paiement des adhésions, Google Maps, Facebook, Instagram). Le Club Démo n'est pas responsable du contenu ou des pratiques de confidentialité de ces sites externes.",
      ],
    ],
  },
  {
    eyebrow: 'Responsabilité',
    title: 'Limitation de responsabilité',
    paragraphs: [
      [
        "Le Club Démo s'efforce d'assurer l'exactitude des informations publiées sur ce site, sans garantie de disponibilité continue ou d'absence d'erreur. Pour toute question, contactez-nous à ",
        mail,
        '.',
      ],
    ],
  },
]);

export const privacySections = legal('confidentialite.articles', [
  {
    eyebrow: 'Responsable',
    title: 'Responsable du traitement',
    paragraphs: [
      [
        'Le Club Démo, association loi 1901 (siège social : 1 place de la Mairie, 00000 Sportville — RNA W000000000), est responsable des données collectées via ce site. Pour toute question, contactez-nous à ',
        mail,
        '.',
      ],
    ],
  },
  {
    eyebrow: 'Collecte',
    title: 'Quelles données sont collectées',
    paragraphs: [
      [
        'Via le ',
        strong("formulaire d'inscription"),
        " (page Inscription) : identité et date de naissance de l'enfant, catégorie souhaitée, taille de maillot, mode de paiement choisi, identité, e-mail, téléphone et adresse du parent ou responsable légal (et, si vous le souhaitez, identité et coordonnées d'un second responsable légal, qui reçoit alors les mêmes e-mails), ainsi que les autorisations cochées (participation, droit à l'image, consentement RGPD). Ces informations servent à générer votre dossier PDF et sont enregistrées sur nos serveurs (hébergement Cloudflare, données stockées dans des centres de données situés dans l'Union européenne). Une fois le dossier signé, vous pouvez le déposer directement en ligne via un lien qui vous est propre : le fichier déposé (PDF ou photo) est stocké dans les mêmes conditions, tout comme la photo de votre enfant que vous ajoutez depuis ce même lien (elle sert à sa licence, reste réservée au club et n'est jamais publiée). Dans l'administration du site, ces données (y compris le dossier et la photo déposés) ne sont accessibles qu'aux responsables du club, par mot de passe. Vous consultez et complétez l'inscription de votre enfant depuis l'espace famille, grâce à un lien personnel envoyé par e-mail : il est valable 30 jours, ne doit pas être transféré, et un nouveau lien ne peut être envoyé qu'aux adresses e-mail enregistrées lors de l'inscription. Le club peut couper ces liens à tout moment. Un e-mail de bonne réception de votre inscription, puis des e-mails de suivi (étape validée, dossier complet, rappel si le dossier reste incomplet), vous sont envoyés depuis la messagerie du club, hébergée par ",
        strong('Infomaniak'),
        " (société suisse), ou à défaut via le prestataire ",
        strong('Brevo'),
        " (société française). Pour s'assurer que ces e-mails sont bien partis, le club conserve un journal des envois : date, type d'e-mail, adresses destinataires, objet et résultat de l'envoi, sans le contenu du message. Ce journal est stocké dans les mêmes conditions et réservé aux responsables du club. Si vous réglez l'adhésion sur ",
        strong('HelloAsso'),
        ", HelloAsso nous transmet le nom et l'e-mail du payeur ainsi que le nom de l'enfant inscrit, afin de valider automatiquement le paiement de votre dossier — cet e-mail ne vaut pas confirmation définitive : l'inscription n'est acquise qu'une fois l'adhésion réglée et la licence de votre enfant enregistrée par le club auprès de la FFF. Cloudflare, Inc. étant une société américaine, un encadrement légal du transfert de données (clauses contractuelles types de la Commission européenne) s'applique à l'hébergement, même lorsque les données elles-mêmes restent stockées dans l'UE.",
      ],
      [
        'Via le ',
        strong('formulaire de pré-inscription U10'),
        " : identité, date et lieu de naissance (ville et pays) de l'enfant, identité, e-mail et téléphone du parent (et, si vous le souhaitez, d'un second responsable légal, qui reçoit alors la confirmation), et le message facultatif. Ces informations servent uniquement à vous recontacter si le groupe ouvre ; elles sont enregistrées dans les mêmes conditions que les inscriptions (Cloudflare, Union européenne), réservées aux responsables du club, et supprimées sur simple demande. Un e-mail de confirmation vous est envoyé depuis la messagerie du club (Infomaniak), ou à défaut via Brevo.",
      ],
      [
        'Via le ',
        strong('formulaire de contact général'),
        " : nom, e-mail et message, envoyés par e-mail à l'adresse de contact du club depuis la messagerie du club (hébergeur de messagerie du club), ou à défaut via Brevo. Le message n'est pas enregistré sur le site : seul le journal des envois (date, adresse destinataire, objet, résultat) est conservé, comme pour les autres e-mails.",
      ],
      [
        'Ce site utilise ',
        strong('Cloudflare Web Analytics'),
        ' pour mesurer la fréquentation (pages vues, temps de chargement) : cet outil ne dépose aucun cookie et ne permet pas de vous identifier individuellement. Le site compte aussi lui-même, de façon anonyme (type d\'action, page et date, sans adresse IP ni identifiant), deux actions ponctuelles : un clic sur le numéro de téléphone de la page Partenaires, ou l\'envoi du formulaire de contact, afin de savoir si ces fonctionnalités sont utilisées.',
        " Ces mesures étant anonymes et sans cookie, aucun bandeau de consentement n'est nécessaire. Pendant la saisie de votre adresse, le texte tapé est envoyé au service public de géocodage de l'",
        strong('IGN'),
        ' (Géoplateforme, Base Adresse Nationale) pour vous proposer des adresses ; de la même façon, un code postal ou le début d\'un nom de commune (lieu de naissance, ville de résidence) lui est envoyé pour proposer la commune : aucun nom de personne n\'y est envoyé et rien n\'y est enregistré au nom de votre enfant. Le formulaire d\'inscription est protégé contre les envois automatisés par ',
        strong('Cloudflare Turnstile'),
        ", qui vérifie que la demande vient d'un navigateur réel, sans publicité ni profilage. Ce site ne dépose aucun cookie de suivi ni de publicité (pas de Google Analytics, pas de pixel Facebook). Seuls des cookies techniques indispensables peuvent être utilisés : la protection de Cloudflare contre les robots (cookie « cf_clearance », et Cloudflare Turnstile sur les formulaires), et la session de l'espace réservé aux responsables du club. Les cartes intégrées (Google Maps, chargées uniquement après un clic de votre part), le paiement en ligne (HelloAsso) et l'envoi d'e-mails (messagerie Infomaniak, ou Brevo à défaut) sont fournis par des services tiers qui peuvent déposer leurs propres cookies ou traiter des données, indépendamment de ce site.",
      ],
    ],
  },
  {
    eyebrow: 'Utilisation',
    title: 'Pourquoi nous les utilisons',
    paragraphs: [
      [
        "Ces informations servent uniquement à traiter l'inscription de votre enfant au club, à générer votre dossier d'adhésion, à vous recontacter et, avec votre accord, à illustrer la vie du club (photos/vidéos). Elles ne sont ni revendues, ni utilisées à des fins commerciales, ni transmises à d'autres organismes que ceux nécessaires au paiement de l'adhésion (HelloAsso).",
      ],
    ],
  },
  {
    eyebrow: 'Finalités',
    title: 'Pourquoi et sur quelle base',
    paragraphs: [
      [
        strong("Inscription, adhésion et licence"),
        " (dossier, photo de l'enfant pour sa licence, paiement, e-mails de suivi, espace famille) : nécessaires à l'adhésion que vous demandez au club (exécution du contrat d'adhésion, article 6.1.b du RGPD). Les informations de l'enfant sont fournies par son responsable légal.",
      ],
      [
        strong("Pré-inscription U10 et formulaire de contact"),
        " : répondre à votre demande avant toute adhésion (mesures précontractuelles prises à votre demande, article 6.1.b).",
      ],
      [
        strong("Photos et vidéos de la vie du club"),
        " : uniquement avec votre accord (case « droit à l'image » ; consentement, article 6.1.a), que vous pouvez retirer à tout moment en nous écrivant.",
      ],
      [
        strong("Sécurité et bon fonctionnement du site"),
        " (protection contre les robots, limitation des envois, journal des e-mails envoyés, mesure d'audience anonyme) : intérêt légitime du club à protéger le site et à vérifier que ses e-mails partent (article 6.1.f).",
      ],
    ],
  },
  {
    eyebrow: 'Conservation',
    title: 'Durée de conservation',
    paragraphs: [
      [
        "Les données d'adhésion sont conservées pendant la saison concernée, puis archivées jusqu'à 3 ans après la fin de cette saison (30 juin), sauf demande de suppression anticipée de votre part. Une fois ce délai passé, la fiche apparaît dans l'administration parmi les données à supprimer, et le club la supprime définitivement : fiche, dossier signé, photo et copie de sauvegarde de ces fichiers. Les sauvegardes automatiques de la base de données sont effacées par l'hébergeur au plus tard 30 jours après. Le journal des e-mails envoyés est effacé automatiquement au bout de 400 jours, et les liens de l'espace famille expirés au bout de 90 jours.",
      ],
    ],
  },
  {
    eyebrow: 'Vos droits',
    title: 'Accès, rectification, suppression',
    paragraphs: [
      [
        "Conformément au RGPD, vous pouvez à tout moment demander l'accès, la rectification, la suppression ou vous opposer à l'utilisation des données concernant votre enfant ou vous-même, en écrivant à ",
        mail,
        ". Si vous estimez, après nous avoir contactés, que vos droits ne sont pas respectés, vous pouvez introduire une réclamation auprès de la ",
        linkVariant('external', 'https://www.cnil.fr/fr/plaintes', 'CNIL'),
        '.',
      ],
    ],
  },
]);
