// Gabarits HTML avec échappement PAR DÉFAUT : toute valeur interpolée est échappée, sauf un fragment déjà produit
// par `html`. Il n'existe AUCUNE primitive qui transforme une chaîne en balisage (ni raw, ni trusted) : le seul
// balisage non échappé est le texte littéral des gabarits html`…` écrits dans le code. Une donnée (fixture
// aujourd'hui, réponse d'API demain) ne peut donc jamais être insérée telle quelle. Les icônes SVG sont construites
// à partir d'un catalogue structurel (components/icons.js), pas de chaînes de balisage.
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Classe privée au module : aucun appelant ne peut en construire une instance à partir d'une chaîne.
class SafeHtml {
  #value;
  constructor(value) {
    this.#value = value;
  }
  toString() {
    return this.#value;
  }
  static unwrap(item) {
    return item.#value;
  }
}

function piece(value) {
  if (value instanceof SafeHtml) return SafeHtml.unwrap(value);
  if (Array.isArray(value)) return value.map(piece).join('');
  if (value === null || value === undefined || value === false) return '';
  return escape(value);
}

// À utiliser uniquement comme gabarit étiqueté : html`<p>${valeur}</p>`. Un appel direct avec une chaîne ou un tableau
// ordinaire est refusé ; la règle « jamais html(…) » est aussi vérifiée statiquement par les tests. (Un tableau gelé
// fabriqué exprès reste indiscernable d'un vrai gabarit : il faudrait pour cela exécuter du code, jamais une donnée.)
export function html(strings, ...values) {
  const template = Array.isArray(strings) && Object.isFrozen(strings) && Array.isArray(strings.raw) && Object.isFrozen(strings.raw) && strings.raw.length === strings.length && values.length === strings.length - 1;
  if (!template) throw new TypeError('html : gabarit étiqueté uniquement');
  let out = strings[0];
  values.forEach((value, i) => {
    out += piece(value) + strings[i + 1];
  });
  return new SafeHtml(out);
}

// Couleur insérée dans un attribut style : #rgb, #rrggbb ou var(--jeton) uniquement, 64 caractères au plus (borne
// appliquée AVANT l'expression régulière). Toute autre valeur donne DEFAULT_SAFE_COLOR : l'appelant ne fournit
// aucune valeur de repli, donc aucun repli ne peut contourner la validation.
export const DEFAULT_SAFE_COLOR = 'currentColor';
const MAX_COLOR_LENGTH = 64;
const COLOR = /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|var\(--[a-z0-9]+(?:-[a-z0-9]+)*\))$/i;
export const safeColor = (value) => (typeof value === 'string' && value.length <= MAX_COLOR_LENGTH && COLOR.test(value) ? value : DEFAULT_SAFE_COLOR);

export const cx = (...classes) => classes.filter(Boolean).join(' ');
