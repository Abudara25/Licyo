// Liste des organisations (maquette : pages/organizations.js) : onglets de vue, recherche, tableau avec état, effectif
// et comptes du bureau. Filtres par paramètres d'URL (?vue=…&q=…) : la liste reste partageable et sans JavaScript.
import { html } from '../../_shared/platform-ui/html.js';
import { icon } from '../../_shared/platform-ui/icons.js';
import { pageHeader } from '../../_shared/platform-ui/card.js';
import { dataTable } from '../../_shared/platform-ui/data-table.js';
import { emptyState } from '../../_shared/platform-ui/feedback.js';
import { badge, signal, orgLogo, consolePage, formatDate } from '../../_shared/platform-ui/kit.js';
import { listOrganizations, orgStatus, sportLabel } from '../../_shared/platform-data.js';
import { canPlatform } from '../../_shared/platform-auth.js';

const VIEWS = [
  ['toutes', 'Toutes', () => true],
  ['a-traiter', 'À traiter', (o) => Boolean(o.issue)],
  ['en-service', 'En service', (o) => o.status === 'active'],
  ['suspendues', 'Suspendues', (o) => o.status === 'suspended'],
];

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const view = VIEWS.find(([key]) => key === url.searchParams.get('vue')) ?? VIEWS[0];
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 100);
  const orgs = await listOrganizations(context.env.DB);
  const needle = fold(q);
  const rows = orgs.filter(view[2]).filter((o) => !needle || [o.name, o.slug, o.domain, o.id, sportLabel(o.sport)].some((v) => fold(v).includes(needle)));
  const operator = context.data.operator;
  const viewHref = (key) => `/platform/organisations?vue=${key}${q ? `&q=${encodeURIComponent(q)}` : ''}`;

  const table = dataTable({
    caption: 'Organisations clientes',
    stack: 'md',
    rows,
    rowAttrs: (o) => (o.issue ? html`class="row-${o.issue.tone}"` : ''),
    columns: [
      {
        key: 'name',
        label: 'Organisation',
        className: 'wrap',
        render: (o) => html`<a class="org-cell" href="/platform/organisations/${o.id}">${orgLogo(o, '', { presence: true })}<span><span class="who">${o.name}</span><br><span class="sub">${o.domain || 'aucun domaine'}</span>${o.issue ? html`<br>${signal(o.issue)}` : ''}</span></a>`,
      },
      { key: 'sport', label: 'Sport', render: (o) => html`<span class="chip">${sportLabel(o.sport)}</span>` },
      { key: 'status', label: 'État', render: (o) => badge(orgStatus(o.status).label, orgStatus(o.status).tone) },
      { key: 'members', label: 'Inscriptions', align: 'right', render: (o) => o.members },
      { key: 'accounts', label: 'Comptes du bureau', render: (o) => html`${o.accounts}${o.invites ? html` <span class="muted small">+ ${o.invites} invité${o.invites > 1 ? 's' : ''}</span>` : ''}` },
      { key: 'created', label: 'Créée le', hide: 'md', render: (o) => formatDate(o.created_at) },
    ],
    empty: emptyState({
      title: q ? 'Aucun résultat' : 'Aucune organisation dans cette vue',
      text: q ? `Aucune organisation ne correspond à « ${q} ».` : '',
      actions: q ? html`<a class="btn btn-secondary" href="${viewHref(view[0]).replace(/&q=.*$/, '')}">Effacer la recherche</a>` : '',
    }),
  });

  const content = html`
    ${pageHeader({
      title: 'Organisations',
      description: `Toutes les organisations clientes, quels que soient leur sport et leur taille. ${orgs.filter((o) => o.issue).length} demandent une attention.`,
      actions: canPlatform(operator, 'orgs.create') ? html`<a class="btn btn-primary only-sm" href="/platform/organisations/nouvelle">${icon('plus', 16)}Nouvelle organisation</a>` : '',
    })}
    <section class="card" aria-label="Liste des organisations">
      <div class="card-head">
        <div class="filter-tabs segmented" role="group" aria-label="Vue">
          ${VIEWS.map(([key, label, test]) => html`<a class="btn btn-sm ${key === view[0] ? 'btn-secondary' : 'btn-ghost'}" href="${viewHref(key)}" ${key === view[0] ? html`aria-current="page"` : ''}>${label} <span class="nav-count">${orgs.filter(test).length}</span></a>`)}
        </div>
      </div>
      <form class="toolbar" method="GET" action="/platform/organisations" role="search">
        <input type="hidden" name="vue" value="${view[0]}">
        <div class="input-icon">${icon('search', 16)}<input class="input" type="search" name="q" value="${q}" placeholder="Nom, domaine, sport, identifiant…" aria-label="Rechercher une organisation" autocomplete="off"></div>
        <button type="submit" class="btn btn-secondary">Rechercher</button>
        <span class="muted small" style="margin-left:auto">${rows.length} organisation${rows.length > 1 ? 's' : ''}</span>
      </form>
      ${table}
    </section>`;
  return consolePage(context, { title: 'Organisations', active: 'organizations', trail: [{ label: 'Organisations' }], content, q, orgs });
}
