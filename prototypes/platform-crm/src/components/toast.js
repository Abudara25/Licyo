// Notifications éphémères, annoncées par une région aria-live (voir index.html).
import { html } from '../lib/html.js';
import { icon } from './icons.js';

export function toast({ title, body = '', iconName = 'check', duration = 4500 }) {
  const region = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = String(html`${icon(iconName, 18)}<div><div class="t-title">${title}</div>${body ? html`<div class="t-body">${body}</div>` : ''}</div><button type="button" aria-label="Fermer la notification">${icon('x', 16)}</button>`);
  el.querySelector('button').addEventListener('click', () => el.remove());
  region.append(el);
  setTimeout(() => el.remove(), duration);
}

// Message commun des actions simulées : le prototype ne modifie rien.
export const prototypeToast = (title) => toast({ title, body: 'Prototype : aucune donnée n’a été modifiée, aucune requête n’a été envoyée.', iconName: 'info' });
