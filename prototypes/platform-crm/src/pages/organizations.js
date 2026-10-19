// Liste CRM des organisations clientes. Une organisation problématique se repère à trois signaux cohérents :
// accent coloré de la ligne, signal sous le nom (organizationIssue) et pastille de santé sur le logo.
import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader } from '../components/card.js';
import { statusBadge, healthDot, chip, signal } from '../components/badge.js';
import { dataTable, pagination } from '../components/data-table.js';
import { searchInput, selectInput } from '../components/form.js';
import { emptyState } from '../components/feedback.js';
import { dropdown } from '../components/dropdown.js';
import { orgLogo } from '../components/avatar.js';
import { ORGANIZATIONS, PLANS } from '../data/fixtures.js';
import { LIFECYCLE, BILLING, ACCESS, SPORTS } from '../data/status.js';
import { filterOrganizations, sortOrganizations, paginate, organizationIssue, ORG_VIEWS } from '../lib/query.js';
import { formatDate, relative } from '../lib/format.js';
import { region } from './common.js';
import { href } from '../router.js';
import { confirmSuspend } from './organization-detail.js';

const PAGE_SIZE = 8;
const planName = (key) => PLANS.find((p) => p.key === key)?.name ?? key;
const opts = (map, all) => [['', all], ...Object.entries(map).map(([k, v]) => [k, v.label])];

const viewTabs = (current) => html`
  <div class="segmented view-tabs" role="group" aria-label="Vues rapides">
    ${Object.entries(ORG_VIEWS).map(([key, v]) => {
      const n = ORGANIZATIONS.filter(v.test).length;
      return html`<button type="button" data-action="orgs-view" data-value="${key}" aria-pressed="${key === current}">${v.label}<span class="count ${key === 'attention' && n ? 'alert' : ''}">${n}</span></button>`;
    })}
  </div>`;

