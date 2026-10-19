// Domaines : revendications (claims) de la plateforme (A2 RFC-7). Aucune action DNS réelle.
import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card, kvList } from '../components/card.js';
import { badge, statusBadge } from '../components/badge.js';
import { dataTable } from '../components/data-table.js';
import { searchInput, segmented } from '../components/form.js';
import { emptyState, notice } from '../components/feedback.js';
import { dropdown } from '../components/dropdown.js';
import { openModal } from '../components/modal.js';
import { DOMAINS, orgById } from '../data/fixtures.js';
import { DOMAIN_STATUS, SSL } from '../data/status.js';
import { relative, formatDate, shortId, fold } from '../lib/format.js';
import { region, orgLink } from './common.js';

function showChallenge(domain) {
  openModal({
    title: 'Défi de vérification DNS',
    description: `Preuve de contrôle attendue pour ${domain.hostname}.`,
    iconName: 'globe',
    tone: 'warning',
    cancel: false,
    confirmLabel: 'Fermer',
    confirmTone: 'secondary',
    body: html`
      ${kvList([
        ['Type', 'TXT'],
        ['Nom', html`<span class="mono">_platform-challenge.${domain.hostname}</span>`],
        ['Valeur', html`<span class="mono muted">générée par la future console (unique par revendication)</span>`],
        ['Expiration', domain.challengeExpiresAt ? html`${formatDate(domain.challengeExpiresAt)} (${relative(domain.challengeExpiresAt)})` : '—'],
      ])}
      ${notice('info', 'Aucune valeur réelle n’est affichée dans le prototype. Un domaine n’est jamais réaffecté : toute réutilisation exige une nouvelle revendication et un nouveau défi.')}`,
  });
}

export function render(ctx) {
  const f = ctx.state.domains;
  const counts = Object.fromEntries(Object.keys(DOMAIN_STATUS).map((k) => [k, DOMAINS.filter((d) => d.status === k).length]));
  const needle = fold(f.q.trim());
  const rows = DOMAINS.filter((d) => (!f.status || d.status === f.status) && (!needle || fold(`${d.hostname} ${orgById(d.orgId)?.name}`).includes(needle)));

  const table = dataTable({
    caption: 'Domaines de la plateforme',
    stack: true,
    rows,
    columns: [
      {
        key: 'host', label: 'Domaine', className: 'wrap', render: (d) => html`<div><span class="mono nowrap" style="font-weight:600;color:var(--ui-text)">${d.hostname}</span>
          <div class="chips" style="margin-top:4px">${badge(d.type === 'platform' ? 'Plateforme' : 'Personnalisé', 'neutral', { dot: false, square: true })}${d.primary ? badge('Principal', 'info', { dot: false }) : ''}${d.redirect ? badge('Redirection 301', 'neutral', { dot: false }) : ''}</div>
          ${d.error ? html`<div style="color:var(--tone-danger);font-size:12px;margin-top:4px">${d.error}</div>` : ''}
          ${d.quarantineUntil ? html`<div class="muted" style="font-size:12px;margin-top:4px">Quarantaine jusqu’au ${formatDate(d.quarantineUntil)}</div>` : ''}</div>`,
      },
      { key: 'org', label: 'Organisation', render: (d) => orgLink(d.orgId) },
      { key: 'claim', label: 'Revendication', hide: 'lg', render: (d) => html`<span class="mono" data-tip="${d.id}" tabindex="0">${shortId(d.id)}</span><div class="muted" style="font-size:12px">${d.claimEpoch ? `Génération ${d.claimEpoch}` : 'Non vérifiée'}</div>` },
      { key: 'status', label: 'Statut', render: (d) => statusBadge(DOMAIN_STATUS, d.status) },
      { key: 'ssl', label: 'SSL', hide: 'md', render: (d) => (d.ssl === 'none' ? html`<span class="muted" aria-label="Aucun certificat">—</span>` : statusBadge(SSL, d.ssl, { dot: false })) },
      { key: 'check', label: 'Dernière vérification', hide: 'md', render: (d) => html`<span class="muted">${relative(d.lastCheckAt)}</span>` },
      {
        key: 'menu', label: '', srLabel: 'Actions', render: (d) =>
          dropdown({
            id: `menu-dom-${d.id.slice(-6)}`,
            label: `Actions pour ${d.hostname}`,
            trigger: { className: 'btn btn-ghost btn-sm btn-icon', content: icon('more', 18) },
            items: [
              { label: 'Revérifier maintenant', iconName: 'refresh', action: 'proto-toast', data: { message: `Revérification de ${d.hostname}` } },
              { label: 'Voir le défi TXT', iconName: 'key', action: 'dom-challenge', data: { id: d.id } },
              'sep',
              { label: 'Demander le retrait…', iconName: 'x', action: 'proto-toast', danger: true, data: { message: `Retrait de ${d.hostname}` } },
            ],
          }),
      },
    ],
    empty: emptyState({ title: 'Aucun domaine ne correspond', text: 'Changez de statut ou de recherche.', actions: html`<button type="button" class="btn btn-secondary" data-action="dom-reset">Tout afficher</button>` }),
  });

  return html`
    ${pageHeader({
      title: 'Domaines',
      description: 'Sous-domaines de la plateforme et domaines personnalisés : revendication par preuve TXT, certificat, quarantaine avant toute réutilisation.',
      actions: html`<button type="button" class="btn btn-primary" data-action="proto-toast" data-message="Nouvelle revendication de domaine">${icon('plus', 16)}Revendiquer un domaine</button>`,
    })}
    ${card({
      flush: true,
      body: html`
        <div class="toolbar">
          ${searchInput({ id: 'dom-q', model: 'domains.q', value: f.q, placeholder: 'Domaine ou organisation…', label: 'Rechercher un domaine' })}
          ${segmented({ label: 'Filtrer par statut', action: 'dom-status', value: f.status, options: [['', `Tous (${DOMAINS.length})`], ...Object.entries(DOMAIN_STATUS).map(([k, v]) => [k, `${v.label} (${counts[k]})`])] })}
        </div>
        ${region(ctx, table, { rows: 8 })}`,
      foot: html`${icon('info', 14)} La plateforme reste l’autorité des domaines ; la table des organisations n’en garde qu’une projection.`,
    })}`;
}

export const actions = {
  'dom-status': (el, ctx) => ctx.set({ domains: { ...ctx.state.domains, status: el.dataset.value } }),
  'dom-reset': (el, ctx) => ctx.set({ domains: { q: '', status: '' } }),
  'dom-challenge': (el) => showChallenge(DOMAINS.find((d) => d.id === el.dataset.id)),
};

export const models = { domains: (ctx, key, value) => ctx.set({ domains: { ...ctx.state.domains, [key]: value } }) };
