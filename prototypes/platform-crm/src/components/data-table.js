// Tableau de données réutilisable : colonnes déclaratives, en-têtes triables, état vide, pied de pagination.
// Option `stack` : sous 768 px (true) ou 1200 px ('md'), chaque ligne devient une carte (libellés tirés de data-label).
import { html, cx } from '../lib/html.js';
import { icon } from './icons.js';

/**
 * columns : [{ key, label, render(row), sortable, align, className, srLabel, hide }]
 * hide    : 'xl' (masquée sous 1600 px), 'lg' (sous 1360 px) ou 'md' (sous 1200 px) ; toujours affichée dans les cartes empilées
 * sort    : { key, dir, action } — l'action reçoit data-key au clic
 * rowAttrs(row) : attributs HTML (fragment html) ajoutés au <tr>, ex. classe d'alerte
 */
export function dataTable({ columns, rows, caption, sort = null, empty = '', rowAttrs = () => '', stack = false }) {
  if (!rows.length) return empty;
  return html`
    <div class="table-wrap">
      <table class="${cx('table', stack && 'table-stack', stack === 'md' && 'table-stack-md')}">
        <caption class="sr-only">${caption}</caption>
        <thead><tr>
          ${columns.map((c) => html`<th scope="col" class="${cx(c.align === 'right' && 'right', c.hide && `col-hide-${c.hide}`)}" ${sort && c.sortable ? html`aria-sort="${sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : ''}>
            ${sort && c.sortable
              ? html`<button type="button" class="sort-btn" data-action="${sort.action}" data-key="${c.key}" aria-pressed="${sort.key === c.key}">${c.label}${icon('sort', 13)}</button>`
              : c.srLabel ? html`<span class="sr-only">${c.srLabel}</span>` : c.label}
          </th>`)}
        </tr></thead>
        <tbody>
          ${rows.map((row) => html`<tr ${rowAttrs(row)}>${columns.map((c) => html`<td class="${cx(c.align === 'right' && 'right', c.className, c.hide && `col-hide-${c.hide}`)}" data-label="${c.label}">${c.render(row)}</td>`)}</tr>`)}
        </tbody>
      </table>
    </div>`;
}

export const pagination = ({ page, pages, from, to, total, action, noun = 'éléments' }) => html`
  <div class="table-foot">
    <span>${from}–${to} sur ${total} ${noun}</span>
    <nav class="pager" aria-label="Pagination">
      <button type="button" class="btn btn-secondary btn-sm btn-icon" data-action="${action}" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Page précédente">${icon('chevronLeft', 16)}</button>
      <span class="num" aria-live="polite">Page ${page} / ${pages}</span>
      <button type="button" class="btn btn-secondary btn-sm btn-icon" data-action="${action}" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Page suivante">${icon('chevronRight', 16)}</button>
    </nav>
  </div>`;
