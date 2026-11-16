// Domaines de toutes les organisations (maquette : pages/domains.js). Le suivi DNS / certificat viendra avec le
// branchement de Cloudflare for SaaS ; ici, la liste réelle des domaines attribués.
import { html } from '../_shared/platform-ui/html.js';
import { pageHeader } from '../_shared/platform-ui/card.js';
import { dataTable } from '../_shared/platform-ui/data-table.js';
import { emptyState } from '../_shared/platform-ui/feedback.js';
import { badge, consolePage, formatDate, notice } from '../_shared/platform-ui/kit.js';
import { listDomains, orgStatus } from '../_shared/platform-data.js';

export async function onRequestGet(context) {
  const domains = await listDomains(context.env.DB);
  const content = html`
    ${pageHeader({ title: 'Domaines', description: `${domains.length} domaine${domains.length > 1 ? 's' : ''} attribué${domains.length > 1 ? 's' : ''}. Chaque domaine mène au site et à l’espace admin d’une seule organisation.` })}
    ${notice('info', 'Le contrôle automatique du DNS et des certificats n’est pas encore branché : vérifiez qu’un domaine répond en l’ouvrant.')}
    <section class="card section-gap">${dataTable({
      caption: 'Domaines',
      stack: true,
      rows: domains,
      columns: [
        { key: 'domain', label: 'Domaine', render: (d) => html`<a class="mono" href="https://${d.domain}" target="_blank" rel="noopener noreferrer">${d.domain}</a>` },
        { key: 'org', label: 'Organisation', render: (d) => html`<a href="/platform/organisations/${d.organization_id}">${d.name}</a>` },
        { key: 'status', label: 'État du club', render: (d) => badge(orgStatus(d.status).label, orgStatus(d.status).tone) },
        { key: 'created', label: 'Ajouté le', render: (d) => formatDate(d.created_at) },
      ],
      empty: emptyState({ title: 'Aucun domaine', iconName: 'globe' }),
    })}</section>`;
  return consolePage(context, { title: 'Domaines', active: 'domains', trail: [{ label: 'Domaines' }], content });
}
