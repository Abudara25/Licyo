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
    form.querySelectorAll('input[type="checkbox"], select').forEach((input) => { input.readOnly = true; });
    form.classList.add('is-sending');
  });
});

// « Tout sélectionner » (data-check-all="<id du formulaire>") : coche les cases rattachées à ce formulaire par
// l'attribut form (cases placées dans les cartes, hors du formulaire), et indique le nombre choisi (data-check-count).
document.querySelectorAll('input[data-check-all]').forEach((all) => {
  const formId = all.dataset.checkAll;
  const boxes = () => [...document.querySelectorAll(`input[type="checkbox"][form="${formId}"]:not(:disabled)`)];
  const count = document.querySelector(`[data-check-count="${formId}"]`);
  const sync = () => {
    const checked = boxes().filter((b) => b.checked).length;
    all.checked = checked > 0 && checked === boxes().length;
    if (count) count.textContent = `${checked} sélectionné${checked > 1 ? 's' : ''}`;
  };
  all.addEventListener('change', () => {
    boxes().forEach((b) => { b.checked = all.checked; });
    sync();
  });
  boxes().forEach((b) => b.addEventListener('change', sync));
  sync();
});

// Lien vers un formulaire replié de la fiche (#versement, #cheques, #correction-versement…) : le <details> visé est
// ouvert, sinon la page se place sur un bouton fermé et le lien semble ne rien faire (constaté le 2026-11-10 avec
// « Enregistrer un versement » de la fiche adhérent).
// Onglets de la fiche enfant (data-tabs, 2026-11-10) : un seul panneau visible ; sans JavaScript, tous s'affichent.
// L'onglet suit l'ancre : #tab-paiement, ou n'importe quel élément d'un panneau (#versement, #suivi-club…) ouvre son
// panneau, pour que les retours après un enregistrement reviennent au bon endroit.
const tabNav = document.querySelector('[data-tabs]');
const tabPanels = [...document.querySelectorAll('[data-tabpanel]')];
function showTab(panelId) {
  if (!tabNav || !tabPanels.length) return;
  const panel = tabPanels.find((p) => p.id === panelId) || tabPanels[0];
  tabPanels.forEach((p) => { p.hidden = p !== panel; });
  tabNav.querySelectorAll('[data-tab]').forEach((a) => {
    if (a.dataset.tab === panel.id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
}
if (tabNav && tabPanels.length) {
  document.body.classList.add('has-tabs');
  tabNav.addEventListener('click', (e) => {
    const link = e.target.closest('[data-tab]');
    if (!link) return;
    e.preventDefault();
    showTab(link.dataset.tab);
    history.replaceState(null, '', `#${link.dataset.tab}`);
    tabNav.scrollIntoView({ block: 'nearest' });
  });
  showTab(null);
}

function openTargetedDetails() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  const panel = target && (target.matches('[data-tabpanel]') ? target : target.closest('[data-tabpanel]'));
  if (panel) {
    showTab(panel.id);
    if (target === panel) return;
  }
  const details = target && (target.tagName === 'DETAILS' ? target : target.closest('details'));
  if (!details) {
    // Élément d'un onglet (formulaire visible, section) : on s'y place.
    if (panel) target.scrollIntoView({ block: 'start' });
    return;
  }
  details.open = true;
  details.scrollIntoView({ block: 'start' });
  details.querySelector('input:not([type=hidden]), select, textarea')?.focus({ preventScroll: true });
}
openTargetedDetails();
window.addEventListener('hashchange', openTargetedDetails);

// Recherche dans une liste (pré-inscriptions, 2026-11-13) : <input data-filter-input="x"> masque les éléments
// [data-filter-text] des conteneurs [data-filter-list="x"] qui ne contiennent pas le texte saisi (sans accents ni
// casse), ouvre les <details data-filter-open="x"> pendant une recherche et affiche [data-filter-empty="x"] si rien
// ne correspond. Sans JavaScript, la liste complète reste affichée.
const fold = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
document.querySelectorAll('input[data-filter-input]').forEach((input) => {
  const key = input.dataset.filterInput;
  const items = () => [...document.querySelectorAll(`[data-filter-list="${key}"] [data-filter-text]`)];
  const empty = document.querySelector(`[data-filter-empty="${key}"]`);
  input.addEventListener('input', () => {
    const query = fold(input.value);
    let shown = 0;
    items().forEach((item) => {
      const match = !query || fold(item.dataset.filterText).includes(query);
      item.hidden = !match;
      if (match) shown += 1;
    });
    document.querySelectorAll(`[data-filter-list="${key}"] [data-filter-label]`).forEach((label) => {
      label.hidden = Boolean(query);
    });
    document.querySelectorAll(`details[data-filter-open="${key}"]`).forEach((details) => {
      if (query) details.open = true;
    });
    if (empty) empty.hidden = shown > 0;
  });
});
// Menu de groupes ouvert : le curseur va directement dans la recherche.
document.querySelectorAll('details.adm-pi-select').forEach((details) => {
  details.addEventListener('toggle', () => {
    if (details.open && window.matchMedia('(pointer: fine)').matches) details.querySelector('input[data-filter-input]')?.focus();
  });
});
