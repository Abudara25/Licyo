// Gabarits des pages de compte sans session (invitation, mot de passe oublié, réinitialisation, premier accès) :
// même carte que l'écran de connexion. Tout texte venant de l'extérieur passe par escapeHtml.
import { adminHead, adminScripts, escapeHtml, flash, icon } from './admin-auth.js';
import { PASSWORD_MIN_LENGTH } from './accounts.js';

export const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export function cardPage({ title, eyebrow = 'Espace admin', intro = '', error = '', ok = '', content = '', back = true }) {
  return `${adminHead(title, 'adm adm-login-body')}
<main class="adm-login">
  <div class="adm-login-card">
    <img src="/assets/images/logo-96.webp" alt="" width="72" height="72">
    <p class="adm-eyebrow">${escapeHtml(eyebrow)}</p>
    <h1>${escapeHtml(title)}</h1>
    ${intro ? `<p class="adm-help">${intro}</p>` : ''}
    ${error ? flash('error', error) : ''}
    ${ok ? flash('ok', ok) : ''}
    ${content}
    ${back ? '<p class="adm-login-links"><a href="/admin/dashboard">Retour à la connexion</a></p>' : ''}
  </div>
</main>
${adminScripts('admin-login')}
</body></html>`;
}

export const passwordField = (id, label, { autocomplete = 'new-password', autofocus = false } = {}) => `
    <div class="form-field">
      <label for="${id}">${label}</label>
      <div class="adm-password">
        <input type="password" id="${id}" name="${id}" autocomplete="${autocomplete}" autocapitalize="off" spellcheck="false" required ${autocomplete === 'new-password' ? `minlength="${PASSWORD_MIN_LENGTH}"` : ''} ${autofocus ? 'autofocus' : ''}>
        <button type="button" class="adm-password-toggle" data-password-toggle="${id}" aria-pressed="false" aria-label="Afficher le mot de passe" hidden>${icon('eye')}</button>
      </div>
    </div>`;

export const newPasswordFields = () => `${passwordField('password', 'Mot de passe')}
    ${passwordField('confirm', 'Confirmer le mot de passe')}
    <p class="adm-help">${PASSWORD_MIN_LENGTH} caractères minimum. Une phrase de quelques mots est plus sûre et plus facile à retenir.</p>`;

export const textField = (id, label, { type = 'text', value = '', autocomplete = '', required = true, autofocus = false } = {}) => `
    <div class="form-field">
      <label for="${id}">${label}</label>
      <input type="${type}" id="${id}" name="${id}" value="${escapeHtml(value)}" ${autocomplete ? `autocomplete="${autocomplete}"` : ''} ${required ? 'required' : ''} ${autofocus ? 'autofocus' : ''} maxlength="200">
    </div>`;

export function confirmMismatch(form) {
  return String(form.get('password') || '') !== String(form.get('confirm') || '') ? 'Les deux mots de passe ne correspondent pas.' : null;
}
