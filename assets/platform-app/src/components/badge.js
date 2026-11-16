import { html, cx } from '../lib/html.js';
import { statusOf, HEALTH } from '../data/status.js';
import { icon } from './icons.js';

export const badge = (label, tone = 'neutral', { dot = true, square = false, tip = '' } = {}) =>
  html`<span class="${cx('badge', `tone-${tone}`, square && 'square')}" ${tip ? html`data-tip="${tip}" tabindex="0"` : ''}>${dot ? html`<span class="dot" aria-hidden="true"></span>` : ''}${label}</span>`;

// Badge d'état à partir d'une table de statuts (LIFECYCLE, BILLING, ACCESS…).
export const statusBadge = (map, key, options) => {
  const s = statusOf(map, key);
  return badge(s.label, s.tone, options);
};

export const healthBadge = (key) => html`<span class="${cx('health', key)}"><span class="dot" aria-hidden="true"></span>${HEALTH[key]?.label ?? key}</span>`;

export const chip = (label) => html`<span class="chip">${label}</span>`;

// Signal « à surveiller » (organizationIssue) : icône + texte coloré.
export const signal = (issue) => (issue ? html`<span class="signal tone-${issue.tone}">${icon(issue.tone === 'violet' ? 'clock' : 'alert', 13)}${issue.label}</span>` : '');

// Pastille de santé compacte (tableaux) : libellé en infobulle et pour les lecteurs d'écran.
export const healthDot = (key) => html`<span class="health ${key}" data-tip="${HEALTH[key]?.label ?? key}" tabindex="0"><span class="dot" aria-hidden="true"></span><span class="sr-only">${HEALTH[key]?.label ?? key}</span></span>`;
