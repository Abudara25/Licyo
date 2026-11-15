// Registre des activités de traitement (RGPD, article 30) pré-rempli à partir des réglages réels du club : modules,
// champs et pièces demandés, autorisation parentale, durées de conservation, droits d'accès du bureau, services
// connectés. Le club reste responsable du traitement : le registre est à relire, compléter et tenir à jour.
// Module pur : testé dans tests/processing-register.test.ts.

import type { RetentionPolicy } from './retention.ts';

export type RegisterInput = {
  club: {
    name: string;
    city: string;
    postalCode: string;
    contactEmail: string;
    presidentName: string | null;
    rnaNumber: string | null;
    siretNumber: string | null;
    sportLabel: string;
    modules: Record<string, boolean>;
    emailProvider: string;
    stripeConnected: boolean;
  };
  /** Champs facultatifs activés dans le formulaire d'inscription (libellés). */
  formFields: string[];
  /** Pièces demandées hors certificat médical (libellés). */
  documents: string[];
  medicalCertificate: boolean;
  parentalAuthorization: boolean;
  retention: RetentionPolicy;
  /** Personnes du bureau par droit utile au registre (libellé de rôle → nombre). */
  access: { members: Record<string, number>; finance: Record<string, number>; communication: Record<string, number>; coaches: number };
  helloAsso: boolean;
  newsletter: boolean;
};

export type Activity = {
  title: string;
  purpose: string;
  legalBasis: string;
  people: string[];
  data: string[];
  sensitive?: string;
  recipients: string[];
  retention: string;
};

export type Processor = { name: string; role: string; location: string };

