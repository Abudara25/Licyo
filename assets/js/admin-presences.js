// Appel d'une séance : bouton « Tous présents » (coche Présent pour chaque enfant sans statut).
(function () {
  const button = document.querySelector('[data-all-present]');
  if (!button) return;
  button.addEventListener('click', () => {
    document.querySelectorAll('.adm-att-kid').forEach((kid) => {
      if (kid.querySelector('input[type=radio]:checked')) return;
      const present = kid.querySelector('input[value=present]');
      if (present) present.checked = true;
    });
  });
})();
