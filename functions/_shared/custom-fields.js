// Champs propres au club (2026-10-20) : Licyo vise tous les sports, et chaque sport a ses informations (grade ou
// ceinture au judo, classement au tennis, « sait nager » en natation…). Le club définit jusqu'à 10 champs dans
// /admin/parametres ; ils apparaissent dans le formulaire d'inscription (ajoutés par assets/js/inscription.js d'après
// /api/categories), dans la réinscription, la fiche admin, le PDF et l'export CSV.
//
// Définitions : KV de l'organisation (clé custom_fields). Valeurs : colonne inscriptions.custom_fields (JSON
// { clé: valeur }, migration 16, additive). Clés stables : une clé enregistrée n'est jamais renommée (le libellé, si).
import { readSetting, writeSetting } from './settings-kv.js';

export const MAX_CUSTOM_FIELDS = 10;
export const MAX_VALUE_LENGTH = 100;
const KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
const TYPES = ['text', 'select', 'number'];
// Colonne inscriptions.custom_fields : migration 16 de schema.js (déclarée là pour éviter un import circulaire).

// Suggestions par sport (clé de sport-profile.js). Le club les ajoute d'un clic, puis les modifie librement.
const BELTS = ['Blanche', 'Blanche-jaune', 'Jaune', 'Jaune-orange', 'Orange', 'Orange-verte', 'Verte', 'Verte-bleue', 'Bleue', 'Marron', 'Noire'];
export const SPORT_SUGGESTIONS = Object.freeze({
  judo: [{ key: 'grade', label: 'Ceinture actuelle', type: 'select', options: BELTS, required: true }],
  karate: [{ key: 'grade', label: 'Ceinture actuelle', type: 'select', options: BELTS, required: true }],
  boxe: [{ key: 'poids', label: 'Poids (kg)', type: 'number', required: false }, { key: 'experience', label: 'Pratique déjà la boxe ?', type: 'select', options: ['Non, débutant', 'Oui, moins de 2 ans', 'Oui, plus de 2 ans'], required: true }],
  muaythai: [{ key: 'poids', label: 'Poids (kg)', type: 'number', required: false }, { key: 'experience', label: 'Pratique déjà un sport de combat ?', type: 'select', options: ['Non, débutant', 'Oui, moins de 2 ans', 'Oui, plus de 2 ans'], required: true }],
  natation: [{ key: 'sait_nager', label: 'Sait nager 25 m sans aide ?', type: 'select', options: ['Oui', 'Non', 'Je ne sais pas'], required: true }],
  tennis: [{ key: 'classement', label: 'Classement (si connu)', type: 'text', required: false }],
  gymnastique: [{ key: 'niveau', label: 'Niveau', type: 'select', options: ['Débutant', 'Intermédiaire', 'Confirmé'], required: true }],
  athletisme: [{ key: 'discipline', label: 'Discipline préférée', type: 'select', options: ['Sprint', 'Demi-fond', 'Sauts', 'Lancers', 'Toutes'], required: false }],
  basketball: [{ key: 'poste', label: 'Poste (si connu)', type: 'text', required: false }],
  handball: [{ key: 'poste', label: 'Poste (si connu)', type: 'text', required: false }],
  rugby: [{ key: 'poste', label: 'Poste (si connu)', type: 'text', required: false }],
  volley: [{ key: 'poste', label: 'Poste (si connu)', type: 'text', required: false }],
  football: [{ key: 'poste', label: 'Poste préféré (si connu)', type: 'select', options: ['Gardien', 'Défenseur', 'Milieu', 'Attaquant', 'Je ne sais pas'], required: false }],
});

const cleanText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function slugKey(label) {
  const base = cleanText(label, 60).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const key = /^[a-z]/.test(base) ? base : `champ_${base}`;
  return key.slice(0, 30).replace(/_+$/, '') || 'champ';
}

// Liste nettoyée et contrôlée (jamais d'erreur : les entrées invalides sont ignorées).
export function normalizeDefinitions(list) {
  const out = [];
  const keys = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    if (!raw || typeof raw !== 'object') continue;
    const label = cleanText(raw.label, 80);
    if (!label) continue;
    let key = KEY_RE.test(raw.key || '') ? raw.key : slugKey(label);
    while (keys.has(key)) key = `${key.slice(0, 27)}_${keys.size}`;
    const type = TYPES.includes(raw.type) ? raw.type : 'text';
    const options = type === 'select' ? [...new Set((Array.isArray(raw.options) ? raw.options : []).map((o) => cleanText(o, 60)).filter(Boolean))].slice(0, 30) : [];
    if (type === 'select' && options.length < 2) continue;
    keys.add(key);
    out.push({ key, label, type, options, required: raw.required === true });
    if (out.length >= MAX_CUSTOM_FIELDS) break;
  }
  return out;
}

export async function getCustomFields(env, organizationId) {
  try {
    const raw = await readSetting(env, organizationId, 'custom_fields');
    return normalizeDefinitions(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export async function setCustomFields(env, organizationId, list) {
  const clean = normalizeDefinitions(list);
  await writeSetting(env, organizationId, 'custom_fields', JSON.stringify(clean));
  return clean;
}

// Valeurs envoyées par le formulaire, contrôlées contre les définitions : { values, error }. Clés inconnues ignorées.
export function validateValues(definitions, input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const values = {};
  for (const def of definitions) {
    const value = cleanText(source[def.key], MAX_VALUE_LENGTH);
    if (!value) {
      if (def.required) return { values: null, error: `Champ manquant : ${def.label}` };
      continue;
    }
    if (def.type === 'select' && !def.options.includes(value)) return { values: null, error: `Valeur invalide : ${def.label}` };
    if (def.type === 'number' && !/^\d{1,4}([.,]\d{1,2})?$/.test(value)) return { values: null, error: `Nombre attendu : ${def.label}` };
    values[def.key] = value;
  }
  return { values, error: null };
}

export function parseValues(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Lignes « libellé : valeur » d'une inscription (fiche, PDF, CSV) ; valeurs d'un champ supprimé conservées avec leur clé.
export function displayRows(definitions, raw) {
  const values = parseValues(raw);
  const rows = definitions.filter((d) => values[d.key]).map((d) => ({ key: d.key, label: d.label, value: String(values[d.key]) }));
  for (const [key, value] of Object.entries(values)) if (!definitions.some((d) => d.key === key) && value) rows.push({ key, label: key, value: String(value) });
  return rows;
}