export type Register = {
  controller: { name: string; address: string; contact: string; representative: string; identifiers: string };
  activities: Activity[];
  processors: Processor[];
  transfers: string;
  security: string[];
  rights: string[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
const holders = (byRole: Record<string, number>) => {
  const list = Object.entries(byRole).filter(([, n]) => n > 0);
  return list.length ? list.map(([label, n]) => `${label} (${n})`).join(', ') : 'personne pour l’instant';
};

export function buildRegister(input: RegisterInput): Register {
  const c = input.club;
  const r = input.retention;
  const kept = (what: string) =>
    r.enabled
      ? what
      : `${what} Attention : la conservation automatique n’est pas activée (Paramètres > Conservation des données) ; tant qu’elle ne l’est pas, ces durées ne sont pas appliquées.`;
  // Champs du formulaire qui révèlent l'état de santé : données sensibles (art. 9), à signaler.
  const healthFields = input.formFields.filter((l) => /allerg|traitement|sant[ée]|m[ée]dical|handicap|asthme|diab[èe]te/i.test(l) || /\bPAI\b/.test(l));
  const office = `Membres du bureau ayant accès aux adhérents : ${holders(input.access.members)}.`;
  const activities: Activity[] = [];

  activities.push({
    title: 'Gestion des adhésions et des inscriptions',
    purpose: `Inscrire les adhérents à la pratique « ${c.sportLabel} », tenir le fichier des membres, organiser la saison et délivrer les licences.`,
    legalBasis: 'Exécution du contrat d’adhésion (art. 6.1.b) ; pour les mineurs, avec l’accord de leurs responsables légaux.',
    people: ['Adhérents, dont des mineurs', 'Responsables légaux', 'Contacts d’urgence'],
    data: [
      'Identité de l’adhérent : nom, prénom, date de naissance, sexe, catégorie',
      'Coordonnées du responsable : nom, e-mail, téléphone, adresse',
      'Contact d’urgence : nom et téléphone',
      'Autorisations : droit à l’image, soins d’urgence, sortie seul',
      'Signature du dossier',
      ...(input.formFields.length ? [`Informations demandées par le club : ${input.formFields.join(', ')}`] : []),
    ],
    sensitive: healthFields.length
      ? `Données de santé (catégorie particulière, art. 9) : ${healthFields.join(', ')}. À ne demander que si c’est nécessaire à la sécurité de l’adhérent, avec l’accord explicite du responsable légal ou de l’adulte.`
      : undefined,
    recipients: [office, ...(input.access.coaches ? [`Éducateurs (${input.access.coaches}) : seulement les adhérents de leurs catégories.`] : []), 'Fédération sportive : données nécessaires à la licence.'],
    retention: kept(`Saison en cours, puis ${plural(r.membersYears, 'an', 'ans')} après la fin de la saison (31 août), avant anonymisation.`),
  });

  if (input.medicalCertificate || input.documents.length) {
    activities.push({
      title: 'Pièces justificatives et santé',
      purpose: 'Vérifier l’aptitude à la pratique sportive et les pièces nécessaires à l’inscription.',
      legalBasis: input.medicalCertificate
        ? 'Obligation prévue par le Code du sport pour la pratique en club et la licence (certificat médical ou questionnaire de santé) ; exécution du contrat d’adhésion pour les autres pièces.'
        : 'Exécution du contrat d’adhésion.',
      people: ['Adhérents, dont des mineurs'],
      data: [...(input.medicalCertificate ? ['Certificat médical ou réponse au questionnaire de santé'] : []), ...input.documents],
      sensitive: input.medicalCertificate ? 'Données de santé (catégorie particulière, art. 9) : accès limité au bureau, fichiers privés servis par lien de courte durée.' : undefined,
      recipients: [office],
      retention: kept(`${plural(r.documentsMonths, 'mois', 'mois')} après la fin de la saison, puis suppression des fichiers vérifiée.`),
    });
  }

  if (input.parentalAuthorization) {
    activities.push({
      title: 'Autorisation parentale',
      purpose: 'Recueillir l’autorisation des responsables légaux pour la pratique, les rencontres et les déplacements des mineurs.',
      legalBasis: 'Exécution du contrat d’adhésion ; preuve de l’accord du responsable légal.',
      people: ['Adhérents mineurs', 'Responsables légaux'],
      data: ['Texte signé, nom et qualité du signataire, date, signature'],
      recipients: [office],
      retention: kept(`Avec la fiche de l’adhérent : ${plural(r.membersYears, 'an', 'ans')} après la fin de la saison.`),
    });
  }

  if (c.modules.payments) {
    activities.push({
      title: 'Cotisations et trésorerie',
      purpose: 'Encaisser les cotisations, suivre les règlements et rapprocher les paiements reçus.',
      legalBasis: 'Exécution du contrat d’adhésion ; obligations comptables du club.',
      people: ['Responsables des inscriptions (payeurs)'],
      data: [
        'Montants, mode de paiement, échéances, numéros de chèque',
        ...(input.helloAsso ? ['Paiements HelloAsso : payeur, e-mail, montant, formulaire'] : []),
        'Opérations importées (relevés, terminaux) : payeur et libellé',
      ],
      recipients: [`Trésorerie : ${holders(input.access.finance)}.`],
      retention: kept(
        `Montants conservés pour la comptabilité du club (durée légale des pièces comptables, généralement 10 ans), sans nom après anonymisation ; payeur et libellé des opérations importées effacés après ${plural(r.membersYears, 'an', 'ans')}.`,
      ),
    });
  }

  activities.push({
    title: 'Pré-inscriptions et liste d’attente',
    purpose: 'Recevoir les demandes et proposer les places disponibles dans l’ordre d’arrivée.',
    legalBasis: 'Mesures précontractuelles à la demande de la personne (art. 6.1.b).',
    people: ['Futurs adhérents, dont des mineurs', 'Contact de la demande'],
    data: ['Identité de l’enfant ou de l’adulte, date de naissance', 'Nom, e-mail et téléphone du contact', 'Message libre'],
    recipients: [office],
    retention: kept(`Demandes closes supprimées après ${plural(r.preregistrationsMonths, 'mois', 'mois')}.`),
  });

  if (c.modules.trials) {
    activities.push({
      title: 'Séances d’essai',
      purpose: 'Organiser une séance de découverte avant l’inscription.',
      legalBasis: 'Mesures précontractuelles à la demande de la personne.',
      people: ['Personnes à l’essai, dont des mineurs', 'Responsables légaux'],
      data: ['Identité, date de naissance, coordonnées du responsable, créneau choisi'],
      recipients: [office],
      retention: kept(`Comme les fiches d’adhérent : ${plural(r.membersYears, 'an', 'ans')} après la fin de la saison.`),
    });
  }

  if (c.modules.attendance) {
    activities.push({
      title: 'Présences, convocations et rencontres',
      purpose: 'Faire l’appel, convoquer aux rencontres et joindre les familles en cas d’urgence.',
      legalBasis: 'Intérêt légitime du club à organiser l’activité et à assurer la sécurité des pratiquants (art. 6.1.f).',
      people: ['Adhérents'],
      data: ['Présences par séance, réponses aux convocations', 'Contact d’urgence'],
      recipients: [`Éducateurs de la catégorie (${input.access.coaches}) et bureau.`],
      retention: kept('Avec la fiche de l’adhérent ; sans nom après anonymisation.'),
    });
  }

  activities.push({
    title: 'Communication avec les familles',
    purpose: `E-mails liés au dossier (confirmation, pièces manquantes, paiement)${input.newsletter ? ' et newsletter du club' : ''}.`,
    legalBasis: input.newsletter
      ? 'Exécution du contrat pour les e-mails de dossier ; intérêt légitime du club à informer ses adhérents pour la newsletter, avec désinscription en un clic dans chaque envoi.'
      : 'Exécution du contrat d’adhésion.',
    people: ['Responsables des inscriptions'],
    data: ['Adresse e-mail, prénom, objet et date des envois', ...(input.newsletter ? ['Liste des désinscriptions à la newsletter'] : [])],
    recipients: [`Communication : ${holders(input.access.communication)}.`],
    retention: '13 mois pour l’historique des envois ; les désinscriptions sont gardées pour respecter l’opposition.',
  });

  activities.push({
    title: 'Accès du bureau à l’espace de gestion',
    purpose: 'Donner à chaque membre du bureau les seuls droits utiles à son rôle et garder trace des changements.',
    legalBasis: 'Intérêt légitime du club à sécuriser les données de ses adhérents (art. 6.1.f, art. 32).',
    people: ['Membres du bureau, bénévoles, éducateurs'],
    data: ['Nom, e-mail, rôle, droits accordés', 'Journal des changements de droits, exports et effacements'],
    recipients: ['Présidence du club.'],
    retention: 'Pendant la fonction au sein du club.',
  });

  const processors: Processor[] = [
    { name: 'Licyo (AbiWeb)', role: 'Éditeur du logiciel de gestion, sous-traitant (art. 28)', location: 'France' },
    { name: 'Cloudflare', role: 'Hébergement de l’application, de la base de données et des fichiers', location: 'Données stockées dans l’Union européenne (juridiction UE)' },
    {
      name: c.emailProvider === 'gmail' ? 'Google (Gmail du club)' : 'Cloudflare Email',
      role: 'Envoi des e-mails',
      location: c.emailProvider === 'gmail' ? 'Selon les conditions de Google Workspace' : 'Infrastructure Cloudflare',
    },
    ...(c.stripeConnected ? [{ name: 'Stripe', role: 'Paiement en ligne des cotisations', location: 'Union européenne (Stripe Payments Europe, Irlande)' }] : []),
    ...(input.helloAsso ? [{ name: 'HelloAsso', role: 'Paiements reçus par le club, lus par sa clé API', location: 'France' }] : []),
  ];

  return {
    controller: {
      name: c.name,
      address: `${c.postalCode} ${c.city}`.trim(),
      contact: c.contactEmail,
      representative: c.presidentName ? `${c.presidentName}, président(e)` : 'Président(e) du club (à compléter)',
      identifiers: [c.rnaNumber ? `RNA ${c.rnaNumber}` : null, c.siretNumber ? `SIRET ${c.siretNumber}` : null].filter(Boolean).join(' - ') || 'RNA ou SIRET à compléter',
    },
    activities,
    processors,
    transfers:
      'Pas de transfert organisé hors de l’Union européenne par le club. Cloudflare, Google et Stripe sont des groupes américains : vérifiez dans leurs conditions les garanties prévues (clauses contractuelles types, Data Privacy Framework).',
    security: [
      'Connexion personnelle par lien à usage unique, sans mot de passe partagé.',
      'Droits attribués à chaque personne du bureau, au plus juste ; éducateurs limités à leurs catégories.',
      'Pièces justificatives dans un stockage privé, consultables uniquement par lien signé de quelques minutes.',
      'Identifiants des services connectés (e-mail, HelloAsso) chiffrés.',
      'Échanges chiffrés (HTTPS) ; formulaires publics protégés contre les robots et les envois répétés.',
      'Journal des changements de droits, des exports et des effacements.',
      ...(r.enabled ? ['Conservation limitée appliquée chaque nuit, avec suppression vérifiée des fichiers.'] : []),
    ],
    rights: [
      'Accès et portabilité : bouton « Exporter ses données » sur la fiche de la personne.',
      'Effacement : bouton « Effacer ses données » sur la fiche (montants gardés sans nom pour la comptabilité).',
      'Rectification : modification de la fiche par le bureau, ou nouveau dossier par la famille.',
      'Opposition à la newsletter : lien de désinscription dans chaque envoi.',
      `Contact pour exercer ces droits : ${c.contactEmail}. Réponse sous un mois.`,
    ],
  };
}
