// Formulaire d'inscription modulable : catalogue commun + réglages propres à chaque club.
//
// Chaque club est différent : le catalogue réunit ce que demandent les clubs de sports collectifs et de sports de
// combat (champs vus chez les clubs pilotes et dans les dossiers de licence fédérale). Le club active chaque champ
// (désactivé, facultatif, obligatoire), choisit le public concerné (tous, mineurs, majeurs) et peut ajouter ses
// propres questions. Les champs de base (identité, catégorie, responsable, urgence, signature) restent toujours
// demandés par le tunnel et ne figurent pas ici.
//
// Les réponses sont stockées dans members.extra_fields (JSON) ; le serveur valide TOUJOURS selon les réglages du club
// (validateExtraAnswers) : une réponse à un champ désactivé ou inconnu est ignorée, un champ obligatoire manquant
// bloque l'inscription. Module pur : importé par le serveur, les composants et les tests.

import type { SportFamily } from './sports-presets.ts';

export type FieldMode = 'off' | 'optional' | 'required';
export type FieldAudience = 'all' | 'minor' | 'adult';
export type FieldType = 'text' | 'textarea' | 'number' | 'select' | 'checkbox';

export type FieldGroup = 'identite' | 'sante' | 'famille' | 'sport' | 'autorisations' | 'club';

export const FIELD_GROUP_LABELS: Record<FieldGroup, string> = {
  identite: 'Identité et licence',
  sante: 'Santé',
  famille: 'Famille',
  sport: 'Pratique sportive',
  autorisations: 'Autorisations',
  club: 'Vie du club',
};

export type CatalogField = {
  key: string;
  label: string;
  type: FieldType;
  group: FieldGroup;
  /** Options d'une liste ; une fonction quand elles dépendent du sport. */
  options?: readonly string[] | ((sport: string) => readonly string[]);
  /** Aide affichée sous le champ. */
  hint?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  /** Familles de sport concernées ; absent = tous les sports ciblés. */
  families?: readonly SportFamily[];
  /** Sports concernés ; absent = tous ceux des familles. */
  sports?: readonly string[];
  /** Réglage proposé à un nouveau club. */
  defaultMode: FieldMode;
  defaultAudience: FieldAudience;
};

