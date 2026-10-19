// Dashboard Platform. Hiérarchie en trois niveaux :
//   1. synthèse : combien d'organisations et dans quel état, revenu, santé ;
//   2. à traiter : organisations signalées, incidents ouverts, domaines en attente ;
//   3. tendances : croissance, onboardings, activité, répartition par sport.
import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card, progress } from '../components/card.js';
import { badge, statusBadge, signal } from '../components/badge.js';
import { areaChart, barList, sparkline } from '../components/charts.js';
import { segmented } from '../components/form.js';
import { orgLogo } from '../components/avatar.js';
import { ORGANIZATIONS, DOMAINS, INCIDENTS, SERVICES, AUDIT, ONBOARDINGS, GROWTH, WIZARD_STEPS, OPERATOR_DISPLAY, orgById } from '../data/fixtures.js';
import { SPORTS, ACCESS, SEVERITY, DOMAIN_STATUS } from '../data/status.js';
import { computeKpis, sportDistribution, organizationIssue, lifecycleBreakdown } from '../lib/query.js';
import { formatEuros, relative, NOW } from '../lib/format.js';
import { region } from './common.js';
import { auditLabel } from './audit.js';
import { href } from '../router.js';

const SERVICE_DOT = { operational: 'var(--tone-success-dot)', degraded: 'var(--tone-warning-dot)', outage: 'var(--tone-danger-dot)', planned: 'var(--tone-neutral-dot)' };

export const attentionList = () =>
  ORGANIZATIONS.map((org) => ({ org, issue: organizationIssue(org) }))
    .filter((x) => x.issue)
    .sort((a, b) => a.issue.rank - b.issue.rank || a.org.name.localeCompare(b.org.name));

function summaryOrganizations(ctx) {
  const groups = lifecycleBreakdown(ORGANIZATIONS);
  const total = ORGANIZATIONS.length;
  return html`<article class="card summary" aria-labelledby="sum-orgs">
    <div class="summary-head"><span class="summary-label" id="sum-orgs">${icon('building', 16)}Organisations clientes</span><a class="head-link" href="#/organisations">Voir la liste${icon('chevronRight', 14)}</a></div>
    <div class="summary-value"><span class="big">${ctx.state.scenario === 'loading' ? '—' : total}</span><span class="unit">organisations, dont ${groups[0].count + groups[1].count} en service</span></div>
    <div class="stackbar" role="img" aria-label="${groups.map((g) => `${g.label} : ${g.count}`).join(', ')}">${groups.filter((g) => g.count).map((g) => html`<span style="width:${(g.count / total) * 100}%;background:${g.color}"></span>`)}</div>
    <div class="legend">${groups.map((g) => html`<button type="button" class="legend-item" data-action="dash-view" data-value="${g.key}"><span class="sw" style="background:${g.color}"></span>${g.label}<span class="n">${g.count}</span></button>`)}</div>
  </article>`;
}

function summaryRevenue(kpi) {
  return html`<article class="card summary" aria-labelledby="sum-mrr">
    <div class="summary-head"><span class="summary-label" id="sum-mrr">${icon('trendUp', 16)}Revenu mensuel</span>${badge('Fictif', 'neutral', { dot: false, square: true })}</div>
    <div class="summary-value"><span class="big">${formatEuros(kpi.mrrCents)}</span><span class="delta up">+3 %</span></div>
    <div class="sparkline-wide">${sparkline(GROWTH.mrrCents, { width: 240, height: 44 })}</div>
    <span class="muted small">Abonnements des organisations en service · septembre</span>
  </article>`;
}

function summaryHealth(kpi) {
  const degraded = SERVICES.filter((s) => s.status === 'degraded' || s.status === 'outage').length;
  const counts = { healthy: 0, warning: 0, incident: 0 };
  for (const o of ORGANIZATIONS) counts[o.health]++;
  return html`<article class="card summary" aria-labelledby="sum-health">
    <div class="summary-head"><span class="summary-label" id="sum-health">${icon('pulse', 16)}Santé de la plateforme</span><a class="head-link" href="#/sante">Détails${icon('chevronRight', 14)}</a></div>
    <div class="summary-value"><span class="big" style="color:${degraded ? 'var(--tone-warning)' : 'var(--tone-success)'}">${degraded}</span><span class="unit">service${degraded > 1 ? 's' : ''} dégradé${degraded > 1 ? 's' : ''} sur ${SERVICES.length}</span></div>
    <div class="service-dots">${SERVICES.map((s) => html`<span><i style="background:${SERVICE_DOT[s.status]}"></i>${s.name.replace(/ \(.*\)$/, '')}</span>`)}</div>
    <span class="muted small">${kpi.openIncidents} incidents ouverts · ${counts.healthy} organisations saines sur ${ORGANIZATIONS.length}</span>
  </article>`;
}

