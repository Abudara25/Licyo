import { html } from '../lib/html.js';
import { icon } from './icons.js';

export const emptyState = ({ title, text = '', iconName = 'search', actions = '' }) => html`
  <div class="empty" role="status">
    <span class="icon-bubble">${icon(iconName, 22)}</span>
    <h3>${title}</h3>
    ${text ? html`<p>${text}</p>` : ''}
    ${actions ? html`<div class="actions">${actions}</div>` : ''}
  </div>`;

export const errorState = ({ title = 'Impossible de charger ces données', text = 'Le service n’a pas répondu. Réessayez dans un instant ; si le problème persiste, consultez Santé & incidents.' } = {}) => html`
  <div class="empty error" role="alert">
    <span class="icon-bubble">${icon('alert', 22)}</span>
    <h3>${title}</h3>
    <p>${text}</p>
    <div class="actions">
      <button class="btn btn-secondary" type="button" data-action="retry">${icon('refresh', 16)}Réessayer</button>
      <a class="btn btn-ghost" href="#/sante">Voir l’état de la plateforme</a>
    </div>
  </div>`;

export const notice = (tone, content, iconName = 'info') => html`<div class="notice tone-${tone}">${icon(iconName, 16)}<div>${content}</div></div>`;

// Squelettes de chargement.
export const skeletonPage = () => html`
  <div aria-busy="true" aria-live="polite">
    <span class="sr-only">Chargement…</span>
    <div class="skeleton sk-title" style="margin-bottom:10px"></div>
    <div class="skeleton sk-line" style="width:55%;margin-bottom:28px"></div>
    <div class="grid grid-3">${Array.from({ length: 3 }, () => html`<div class="card summary"><div class="skeleton sk-line" style="width:45%"></div><div class="skeleton" style="height:34px;width:35%"></div><div class="skeleton sk-line" style="width:85%"></div></div>`)}</div>
    <div class="card section-gap"><div class="card-body stack">${Array.from({ length: 6 }, (_, i) => html`<div class="skeleton sk-line" style="width:${90 - i * 7}%"></div>`)}</div></div>
  </div>`;

export const skeletonRows = (n = 6) => html`
  <div class="card-body stack" aria-busy="true"><span class="sr-only">Chargement…</span>
    ${Array.from({ length: n }, () => html`<div style="display:flex;gap:12px;align-items:center"><div class="skeleton" style="width:36px;height:36px;border-radius:10px"></div><div style="flex:1" class="stack"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-line" style="width:25%;height:10px"></div></div><div class="skeleton sk-line" style="width:12%"></div></div>`)}
  </div>`;