const POSITIONS: Record<string, readonly string[]> = {
  football: ['Gardien', 'Défenseur', 'Milieu', 'Attaquant', 'Pas de préférence'],
  basketball: ['Meneur', 'Arrière', 'Ailier', 'Ailier fort', 'Pivot', 'Pas de préférence'],
  handball: ['Gardien', 'Ailier', 'Arrière', 'Demi-centre', 'Pivot', 'Pas de préférence'],
  volleyball: ['Passeur', 'Réceptionneur-attaquant', 'Central', 'Pointu', 'Libéro', 'Pas de préférence'],
  rugby: ['Première ligne', 'Deuxième ligne', 'Troisième ligne', 'Demi de mêlée', "Demi d'ouverture", 'Centre', 'Ailier', 'Arrière', 'Pas de préférence'],
};
const LEVELS = ['Débutant', 'Intermédiaire', 'Confirmé'] as const;
const SIZES = ['6 ans', '8 ans', '10 ans', '12 ans', '14 ans', 'XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

export const FIELD_CATALOG: readonly CatalogField[] = [
  // Identité et licence (dossiers fédéraux)
  { key: 'birth_place', label: 'Lieu de naissance (ville)', type: 'text', group: 'identite', maxLength: 80, defaultMode: 'off', defaultAudience: 'all', hint: 'Demandé par certaines fédérations pour la licence.' },
  { key: 'nationality', label: 'Nationalité', type: 'text', group: 'identite', maxLength: 60, defaultMode: 'off', defaultAudience: 'all' },
  { key: 'previous_club', label: 'Club précédent', type: 'text', group: 'identite', maxLength: 100, defaultMode: 'off', defaultAudience: 'all' },
  { key: 'license_number', label: 'Numéro de licence (si déjà licencié)', type: 'text', group: 'identite', maxLength: 30, defaultMode: 'optional', defaultAudience: 'all' },
  { key: 'sport_passport', label: 'Numéro de passeport sportif', type: 'text', group: 'identite', maxLength: 30, families: ['combat'], defaultMode: 'off', defaultAudience: 'all' },
  { key: 'profession', label: 'Profession', type: 'text', group: 'identite', maxLength: 80, defaultMode: 'off', defaultAudience: 'adult' },
  { key: 'school', label: 'Établissement scolaire', type: 'text', group: 'identite', maxLength: 100, defaultMode: 'off', defaultAudience: 'minor' },

  // Santé
  { key: 'allergies', label: 'Allergies ou traitement en cours', type: 'textarea', group: 'sante', maxLength: 500, defaultMode: 'optional', defaultAudience: 'all', hint: 'Seuls les membres du bureau qui gèrent les dossiers y ont accès.' },
  { key: 'doctor', label: 'Médecin traitant (nom et téléphone)', type: 'text', group: 'sante', maxLength: 120, defaultMode: 'off', defaultAudience: 'minor' },
  { key: 'medical_notes', label: 'Autres informations médicales utiles', type: 'textarea', group: 'sante', maxLength: 500, defaultMode: 'off', defaultAudience: 'all' },

  // Famille
  { key: 'guardian2_name', label: 'Second responsable légal : nom et prénom', type: 'text', group: 'famille', maxLength: 80, defaultMode: 'off', defaultAudience: 'minor' },
  { key: 'guardian2_phone', label: 'Second responsable légal : téléphone', type: 'text', group: 'famille', maxLength: 20, defaultMode: 'off', defaultAudience: 'minor' },
  { key: 'guardian2_email', label: 'Second responsable légal : e-mail', type: 'text', group: 'famille', maxLength: 120, defaultMode: 'off', defaultAudience: 'minor' },

  // Pratique sportive
  { key: 'level', label: 'Niveau', type: 'select', group: 'sport', options: LEVELS, defaultMode: 'off', defaultAudience: 'all' },
  { key: 'experience_years', label: 'Années de pratique', type: 'number', group: 'sport', min: 0, max: 60, defaultMode: 'off', defaultAudience: 'all' },
  { key: 'position', label: 'Poste préféré', type: 'select', group: 'sport', families: ['collectif'], options: (sport) => POSITIONS[sport] ?? ['Pas de préférence'], defaultMode: 'off', defaultAudience: 'all' },
  { key: 'strong_foot', label: 'Pied fort', type: 'select', group: 'sport', sports: ['football', 'rugby'], families: ['collectif'], options: ['Droit', 'Gauche', 'Les deux'], defaultMode: 'off', defaultAudience: 'all' },
  { key: 'grade', label: 'Grade ou ceinture actuel', type: 'text', group: 'sport', families: ['combat'], maxLength: 40, defaultMode: 'optional', defaultAudience: 'all' },
  { key: 'weight_kg', label: 'Poids (kg)', type: 'number', group: 'sport', families: ['combat'], min: 10, max: 200, defaultMode: 'off', defaultAudience: 'all', hint: 'Utile pour les catégories de poids en compétition.' },
  { key: 'competitor', label: 'Souhaite faire de la compétition', type: 'checkbox', group: 'sport', defaultMode: 'off', defaultAudience: 'all' },
  { key: 'outfit_size', label: 'Taille de tenue', type: 'select', group: 'sport', options: SIZES, defaultMode: 'off', defaultAudience: 'all' },

  // Autorisations (signées avec la signature électronique du tunnel)
  { key: 'parental_authorization', label: 'J’autorise mon enfant à pratiquer l’activité au sein du club', type: 'checkbox', group: 'autorisations', defaultMode: 'off', defaultAudience: 'minor' },
  { key: 'transport_authorization', label: 'J’autorise le transport de mon enfant par les encadrants ou d’autres parents lors des déplacements', type: 'checkbox', group: 'autorisations', defaultMode: 'off', defaultAudience: 'minor' },
  { key: 'whatsapp_group', label: 'J’accepte d’être ajouté au groupe de messagerie du groupe', type: 'checkbox', group: 'autorisations', defaultMode: 'off', defaultAudience: 'all' },

  // Vie du club
  { key: 'volunteer_interest', label: 'Je souhaite donner un coup de main au club (bénévolat)', type: 'checkbox', group: 'club', defaultMode: 'off', defaultAudience: 'all' },
  { key: 'how_heard', label: 'Comment avez-vous connu le club ?', type: 'select', group: 'club', options: ['Bouche à oreille', 'Réseaux sociaux', 'Forum des associations', 'École', 'Internet', 'Autre'], defaultMode: 'off', defaultAudience: 'all' },
];

const CATALOG_BY_KEY = new Map(FIELD_CATALOG.map((f) => [f.key, f]));

export const MAX_CUSTOM_QUESTIONS = 10;

/** Question ajoutée par le club. */
export type CustomQuestion = {
  id: string; // c_ + 1 à 20 caractères [a-z0-9_]
  label: string;
  type: Exclude<FieldType, 'number'>;
  options?: string[];
  mode: Exclude<FieldMode, 'off'>;
  audience: FieldAudience;
};

export type FieldSetting = { mode: FieldMode; audience: FieldAudience };

/** Réglages enregistrés dans clubs.registration_form. */
export type RegistrationFormConfig = {
  fields: Record<string, FieldSetting>;
  custom: CustomQuestion[];
};

/** Champ effectif d'un club : catalogue ou question du club, avec son réglage. */
export type ResolvedField = {
  key: string;
  label: string;
  type: FieldType;
  group: FieldGroup | 'questions';
  options?: readonly string[];
  hint?: string;
  maxLength: number;
  min?: number;
  max?: number;
  mode: Exclude<FieldMode, 'off'>;
  audience: FieldAudience;
};

/** Champs du catalogue proposés pour ce sport (familles et sports ciblés). */
export function catalogForSport(sport: string, family: SportFamily): CatalogField[] {
  return FIELD_CATALOG.filter((f) => (!f.families || f.families.includes(family)) && (!f.sports || f.sports.includes(sport)));
}

const MODES: readonly FieldMode[] = ['off', 'optional', 'required'];
const AUDIENCES: readonly FieldAudience[] = ['all', 'minor', 'adult'];
const CUSTOM_ID = /^c_[a-z0-9_]{1,20}$/;
const CUSTOM_TYPES: readonly CustomQuestion['type'][] = ['text', 'textarea', 'select', 'checkbox'];

/**
 * Lit les réglages d'un club en tolérant une valeur absente ou ancienne : tout ce qui n'est pas reconnu est ignoré
 * (jamais d'erreur à l'affichage d'un formulaire public).
 */
export function parseFormConfig(raw: unknown): RegistrationFormConfig {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const fields: Record<string, FieldSetting> = {};
  const rawFields = obj.fields && typeof obj.fields === 'object' ? (obj.fields as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (!CATALOG_BY_KEY.has(key) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (MODES.includes(v.mode as FieldMode) && AUDIENCES.includes(v.audience as FieldAudience)) {
      fields[key] = { mode: v.mode as FieldMode, audience: v.audience as FieldAudience };
    }
  }
  const custom: CustomQuestion[] = [];
  const seen = new Set<string>();
  for (const q of Array.isArray(obj.custom) ? obj.custom : []) {
    if (!q || typeof q !== 'object' || custom.length >= MAX_CUSTOM_QUESTIONS) continue;
    const c = q as Record<string, unknown>;
    const label = typeof c.label === 'string' ? c.label.trim().slice(0, 160) : '';
    const options = Array.isArray(c.options)
      ? [...new Set(c.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim().slice(0, 80)).filter(Boolean))].slice(0, 20)
      : [];
    if (
      typeof c.id !== 'string' || !CUSTOM_ID.test(c.id) || seen.has(c.id) || !label ||
      !CUSTOM_TYPES.includes(c.type as CustomQuestion['type']) ||
      (c.mode !== 'optional' && c.mode !== 'required') || !AUDIENCES.includes(c.audience as FieldAudience) ||
      (c.type === 'select' && options.length < 2)
    ) continue;
    seen.add(c.id);
    custom.push({
      id: c.id,
      label,
      type: c.type as CustomQuestion['type'],
      ...(c.type === 'select' ? { options } : {}),
      mode: c.mode,
      audience: c.audience as FieldAudience,
    });
  }
  return { fields, custom };
}

/** Champs actifs du club, dans l'ordre du catalogue puis des questions du club. */
export function resolveForm(config: RegistrationFormConfig, sport: string, family: SportFamily): ResolvedField[] {
  const out: ResolvedField[] = [];
  for (const f of catalogForSport(sport, family)) {
    const setting = config.fields[f.key] ?? { mode: f.defaultMode, audience: f.defaultAudience };
    if (setting.mode === 'off') continue;
    out.push({
      key: f.key,
      label: f.label,
      type: f.type,
      group: f.group,
      options: typeof f.options === 'function' ? f.options(sport) : f.options,
      hint: f.hint,
      maxLength: f.maxLength ?? 200,
      min: f.min,
      max: f.max,
      mode: setting.mode,
      audience: setting.audience,
    });
  }
  for (const q of config.custom) {
    out.push({ key: q.id, label: q.label, type: q.type, group: 'questions', options: q.options, maxLength: q.type === 'textarea' ? 1000 : 200, mode: q.mode, audience: q.audience });
  }
  return out;
}

/** Vrai si le champ s'adresse à cette personne. */
export function appliesTo(field: Pick<ResolvedField, 'audience'>, isMinor: boolean): boolean {
  return field.audience === 'all' || (field.audience === 'minor') === isMinor;
}

export type ExtraAnswers = Record<string, string | number | boolean>;

/**
 * Valide les réponses d'une personne selon les champs actifs du club. Renvoie les seules réponses retenues
 * (champs actifs qui la concernent, valeurs nettoyées) ou le premier problème rencontré.
 */
export function validateExtraAnswers(
  fields: readonly ResolvedField[],
  answers: unknown,
  isMinor: boolean,
  who: string,
): { ok: true; value: ExtraAnswers } | { ok: false; error: string } {
  const input = answers && typeof answers === 'object' && !Array.isArray(answers) ? (answers as Record<string, unknown>) : {};
  const value: ExtraAnswers = {};
  for (const f of fields) {
    if (!appliesTo(f, isMinor)) continue;
    const raw = input[f.key];
    const missing = () => ({ ok: false as const, error: `${who} : « ${f.label} » est obligatoire.` });
    if (f.type === 'checkbox') {
      const checked = raw === true;
      if (f.mode === 'required' && !checked) return missing();
      value[f.key] = checked;
      continue;
    }
    const text = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
    if (!text) {
      if (f.mode === 'required') return missing();
      continue;
    }
    if (f.type === 'number') {
      const n = Number(text.replace(',', '.'));
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
        return { ok: false, error: `${who} : « ${f.label} » n’est pas une valeur valide.` };
      }
      value[f.key] = n;
      continue;
    }
    if (f.type === 'select') {
      if (!f.options?.includes(text)) return { ok: false, error: `${who} : choisissez une réponse proposée pour « ${f.label} ».` };
      value[f.key] = text;
      continue;
    }
    if (text.length > f.maxLength) return { ok: false, error: `${who} : « ${f.label} » est trop long.` };
    value[f.key] = text;
  }
  return { ok: true, value };
}

/**
 * Réponses lisibles pour le bureau : libellé du catalogue ou de la question du club, même si le champ a été désactivé
 * depuis (les réponses déjà données restent consultables).
 */
export function describeAnswers(config: RegistrationFormConfig, answers: unknown): { label: string; value: string }[] {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  const customById = new Map(config.custom.map((q) => [q.id, q.label]));
  const out: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(answers as Record<string, unknown>)) {
    const label = CATALOG_BY_KEY.get(key)?.label ?? customById.get(key) ?? 'Question retirée par le club';
    const value = raw === true ? 'Oui' : raw === false ? 'Non' : typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    if (value) out.push({ label, value });
  }
  return out;
}

/** Réglages complets (catalogue du sport) pour l'éditeur du back-office. */
export function editableSettings(config: RegistrationFormConfig, sport: string, family: SportFamily) {
  return catalogForSport(sport, family).map((f) => ({
    field: f,
    setting: config.fields[f.key] ?? { mode: f.defaultMode, audience: f.defaultAudience },
  }));
}
