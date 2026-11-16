// Journal de la plateforme (maquette : pages/audit.js) : qui a fait quoi, sur quelle organisation, et quand.
import { html } from '../_shared/platform-ui/html.js';
import { pageHeader } from '../_shared/platform-ui/card.js';
import { dataTable } from '../_shared/platform-ui/data-table.js';
import { emptyState } from '../_shared/platform-ui/feedback.js';
import { consolePage, formatDate } from '../_shared/platform-ui/kit.js';
import { auditEntries, AUDIT_LABELS } from '../_shared/platform-auth.js';
import { listOrganizations } from '../_shared/platform-data.js';

export async function onRequestGet(context) {
  const [entries, orgs] = await Promise.all([auditEntries(context.env.DB, { limit: 200 }), listOrganizations(context.env.DB)]);
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const content = html`
    ${pageHeader({ title: 'Journal', description: 'Les 200 dernières actions de l’équipe Licyo. Le journal ne se modifie pas depuis la console.' })}
    <section class="card">${dataTable({
      caption: 'Journal de la plateforme',
      stack: true,
      rows: entries,
      columns: [
        { key: 'at', label: 'Date', render: (a) => formatDate(a.at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) },
        { key: 'who', label: 'Qui', render: (a) => a.operator_name },
        { key: 'what', label: 'Action', className: 'wrap', render: (a) => html`${AUDIT_LABELS[a.action] ?? a.action} <span class="muted small mono">${a.action}</span>` },
        {
          key: 'org',
          label: 'Organisation',
          render: (a) => {
            const org = a.target_organization_id && byId.get(a.target_organization_id);
            return org ? html`<a href="/platform/organisations/${org.id}">${org.name}</a>` : '—';
          },
        },
      ],
      empty: emptyState({ title: 'Journal vide', iconName: 'scroll' }),
    })}</section>`;
  return consolePage(context, { title: 'Journal', active: 'audit', trail: [{ label: 'Journal' }], content, orgs });
}
