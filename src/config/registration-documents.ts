// Pièces à fournir à l'inscription, configurables par club (même principe que les champs du formulaire).
//
// - Le certificat médical reste piloté par la catégorie (questionnaire de santé ou certificat exigé) : il n'est pas
//   réglable ici, pour ne jamais affaiblir une exigence fédérale.
// - Photo et pièce d'identité sont stockées dans les colonnes historiques de members ; les autres pièces dans
//   member_documents (une ligne par pièce). Toutes vont dans le stockage R2 privé.
// - Réglages enregistrés dans clubs.registration_form (clés « documents » et « customDocuments »), lus avec
//   parseDocumentsConfig ; tout ce qui n'est pas reconnu est ignoré.
// Module pur : importé par le serveur, les composants et les tests.

import type { SportFamily } from './sports-presets.ts';
import type { FieldAudience, FieldMode } from './registration-fields.ts';

export type DocStorage = 'photo' | 'id' | 'extra';

export type CatalogDocument = {
  key: string;
  label: string;
  hint?: string;
  storage: DocStorage;
  families?: readonly SportFamily[];
  defaultMode: FieldMode;
  defaultAudience: FieldAudience;
};

export const DOCUMENT_CATALOG: readonly CatalogDocument[] = [
  { key: 'photo', label: 'Photo d’identité', storage: 'photo', defaultMode: 'required', defaultAudience: 'all', hint: 'Pour la licence et la carte d’adhérent.' },
  { key: 'id', label: 'Pièce d’identité', storage: 'id', defaultMode: 'optional', defaultAudience: 'all' },
  { key: 'parental_authorization_doc', label: 'Autorisation parentale signée', storage: 'extra', defaultMode: 'off', defaultAudience: 'minor', hint: 'Document du club, imprimé, signé puis photographié.' },
  { key: 'residence_proof', label: 'Justificatif de domicile', storage: 'extra', defaultMode: 'off', defaultAudience: 'all', hint: 'Utile pour un tarif réservé aux habitants de la commune.' },
  { key: 'aid_proof', label: 'Justificatif d’aide (CAF, CE, Pass’Sport…)', storage: 'extra', defaultMode: 'off', defaultAudience: 'all' },
  { key: 'previous_license', label: 'Licence de la saison précédente', storage: 'extra', defaultMode: 'off', defaultAudience: 'all' },
  { key: 'sport_passport_doc', label: 'Passeport sportif (page d’identité)', storage: 'extra', families: ['combat'], defaultMode: 'off', defaultAudience: 'all' },
];

export const MAX_CUSTOM_DOCUMENTS = 5;
const CUSTOM_ID = /^d_[a-z0-9_]{1,20}$/;
const MODES: readonly FieldMode[] = ['off', 'optional', 'required'];
const AUDIENCES: readonly FieldAudience[] = ['all', 'minor', 'adult'];
const CATALOG_KEYS = new Set(DOCUMENT_CATALOG.map((d) => d.key));

export type CustomDocument = { id: string; label: string; mode: Exclude<FieldMode, 'off'>; audience: FieldAudience };
export type DocumentSetting = { mode: FieldMode; audience: FieldAudience };
export type DocumentsConfig = { documents: Record<string, DocumentSetting>; customDocuments: CustomDocument[] };

export type ResolvedDocument = {
  key: string;
  label: string;
  hint?: string;
  storage: DocStorage;
  mode: Exclude<FieldMode, 'off'>;
  audience: FieldAudience;
};

/** Clé de pièce valide (catalogue ou pièce du club) : sert aussi à refuser toute clé fournie par le navigateur. */
export function isDocumentKey(key: string): boolean {
  return CATALOG_KEYS.has(key) || CUSTOM_ID.test(key);
}

export function parseDocumentsConfig(raw: unknown): DocumentsConfig {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const documents: Record<string, DocumentSetting> = {};
  const rawDocs = obj.documents && typeof obj.documents === 'object' ? (obj.documents as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(rawDocs)) {
    if (!CATALOG_KEYS.has(key) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    if (MODES.includes(v.mode as FieldMode) && AUDIENCES.includes(v.audience as FieldAudience)) {
      documents[key] = { mode: v.mode as FieldMode, audience: v.audience as FieldAudience };
    }
  }
  const customDocuments: CustomDocument[] = [];
  const seen = new Set<string>();
  for (const d of Array.isArray(obj.customDocuments) ? obj.customDocuments : []) {
    if (!d || typeof d !== 'object' || customDocuments.length >= MAX_CUSTOM_DOCUMENTS) continue;
    const c = d as Record<string, unknown>;
    const label = typeof c.label === 'string' ? c.label.trim().slice(0, 120) : '';
    if (
      typeof c.id !== 'string' || !CUSTOM_ID.test(c.id) || seen.has(c.id) || !label ||
      (c.mode !== 'optional' && c.mode !== 'required') || !AUDIENCES.includes(c.audience as FieldAudience)
    ) continue;
    seen.add(c.id);
    customDocuments.push({ id: c.id, label, mode: c.mode, audience: c.audience as FieldAudience });
  }
  return { documents, customDocuments };
}

/** Catalogue proposé pour ce sport, avec le réglage du club (éditeur du back-office). */
export function editableDocuments(config: DocumentsConfig, family: SportFamily) {
  return DOCUMENT_CATALOG.filter((d) => !d.families || d.families.includes(family)).map((d) => ({
    document: d,
    setting: config.documents[d.key] ?? { mode: d.defaultMode, audience: d.defaultAudience },
  }));
}

/** Pièces demandées par le club (hors certificat médical), dans l'ordre du catalogue puis des pièces du club. */
export function resolveDocuments(config: DocumentsConfig, family: SportFamily): ResolvedDocument[] {
  const out: ResolvedDocument[] = [];
  for (const { document: d, setting } of editableDocuments(config, family)) {
    if (setting.mode === 'off') continue;
    out.push({ key: d.key, label: d.label, hint: d.hint, storage: d.storage, mode: setting.mode, audience: setting.audience });
  }
  for (const c of config.customDocuments) out.push({ key: c.id, label: c.label, storage: 'extra', mode: c.mode, audience: c.audience });
  return out;
}

/** Réglages par défaut (club qui n'a rien configuré) : photo obligatoire, pièce d'identité facultative. */
export const DEFAULT_DOCUMENTS: readonly ResolvedDocument[] = resolveDocuments({ documents: {}, customDocuments: [] }, 'collectif');

export function documentApplies(doc: Pick<ResolvedDocument, 'audience'>, isMinor: boolean): boolean {
  return doc.audience === 'all' || (doc.audience === 'minor') === isMinor;
}

/** Libellé d'une pièce (catalogue ou pièce du club), même si elle a été retirée depuis. */
export function documentLabel(config: DocumentsConfig, key: string): string {
  return DOCUMENT_CATALOG.find((d) => d.key === key)?.label ?? config.customDocuments.find((d) => d.id === key)?.label ?? 'Pièce retirée par le club';
}
