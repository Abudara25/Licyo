// Onglets accessibles (role=tablist). Chaque onglet a sa propre URL (#/…/onglet) : partageable et
// restauré par le bouton « précédent ». Flèches gauche/droite, Début/Fin gérées dans main.js.
import { html } from '../lib/html.js';

export const tabs = ({ items, current, label, hrefFor }) => html`
  <div class="tabs" role="tablist" aria-label="${label}">
    ${items.map(
      (t) => html`<a class="tab" role="tab" id="tab-${t.key}" href="${hrefFor(t.key)}" aria-selected="${t.key === current}" aria-controls="panel-${t.key}" tabindex="${t.key === current ? '0' : '-1'}">${t.label}${t.count !== undefined ? html`<span class="nav-count">${t.count}</span>` : ''}</a>`
    )}
  </div>`;

export const tabPanel = (key, content) => html`<div role="tabpanel" id="panel-${key}" aria-labelledby="tab-${key}" tabindex="0">${content}</div>`;
