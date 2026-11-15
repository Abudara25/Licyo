// Rôles et permissions du back-office club : source unique.
//
// Les gros clubs répartissent le travail entre bureau, adjoints, encadrement et bénévoles. Chaque action serveur,
// chaque page et chaque règle d'accès SQL (src/lib/db/policies.ts) demande une PERMISSION, jamais une liste de rôles
// écrite en dur : ajouter un rôle ou ajuster ses droits se fait ici seulement.
//
// Rôles « encadrement » (éducateur, dirigeant d'équipe, bénévole) : leurs permissions sportives ne valent que pour
// les catégories rattachées (staff_members.assigned_category_ids). Sans catégorie rattachée, ils ne voient aucun
// adhérent. Le super_admin (rôle plateforme) a tous les droits, y compris en Mode Miroir.
//
// Ce module est pur (aucune dépendance) : il est importé par le serveur, les composants et les tests.

export const CLUB_ROLES = [
  'president',
  'vice_president',
  'secretary',
  'assistant_secretary',
  'treasurer',
  'assistant_treasurer',
  'coach',
  'team_manager',
  'volunteer',
] as const;

export type ClubRole = (typeof CLUB_ROLES)[number];
export type AnyStaffRole = ClubRole | 'super_admin';

export const ROLE_LABELS: Record<AnyStaffRole, string> = {
  super_admin: 'Équipe Licyo',
  president: 'Président(e)',
  vice_president: 'Vice-président(e)',
  secretary: 'Secrétaire',
  assistant_secretary: 'Secrétaire adjoint(e)',
  treasurer: 'Trésorier(ère)',
  assistant_treasurer: 'Trésorier(ère) adjoint(e)',
  coach: 'Éducateur / entraîneur',
  team_manager: "Dirigeant(e) d'équipe",
  volunteer: 'Bénévole',
};

export const ROLE_DESCRIPTIONS: Record<ClubRole, string> = {
  president: 'Tous les droits, dont la gestion des accès, le domaine et la purge des saisons.',
  vice_president: 'Remplace le président au quotidien, sans gérer les accès.',
  secretary: 'Dossiers des adhérents, organisation sportive, contenus du site, communication et réglages.',
  assistant_secretary: 'Dossiers des adhérents, sportif et contenus, sans les réglages du club.',
  treasurer: 'Paiements, échéanciers, boutique, partenaires et tarifs ; lecture des dossiers.',
  assistant_treasurer: 'Paiements et échéanciers ; lecture des dossiers.',
  coach: 'Appel, événements et convocations de ses catégories ; contacts d’urgence de ses adhérents.',
  team_manager: 'Comme l’éducateur : appel, événements et convocations de ses catégories.',
  volunteer: 'Appel des séances de ses catégories seulement.',
};

export const PERMISSIONS = [
  'members.read', // dossiers, pièces, demandes
  'members.write', // valider, refuser, demander une correction, Pass'Sport, réinscriptions
  'finance.read',
  'finance.write', // échéances, encaissements, commandes, Stripe, abonnement
  'sport.manage', // appel, événements, convocations de TOUTES les catégories
  'organization.manage', // catégories, créneaux, lieux, produits et tarifs
  'content.write', // textes, actualités, images, vitrine, galerie
  'partners.manage', // partenaires et prospects partenaires
  'communication.manage', // messagerie d'envoi du club
  'settings.manage', // réglages, modules, formulaire d'inscription
  'club.admin', // accès des membres du bureau, domaine, purge des saisons
  'stats.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissions sportives limitées aux catégories rattachées. */
export type ScopedPermission = 'attendance.take' | 'events.manage';

const ALL: readonly Permission[] = PERMISSIONS;

export const ROLE_PERMISSIONS: Record<ClubRole, readonly Permission[]> = {
  president: ALL,
  vice_president: ALL.filter((p) => p !== 'club.admin'),
  secretary: [
    'members.read', 'members.write', 'finance.read', 'sport.manage', 'organization.manage', 'content.write',
    'partners.manage', 'communication.manage', 'settings.manage', 'stats.read',
  ],
  assistant_secretary: ['members.read', 'members.write', 'sport.manage', 'content.write', 'stats.read'],
  treasurer: ['members.read', 'finance.read', 'finance.write', 'organization.manage', 'partners.manage', 'stats.read'],
  assistant_treasurer: ['members.read', 'finance.read', 'finance.write', 'stats.read'],
  coach: [],
  team_manager: [],
  volunteer: [],
};

export const ROLE_SCOPED_PERMISSIONS: Record<ClubRole, readonly ScopedPermission[]> = {
  president: [],
  vice_president: [],
  secretary: [],
  assistant_secretary: [],
  treasurer: [],
  assistant_treasurer: [],
  coach: ['attendance.take', 'events.manage'],
  team_manager: ['attendance.take', 'events.manage'],
  volunteer: ['attendance.take'],
};

export function isClubRole(value: unknown): value is ClubRole {
  return typeof value === 'string' && (CLUB_ROLES as readonly string[]).includes(value);
}

/** Vrai si le rôle a la permission sur tout le club. */
export function roleCan(role: AnyStaffRole | null | undefined, permission: Permission): boolean {
  if (role === 'super_admin') return true;
  return isClubRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}

/** Vrai si le rôle a au moins une des permissions. */
export function roleCanAny(role: AnyStaffRole | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => roleCan(role, p));
}

