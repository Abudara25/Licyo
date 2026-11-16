import { html, cx, safeColor } from '../lib/html.js';

// Logo d'organisation : initiales sur la couleur principale (aucune image chargée).
export const orgLogo = (org, size = '', { presence = false } = {}) =>
  html`<span class="${cx('org-logo', size)}" style="background:${safeColor(org.color)}" aria-hidden="true">${org.initials}${presence ? html`<span class="presence ${org.health}"></span>` : ''}</span>`;

export const avatar = (initials, label = '') => html`<span class="avatar" ${label ? html`title="${label}"` : ''} aria-hidden="true">${initials}</span>`;

export const initialsOf = (name) =>
  String(name || '?')
    .split(/[\s'-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
