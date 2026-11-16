// Page de connexion admin : bouton « œil » pour afficher ou masquer le mot de passe saisi (utile quand le
// navigateur a prérempli le champ, ou pour vérifier une faute de frappe). Script externe : le CSP bloque le JS inline.
document.querySelectorAll('[data-password-toggle]').forEach((button) => {
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  const eye = button.innerHTML;
  const eyeOff = '<svg class="adm-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0 1 12 20C5 20 1 12 1 12a19.8 19.8 0 0 1 5.1-5.9M9.9 4.2A10.5 10.5 0 0 1 12 4c7 0 11 8 11 8a19.9 19.9 0 0 1-2.2 3.3M14.1 14.1a3 3 0 1 1-4.2-4.2M1 1l22 22"/></svg>';
  button.hidden = false;
  button.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
    button.innerHTML = show ? eyeOff : eye;
    input.focus();
  });
  // Jamais envoyé en clair à l'écran après l'envoi : le champ redevient masqué.
  input.form?.addEventListener('submit', () => { input.type = 'password'; });
});
