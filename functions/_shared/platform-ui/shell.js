// Coquille de la console fondateur, rendue côté serveur : même structure et mêmes classes que la maquette validée
// (prototypes/platform-crm du dépôt Saint-Gratien, components/shell.js), avec de vrais liens, l'opérateur connecté et
// les compteurs réels. Afficher ou masquer une entrée ne donne aucun droit : chaque page et chaque action vérifient
// la permission côté serveur (functions/platform/_middleware.js).
import { html } from './html.js';
import { icon } from './icons.js';
import { avatar, initialsOf } from './avatar.js';
import { canPlatform, PLATFORM_ROLE_LABELS } from '../platform-auth.js';

export const BRAND = Object.freeze({ productName: 'Licyo', platformLabel: 'Console fondateur', platformName: 'Licyo Console' });

// Entrées « soon » : prévues par la maquette, pas encore construites. Affichées comme telles, jamais avec des données
// fictives présentées comme réelles.
const NAV = [
  { section: 'Pilotage' },
  { key: 'dashboard', label: 'Dashboard', href: '/platform', iconName: 'dashboard' },
  {
    key: 'organizations', label: 'Organisations', href: '/platform/organisations', iconName: 'building',
    children: [
      { key: 'organizations', label: 'Toutes les organisations', href: '/platform/organisations' },
      { key: 'new', label: 'Nouvelle organisation', href: '/platform/organisations/nouvelle', perm: 'orgs.create' },
    ],
  },
  { key: 'domains', label: 'Domaines', href: '/platform/domaines', iconName: 'globe' },
  { key: 'plans', label: 'Plans & tarifs', iconName: 'layers', soon: true },
  { section: 'Exploitation' },
  { key: 'health', label: 'Santé & incidents', iconName: 'pulse', soon: true },
  { key: 'support', label: 'Support', iconName: 'lifebuoy', soon: true },
  { section: 'Gouvernance' },
  { key: 'audit', label: 'Journal', href: '/platform/journal', iconName: 'scroll', perm: 'audit.read' },
  { key: 'team', label: 'Équipe Licyo', href: '/platform/equipe', iconName: 'users', perm: 'team.manage' },
];

const count = (n, alert) => (n ? html`<span class="nav-count ${alert ? 'alert' : ''}" aria-label="${n} à traiter">${n}</span>` : '');
const allowed = (item, operator) => !item.perm || canPlatform(operator, item.perm);

export function sidebar(active, operator, counts = {}, env = {}) {
  const envLabel = env.APP_ENV === 'production' ? 'Production' : env.APP_ENV === 'preview' ? 'Prévisualisation' : 'Local';
  return html`
    <aside class="sidebar" id="sidebar" aria-label="Navigation ${BRAND.platformName}">
      <a class="brand" href="/platform" aria-label="${BRAND.platformName}, tableau de bord">
        <span class="brand-mark" aria-hidden="true">${BRAND.productName.charAt(0)}</span>
        <span><span class="brand-name">${BRAND.productName}</span><span class="brand-sub">${BRAND.platformLabel}</span></span>
      </a>
      <nav class="nav" aria-label="Sections">
        ${NAV.filter((item) => item.section || allowed(item, operator)).map((item) => {
          if (item.section) return html`<div class="nav-section">${item.section}</div>`;
          if (item.soon) return html`<span class="nav-link is-soon" aria-disabled="true">${icon(item.iconName, 18)}<span>${item.label}</span><span class="nav-count">Bientôt</span></span>`;
          const current = active === item.key || (item.children || []).some((c) => c.key === active);
          if (!item.children) return html`<a class="nav-link" href="${item.href}" ${current ? html`aria-current="page"` : ''}>${icon(item.iconName, 18)}<span>${item.label}</span></a>`;
          return html`
            <a class="nav-link" href="${item.href}" ${current ? html`aria-current="true"` : ''}>${icon(item.iconName, 18)}<span>${item.label}</span></a>
            <div class="nav-sub">${item.children.filter((c) => allowed(c, operator)).map((c) => html`<a class="nav-link" href="${c.href}" ${c.key === active ? html`aria-current="page"` : ''}><span>${c.label}</span>${count(c.countKey && counts[c.countKey], true)}</a>`)}</div>`;
        })}
      </nav>
      <div class="sidebar-foot">
        <div class="env-card">
          <span class="env-line"><span class="dot env-${envLabel === 'Production' ? 'prod' : 'dev'}" aria-hidden="true"></span><strong>${envLabel}</strong> · données UE</span>
          <span class="mono">Cloudflare · D1 Europe</span>
        </div>
        <details class="operator-menu">
          <summary class="btn btn-ghost operator-btn">${avatar(initialsOf(operator.name))}<span class="operator-meta"><span class="operator-name">${operator.name}</span><span class="operator-role">${PLATFORM_ROLE_LABELS[operator.role]}</span></span>${icon('chevronDown', 16)}</summary>
          <div class="menu operator-pop">
            <div class="menu-head"><div class="who">${operator.name}</div><div class="role">${operator.email}</div><div class="role">${PLATFORM_ROLE_LABELS[operator.role]}</div></div>
            <form method="POST" action="/platform/deconnexion"><button type="submit" class="menu-item">${icon('logout', 16)}Se déconnecter</button></form>
          </div>
        </details>
      </div>
    </aside>`;
}