export function render(ctx) {
  const kpi = computeKpis({ organizations: ORGANIZATIONS, domains: DOMAINS, incidents: INCIDENTS });
  const attention = attentionList();
  const metric = ctx.state.dashMetric;
  const series = metric === 'mrr' ? GROWTH.mrrCents.map((c) => c / 100) : GROWTH.organizations;
  const allSports = sportDistribution(ORGANIZATIONS.filter((o) => o.lifecycle !== 'ARCHIVED'));
  const others = allSports.slice(6).reduce((n, d) => n + d.count, 0);
  const dist = [...allSports.slice(0, 6), ...(others ? [{ sport: 'autres', count: others }] : [])];
  const maxSport = Math.max(...dist.map((d) => d.count));
  const openIncidents = INCIDENTS.filter((i) => i.status !== 'resolved');
  const pendingDomains = DOMAINS.filter((d) => ['CHALLENGE_ISSUED', 'PROVISIONING', 'PROVISIONING_FAILED'].includes(d.status));

  return html`
    ${pageHeader({
      eyebrow: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(NOW),
      title: `Bonjour ${OPERATOR_DISPLAY.name.split(' ')[0]}`,
      description: `${ORGANIZATIONS.length} organisations suivies · ${attention.length} à surveiller · ${kpi.openIncidents} incidents ouverts · ${kpi.onboarding} onboardings en cours.`,
      actions: html`<a class="btn btn-secondary" href="#/sante">${icon('pulse', 16)}État de la plateforme</a><a class="btn btn-secondary" href="#/support">${icon('lifebuoy', 16)}Support</a>`,
    })}

    <div class="dash">
      <div class="dash-summary">${summaryOrganizations(ctx)}${summaryRevenue(kpi)}${summaryHealth(kpi)}</div>

      <div class="dash-main">
      <div class="dash-item wide" style="order:1">${card({
        title: 'À traiter',
        subtitle: 'Organisations signalées, de la plus urgente à la moins urgente',
        actions: html`<button type="button" class="head-link head-btn" data-action="dash-view" data-value="attention">Voir dans la liste${icon('chevronRight', 14)}</button>`,
        flush: true,
        body: region(
          ctx,
          html`${attention.map(
            ({ org, issue }) => html`<a class="attention-row" href="${href('organisations', org.id)}">
              ${orgLogo(org, '', { presence: true })}
              <div><div class="who">${org.name}</div><div class="why">${signal(issue)}</div></div>
              <div class="side">${statusBadge(ACCESS, org.access.mode)}<span class="go" aria-hidden="true">${icon('chevronRight', 16)}</span></div>
            </a>`
          )}`,
          { rows: 5 }
        ),
      })}</div>
      <div class="dash-item wide" style="order:6">${card({
        title: 'Croissance de la plateforme',
        subtitle: 'Octobre 2025 → septembre 2026',
        actions: segmented({ options: [['orgs', 'Organisations'], ['mrr', 'Revenu']], value: metric, action: 'dash-metric', label: 'Indicateur du graphique' }),
        body: region(
          ctx,
          html`${areaChart({ values: series, labels: GROWTH.months, height: 220, ariaLabel: metric === 'mrr' ? 'Revenu mensuel fictif, en hausse de 29 € à 722 €' : 'Organisations clientes, de 1 à 14 en douze mois' })}
            <div class="stat-row">${GROWTH.summary.map((s) => html`<div><div class="v">${s.value}</div><div class="l">${s.label}</div></div>`)}</div>`,
          { rows: 5 }
        ),
      })}</div>
      <div class="dash-item wide" style="order:7">${card({
        title: 'Activité récente',
        subtitle: 'Journal plateforme',
        actions: html`<a class="head-link" href="#/audit">Tout voir${icon('chevronRight', 14)}</a>`,
        flush: true,
        body: region(
          ctx,
          html`<ul class="feed">${AUDIT.slice(0, 6).map((a) => {
            const org = orgById(a.orgId);
            const tone = a.result === 'success' ? 'info' : a.result === 'denied' ? 'danger' : 'warning';
            return html`<li><span class="icon-bubble tone-${tone}">${icon(a.actorType === 'system' ? 'zap' : a.result === 'denied' ? 'lock' : 'check', 15)}</span><div><div class="what"><strong>${a.actor}</strong> ${auditLabel(a.action)}${org ? html` — <a href="${href('organisations', org.id)}">${org.name}</a>` : ''}</div><div class="when">${relative(a.at)} · <span class="mono">${a.action}</span></div></div></li>`;
          })}</ul>`
        ),
      })}</div>
      </div>

      <div class="dash-side">
      <div class="dash-item" style="order:2">${card({
        title: 'Incidents ouverts',
        actions: html`<a class="head-link" href="#/sante">Tous${icon('chevronRight', 14)}</a>`,
        flush: true,
        body: region(ctx, html`${openIncidents.map((i) => html`<a class="mini-row" href="#/sante">${statusBadge(SEVERITY, i.severity, { dot: false, square: true })}<div class="grow"><div class="t">${i.title}</div><div class="m">${orgById(i.orgId)?.name ?? 'Toutes les organisations'} · ${relative(i.startedAt)}</div></div></a>`)}`, { rows: 3 }),
      })}</div>
      <div class="dash-item" style="order:3">${card({
        title: 'Domaines en attente',
        actions: html`<a class="head-link" href="#/domaines">Domaines${icon('chevronRight', 14)}</a>`,
        flush: true,
        body: region(ctx, html`${pendingDomains.map((d) => html`<a class="mini-row" href="#/domaines"><div class="grow"><div class="t mono" title="${d.hostname}">${d.hostname}</div><div class="m">${orgById(d.orgId)?.name}</div></div>${statusBadge(DOMAIN_STATUS, d.status)}</a>`)}`, { rows: 4 }),
      })}</div>

      <div class="dash-item" style="order:4">${card({
        title: 'Onboardings en cours',
        actions: html`<a class="head-link" href="#/onboarding">Onboarding${icon('chevronRight', 14)}</a>`,
        flush: true,
        body: region(
          ctx,
          html`${ONBOARDINGS.map((ob) => {
            const org = orgById(ob.orgId);
            const name = org ? org.name : ob.draftName;
            return html`<div class="list-row">${org ? orgLogo(org, 'sm') : html`<span class="org-logo sm" style="background:#98a2b3" aria-hidden="true">TA</span>`}<div class="grow"><div class="strong">${name}</div><div class="muted small" style="margin-bottom:7px">Étape ${ob.step}/9 · ${WIZARD_STEPS[ob.step - 1]}${ob.blocker && ob.blocker !== 'Brouillon' ? ' · bloqué' : ''}</div>${progress(ob.step / 9, `Progression de ${name}`)}</div></div>`;
          })}
          <div class="list-row"><a class="btn btn-secondary btn-sm btn-block" href="#/onboarding/nouveau/1">${icon('plus', 14)}Nouvel onboarding</a></div>`
        ),
      })}</div>

      <div class="dash-item" style="order:5">${card({
        title: 'Répartition par sport',
        subtitle: 'Organisations non archivées',
        body: region(ctx, barList(dist.map((d) => ({ label: SPORTS[d.sport]?.label ?? `Autres (${allSports.length - 6} sports)`, value: d.count, ratio: d.count / maxSport, color: SPORTS[d.sport]?.color ?? '#98a2b3' })))),
      })}</div>
      </div>
    </div>`;
}

export const actions = {
  'dash-metric': (el, ctx) => ctx.set({ dashMetric: el.dataset.value }),
  // Raccourci vers la liste filtrée : état d'interface seulement.
  'dash-view': (el, ctx) => {
    const view = { ending: 'active' }[el.dataset.value] ?? el.dataset.value;
    ctx.set({ orgs: { ...ctx.state.orgs, view, q: '', lifecycle: '', plan: '', access: '', health: '', page: 1 } });
    ctx.navigate('#/organisations');
  },
};
