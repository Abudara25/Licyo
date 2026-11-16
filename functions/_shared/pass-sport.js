// Code Pass'Sport (aide de l'État de 50 €, déduite de l'adhésion). Format de la campagne 2026-2027 : 10 caractères,
// « 26-XXXX-XXXX » (2 chiffres = année de la campagne, puis deux blocs de 4 lettres ou chiffres). La famille peut le
// taper sans tirets, en minuscules ou avec des espaces : il est remis en forme (majuscules, tirets) dans le navigateur
// (assets/js/pass-sport.js, même règle) et ici, côté serveur, qui seul fait foi.
// Si le format change une saison, modifier PASS_SPORT_RE ET assets/js/pass-sport.js (test : tests/pass-sport.test.mjs).

export const PASS_SPORT_CENTS = 5000;
export const PASS_SPORT_RE = /^\d{2}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// Mise en forme progressive : « 26ab12cd34 » → « 26-AB12-CD34 », « 26a » → « 26-A ». Tout ce qui n'est pas une lettre
// ou un chiffre est retiré, 10 caractères au plus.
export function formatPassSportCode(value) {
  const raw = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  return [raw.slice(0, 2), raw.slice(2, 6), raw.slice(6, 10)].filter(Boolean).join('-');
}

// '' si vide, le code mis en forme s'il est complet et valide, null sinon (à refuser).
export function normalizePassSportCode(value) {
  if (!String(value ?? '').trim()) return '';
  const code = formatPassSportCode(value);
  return PASS_SPORT_RE.test(code) ? code : null;
}

export const PASS_SPORT_ERROR = "Code Pass'Sport invalide : 10 lettres ou chiffres, au format 26-XXXX-XXXX (les tirets s'ajoutent tout seuls).";
