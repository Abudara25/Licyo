const HEX = /^#?([0-9a-f]{6})$/i;

/** Valide une couleur #RRGGBB ; renvoie la valeur de repli sinon. */
export function safeHex(color: string | null | undefined, fallback = '#1E40AF'): string {
  const m = color ? HEX.exec(color.trim()) : null;
  return m ? `#${m[1].toUpperCase()}` : fallback;
}

/** Luminance YIQ (0-255) d'une couleur #RRGGBB. */
export function yiq(color: string): number {
  const hex = safeHex(color).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** Couleur de texte lisible par-dessus le fond donné. */
export function readableTextColor(background: string): '#FFFFFF' | '#09090B' {
  return yiq(background) >= 128 ? '#09090B' : '#FFFFFF';
}

/** Variables CSS du club, injectées dans /[domain]/layout.tsx. */
export function clubCssVariables(primary: string, secondary: string): Record<string, string> {
  const p = safeHex(primary, '#1E40AF');
  const s = safeHex(secondary, '#FBBF24');
  return {
    '--club-primary': p,
    '--club-primary-fg': readableTextColor(p),
    '--club-secondary': s,
    '--club-secondary-fg': readableTextColor(s),
  };
}
