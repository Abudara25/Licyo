// Couleurs d'un club (2026-10-20) : à partir de deux couleurs choisies dans l'admin (principale et secondaire), calcule
// les primitives de palette du thème (mêmes noms que styles/palettes/<club>.css) et les écrit dans une balise <style>
// placée juste après la feuille de style : elles remplacent celles de la palette de référence, sans régénérer le CSS.
// Pur (aucun accès réseau ni base). Les couleurs d'état (succès, alerte) ne changent pas.
const HEX = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value) => typeof value === 'string' && HEX.test(value);

const toRgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (rgb, target, amount) => rgb.map((v, i) => v + (target[i] - v) * amount);
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// Version assombrie jusqu'au contraste demandé sur blanc (texte lisible).
function readableOnWhite(rgb, ratio = 4.5) {
  let color = rgb;
  for (let i = 0; i < 40 && contrast(color, WHITE) < ratio; i += 1) color = mix(color, BLACK, 0.06);
  return color;
}

// Variables CSS d'une palette ; null si les couleurs sont invalides.
export function paletteVariables({ primary, accent } = {}) {
  if (!isHexColor(primary) || !isHexColor(accent)) return null;
  // La couleur principale sert de fond aux bandeaux (texte blanc) : assombrie si besoin pour rester lisible.
  const p700 = readableOnWhite(toRgb(primary), 4.5);
  const a500 = toRgb(accent);
  const shades = {
    'primary-950': mix(p700, BLACK, 0.55),
    'primary-900': mix(p700, BLACK, 0.38),
    'primary-800': mix(p700, BLACK, 0.16),
    'primary-700': p700,
    'primary-600': mix(p700, WHITE, 0.12),
    'accent-800': readableOnWhite(mix(a500, BLACK, 0.2)),
    'accent-600': mix(a500, BLACK, 0.13),
    'accent-500': a500,
    'accent-400': mix(a500, WHITE, 0.25),
    'accent-300': mix(a500, WHITE, 0.5),
    'accent-100': mix(a500, WHITE, 0.88),
    'neutral-100': mix(a500, WHITE, 0.95),
    'neutral-200': mix(a500, WHITE, 0.86),
  };
  const vars = {};
  for (const [name, rgb] of Object.entries(shades)) vars[`--brand-${name}`] = toHex(rgb);
  for (const name of ['primary-950', 'primary-900', 'primary-700', 'accent-600', 'accent-500', 'neutral-100']) {
    vars[`--brand-${name}-rgb`] = toRgb(vars[`--brand-${name}`]).join(', ');
  }
  return vars;
}

// Balise <style> (valeurs générées par ce module uniquement : aucun texte venant d'une saisie n'y entre).
export function paletteStyleTag(colors) {
  const vars = paletteVariables(colors);
  if (!vars) return '';
  return `<style id="club-palette">:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}</style>`;
}

// Couleur de la barre du navigateur (meta theme-color) : la teinte la plus sombre de la couleur principale.
export function paletteThemeColor(colors) {
  return paletteVariables(colors)?.['--brand-primary-900'] || null;
}