/** Rôles de club qui ont la permission (utilisé par les règles SQL). */
export function rolesWith(permission: Permission): ClubRole[] {
  return CLUB_ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(permission));
}

/** Rôles d'encadrement qui ont la permission limitée à leurs catégories. */
export function scopedRolesWith(permission: ScopedPermission): ClubRole[] {
  return CLUB_ROLES.filter((r) => ROLE_SCOPED_PERMISSIONS[r].includes(permission));
}

/** Vrai si le rôle doit être rattaché à des catégories pour voir quelque chose. */
export function isScopedRole(role: AnyStaffRole | null | undefined): boolean {
  return isClubRole(role) && ROLE_PERMISSIONS[role].length === 0;
}

/** Tout rôle de club voit le back-office ; la suite dépend de ses permissions. */
export const STAFF_ROLES: readonly ClubRole[] = CLUB_ROLES;

/** Rôles « bureau » : accès aux données de tout le club (au moins la lecture des dossiers ou des finances). */
export const OFFICE_ROLES: readonly ClubRole[] = CLUB_ROLES.filter((r) => !isScopedRole(r));

// ---------------------------------------------------------------------------------------------------------------------
// Droits personnalisés par personne (décision du propriétaire du 2026-11-15)
//
// Le rôle n'est qu'un MODÈLE qui pré-coche des droits. L'administrateur du club (club.admin) ajuste ensuite librement
// les droits de chaque personne. staff_members.permissions : NULL = droits par défaut du rôle (comptes existants),
// sinon la liste exacte des droits accordés. Les règles SQL (policies.ts) lisent la même donnée.
// ---------------------------------------------------------------------------------------------------------------------

export const SCOPED_PERMISSIONS = ['attendance.take', 'events.manage'] as const satisfies readonly ScopedPermission[];

/** Tout droit attribuable : sur tout le club, ou limité aux catégories rattachées. */
export type Grant = Permission | ScopedPermission;
export const ALL_GRANTS: readonly Grant[] = [...PERMISSIONS, ...SCOPED_PERMISSIONS];

export function isGrant(value: unknown): value is Grant {
  return typeof value === 'string' && (ALL_GRANTS as readonly string[]).includes(value);
}

export type Sensitivity = 'critique' | 'élevée' | 'modérée' | 'faible';

/** Explication affichée à l'administrateur pour chaque droit, avec son niveau de risque pour les adhérents. */
export const GRANT_INFO: Record<Grant, { label: string; description: string; sensitivity: Sensitivity }> = {
  'club.admin': {
    label: 'Administrer les accès',
    description: 'Inviter, retirer et modifier les droits de chacun ; domaine du site ; purge des anciennes saisons.',
    sensitivity: 'critique',
  },
  'members.read': {
    label: 'Consulter les dossiers des adhérents',
    description: 'Identité, coordonnées, date de naissance, pièces (certificat médical, identité), informations de santé, souvent de mineurs.',
    sensitivity: 'élevée',
  },
  'members.write': {
    label: 'Valider et modifier les dossiers',
    description: 'Valider, refuser, demander une correction, vérifier le Pass’Sport, envoyer les réinscriptions.',
    sensitivity: 'élevée',
  },
  'finance.read': {
    label: 'Consulter les finances',
    description: 'Paiements des familles, échéanciers, chèques, montants dus.',
    sensitivity: 'élevée',
  },
  'finance.write': {
    label: 'Gérer les paiements',
    description: 'Saisir et modifier les encaissements, commandes, paiement en ligne, abonnement du club.',
    sensitivity: 'élevée',
  },
  'communication.manage': {
    label: 'Messagerie du club',
    description: 'Configurer l’adresse d’envoi du club (Gmail ou SMTP) utilisée pour écrire aux familles.',
    sensitivity: 'élevée',
  },
  'sport.manage': {
    label: 'Sportif de tout le club',
    description: 'Appel, événements et convocations de toutes les catégories, avec les contacts d’urgence.',
    sensitivity: 'modérée',
  },
  'settings.manage': {
    label: 'Réglages du club',
    description: 'Modules, formulaire d’inscription, informations générales.',
    sensitivity: 'modérée',
  },
  'organization.manage': {
    label: 'Catégories, créneaux et tarifs',
    description: 'Catégories, lieux, horaires, prix et boutique.',
    sensitivity: 'faible',
  },
  'content.write': {
    label: 'Site et contenus',
    description: 'Textes, actualités, images, galerie et vitrine.',
    sensitivity: 'faible',
  },
  'partners.manage': {
    label: 'Partenaires',
    description: 'Partenaires et demandes de partenariat.',
    sensitivity: 'faible',
  },
  'stats.read': {
    label: 'Statistiques de visite',
    description: 'Fréquentation anonyme du site.',
    sensitivity: 'faible',
  },
  'attendance.take': {
    label: 'Appel de ses catégories',
    description: 'Feuille d’appel et contacts d’urgence, uniquement pour les catégories rattachées.',
    sensitivity: 'modérée',
  },
  'events.manage': {
    label: 'Événements de ses catégories',
    description: 'Créer des événements et convoquer, uniquement pour les catégories rattachées.',
    sensitivity: 'modérée',
  },
};

