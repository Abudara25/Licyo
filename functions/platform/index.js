// Dashboard de la console fondateur. Même hiérarchie que la maquette :
//   1. synthèse : organisations et leur état, adhérents suivis, comptes du bureau ;
//   2. à traiter : clubs signalés, du plus urgent au moins urgent ;
//   3. activité : journal plateforme, domaines récents, répartition par sport.
// Uniquement des données réelles. Revenu, santé des services et support viendront avec leurs lots (aucun chiffre fictif).
import { html } from '../_shared/platform-ui/html.js';
import { icon } from '../_shared/platform-ui/icons.js';
import { pageHeader, card } from '../_shared/platform-ui/card.js';
import { emptyState } from '../_shared/platform-ui/feedback.js';
import { badge, signal, orgLogo, consolePage, formatDate, plural } from '../_shared/platform-ui/kit.js';
import { listOrganizations, listDomains, orgStatus, SPORTS, sportLabel, sportColor } from '../_shared/platform-data.js';
import { auditEntries, AUDIT_LABELS, canPlatform } from '../_shared/platform-auth.js';

function summaryOrganizations(orgs) {
  const active = orgs.filter((o) => o.status === 'active').length;
  const suspended = orgs.length - active;
  const groups = [
    { label: 'En service', count: active, color: 'var(--tone-success-dot)' },
    { label: 'Suspendues', count: suspended, color: 'var(--tone-danger-dot)' },
  ];
  return html`<article class="card summary" aria-labelledby="sum-orgs">
    <div class="summary-head"><span class="summary-label" id="sum-orgs">${icon('building', 16)}Organisations clientes</span><a class="head-link" href="/platform/organisations">Voir la liste${icon('chevronRight', 14)}</a></div>
    <div class="summary-value"><span class="big">${orgs.length}</span><span class="unit">organisation${orgs.length > 1 ? 's' : ''}, dont ${active} en service</span></div>
    ${orgs.length ? html`<div class="stackbar" role="img" aria-label="${groups.map((g) => `${g.label} : ${g.count}`).join(', ')}">${groups.filter((g) => g.count).map((g) => html`<span style="width:${(g.count / orgs.length) * 100}%;background:${g.color}"></span>`)}</div>` : ''}
    <div class="legend">${groups.map((g) => html`<span class="legend-item"><span class="sw" style="background:${g.color}"></span>${g.label}<span class="n">${g.count}</span></span>`)}</div>
  </article>`;
}

function summaryMembers(orgs) {
  const members = orgs.reduce((n, o) => n + Number(o.members || 0), 0);
  const top = [...orgs].sort((a, b) => b.members - a.members)[0];
  return html`<article class="card summary" aria-labelledby="sum-members">
    <div class="summary-head"><span class="summary-label" id="sum-members">${icon('users', 16)}Effectif accompagné</span></div>
    <div class="summary-value"><span class="big">${members}</span><span class="unit">inscription${members > 1 ? 's' : ''} en cours</span></div>
    <span class="muted small">${top && top.members ? `Le plus grand club : ${top.name} (${top.members}).` : 'Aucune inscription pour le moment.'} Les tarifs selon l’effectif ne sont pas encore fixés.</span>
  </article>`;
}

function summaryAccounts(orgs) {
  const accounts = orgs.reduce((n, o) => n + Number(o.accounts || 0), 0);
  const invites = orgs.reduce((n, o) => n + Number(o.invites || 0), 0);
  const withoutPresident = orgs.filter((o) => !o.presidents).length;
  return html`<article class="card summary" aria-labelledby="sum-accounts">
    <div class="summary-head"><span class="summary-label" id="sum-accounts">${icon('key', 16)}Comptes des bureaux</span></div>
    <div class="summary-value"><span class="big" style="color:${withoutPresident ? 'var(--tone-warning)' : 'var(--tone-success)'}">${accounts}</span><span class="unit">compte${accounts > 1 ? 's' : ''} actif${accounts > 1 ? 's' : ''}</span></div>
    <span class="muted small">${plural(invites, 'invitation')} en attente · ${withoutPresident ? `${plural(withoutPresident, 'club')} sans président connecté` : 'chaque club a un président'}</span>
  </article>`;
}