export function topbar(trail, operator, { q = '' } = {}) {
  return html`
    <header class="topbar">
      <button type="button" class="btn btn-ghost btn-icon menu-toggle" data-action="toggle-nav" aria-controls="sidebar" aria-expanded="false" aria-label="Ouvrir la navigation">${icon('menu', 20)}</button>
      <nav class="crumbs" aria-label="Fil d’Ariane">
        <span class="hide-md">${BRAND.productName}</span><span class="hide-md" aria-hidden="true">${icon('chevronRight', 14)}</span>
        ${trail.map((t, i) =>
          i < trail.length - 1
            ? html`<a class="hide-sm" href="${t.href}">${t.label}</a><span class="hide-sm" aria-hidden="true">${icon('chevronRight', 14)}</span>`
            : html`<span aria-current="page">${t.label}</span>`
        )}
      </nav>
      <div class="topbar-actions">
        <form class="topbar-search" method="GET" action="/platform/organisations" role="search">
          <label class="sr-only" for="top-q">Rechercher une organisation</label>
          <div class="input-icon">${icon('search', 16)}<input class="input" id="top-q" type="search" name="q" value="${q}" placeholder="Rechercher un club…" autocomplete="off"></div>
        </form>
        ${canPlatform(operator, 'orgs.create') ? html`<a class="btn btn-primary hide-sm" href="/platform/organisations/nouvelle">${icon('plus', 16)}Nouvelle organisation</a>` : ''}
      </div>
    </header>`;
}

const STYLES = ['tokens', 'base', 'layout', 'components', 'pages', 'licyo'];

// Document complet. active : clé de navigation ; trail : fil d'Ariane [{ label, href }].
export function platformPage({ title, active, trail, operator, counts, env, content, q = '' }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${html`${title}`} · ${BRAND.platformName}</title>
  <link rel="icon" href="data:,">
  ${STYLES.map((s) => `<link rel="stylesheet" href="/assets/platform/${s}.css">`).join('\n  ')}
  <script src="/assets/platform/console.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main-content">Aller au contenu</a>
  <div class="app">
    <div class="sidebar-slot">${sidebar(active, operator, counts, env)}</div>
    <div class="main-col">
      ${topbar(trail, operator, { q })}
      <main id="main-content" class="content" tabindex="-1">${content}</main>
    </div>
  </div>
</body>
</html>`;
}

// Pages sans session (connexion, invitation, démarrage) : carte centrée, mêmes styles.
export function platformAuthPage({ title, content }) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${html`${title}`} · ${BRAND.platformName}</title>
  <link rel="icon" href="data:,">
  ${STYLES.map((s) => `<link rel="stylesheet" href="/assets/platform/${s}.css">`).join('\n  ')}
</head>
<body>
  <main class="auth-wrap">
    <div class="card auth-card">
      <div class="brand auth-brand"><span class="brand-mark" aria-hidden="true">${BRAND.productName.charAt(0)}</span><span><span class="brand-name">${BRAND.productName}</span><span class="brand-sub">${BRAND.platformLabel}</span></span></div>
      ${content}
    </div>
  </main>
</body>
</html>`;
}