/** Droits donnant accès aux données personnelles des adhérents (compteur et avertissements). */
export const PERSONAL_DATA_GRANTS: readonly Grant[] = ['members.read', 'members.write', 'finance.read', 'finance.write'];

/** Au-delà, l'écran recommande de réduire le nombre de personnes ayant accès aux dossiers. */
export const RECOMMENDED_MAX_PERSONAL_DATA_ACCESS = 4;

/** Droits pré-cochés par un rôle. */
export function defaultGrants(role: AnyStaffRole): Grant[] {
  if (role === 'super_admin') return [...ALL_GRANTS];
  if (!isClubRole(role)) return [];
  return [...ROLE_PERMISSIONS[role], ...ROLE_SCOPED_PERMISSIONS[role]];
}

/** Droits effectifs d'une personne : sa liste personnalisée, sinon ceux de son rôle. Inconnus ignorés. */
export function effectiveGrants(role: AnyStaffRole, permissions: readonly unknown[] | null | undefined): Grant[] {
  if (role === 'super_admin') return [...ALL_GRANTS];
  if (!Array.isArray(permissions)) return defaultGrants(role);
  return ALL_GRANTS.filter((g) => permissions.includes(g));
}

/** Liste propre à enregistrer : droits connus, sans doublon, dans l'ordre du catalogue. */
export function normalizeGrants(input: unknown): Grant[] {
  return Array.isArray(input) ? ALL_GRANTS.filter((g) => input.includes(g)) : [];
}

/** Vrai si les droits ont la permission sur tout le club. */
export function grantsCan(grants: readonly Grant[], permission: Permission): boolean {
  return grants.includes(permission);
}

export function grantsCanAny(grants: readonly Grant[], permissions: readonly Permission[]): boolean {
  return permissions.some((p) => grants.includes(p));
}

/** Vrai si ces droits ne valent que pour des catégories rattachées (aucun droit sur tout le club). */
export function isScopedOnly(grants: readonly Grant[]): boolean {
  return !grants.some((g) => (PERMISSIONS as readonly string[]).includes(g));
}

/** Avertissements à afficher avant d'enregistrer des droits. */
export function grantWarnings(grants: readonly Grant[], hasCategories: boolean): string[] {
  const out: string[] = [];
  if (grants.includes('club.admin')) {
    out.push('Cette personne pourra inviter d’autres personnes et modifier tous les droits, y compris les vôtres. À réserver à une ou deux personnes de confiance.');
  }
  if (grants.includes('members.read') || grants.includes('members.write')) {
    out.push('Accès aux dossiers des adhérents : données personnelles, souvent de mineurs, et informations de santé. Le club en est responsable (RGPD) : ne l’accordez qu’aux personnes qui traitent les inscriptions.');
  }
  if (grants.includes('finance.read') || grants.includes('finance.write')) {
    out.push('Accès aux paiements des familles : à limiter à la trésorerie et à la présidence.');
  }
  if (!hasCategories && grants.some((g) => (SCOPED_PERMISSIONS as readonly string[]).includes(g))) {
    out.push('Aucune catégorie rattachée : l’appel et les événements « de ses catégories » ne donneront accès à rien.');
  }
  return out;
}