export function render(ctx) {
  const f = ctx.state.orgs;
  const filtered = sortOrganizations(filterOrganizations(ORGANIZATIONS, f), f.sort, f.dir);
  const pageData = paginate(filtered, f.page, PAGE_SIZE);
  const refined = f.q || f.lifecycle || f.plan || f.access;

  const columns = [
    {
      key: 'name', label: 'Organisation', sortable: true, render: (o) => {
        const issue = organizationIssue(o);
        return html`<div class="org-cell">${orgLogo(o, '', { presence: true })}<div style="min-width:0"><a class="name" href="${href('organisations', o.id)}">${o.name}</a><div class="sub mono truncate" title="${o.domain}">${o.domain}</div>${issue ? html`<div style="margin-top:3px">${signal(issue)}</div>` : ''}</div></div>`;
      },
    },
    { key: 'sports', label: 'Activités', hide: 'lg', render: (o) => html`<div class="chips">${o.sports.slice(0, 2).map((s) => chip(SPORTS[s]?.label ?? s))}${o.sports.length > 2 ? chip(`+${o.sports.length - 2}`) : ''}</div>` },
    { key: 'plan', label: 'Plan', hide: 'md', render: (o) => html`<div><span class="strong">${planName(o.plan)}</span><div class="muted" style="font-size:12px">${o.users.length} utilisateur${o.users.length > 1 ? 's' : ''}</div></div>` },
    { key: 'lifecycle', label: 'Cycle de vie', render: (o) => statusBadge(LIFECYCLE, o.lifecycle) },
    { key: 'billing', label: 'Facturation', render: (o) => statusBadge(BILLING, o.billing.status, { dot: false, square: true }) },
    { key: 'access', label: 'Accès', render: (o) => statusBadge(ACCESS, o.access.mode, { tip: 'Mode d’accès dérivé du contrat, de la facturation et des blocages' }) },
    { key: 'lastActivityAt', label: 'Activité', sortable: true, hide: 'lg', render: (o) => html`<div>${relative(o.lastActivityAt)}<div class="muted" style="font-size:12px">Créée ${formatDate(o.createdAt)}</div></div>` },
    { key: 'health', label: 'Santé', hide: 'md', render: (o) => healthDot(o.health) },
    {
      key: 'menu', label: '', srLabel: 'Actions', render: (o) =>
        dropdown({
          id: `menu-org-${o.slug}`,
          label: `Actions pour ${o.name}`,
          trigger: { className: 'btn btn-ghost btn-sm btn-icon', content: icon('more', 18) },
          items: [
            { label: 'Ouvrir la fiche', iconName: 'external', href: href('organisations', o.id) },
            { label: 'Voir les domaines', iconName: 'globe', href: href('organisations', o.id, 'domaines') },
            { label: 'Voir la facturation', iconName: 'card', href: href('organisations', o.id, 'facturation') },
            { label: 'Copier l’identifiant', iconName: 'copy', action: 'copy-id', data: { id: o.id } },
            'sep',
            { label: 'Suspendre l’accès…', iconName: 'lock', action: 'suspend', danger: true, data: { id: o.id } },
          ],
        }),
    },
  ];

  const table = dataTable({
    columns,
    rows: pageData.items,
    caption: 'Organisations clientes',
    stack: true,
    sort: { key: f.sort, dir: f.dir, action: 'orgs-sort' },
    rowAttrs: (o) => {
      const issue = organizationIssue(o);
      return issue ? html`class="row-${issue.tone}"` : '';
    },
    empty: emptyState({
      title: 'Aucune organisation ne correspond',
      text: 'Modifiez la recherche, les filtres ou la vue pour élargir les résultats.',
      actions: html`<button type="button" class="btn btn-secondary" data-action="orgs-reset">Réinitialiser les filtres</button>`,
    }),
  });

  return html`
    ${pageHeader({
      title: 'Organisations',
      description: `Toutes les organisations clientes, quels que soient leur sport et leur taille. ${ORGANIZATIONS.filter(ORG_VIEWS.attention.test).length} demandent une attention.`,
      actions: html`<button type="button" class="btn btn-secondary" data-action="proto-toast" data-message="Export CSV des organisations">${icon('download', 16)}Exporter</button>`,
    })}
    <section class="card" aria-label="Liste des organisations">
      <div class="toolbar">${viewTabs(f.view)}</div>
      <div class="toolbar" role="search">
        ${searchInput({ id: 'orgs-q', model: 'orgs.q', value: f.q, placeholder: 'Nom, domaine, sport, identifiant…', label: 'Rechercher une organisation' })}
        ${selectInput({ id: 'orgs-lifecycle', model: 'orgs.lifecycle', value: f.lifecycle, options: opts(LIFECYCLE, 'Tous les cycles de vie'), label: 'Filtrer par cycle de vie' })}
        ${selectInput({ id: 'orgs-access', model: 'orgs.access', value: f.access, options: opts(ACCESS, 'Tous les accès'), label: 'Filtrer par mode d’accès' })}
        ${selectInput({ id: 'orgs-plan', model: 'orgs.plan', value: f.plan, options: [['', 'Tous les plans'], ...PLANS.map((p) => [p.key, p.name])], label: 'Filtrer par plan' })}
        ${refined ? html`<button type="button" class="btn btn-ghost btn-sm" data-action="orgs-reset">${icon('x', 14)}Effacer les filtres</button>` : ''}
        <span class="muted small" style="margin-left:auto" aria-live="polite">${filtered.length} organisation${filtered.length > 1 ? 's' : ''}</span>
      </div>
      ${region(ctx, html`${table}${filtered.length ? pagination({ ...pageData, action: 'orgs-page', noun: 'organisations' }) : ''}`, {
        empty: emptyState({ title: 'Aucune organisation', text: 'Créez votre première organisation cliente pour commencer.', iconName: 'building', actions: html`<a class="btn btn-primary" href="#/onboarding/nouveau/1">${icon('plus', 16)}Nouvelle organisation</a>` }),
        rows: 8,
      })}
    </section>`;
}

export const actions = {
  'orgs-view': (el, ctx) => ctx.set({ orgs: { ...ctx.state.orgs, view: el.dataset.value, page: 1 } }),
  'orgs-sort': (el, ctx) => {
    const key = el.dataset.key;
    const f = ctx.state.orgs;
    ctx.set({ orgs: { ...f, sort: key, dir: f.sort === key && f.dir === 'asc' ? 'desc' : 'asc', page: 1 } });
  },
  'orgs-page': (el, ctx) => ctx.set({ orgs: { ...ctx.state.orgs, page: Number(el.dataset.page) } }),
  'orgs-reset': (el, ctx) => ctx.set({ orgs: { ...ctx.state.orgs, view: 'all', q: '', lifecycle: '', plan: '', access: '', health: '', page: 1 } }),
  suspend: (el) => confirmSuspend(el.dataset.id),
};

// Modifier un filtre ramène à la première page.
export const models = { orgs: (ctx, key, value) => ctx.set({ orgs: { ...ctx.state.orgs, [key]: value, page: 1 } }) };