export async function onRequestGet(context) {
  const { env } = context;
  const operator = context.data.operator;
  const orgs = await listOrganizations(env.DB);
  const attention = orgs.filter((o) => o.issue).sort((a, b) => a.issue.rank - b.issue.rank || a.name.localeCompare(b.name));
  const [journal, domains] = await Promise.all([canPlatform(operator, 'audit.read') ? auditEntries(env.DB, { limit: 6 }) : [], listDomains(env.DB)]);
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const sports = Object.entries(orgs.reduce((acc, o) => ({ ...acc, [o.sport || 'inconnu']: (acc[o.sport || 'inconnu'] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const maxSport = Math.max(1, ...sports.map(([, n]) => n));
  const firstName = operator.name.split(' ')[0];
  const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date());

  const content = html`
    ${pageHeader({
      eyebrow: today,
      title: `Bonjour ${firstName}`,
      description: `${plural(orgs.length, 'organisation suivie', 'organisations suivies')} · ${attention.length} à traiter.`,
      actions: canPlatform(operator, 'orgs.create') ? html`<a class="btn btn-primary only-sm" href="/platform/organisations/nouvelle">${icon('plus', 16)}Nouvelle organisation</a>` : '',
    })}
    <div class="dash">
      <div class="dash-summary">${summaryOrganizations(orgs)}${summaryMembers(orgs)}${summaryAccounts(orgs)}</div>
      <div class="dash-main">
        <div class="dash-item wide">${card({
          title: 'À traiter',
          subtitle: 'Organisations signalées, de la plus urgente à la moins urgente',
          actions: html`<a class="head-link" href="/platform/organisations?vue=a-traiter">Voir dans la liste${icon('chevronRight', 14)}</a>`,
          flush: true,
          body: attention.length
            ? html`${attention.slice(0, 8).map(
                (org) => html`<a class="attention-row" href="/platform/organisations/${org.id}">
                  ${orgLogo(org, '', { presence: true })}
                  <div><div class="who">${org.name}</div><div class="why">${signal(org.issue)}</div></div>
                  <div class="side">${badge(orgStatus(org.status).label, orgStatus(org.status).tone)}<span class="go" aria-hidden="true">${icon('chevronRight', 16)}</span></div>
                </a>`
              )}`
            : emptyState({ title: 'Rien à traiter', text: orgs.length ? 'Chaque club a un domaine et un président connecté.' : 'Créez la première organisation pour commencer.', iconName: 'check' }),
        })}</div>
        ${canPlatform(operator, 'audit.read')
          ? html`<div class="dash-item wide">${card({
              title: 'Activité récente',
              subtitle: 'Journal plateforme',
              actions: html`<a class="head-link" href="/platform/journal">Tout voir${icon('chevronRight', 14)}</a>`,
              flush: true,
              body: journal.length
                ? html`<ul class="feed">${journal.map((a) => {
                    const org = a.target_organization_id ? byId.get(a.target_organization_id) : null;
                    return html`<li><span class="icon-bubble tone-info">${icon(a.action.startsWith('org.') ? 'building' : 'user', 15)}</span><div><div class="what"><strong>${a.operator_name}</strong> ${AUDIT_LABELS[a.action] ?? a.action}${org ? html` — <a href="/platform/organisations/${org.id}">${org.name}</a>` : ''}</div><div class="when">${formatDate(a.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · <span class="mono">${a.action}</span></div></div></li>`;
                  })}</ul>`
                : emptyState({ title: 'Aucune activité', iconName: 'scroll' }),
            })}</div>`
          : ''}
      </div>
      <div class="dash-side">
        <div class="dash-item">${card({
          title: 'Domaines',
          actions: html`<a class="head-link" href="/platform/domaines">Tous${icon('chevronRight', 14)}</a>`,
          flush: true,
          body: domains.length
            ? html`${[...domains].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 5).map((d) => html`<a class="mini-row" href="/platform/organisations/${d.organization_id}"><div class="grow"><div class="t mono" title="${d.domain}">${d.domain}</div><div class="m">${d.name}</div></div>${badge(orgStatus(d.status).label, orgStatus(d.status).tone)}</a>`)}`
            : emptyState({ title: 'Aucun domaine', iconName: 'globe' }),
        })}</div>
        <div class="dash-item">${card({
          title: 'Répartition par sport',
          subtitle: 'Toutes les organisations',
          body: sports.length
            ? html`<div class="bar-list">${sports.map(([key, n]) => {
                const label = SPORTS[key] ? sportLabel(key) : 'Sport à préciser';
                return html`<div class="bar-row"><span>${label}</span><span class="bar-track" role="img" aria-label="${label} : ${n}"><span style="width:${Math.max(4, Math.round((n / maxSport) * 100))}%;background:${sportColor(key)}"></span></span><span class="num right">${n}</span></div>`;
              })}</div>`
            : emptyState({ title: 'Aucune organisation', iconName: 'layers' }),
        })}</div>
      </div>
    </div>`;
  return consolePage(context, { title: 'Dashboard', active: 'dashboard', trail: [{ label: 'Dashboard' }], content, orgs });
}
