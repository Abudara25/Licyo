// Shell de la console Platform : sidebar, topbar, fil d'Ariane.
// Cette navigation est PROPRE à la plateforme : elle ne partage ni session, ni rôles, ni navigation avec
// l'admin d'un club (surface distincte, ADR-018).
// UI visibility is not authorization : afficher ou masquer une entrée ne donne ni ne retire aucun droit ;
// la future console contrôlera chaque action côté serveur.
// Le nom du produit vient UNIQUEMENT de config/brand.js (nom de travail remplaçable).
import { html } from '../lib/html.js';
import { icon } from './icons.js';
import { avatar } from './avatar.js';
import { dropdown } from './dropdown.js';
import { BRAND, brandInitial } from '../config/brand.js';
import { OPERATOR_DISPLAY, ENVIRONMENT } from '../data/fixtures.js';

const NAV = [
  { section: 'Pilotage' },
  { key: 'dashboard', label: 'Dashboard', href: '#/dashboard', iconName: 'dashboard', routes: ['dashboard'] },
  {
    key: 'organizations', label: 'Organisations', href: '#/organisations', iconName: 'building', routes: ['organizations', 'organization'],
    children: [
      { key: 'organizations', label: 'Toutes les organisations', href: '#/organisations', routes: ['organizations', 'organization'] },
      { key: 'onboarding', label: 'Onboarding', href: '#/onboarding', routes: ['onboarding', 'wizard'], countKey: 'onboarding' },
    ],
  },
  { key: 'domains', label: 'Domaines', href: '#/domaines', iconName: 'globe', routes: ['domains'], countKey: 'pendingDomains' },
  { key: 'plans', label: 'Plans & fonctionnalités', href: '#/plans', iconName: 'layers', routes: ['plans'] },
  { section: 'Exploitation' },
  { key: 'health', label: 'Santé & incidents', href: '#/sante', iconName: 'pulse', routes: ['health'], countKey: 'openIncidents', alert: true },
  { key: 'support', label: 'Support', href: '#/support', iconName: 'lifebuoy', routes: ['support'], countKey: 'openTickets' },
  { section: 'Gouvernance' },
  { key: 'audit', label: 'Audit', href: '#/audit', iconName: 'scroll', routes: ['audit'] },
  { key: 'settings', label: 'Paramètres Platform', href: '#/parametres', iconName: 'settings', routes: ['settings'] },
];

const count = (n, alert) => (n ? html`<span class="nav-count ${alert ? 'alert' : ''}" aria-label="${n} à traiter">${n}</span>` : '');

export function sidebar(route, counts) {
  return html`
    <aside class="sidebar" id="sidebar" aria-label="Navigation ${BRAND.platformName}">
      <a class="brand" href="#/dashboard" aria-label="${BRAND.platformName}, tableau de bord">
        <span class="brand-mark" aria-hidden="true">${brandInitial()}</span>
        <span><span class="brand-name">${BRAND.productName}</span><span class="brand-sub">${BRAND.platformLabel}${BRAND.workingName ? html`<span class="wn-badge" title="Nom provisoire du produit">nom de travail</span>` : ''}</span></span>
      </a>
      <nav class="nav" aria-label="Sections">
        ${NAV.map((item) => {
          if (item.section) return html`<div class="nav-section">${item.section}</div>`;
          const current = item.routes.includes(route.name);
          if (!item.children) {
            return html`<a class="nav-link" href="${item.href}" ${current ? html`aria-current="page"` : ''}>${icon(item.iconName, 18)}<span>${item.label}</span>${count(item.countKey && counts[item.countKey], item.alert)}</a>`;
          }
          return html`
            <a class="nav-link" href="${item.href}" ${current ? html`aria-current="${route.name === 'onboarding' || route.name === 'wizard' ? 'true' : 'page'}"` : ''}>${icon(item.iconName, 18)}<span>${item.label}</span></a>
            <div class="nav-sub">${item.children.map((c) => html`<a class="nav-link" href="${c.href}" ${c.routes.includes(route.name) ? html`aria-current="page"` : ''}><span>${c.label}</span>${count(c.countKey && counts[c.countKey])}</a>`)}</div>`;
        })}
      </nav>
      <div class="sidebar-foot">
        <div class="env-card" title="Environnement de démonstration, données fictives">
          <span class="env-line"><span class="dot" aria-hidden="true"></span><strong>${ENVIRONMENT.label}</strong> · données fictives · ${ENVIRONMENT.region}</span>
          <span class="mono">${ENVIRONMENT.version}</span>
        </div>
        ${dropdown({
          id: 'menu-operator',
          label: 'Menu du profil opérateur',
          up: true,
          trigger: {
            className: 'btn btn-ghost operator-btn',
            content: html`${avatar(OPERATOR_DISPLAY.initials)}<span class="operator-meta"><span class="operator-name">${OPERATOR_DISPLAY.name}</span><span class="operator-role">Opérateur · démo</span></span>${icon('chevronDown', 16)}`,
          },
          head: html`<div class="menu-head"><div class="who">${OPERATOR_DISPLAY.name}</div><div class="role">${OPERATOR_DISPLAY.email}</div><div class="role">${OPERATOR_DISPLAY.roleLabel}</div></div>`,
          items: [
            { label: 'Mon profil', iconName: 'user', action: 'proto-toast', data: { message: 'Profil opérateur' } },
            { label: 'Sécurité et MFA', iconName: 'shield', action: 'proto-toast', data: { message: 'Paramètres de sécurité' } },
            'sep',
            { label: 'Se déconnecter (désactivé)', iconName: 'logout', action: 'noop', disabled: true },
          ],
        })}
      </div>
    </aside>`;
}

