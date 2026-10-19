// Graphiques SVG légers (aucune bibliothèque). Données fournies par les fixtures.
import { html, safeColor } from '../lib/html.js';

// Valeurs acceptées dans le SVG et les styles : des nombres finis et des couleurs validées par safeColor.
// Tout le reste est refusé ou remplacé : aucune donnée ne peut produire
// de balisage, d'attribut ou de style arbitraire, même quand les graphiques seront alimentés par une API.
export function finite(value) {
  const n = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(n)) throw new TypeError('graphique : valeur numérique invalide');
  return n;
}
const f1 = (n) => finite(n).toFixed(1);
const pathOf = (points) => points.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join(' ');

export function sparkline(values, { width = 56, height = 26, color = 'var(--ui-brand)' } = {}) {
  const v = values.map(finite);
  const w = finite(width);
  const h = finite(height);
  const max = Math.max(...v);
  const min = Math.min(...v);
  const span = max - min || 1;
  const d = pathOf(v.map((n, i) => [(i / Math.max(1, v.length - 1)) * w, h - 3 - ((n - min) / span) * (h - 6)]));
  return html`<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false"><path d="${d}" fill="none" stroke="${safeColor(color)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

// Courbe en aire avec quadrillage ; les libellés d'axe sont en HTML (lisibles, redimensionnables).
export function areaChart({ values, labels, ariaLabel, height = 200 }) {
  const v = values.map(finite);
  const h = finite(height);
  const width = 640;
  const pad = 8;
  const max = Math.ceil(Math.max(...v) * 1.15) || 1;
  const x = (i) => pad + (i / Math.max(1, v.length - 1)) * (width - pad * 2);
  const y = (n) => h - pad - (n / max) * (h - pad * 2);
  const line = pathOf(v.map((n, i) => [x(i), y(n)]));
  const area = `${line} L${f1(x(v.length - 1))} ${f1(h - pad)} L${f1(x(0))} ${f1(h - pad)} Z`;
  const last = v.length - 1;
  return html`
    <figure class="chart" style="margin:0">
      <svg viewBox="0 0 ${width} ${h}" preserveAspectRatio="none" role="img" aria-label="${ariaLabel}" focusable="false" style="height:${h}px">
        <defs><linearGradient id="ui-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3346d3" stop-opacity=".22"/><stop offset="1" stop-color="#3346d3" stop-opacity="0"/></linearGradient></defs>
        ${[0.25, 0.5, 0.75].map((r) => html`<line x1="${pad}" x2="${width - pad}" y1="${f1(pad + r * (h - pad * 2))}" y2="${f1(pad + r * (h - pad * 2))}" stroke="#eceef2" stroke-dasharray="3 4"/>`)}
        <path d="${area}" fill="url(#ui-area)"/>
        <path d="${line}" fill="none" stroke="#3346d3" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <circle cx="${f1(x(last))}" cy="${f1(y(v[last]))}" r="4.5" fill="#fff" stroke="#3346d3" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="chart-axis" aria-hidden="true">${labels.map((l, i) => html`<span class="${i % 2 ? 'minor' : ''}">${l}</span>`)}</div>
    </figure>`;
}

// Liste de barres horizontales (répartition).
export const barList = (rows) => html`
  <div class="bar-list">
    ${rows.map(
      (r) => html`<div class="bar-row">
        <span>${r.label}</span>
        <span class="bar-track" role="img" aria-label="${r.label} : ${r.value}"><span style="width:${Math.max(4, Math.min(100, Math.round(finite(r.ratio) * 100)))}%;background:${safeColor(r.color)}"></span></span>
        <span class="num right">${r.value}</span>
      </div>`
    )}
  </div>`;

// Disponibilité sur 90 jours.
export const uptimeBars = (days, label) =>
  html`<div class="uptime" role="img" aria-label="${label}">${days.map((d) => html`<span class="${d === 'ok' ? '' : d}"></span>`)}</div>`;
