// Console Platform — prototype visuel (front-end seul, données fictives).
// Le nom du produit n'apparaît nulle part ici : il vient de src/config/brand.js (nom de travail provisoire).
//
// Garde-fous du prototype :
//   - aucune requête réseau : ni fetch, ni XHR, ni WebSocket (la CSP du serveur local l'interdit aussi : connect-src 'none') ;
//   - aucun stockage persistant (ni localStorage, ni cookie) : l'état vit en mémoire et disparaît au rechargement ;
//   - aucune session, aucun rôle, aucune autorité côté client. UI visibility is not authorization : la future console
//     décidera de chaque action côté serveur (ADR-018), sur un domaine distinct de ceux des clubs.
import { html } from './lib/html.js';
import { BRAND } from './config/brand.js';
import { parseRoute } from './router.js';
import { sidebar, topbar } from './components/shell.js';
import { skeletonPage } from './components/feedback.js';
import { closeMenus, toggleMenu, menuKeydown } from './components/dropdown.js';
import { openPalette } from './components/command-palette.js';
import { toast, prototypeToast } from './components/toast.js';
import { ORGANIZATIONS, DOMAINS, INCIDENTS, TICKETS, orgById } from './data/fixtures.js';
import { computeKpis } from './lib/query.js';
import * as dashboard from './pages/dashboard.js';
import * as organizations from './pages/organizations.js';
import * as organization from './pages/organization-detail.js';
import * as onboarding from './pages/onboarding.js';
import * as domains from './pages/domains.js';
import * as plans from './pages/plans.js';
import * as health from './pages/health.js';
import * as support from './pages/support.js';
import * as audit from './pages/audit.js';
import * as settings from './pages/settings.js';

const PAGES = {
  dashboard: { module: dashboard, title: 'Dashboard' },
  organizations: { module: organizations, title: 'Organisations' },
  organization: { module: organization, title: 'Organisation' },
  onboarding: { module: onboarding, render: onboarding.renderList, title: 'Onboarding' },
  wizard: { module: onboarding, render: onboarding.renderWizard, title: 'Nouvelle organisation' },
  domains: { module: domains, title: 'Domaines' },
  plans: { module: plans, title: 'Plans & fonctionnalités' },
  health: { module: health, title: 'Santé & incidents' },
  support: { module: support, title: 'Support' },
  audit: { module: audit, title: 'Audit' },
  settings: { module: settings, title: 'Paramètres Platform' },
};

// État d'interface, en mémoire uniquement.
const state = {
  scenario: 'normal',
  routeLoading: false,
  dashMetric: 'orgs',
  orgs: { view: 'all', q: '', lifecycle: '', plan: '', access: '', health: '', sort: 'name', dir: 'asc', page: 1 },
  domains: { q: '', status: '' },
  health: { incidents: 'open' },
  support: { status: 'active', priority: '' },
  audit: { q: '', result: '' },
  notifications: { incidents: true, billing: true, domains: true, onboarding: false },
  wizard: onboarding.emptyWizard(),
};

const app = document.querySelector('.app');
const sidebarSlot = document.getElementById('sidebar-slot');
const topbarSlot = document.getElementById('topbar-slot');
const main = document.getElementById('main-content');
let route = parseRoute(location.hash);

function counts() {
  const k = computeKpis({ organizations: ORGANIZATIONS, domains: DOMAINS, incidents: INCIDENTS });
  return { ...k, openTickets: TICKETS.filter((t) => t.status !== 'resolved').length };
}

const navigate = (hash, { replace = false } = {}) => {
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) onRoute();
};

const ctx = () => ({ route, state, set, navigate, toast: (title) => toast({ title, iconName: 'check' }) });

function renderMain() {
  const page = PAGES[route.name];
  if (!page) {
    main.innerHTML = String(html`<div class="empty"><span class="icon-bubble">?</span><h1 style="font-size:20px">Page introuvable</h1><p>Cette adresse ne correspond à aucune page de la console.</p><div class="actions"><a class="btn btn-primary" href="#/dashboard">Retour au dashboard</a></div></div>`);
    return;
  }
  const render = page.render || page.module.render;
  main.innerHTML = String(state.routeLoading ? skeletonPage() : render(ctx()));
}

function renderShell() {
  sidebarSlot.innerHTML = String(sidebar(route, counts()));
  topbarSlot.innerHTML = String(topbar(route, { orgName: route.name === 'organization' ? orgById(route.id)?.name : '' }));
}

// Sélecteur qui retrouve « le même » élément après réaffichage : par id, sinon par action et paramètre.
function focusKey(el) {
  if (!el || !main.contains(el)) return null;
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.dataset.action) {
    const param = ['key', 'value', 'page', 'id'].find((k) => el.dataset[k] !== undefined);
    return `[data-action="${CSS.escape(el.dataset.action)}"]${param ? `[data-${param}="${CSS.escape(el.dataset[param])}"]` : ''}`;
  }
  return null;
}

// Réaffichage qui préserve le focus (et le curseur d'un champ en cours de saisie).
function set(patch) {
  Object.assign(state, patch);
  const active = document.activeElement;
  const key = focusKey(active);
  const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  renderMain();
  const again = key ? main.querySelector(key) : null;
  if (!again) return;
  again.focus({ preventScroll: true });
  if (caret) {
    try {
      again.setSelectionRange(caret[0], caret[1]);
    } catch {
      /* champ sans sélection (e-mail) */
    }
  }
}

