import { html, cx } from '../lib/html.js';

export const card = ({ title = '', subtitle = '', actions = '', body = '', foot = '', flush = false, id = '', className = '' }) => html`
  <section class="${cx('card', className)}" ${id ? html`id="${id}"` : ''} ${title ? html`aria-labelledby="${id || slug(title)}-t"` : ''}>
    ${title ? html`<header class="card-head"><div><h2 id="${id || slug(title)}-t">${title}</h2>${subtitle ? html`<p>${subtitle}</p>` : ''}</div>${actions}</header>` : ''}
    <div class="${cx('card-body', flush && 'flush')}">${body}</div>
    ${foot ? html`<footer class="card-foot">${foot}</footer>` : ''}
  </section>`;

export const pageHeader = ({ eyebrow = '', title, description = '', actions = '' }) => html`
  <header class="page-header">
    <div>
      ${eyebrow ? html`<span class="eyebrow">${eyebrow}</span>` : ''}
      <h1>${title}</h1>
      ${description ? html`<p>${description}</p>` : ''}
    </div>
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </header>`;

export const kvList = (entries) => html`<dl class="kv">${entries.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>`;

export const progress = (ratio, label) =>
  html`<div class="progress" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(ratio * 100)}"><span style="width:${Math.round(ratio * 100)}%"></span></div>`;

const slug = (text) => String(text).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
