// Recherche rapide (Ctrl/⌘ + K ou « / ») : pages, organisations et domaines des données fictives.
// Filtrage local, en mémoire ; aucune requête.
import { html } from '../lib/html.js';
import { icon } from './icons.js';
import { openModal, closeModal } from './modal.js';
import { fold } from '../lib/format.js';

export function openPalette(entries, navigate) {
  const dialog = openModal({
    title: 'Recherche rapide',
    iconName: 'search',
    footer: false,
    className: 'palette',
    body: html`
      <div class="palette-input">${icon('search', 18)}
        <input id="palette-q" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" placeholder="Organisation, domaine, page…" autocomplete="off" aria-label="Rechercher">
        <kbd>Échap</kbd>
      </div>
      <ul class="palette-list" id="palette-list" role="listbox" aria-label="Résultats"></ul>`,
  });
  dialog.querySelector('.modal-head').classList.add('sr-only');
  dialog.querySelector('.modal-body').style.padding = '0';
  const input = dialog.querySelector('#palette-q');
  const list = dialog.querySelector('#palette-list');
  let selected = 0;
  let results = [];

  const draw = () => {
    const q = fold(input.value.trim());
    results = entries.filter((e) => !q || fold(`${e.label} ${e.meta || ''}`).includes(q)).slice(0, 12);
    selected = Math.min(selected, Math.max(0, results.length - 1));
    let group = '';
    list.innerHTML = results.length
      ? results
          .map((e, i) => {
            const head = e.group !== group ? String(html`<li class="palette-group" role="presentation">${e.group}</li>`) : '';
            group = e.group;
            return head + String(html`<li class="palette-item" role="option" id="pal-${i}" data-index="${i}" aria-selected="${i === selected}">${icon(e.iconName, 16)}<span>${e.label}</span><span class="meta">${e.meta || ''}</span></li>`);
          })
          .join('')
      : String(html`<li class="palette-group" role="presentation">Aucun résultat</li>`);
    input.setAttribute('aria-activedescendant', results.length ? `pal-${selected}` : '');
  };
  const go = (i) => {
    const target = results[i];
    if (!target) return;
    closeModal();
    navigate(target.href);
  };
  input.addEventListener('input', () => {
    selected = 0;
    draw();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(1, results.length);
      draw();
      list.querySelector(`#pal-${selected}`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(selected);
    }
  });
  list.addEventListener('click', (e) => {
    const item = e.target.closest('[data-index]');
    if (item) go(Number(item.dataset.index));
  });
  draw();
  input.focus();
}
