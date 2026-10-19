// Comportements communs à chaque page /admin/* authentifiée (voir functions/_shared/admin-auth.js).
// Script externe : le CSP du site bloque les attributs onclick/<script> inline (voir _headers).

// Menus repliables <details data-dismiss> (« Plus » de la barre d'onglets mobile, « Filtres » de la
// liste des inscriptions) : se referment au clic à l'extérieur ou avec Échap, comme un menu classique.
const dismissables = [...document.querySelectorAll('details[data-dismiss]')];
document.addEventListener('click', (e) => {
  dismissables.forEach((details) => {
    if (details.open && !details.contains(e.target)) details.open = false;
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  dismissables.forEach((details) => {
    if (!details.open) return;
    details.open = false;
    details.querySelector('summary')?.focus();
  });
});

// Anti double envoi : un formulaire marqué data-once désactive son bouton dès le premier envoi (une opération
// longue, comme la synchronisation du CRM, ne doit pas être lancée deux fois par un double clic).
document.querySelectorAll('form[data-once]').forEach((form) => {
  form.addEventListener('submit', () => {
    form.querySelectorAll('button[type=submit]').forEach((button) => {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    });
  });
});

// Confirmation avant un envoi destructif ou à conséquence (suppression, archivage, relance, changement
// de saison...) — un seul handler partagé par toute page /admin/* utilisant la classe
// .admin-confirm-form. Le message vient de l'attribut data-confirm du bouton de submit : chaque action
// a un libellé différent, et une gravité différente.
document.querySelectorAll('.admin-confirm-form').forEach((form) => {
  form.addEventListener('submit', (e) => {
    const message = form.querySelector('button[type=submit]')?.dataset.confirm || 'Confirmer ?';
    if (!confirm(message)) e.preventDefault();
  });
});

// Bouton « Copier » (data-copy) : copie le texte dans le presse-papiers et l'annonce brièvement sur le bouton.
document.querySelectorAll('button[data-copy]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      return;
    }
    // Bouton icône seule (.adm-copy-btn) : la coche remplace l'icône, l'état est annoncé aux lecteurs d'écran.
    if (button.classList.contains('adm-copy-btn')) {
      const label = button.getAttribute('aria-label');
      button.classList.add('is-copied');
      button.setAttribute('aria-label', 'Copié');
      setTimeout(() => { button.classList.remove('is-copied'); button.setAttribute('aria-label', label); }, 2000);
      return;
    }
    const label = button.lastChild;
    const previous = label.textContent;
    label.textContent = button.dataset.copied || 'Copié';
    setTimeout(() => { label.textContent = previous; }, 2000);
  });
});

// Formulaire de cases à cocher enregistré dès qu'une case change (data-autosubmit, ex. suivi licence et tenue de la
// fiche adhérent). Les cases sont désactivées pendant l'envoi pour éviter un double clic.
document.querySelectorAll('form[data-autosubmit]').forEach((form) => {
  form.addEventListener('change', () => {
    if (form.dataset.sending) return;
    form.dataset.sending = '1';
    form.requestSubmit ? form.requestSubmit() : form.submit();
    form.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.readOnly = true; });
    form.classList.add('is-sending');
  });
});