let loadingTimer;
let lastPage = '';
function onRoute() {
  const wasTab = document.activeElement?.getAttribute('role') === 'tab';
  route = parseRoute(location.hash);
  app.classList.remove('nav-open');
  document.querySelector('.nav-scrim')?.remove();
  const title = route.name === 'organization' ? orgById(route.id)?.name ?? 'Organisation' : PAGES[route.name]?.title ?? 'Page introuvable';
  document.title = `${title} · ${BRAND.platformName} (aperçu)`;
  renderShell();
  const page = `${route.name}:${route.id || ''}`;
  const samePage = page === lastPage;
  lastPage = page;
  clearTimeout(loadingTimer);
  if (samePage) {
    // Changement d'onglet ou d'étape : pas de squelette, focus conservé sur l'onglet actif.
    state.routeLoading = false;
    renderMain();
    if (wasTab) main.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    return;
  }
  // Nouvelle page : chargement simulé (squelette) ; aucune donnée n'est réellement demandée.
  state.routeLoading = true;
  renderMain();
  window.scrollTo(0, 0);
  loadingTimer = setTimeout(() => {
    state.routeLoading = false;
    renderMain();
    if (document.activeElement === document.body || !document.activeElement) main.focus({ preventScroll: true });
  }, 260);
}

// Actions globales, puis actions de la page courante.
const GLOBAL_ACTIONS = {
  menu: (el) => toggleMenu(el),
  palette: () => openPalette(paletteEntries(), navigate),
  scenario: (el) => {
    closeMenus();
    set({ scenario: el.dataset.value });
    toast({ title: `Aperçu : ${el.textContent.trim()}`, iconName: 'info' });
  },
  'toggle-nav': (el) => {
    const open = !app.classList.contains('nav-open');
    app.classList.toggle('nav-open', open);
    el.setAttribute('aria-expanded', String(open));
    if (open) {
      const scrim = document.createElement('div');
      scrim.className = 'nav-scrim';
      scrim.addEventListener('click', () => GLOBAL_ACTIONS['toggle-nav'](el));
      app.append(scrim);
      document.querySelector('#sidebar .nav-link')?.focus();
    } else document.querySelector('.nav-scrim')?.remove();
  },
  'proto-toast': (el) => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    closeMenus();
    prototypeToast(el.dataset.message || 'Action simulée');
  },
  'copy-id': (el) => {
    closeMenus();
    // Copie locale uniquement (presse-papiers du navigateur), aucune requête.
    navigator.clipboard?.writeText(el.dataset.id).catch(() => {});
    toast({ title: 'Identifiant copié', body: el.dataset.id, iconName: 'copy' });
  },
  retry: () => set({ scenario: 'normal' }),
  noop: () => {},
};

function paletteEntries() {
  return [
    ...Object.entries({ dashboard: '#/dashboard', organizations: '#/organisations', onboarding: '#/onboarding', domains: '#/domaines', plans: '#/plans', health: '#/sante', support: '#/support', audit: '#/audit', settings: '#/parametres' }).map(([k, h]) => ({ group: 'Pages', label: PAGES[k].title, href: h, iconName: 'chevronRight' })),
    { group: 'Actions', label: 'Nouvelle organisation', href: '#/onboarding/nouveau/1', iconName: 'plus' },
    ...ORGANIZATIONS.map((o) => ({ group: 'Organisations', label: o.name, meta: o.domain, href: `#/organisations/${o.id}`, iconName: 'building' })),
    ...DOMAINS.map((d) => ({ group: 'Domaines', label: d.hostname, meta: orgById(d.orgId)?.name, href: '#/domaines', iconName: 'globe' })),
  ];
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!e.target.closest('.dropdown')) closeMenus();
  if (!el) return;
  const name = el.dataset.action;
  const handler = GLOBAL_ACTIONS[name] || PAGES[route.name]?.module.actions?.[name];
  if (!handler) return;
  e.preventDefault();
  if (name !== 'menu') closeMenus();
  handler(el, ctx());
});

// Champs liés à l'état : data-model="page.champ" → models[page](ctx, champ, valeur)
function onModel(e) {
  const el = e.target.closest('[data-model]');
  if (!el) return;
  const [scope, key] = el.dataset.model.split('.');
  const handler = PAGES[route.name]?.module.models?.[scope];
  if (handler) handler(ctx(), key, el.value);
}
document.addEventListener('input', (e) => e.target.matches('input, textarea') && onModel(e));
document.addEventListener('change', (e) => e.target.matches('select') && onModel(e));

document.addEventListener('keydown', (e) => {
  if (menuKeydown(e)) return;
  const typing = e.target.closest('input, textarea, select, [contenteditable]');
  if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openPalette(paletteEntries(), navigate);
  } else if (e.key === '/' && !typing && !document.querySelector('.modal-backdrop')) {
    e.preventDefault();
    openPalette(paletteEntries(), navigate);
  } else if (e.key === 'Escape') {
    closeMenus();
    if (app.classList.contains('nav-open')) GLOBAL_ACTIONS['toggle-nav'](document.querySelector('[data-action="toggle-nav"]'));
  }
  // Onglets : flèches gauche/droite, Début/Fin.
  const tab = e.target.closest('[role="tab"]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const all = [...tab.parentElement.querySelectorAll('[role="tab"]')];
    const i = all.indexOf(tab);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    e.preventDefault();
    all[next].focus();
    all[next].click();
  }
});

window.addEventListener('hashchange', onRoute);
if (!location.hash) history.replaceState(null, '', '#/dashboard');
onRoute();
