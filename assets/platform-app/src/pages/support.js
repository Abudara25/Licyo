// Demandes de support (vue de suivi). Pas de messagerie dans le prototype.
import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card, kvList } from '../components/card.js';
import { statusBadge } from '../components/badge.js';
import { dataTable } from '../components/data-table.js';
import { selectInput, segmented } from '../components/form.js';
import { emptyState, notice } from '../components/feedback.js';
import { avatar, initialsOf } from '../components/avatar.js';
import { openModal } from '../components/modal.js';
import { prototypeToast } from '../components/toast.js';
import { TICKETS } from '../data/fixtures.js';
import { PRIORITY, TICKET_STATUS } from '../data/status.js';
import { relative, formatDateTime } from '../lib/format.js';
import { region, orgLink } from './common.js';

function preview(ticket) {
  openModal({
    title: `${ticket.id} · ${ticket.subject}`,
    iconName: 'lifebuoy',
    tone: 'info',
    wide: true,
    confirmLabel: 'M’assigner la demande',
    body: html`${kvList([
      ['Organisation', orgLink(ticket.orgId)],
      ['Priorité', statusBadge(PRIORITY, ticket.priority)],
      ['Statut', statusBadge(TICKET_STATUS, ticket.status)],
      ['Ouverte', `${formatDateTime(ticket.openedAt)} (${relative(ticket.openedAt)})`],
      ['Assignée à', ticket.assignee ?? 'Personne'],
    ])}
    ${notice('neutral', 'Aperçu uniquement : la conversation et les pièces jointes ne sont pas affichées dans le prototype.')}`,
    onConfirm: () => prototypeToast(`${ticket.id} assignée`),
  });
}

export function render(ctx) {
  const f = ctx.state.support;
  const rows = TICKETS.filter((t) => (f.status === 'active' ? t.status !== 'resolved' : !f.status || t.status === f.status) && (!f.priority || t.priority === f.priority)).sort(
    (a, b) => PRIORITY[a.priority].rank - PRIORITY[b.priority].rank || (a.openedAt < b.openedAt ? 1 : -1)
  );
  return html`
    ${pageHeader({
      title: 'Support',
      description: 'Demandes des organisations clientes, par priorité et par ancienneté.',
      actions: html`<button type="button" class="btn btn-primary" data-action="proto-toast" data-message="Nouvelle demande de support">${icon('plus', 16)}Nouvelle demande</button>`,
    })}
    ${card({
      flush: true,
      body: html`
        <div class="toolbar">
          ${segmented({ label: 'Filtrer par statut', action: 'sup-status', value: f.status, options: [['active', 'À traiter'], ['', 'Toutes'], ...Object.entries(TICKET_STATUS).map(([k, v]) => [k, v.label])] })}
          ${selectInput({ id: 'sup-priority', model: 'support.priority', value: f.priority, label: 'Filtrer par priorité', options: [['', 'Toutes priorités'], ...Object.entries(PRIORITY).map(([k, v]) => [k, v.label])] })}
          <span class="muted" style="margin-left:auto" aria-live="polite">${rows.length} demande${rows.length > 1 ? 's' : ''}</span>
        </div>
        ${region(
          ctx,
          dataTable({
            caption: 'Demandes de support',
            stack: true,
            rows,
            columns: [
              { key: 'id', label: 'Demande', className: 'wrap', render: (t) => html`<button type="button" class="link-btn" data-action="sup-open" data-id="${t.id}"><span class="mono muted">${t.id}</span><span style="display:block;font-weight:600">${t.subject}</span></button>` },
              { key: 'org', label: 'Organisation', render: (t) => orgLink(t.orgId) },
              { key: 'priority', label: 'Priorité', render: (t) => statusBadge(PRIORITY, t.priority) },
              { key: 'status', label: 'Statut', render: (t) => statusBadge(TICKET_STATUS, t.status, { dot: false, square: true }) },
              { key: 'age', label: 'Âge', hide: 'md', render: (t) => html`<span class="muted">${relative(t.openedAt)}</span>` },
              { key: 'assignee', label: 'Assignation', hide: 'lg', render: (t) => (t.assignee ? html`<div class="org-cell">${avatar(initialsOf(t.assignee))}<span>${t.assignee}</span></div>` : html`<span class="muted">Non assignée</span>`) },
            ],
            empty: emptyState({ title: 'Aucune demande', text: 'Aucune demande ne correspond à ces filtres.', iconName: 'lifebuoy' }),
          }),
          { rows: 7 }
        )}`,
    })}`;
}

export const actions = {
  'sup-status': (el, ctx) => ctx.set({ support: { ...ctx.state.support, status: el.dataset.value } }),
  'sup-open': (el) => preview(TICKETS.find((t) => t.id === el.dataset.id)),
};

export const models = { support: (ctx, key, value) => ctx.set({ support: { ...ctx.state.support, [key]: value } }) };
