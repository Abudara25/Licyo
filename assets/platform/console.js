// Console fondateur Licyo : seuls comportements côté navigateur (la console fonctionne aussi sans JavaScript, sauf
// le tiroir de navigation mobile). Aucune donnée, aucun appel réseau, aucun stockage.
(() => {
  const app = document.querySelector('.app');
  const toggle = document.querySelector('[data-action="toggle-nav"]');
  let scrim = null;
  const setNav = (open) => {
    if (!app || !toggle) return;
    app.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open && !scrim) {
      scrim = document.createElement('div');
      scrim.className = 'nav-scrim';
      scrim.addEventListener('click', () => setNav(false));
      app.append(scrim);
    } else if (!open && scrim) {
      scrim.remove();
      scrim = null;
    }
  };
  toggle?.addEventListener('click', () => setNav(!app.classList.contains('nav-open')));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setNav(false);
  });

  // Confirmation des actions sensibles : <form data-confirm="…">.
  document.addEventListener('submit', (event) => {
    const message = event.target.getAttribute?.('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });

  // Copier un lien d'invitation.
  document.addEventListener('click', async (event) => {
    const button = event.target.closest?.('[data-copy]');
    if (!button) return;
    const input = document.getElementById(button.getAttribute('data-copy'));
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = 'Copié';
    } catch {
      input.select();
    }
  });
})();
