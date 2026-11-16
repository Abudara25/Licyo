// File « À traiter » : sur grand écran, cliquer un nom (ou la ligne) affiche l'aperçu de l'enfant à droite au lieu
// d'ouvrir sa fiche. En dessous de 1200 px, ou sans JavaScript, le nom reste un lien vers la fiche.
(() => {
  const aside = document.querySelector('.adm-peek');
  if (!aside) return;
  const wide = window.matchMedia('(min-width: 1200px)');

  const show = (index) => {
    const tpl = document.querySelector(`template[data-peek-template="${index}"]`);
    if (!tpl) return;
    aside.replaceChildren(tpl.content.cloneNode(true));
    document.querySelectorAll('.adm-q-row.is-selected').forEach((row) => row.classList.remove('is-selected'));
    document.querySelector(`.adm-q-row[data-peek-row="${index}"]`)?.classList.add('is-selected');
  };

  document.addEventListener('click', (event) => {
    if (!wide.matches) return;
    const name = event.target.closest('a[data-peek]');
    if (name) {
      event.preventDefault();
      show(name.dataset.peek);
      return;
    }
    // Clic dans la ligne hors d'un lien ou d'un bouton : même effet que le nom.
    const row = event.target.closest('.adm-q-row');
    if (row && !event.target.closest('a, button')) show(row.dataset.peekRow);
  });
})();
