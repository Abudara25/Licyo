// Préférence de présentation appliquée avant le CSS, pour éviter l'ouverture/fermeture à chaque navigation.
// Ces stockages ne contiennent ni identité ni dossier : seulement une préférence et deux positions de défilement.
(() => {
  const root = document.documentElement;
  const prefKey = 'demo.admin.sidebar.collapsed';
  const read = (storage, key) => { try { return window[storage].getItem(key); } catch { return null; } };
  const write = (storage, key, value) => { try { window[storage].setItem(key, value); } catch { /* Stockage facultatif. */ } };
  let collapsed = read('localStorage', prefKey) === '1';
  root.dataset.adminSidebar = collapsed ? 'collapsed' : 'expanded';

  document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.adm-sidebar');
    const nav = sidebar?.querySelector('.adm-sidebar-nav');
    const toggle = document.querySelector('.adm-sidebar-toggle');
    const tooltip = document.querySelector('.adm-sidebar-tooltip');
    if (!nav || !toggle) return;
    const desktop = window.matchMedia('(min-width: 901px)');
    const positionKey = () => `demo.admin.sidebar.scroll.${collapsed ? 'collapsed' : 'expanded'}`;
    const save = () => {
      if (desktop.matches) write('sessionStorage', positionKey(), String(nav.scrollTop));
    };
    const restore = () => {
      if (!desktop.matches) return;
      const saved = read('sessionStorage', positionKey());
      const position = Number(saved);
      nav.scrollTop = saved !== null && Number.isFinite(position) ? Math.max(0, position) : 0;
    };
    const hideTip = () => { if (tooltip) tooltip.hidden = true; };
    const syncToggle = () => {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale');
    };
    syncToggle();
    toggle.hidden = false;
    restore();

    toggle.addEventListener('click', () => {
      save();
      collapsed = !collapsed;
      root.dataset.adminSidebar = collapsed ? 'collapsed' : 'expanded';
      write('localStorage', prefKey, collapsed ? '1' : '0');
      syncToggle();
      hideTip();
      restore();
    });
    nav.addEventListener('scroll', () => { save(); hideTip(); }, { passive: true });
    // Sauvegarde synchrone avant de quitter la page, y compris après un formulaire ou un retour arrière.
    sidebar.addEventListener('click', (event) => { if (event.target.closest('a')) save(); });
    window.addEventListener('pagehide', save);
    window.addEventListener('pageshow', restore);
    desktop.addEventListener('change', () => { hideTip(); restore(); });

    // Les libellés restent accessibles aux lecteurs d'écran dans le mode compact.
    // L'infobulle est hors du panneau défilant pour ne pas être coupée par son overflow.
    const showTip = (event) => {
      const link = event.target.closest('[data-nav-label]');
      if (!tooltip || !link || !collapsed || !desktop.matches) return;
      tooltip.textContent = link.dataset.navLabel;
      tooltip.hidden = false;
      const box = link.getBoundingClientRect();
      tooltip.style.left = `${sidebar.getBoundingClientRect().right + 8}px`;
      tooltip.style.top = `${Math.max(8, Math.min(window.innerHeight - tooltip.offsetHeight - 8, box.top + (box.height - tooltip.offsetHeight) / 2))}px`;
    };
    sidebar.addEventListener('pointerover', showTip);
    sidebar.addEventListener('focusin', showTip);
    sidebar.addEventListener('pointerout', hideTip);
    sidebar.addEventListener('focusout', hideTip);
    window.addEventListener('resize', hideTip);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideTip(); });
  });
})();
