// Champs de formulaire. data-model relie un champ à l'état en mémoire de la page (aucune persistance).
import { html } from '../lib/html.js';
import { icon } from './icons.js';

export const field = ({ id, label, hint = '', error = '', control, required = false, valid = false }) => html`
  <div class="field">
    <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true">*</span><span class="sr-only"> (obligatoire)</span>` : ''}</label>
    ${valid && !error ? html`<div class="input-state">${control}<span class="ok" aria-hidden="true">${icon('check', 16)}</span></div>` : control}
    ${error ? html`<span class="error" id="${id}-err">${icon('alert', 14)}${error}</span>` : hint ? html`<span class="hint" id="${id}-hint">${hint}</span>` : ''}
  </div>`;

export const textInput = ({ id, model, value = '', placeholder = '', type = 'text', error = '', autocomplete = 'off' }) =>
  html`<input class="input" id="${id}" type="${type}" data-model="${model}" value="${value}" placeholder="${placeholder}" autocomplete="${autocomplete}" ${error ? html`aria-invalid="true" aria-describedby="${id}-err"` : ''}>`;

export const selectInput = ({ id, model, value = '', options, label = '' }) => html`
  <select class="select" id="${id}" data-model="${model}" ${label ? html`aria-label="${label}"` : ''}>
    ${options.map(([v, l]) => html`<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`)}
  </select>`;

export const searchInput = ({ id, model, value = '', placeholder, label }) => html`
  <div class="input-icon">${icon('search', 16)}
    <input class="input" id="${id}" type="search" data-model="${model}" value="${value}" placeholder="${placeholder}" aria-label="${label}" autocomplete="off">
  </div>`;

export const toggle = ({ id, checked, label, action, disabled = false }) =>
  html`<button type="button" class="toggle" id="${id}" role="switch" aria-checked="${checked}" aria-label="${label}" data-action="${action}" ${disabled ? html`aria-disabled="true"` : ''}></button>`;

export const segmented = ({ options, value, action, label }) => html`
  <div class="segmented" role="group" aria-label="${label}">
    ${options.map(([v, l]) => html`<button type="button" data-action="${action}" data-value="${v}" aria-pressed="${v === value}">${l}</button>`)}
  </div>`;
