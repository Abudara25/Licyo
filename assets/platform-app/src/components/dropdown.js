// Menus déroulants : bouton [data-action="menu"][aria-controls] + <div role="menu" hidden>.
// Fermeture au clic extérieur et sur Échap ; flèches haut/bas entre les éléments.
import { html } from '../lib/html.js';
import { icon } from './icons.js';

export function closeMenus(except = null) {
  document.querySelectorAll('[data-action="menu"][aria-expanded="true"]').forEach((btn) => {
    if (btn === except) return;
    btn.setAttribute('aria-expanded', 'false');
    document.getElementById(btn.getAttribute('aria-controls'))?.setAttribute('hidden', '');
  });
}

export function toggleMenu(button) {
  const menu = document.getElementById(button.getAttribute('aria-controls'));
  const open = button.getAttribute('aria-expanded') !== 'true';
  closeMenus(button);
  button.setAttribute('aria-expanded', String(open));
  menu.toggleAttribute('hidden', !open);
  if (open) menu.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
}

export function menuKeydown(e) {
  const menu = e.target.closest('[role="menu"]');
  if (!menu) return false;
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    return true;
  }
  if (e.key === 'Escape') {
    const button = document.querySelector(`[aria-controls="${menu.id}"]`);
    closeMenus();
    button?.focus();
    return true;
  }
  return false;
}

// Bouton + menu. items : [{ label, iconName, action, href, danger, disabled, data }] ou 'sep'.
export const dropdown = ({ id, trigger, label, items, up = false, head = '' }) => html`
  <div class="dropdown">
    <button type="button" class="${trigger.className}" data-action="menu" aria-haspopup="menu" aria-expanded="false" aria-controls="${id}" aria-label="${label}">${trigger.content}</button>
    <div class="menu ${up ? 'up' : ''}" id="${id}" role="menu" aria-label="${label}" hidden>
      ${head}
      ${items.map((it) =>
        it === 'sep'
          ? html`<div class="menu-sep" role="separator"></div>`
          : it.href
            ? html`<a class="menu-item" role="menuitem" href="${it.href}" tabindex="-1">${icon(it.iconName, 16)}${it.label}</a>`
            : html`<button type="button" class="menu-item ${it.danger ? 'danger' : ''}" role="menuitem" tabindex="-1" data-action="${it.action}" ${it.disabled ? html`aria-disabled="true"` : ''} ${Object.entries(it.data || {}).map(([k, v]) => html`data-${k}="${v}" `)}>${icon(it.iconName, 16)}${it.label}</button>`
      )}
    </div>
  </div>`;
