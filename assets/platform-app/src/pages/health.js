import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card } from '../components/card.js';
import { badge, statusBadge, healthBadge } from '../components/badge.js';
import { dataTable } from '../components/data-table.js';
import { uptimeBars } from '../components/charts.js';
import { segmented } from '../components/form.js';
import { emptyState } from '../components/feedback.js';
import { orgLogo } from '../components/avatar.js';
import { SERVICES, UPTIME, INCIDENTS, ORGANIZATIONS } from '../data/fixtures.js';
import { SERVICE_STATUS, INCIDENT_STATUS, SEVERITY, HEALTH } from '../data/status.js';
import { formatDateTime, relative } from '../lib/format.js';
import { region, orgLink } from './common.js';
import { href } from '../router.js';

const SERVICE_ICONS = { d1: 'database', pages: 'server', domains: 'globe', queues: 'zap', email: 'mail', storage: 'disk' };
const duration = (i) => {
  const end = i.resolvedAt ? new Date(i.resolvedAt) : new Date('2026-09-28T09:30:00Z');
  const minutes = Math.round((end - new Date(i.startedAt)) / 60000);
  return minutes < 60 ? `${minutes} min` : minutes < 1440 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.round(minutes / 1440)} j`;
};

export function render(ctx) {
  const f = ctx.state.health;
  const incidents = INCIDENTS.filter((i) => f.incidents === 'all' || i.status !== 'resolved');
  const orgCounts = Object.keys(HEALTH).map((k) => [k, ORGANIZATIONS.filter((o) => o.health === k).length]);
  const degraded = SERVICES.filter((s) => s.status === 'degraded' || s.status === 'outage').length;

  return html`
    ${pageHeader({
      title: 'Santé & incidents',
      description: 'Services partagés, incidents et santé de chaque organisation.',
      actions: html`<button type="button" class="btn btn-secondary" data-action="proto-toast" data-message="Page de statut publique">${icon('external', 16)}Page de statut</button><button type="button" class="btn btn-primary" data-action="proto-toast" data-message="Déclaration d’un incident">${icon('alert', 16)}Déclarer un incident</button>`,
    })}
    <div class="status-banner ${degraded ? 'warn' : 'ok'}" role="status">
      ${icon(degraded ? 'alert' : 'check', 18)}
      <strong>${degraded ? `${degraded} service${degraded > 1 ? 's' : ''} dégradé${degraded > 1 ? 's' : ''}` : 'Tous les services sont opérationnels'}</strong>
      <span class="muted">Dernière mise à jour ${relative('2026-09-28T09:28:00Z')}</span>
    </div>
    ${region(
      ctx,
      html`<div class="grid grid-3">
        ${SERVICES.map((s) => html`<article class="card service-card">
          <div class="card-body stack" style="gap:12px">
            <div style="display:flex;align-items:center;gap:10px"><span class="icon-bubble tone-neutral service-icon">${icon(SERVICE_ICONS[s.key], 18)}</span><div style="flex:1;min-width:0"><h2 style="font-size:14.5px">${s.name}</h2><div class="muted" style="font-size:12px">${s.detail}</div></div>${statusBadge(SERVICE_STATUS, s.status)}</div>
            ${uptimeBars(UPTIME[s.key], `Disponibilité sur 90 jours : ${s.name}`)}
            <div style="display:flex;justify-content:space-between;font-size:12px" class="muted"><span>il y a 90 j</span><span>${s.uptime === null ? 'Non activé' : `${String(s.uptime).replace('.', ',')} % de disponibilité`}</span><span>aujourd’hui</span></div>
          </div>
        </article>`)}
      </div>`,
      { rows: 6 }
    )}
    <div class="grid grid-main section-gap">
      ${card({
        title: 'Incidents',
        actions: segmented({ label: 'Incidents affichés', action: 'health-incidents', value: f.incidents, options: [['open', 'Ouverts'], ['all', 'Tous']] }),
        flush: true,
        body: region(
          ctx,
          dataTable({
            caption: 'Incidents',
            stack: true,
            rows: incidents,
            columns: [
              { key: 'id', label: 'Incident', className: 'wrap', render: (i) => html`<div><span class="mono muted">${i.id}</span><div style="font-weight:600">${i.title}</div></div>` },
              { key: 'sev', label: 'Sévérité', render: (i) => statusBadge(SEVERITY, i.severity, { dot: false, square: true }) },
              { key: 'status', label: 'Statut', render: (i) => statusBadge(INCIDENT_STATUS, i.status) },
              { key: 'org', label: 'Organisation', hide: 'lg', render: (i) => (i.orgId ? orgLink(i.orgId) : html`<span class="muted">Toutes</span>`) },
              { key: 'start', label: 'Début', hide: 'xl', render: (i) => html`<span class="num">${formatDateTime(i.startedAt)}</span>` },
              { key: 'dur', label: 'Durée', render: (i) => html`<span class="num">${duration(i)}</span>` },
            ],
            empty: emptyState({ title: 'Aucun incident ouvert', text: 'Tout fonctionne normalement.', iconName: 'check' }),
          })
        ),
      })}
      ${card({
        title: 'Santé des organisations',
        flush: true,
        body: region(
          ctx,
          html`<div class="list-row" style="gap:18px">${orgCounts.map(([k, n]) => html`<div style="flex:1">${healthBadge(k)}<div style="font-size:22px;font-weight:650;margin-top:4px" class="num">${n}</div></div>`)}</div>
            ${ORGANIZATIONS.filter((o) => o.health !== 'healthy').map(
              (o) => html`<div class="list-row">${orgLogo(o, 'sm')}<div class="grow"><a href="${href('organisations', o.id)}" style="font-weight:600;color:var(--ui-text)">${o.name}</a></div>${healthBadge(o.health)}</div>`
            )}`
        ),
      })}
    </div>`;
}

export const actions = {
  'health-incidents': (el, ctx) => ctx.set({ health: { ...ctx.state.health, incidents: el.dataset.value } }),
};
