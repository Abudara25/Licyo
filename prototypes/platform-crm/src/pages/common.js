// Aides communes aux pages : bascule des états simulés (chargement, vide, erreur) et libellés partagés.
import { html } from '../lib/html.js';
import { emptyState, errorState, skeletonRows } from '../components/feedback.js';
import { orgById } from '../data/fixtures.js';
import { orgLogo } from '../components/avatar.js';
import { href } from '../router.js';

// Zone de données soumise au scénario choisi dans « Platform Preview ».
export function region(ctx, content, { empty = null, rows = 6 } = {}) {
  if (ctx.state.scenario === 'loading') return skeletonRows(rows);
  if (ctx.state.scenario === 'error') return errorState();
  if (ctx.state.scenario === 'empty') return empty || emptyState({ title: 'Aucune donnée pour le moment', text: 'Les éléments apparaîtront ici dès qu’ils existeront.', iconName: 'sparkles' });
  return content;
}

export const orgCell = (org, { sub = true } = {}) =>
  org
    ? html`<div class="org-cell">${orgLogo(org)}<div><a class="name" href="${href('organisations', org.id)}">${org.name}</a>${sub ? html`<div class="sub">${org.domain}</div>` : ''}</div></div>`
    : html`<span class="muted">Plateforme</span>`;

export const orgLink = (orgId) => {
  const org = orgById(orgId);
  return org ? html`<a href="${href('organisations', org.id)}">${org.name}</a>` : html`<span class="muted">—</span>`;
};
