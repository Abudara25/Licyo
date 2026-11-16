// Petits éléments de la console fondateur, repris de la maquette (components/badge.js, avatar.js) et branchés sur les
// données réelles : badges d'état, logo à initiales du club, réponse HTML complète.
import { html, cx, safeColor } from './html.js';
import { icon } from './icons.js';
import { initialsOf } from './avatar.js';
import { platformPage } from './shell.js';
import { listOrganizations, sportColor } from '../platform-data.js';

export const badge = (label, tone = 'neutral', { dot = true, square = false } = {}) =>
  html`<span class="${cx('badge', `tone-${tone}`, square && 'square')}">${dot ? html`<span class="dot" aria-hidden="true"></span>` : ''}${label}</span>`;

export const signal = (issue) => (issue ? html`<span class="signal tone-${issue.tone}">${icon(issue.tone === 'violet' ? 'clock' : 'alert', 13)}${issue.label}</span>` : '');

// Logo à initiales sur la couleur du sport ; pastille : rouge si suspendu, orange si un point est à traiter.
export const orgLogo = (org, size = '', { presence = false } = {}) => {
  const health = org.status === 'suspended' ? 'incident' : org.issue ? 'warning' : 'healthy';
  return html`<span class="${cx('org-logo', size)}" style="background:${safeColor(sportColor(org.sport))}" aria-hidden="true">${initialsOf(org.name)}${presence ? html`<span class="presence ${health}"></span>` : ''}</span>`;
};

export const notice = (tone, content, iconName = 'info') => html`<div class="notice tone-${tone}">${icon(iconName, 16)}<div>${content}</div></div>`;

export const formatDate = (sqlite, options = { day: 'numeric', month: 'short', year: 'numeric' }) => {
  if (!sqlite) return '—';
  const date = new Date(`${String(sqlite).replace(' ', 'T')}${/Z|[+-]\d\d:?\d\d$/.test(sqlite) ? '' : 'Z'}`);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'Europe/Paris' }).format(date);
};

export const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

export const respond = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', ...headers } });

// Page complète de la console : compteurs de navigation calculés une fois par requête.
export async function consolePage(context, { title, active, trail, content, q = '', status = 200, orgs = null }) {
  const operator = context.data.operator;
  const list = orgs ?? (await listOrganizations(context.env.DB));
  const counts = { attention: list.filter((o) => o.issue).length };
  return respond(platformPage({ title, active, trail, operator, counts, env: context.env, content, q }), status);
}