const TITLES = {
  dashboard: ['Dashboard'],
  organizations: ['Organisations'],
  onboarding: ['Organisations', 'Onboarding'],
  wizard: ['Onboarding', 'Nouvelle organisation'],
  domains: ['Domaines'],
  plans: ['Plans & fonctionnalités'],
  health: ['Santé & incidents'],
  support: ['Support'],
  audit: ['Audit'],
  settings: ['Paramètres Platform'],
  'not-found': ['Page introuvable'],
};

export function topbar(route, { orgName = '' } = {}) {
  const trail = route.name === 'organization' ? ['Organisations', orgName || 'Organisation'] : TITLES[route.name] || [''];
  const parentHref = { Organisations: '#/organisations', Onboarding: '#/onboarding' };
  return html`
    <header class="topbar">
      <button type="button" class="btn btn-ghost btn-icon menu-toggle" data-action="toggle-nav" aria-controls="sidebar" aria-expanded="false" aria-label="Ouvrir la navigation">${icon('menu', 20)}</button>
      <nav class="crumbs" aria-label="Fil d’Ariane">
        <span class="hide-md">${BRAND.productName}</span><span class="hide-md" aria-hidden="true">${icon('chevronRight', 14)}</span>
        ${trail.map((t, i) =>
          i < trail.length - 1
            ? html`<a class="hide-sm" href="${parentHref[t] || '#/dashboard'}">${t}</a><span class="hide-sm" aria-hidden="true">${icon('chevronRight', 14)}</span>`
            : html`<span aria-current="page">${t}</span>`
        )}
      </nav>
      <div class="topbar-actions">
        ${dropdown({
          id: 'menu-preview',
          label: 'Options de l’aperçu',
          trigger: { className: 'badge tone-violet preview-pill', content: html`<span class="dot" aria-hidden="true"></span>${BRAND.platformLabel} Preview<span class="hide-sm">&nbsp;· données fictives</span>` },
          head: html`<div class="menu-head"><div class="who">Aperçu de démonstration</div><div class="role">Simuler un état d’interface (aucun service réel)</div>${BRAND.workingName ? html`<div class="role">Nom affiché : nom de travail provisoire</div>` : ''}</div>`,
          items: [
            { label: 'Données normales', iconName: 'check', action: 'scenario', data: { value: 'normal' } },
            { label: 'État de chargement', iconName: 'refresh', action: 'scenario', data: { value: 'loading' } },
            { label: 'État vide', iconName: 'search', action: 'scenario', data: { value: 'empty' } },
            { label: 'État d’erreur', iconName: 'alert', action: 'scenario', data: { value: 'error' } },
          ],
        })}
        <button type="button" class="search-trigger" data-action="palette" aria-label="Recherche rapide (Ctrl+K)">${icon('search', 16)}<span class="label">Rechercher…</span><kbd>Ctrl K</kbd></button>
        ${dropdown({
          id: 'menu-notifications',
          label: 'Notifications, 3 non lues',
          trigger: { className: 'btn btn-ghost btn-icon bell', content: html`${icon('bell', 19)}<span class="unread" aria-hidden="true"></span>` },
          head: html`<div class="menu-head"><div class="who">Notifications</div><div class="role">3 éléments récents</div></div>`,
          items: [
            { label: 'SSL en échec : badminton-herblay.example', iconName: 'alert', href: '#/sante' },
            { label: 'Padel 95 : grâce jusqu’au 5 oct.', iconName: 'card', href: '#/organisations/org_91b3e6d027f84ac5b1d93e0f62a7c4d8/facturation' },
            { label: 'Nouvelle demande SUP-331', iconName: 'lifebuoy', href: '#/support' },
          ],
        })}
        <a class="btn btn-primary hide-sm" href="#/onboarding/nouveau/1">${icon('plus', 16)}Nouvelle organisation</a>
      </div>
    </header>`;
}
