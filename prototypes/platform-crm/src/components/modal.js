// Modale de confirmation accessible : focus piégé, Échap, retour du focus à l'élément d'origine,
// reste de l'application rendu inerte. Dans ce prototype, aucune confirmation ne déclenche d'action réelle.
import { html } from '../lib/html.js';
import { icon } from './icons.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
let active = null;

export function closeModal() {
  if (!active) return;
  const { backdrop, opener, onKey } = active;
  document.removeEventListener('keydown', onKey, true);
  backdrop.remove();
  document.querySelector('.app')?.removeAttribute('inert');
  active = null;
  if (opener && document.contains(opener)) opener.focus();
}

/**
 * openModal({ title, description, iconName, tone, body, confirmLabel, confirmTone, requireText, onConfirm, wide, className, role })
 * requireText : saisie exacte exigée avant de confirmer (actions sensibles).
 * Champs du corps marqués data-required : la confirmation reste désactivée tant que l'un d'eux est vide ou blanc.
 */
export function openModal({ title, description = '', iconName = 'info', tone = 'info', body = '', confirmLabel = 'Confirmer', confirmTone = 'primary', requireText = '', onConfirm = () => {}, wide = false, cancelLabel = 'Annuler', cancel = true, footer = true, className = '' }) {
  closeModal();
  const opener = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = String(html`
    <div class="modal ${wide ? 'wide' : ''} ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title" ${description ? html`aria-describedby="modal-desc"` : ''}>
      <button type="button" class="btn btn-ghost btn-sm btn-icon modal-close" data-modal="cancel" aria-label="Fermer">${icon('x', 16)}</button>
      <div class="modal-head">
        <span class="icon-bubble tone-${tone}">${icon(iconName, 20)}</span>
        <div><h2 id="modal-title">${title}</h2>${description ? html`<p id="modal-desc">${description}</p>` : ''}</div>
      </div>
      <div class="modal-body">
        ${body}
        ${requireText ? html`<div class="field"><label for="modal-confirm-text">Pour confirmer, saisissez <strong class="mono">${requireText}</strong></label><input class="input" id="modal-confirm-text" autocomplete="off" spellcheck="false"></div>` : ''}
      </div>
      ${footer ? html`<div class="modal-foot">
        ${cancel ? html`<button type="button" class="btn btn-secondary" data-modal="cancel">${cancelLabel}</button>` : ''}
        <button type="button" class="btn btn-${confirmTone}" data-modal="confirm">${confirmLabel}</button>
      </div>` : ''}
    </div>`);
  document.getElementById('modal-root').append(backdrop);
  document.querySelector('.app')?.setAttribute('inert', '');

  const dialog = backdrop.querySelector('[role="dialog"]');
  const confirm = backdrop.querySelector('[data-modal="confirm"]');
  const text = backdrop.querySelector('#modal-confirm-text');
  const required = [...backdrop.querySelectorAll('[data-required]')];
  const update = () => {
    if (confirm) confirm.disabled = (text && text.value.trim() !== requireText) || required.some((f) => !f.value.trim());
  };
  backdrop.addEventListener('input', update);
  update();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop || e.target.closest('[data-modal="cancel"]')) closeModal();
    else if (e.target.closest('[data-modal="confirm"]') && confirm && !confirm.disabled) {
      closeModal();
      onConfirm();
    }
  });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    } else if (e.key === 'Tab') {
      const nodes = [...dialog.querySelectorAll(FOCUSABLE)];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  active = { backdrop, opener, onKey };
  (text || dialog.querySelector('.modal-foot [data-modal="cancel"]') || dialog.querySelector('.modal-foot [data-modal="confirm"]') || dialog.querySelector(FOCUSABLE))?.focus();
  return dialog;
}
