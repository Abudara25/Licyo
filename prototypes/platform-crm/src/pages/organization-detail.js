// Fiche d'une organisation cliente, vue par l'opérateur de la plateforme.
// Les trois états restent distincts (ADR-003) : cycle de vie (contrat), facturation (miroir), accès (projection dérivée).
// UI visibility is not authorization : ces boutons ne sont que des maquettes ; chaque action de la future console
// sera autorisée côté serveur (permission, MFA, audit), jamais par l'affichage.
import { html, safeColor } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { card, kvList, progress } from '../components/card.js';
import { badge, statusBadge, healthBadge, chip, signal } from '../components/badge.js';
import { tabs, tabPanel } from '../components/tabs.js';
import { dataTable } from '../components/data-table.js';
import { dropdown } from '../components/dropdown.js';
import { emptyState, notice } from '../components/feedback.js';
import { toggle } from '../components/form.js';
import { orgLogo, avatar, initialsOf } from '../components/avatar.js';
import { openModal } from '../components/modal.js';
import { prototypeToast } from '../components/toast.js';
import { PLANS, MODULES, FLAGS, DOMAINS, AUDIT, orgById } from '../data/fixtures.js';
import { LIFECYCLE, BILLING, ACCESS, SPORTS, DOMAIN_STATUS, SSL, CAPABILITY, AUDIT_RESULT } from '../data/status.js';
import { moduleAvailability, accessDerivation, organizationIssue } from '../lib/query.js';
import { formatDate, formatDateTime, formatEuros, formatNumber, formatStorage, relative, shortId } from '../lib/format.js';
import { region } from './common.js';
import { auditLabel } from './audit.js';
import { href, ORG_TABS } from '../router.js';

const TAB_LABELS = { apercu: 'Vue d’ensemble', configuration: 'Configuration', utilisateurs: 'Utilisateurs', modules: 'Modules', domaines: 'Domaines', facturation: 'Billing', activite: 'Activité', audit: 'Audit' };
const REASONS = {
  CONTRACT_LIVE: 'Contrat actif, facturation à jour, aucun blocage',
  TRIAL: 'Essai contractuel en cours',
  BILLING_PAST_DUE: 'Impayé : accès complet jusqu’à la fin de la grâce',
  BILLING_UNPAID: 'Impayé après la grâce : lecture seule',
  PROVISIONING: 'Onboarding en cours',
  OPERATOR_MAINTENANCE: 'Blocage opérateur : maintenance programmée',
  TERMINATION_SCHEDULED: 'Résiliation planifiée : accès complet jusqu’à la date d’effet',
  TERMINATED_GRACE: 'Résilié : lecture seule pendant la période d’export',
  SECURITY_HOLD: 'Blocage de sécurité actif',
  ARCHIVED: 'Organisation archivée',
};

export function confirmSuspend(orgId) {
  const org = orgById(orgId);
  if (!org) return;
  openModal({
    title: `Suspendre l’accès de ${org.name} ?`,
    description: 'Pose un blocage de sécurité : l’accès devient « Bloqué » sur toutes les surfaces du club, après confirmation de la projection.',
    iconName: 'lock',
    tone: 'danger',
    confirmLabel: 'Suspendre l’accès',
    confirmTone: 'danger',
    requireText: org.slug,
    body: html`
      ${notice('warning', html`Les administrateurs du club perdront l’accès. Les paiements reçus continueront d’être enregistrés. <strong>Action réservée, réauthentification exigée</strong> dans la future console.`, 'alert')}
      <div class="field"><label for="suspend-reason">Motif<span class="req" aria-hidden="true">*</span><span class="sr-only"> (obligatoire)</span></label><textarea class="textarea" id="suspend-reason" data-required required aria-required="true" aria-describedby="suspend-reason-hint" placeholder="Ex. : connexions suspectes signalées par le club"></textarea><span class="hint" id="suspend-reason-hint">Obligatoire, conservé dans le journal d’audit.</span></div>`,
    onConfirm: () => prototypeToast(`Blocage simulé pour ${org.name}`),
  });
}

function supportSession(org) {
  openModal({
    title: 'Ouvrir une session d’assistance',
    description: `Accès encadré à l’admin de ${org.name} : lecture seule par défaut, 30 minutes, bannière visible par le club et double journal (plateforme et club).`,
    iconName: 'lifebuoy',
    tone: 'info',
    confirmLabel: 'Démarrer (simulation)',
    body: html`
      <div class="field"><label for="support-reason">Motif et numéro de ticket</label><input class="input" id="support-reason" placeholder="SUP-331 — dossier signé refusé"></div>
      ${notice('info', 'Pas de « connexion en tant que » : la session d’assistance est distincte et ne donne jamais accès aux données de santé, aux remboursements ni aux rôles.')}`,
    onConfirm: () => prototypeToast('Session d’assistance simulée'),
  });
}

// --- Onglets -----------------------------------------------------------------------------------------------------
function overview(org, plan) {
  const q = plan.quotas;
  const quota = (used, max, label, fmt = formatNumber) =>
    html`<div class="stack" style="gap:6px"><div style="display:flex;justify-content:space-between;font-size:13px"><span>${label}</span><span class="num muted">${fmt(used)} / ${max === null ? 'illimité' : fmt(max)}</span></div>${progress(max === null ? 0.08 : Math.min(1, used / max), label)}</div>`;
  const acc = org.access;
  const d = accessDerivation(org);
  const contribution = (mode, empty) => (mode ? statusBadge(ACCESS, mode, { dot: false, square: true }) : html`<span class="muted small">${empty}</span>`);
  const billingEffect = org.billing.mode === 'manual' ? 'Facturation manuelle, sans effet' : 'Sans effet dans ce cycle de vie';
  return html`<div class="grid grid-2">
    ${card({
      title: 'Calcul du mode d’accès',
      subtitle: 'Projection dérivée : la contribution la plus restrictive l’emporte',
      body: html`<ul class="derivation" aria-label="Contributions au mode d’accès">
          <li><span class="src">Contrat<small>Cycle de vie : ${LIFECYCLE[org.lifecycle].label}</small></span>${contribution(d.lifecycle)}</li>
          <li><span class="src">Facturation<small>État miroir : ${BILLING[org.billing.status].label}</small></span>${contribution(d.billing, billingEffect)}</li>
          <li><span class="src">Blocages<small>${d.hold ? d.hold.label : 'Sécurité, maintenance opérateur'}</small></span>${contribution(d.hold?.mode, 'Aucun')}</li>
        </ul>
        <div class="derivation-result">
          <div class="derivation-head"><span class="strong">Mode d’accès</span>${statusBadge(ACCESS, acc.mode)}</div>
          <p class="muted small">${REASONS[acc.reason] ?? ''}${acc.validUntil ? `. Jusqu’au ${formatDateTime(acc.validUntil)}, puis ${ACCESS[acc.modeAfter]?.label ?? 'recalcul'}.` : '.'}</p>
        </div>`,
      foot: html`${icon('info', 14)}<span>Un paiement ne modifie jamais le contrat : il déclenche seulement un nouveau calcul de l’accès.</span>`,
    })}
    ${card({
      title: 'Organisation',
      body: kvList([
        ['Activités', html`<div class="chips">${org.sports.map((s) => chip(SPORTS[s]?.label ?? s))}</div>`],
        ['Sections', html`<div class="chips">${org.sections.map((s) => chip(s))}</div>`],
        ['Administrateurs', html`<span class="num">${org.users.length}</span>`],
        ['Membres', html`<span class="num">${formatNumber(org.members)}</span> <span class="muted">(nombre fictif)</span>`],
        ['Stockage', formatStorage(org.storageMb)],
        ['Dernière activité', relative(org.lastActivityAt)],
        ['Création', formatDate(org.createdAt)],
        ['Dernier déploiement du site', org.lastDeployAt ? formatDateTime(org.lastDeployAt) : html`<span class="muted">Site pas encore publié</span>`],
      ]),
    })}
    ${card({
      title: `Utilisation du plan ${plan.name}`,
      subtitle: 'Droits du plan (exemple d’offre)',
      body: html`<div class="stack">${quota(org.members, q.members, 'Membres')}${quota(org.users.length, q.admins, 'Administrateurs')}${quota(org.storageMb / 1024, q.storageGb, 'Stockage (Go)', (v) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(v))}${quota(DOMAINS.filter((d) => d.orgId === org.id && d.type === 'custom').length, q.customDomains, 'Domaines personnalisés')}</div>`,
    })}
    ${card({
      title: 'Santé',
      body: html`<div class="stack">${healthBadge(org.health)}<p class="muted">${org.health === 'healthy' ? 'Aucune alerte sur les 7 derniers jours.' : org.health === 'warning' ? 'Une échéance ou une opération demande un suivi.' : 'Un incident ouvert concerne cette organisation.'}</p><a class="btn btn-secondary btn-sm" href="#/sante" style="align-self:flex-start">Voir Santé & incidents</a></div>`,
    })}
  </div>`;
}

function configuration(org) {
  return card({
    title: 'Configuration de l’organisation',
    subtitle: 'Valeurs choisies par le club (lecture seule dans la console)',
    actions: html`<button type="button" class="btn btn-secondary btn-sm" data-action="proto-toast" data-message="Modification de la configuration">Modifier</button>`,
    body: kvList([
      ['Nom', org.name],
      ['Slug', html`<span class="mono">${org.slug}</span>`],
      ['Logo', html`<div style="display:flex;align-items:center;gap:10px">${orgLogo(org, 'lg')}<span class="muted">Monogramme généré (aucun fichier)</span></div>`],
      ['Couleurs', html`<div class="swatches">${org.colors.map((c) => html`<span class="swatch" style="background:${safeColor(c)}" title="${c}"></span>`)}<span class="mono muted" style="align-self:center">${org.colors.join(' · ')}</span></div>`],
      ['Fuseau horaire', org.timezone],
      ['Langue', org.locale],
      ['Sport principal', SPORTS[org.sports[0]]?.label ?? org.sports[0]],
      ['Sections', html`<div class="chips">${org.sections.map((s) => chip(s))}</div>`],
      ['Période courante', org.period],
    ]),
  });
}

function usersTab(org) {
  return card({
    title: 'Utilisateurs de l’organisation',
    subtitle: 'Appartenances des utilisateurs à ce club. Aucun compte plateforme n’apparaît ici.',
    actions: html`<button type="button" class="btn btn-secondary btn-sm" data-action="proto-toast" data-message="Invitation d’un administrateur">${icon('plus', 14)}Inviter</button>`,
    flush: true,
    body: dataTable({
      caption: 'Utilisateurs',
      stack: true,
      columns: [
        { key: 'name', label: 'Utilisateur', render: (u) => html`<div class="org-cell">${avatar(initialsOf(u.name))}<span style="font-weight:560">${u.name}</span></div>` },
        { key: 'role', label: 'Rôle', render: (u) => badge(u.role, u.role === 'Propriétaire' ? 'violet' : 'neutral', { dot: false }) },
        { key: 'mfa', label: 'MFA', render: (u) => (u.mfa ? badge('Activée', 'success') : badge('Non activée', 'warning')) },
        { key: 'last', label: 'Dernière connexion', render: (u) => html`<span class="muted">${u.lastLogin ? relative(u.lastLogin) : 'Jamais'}</span>` },
      ],
      rows: org.users,
      empty: emptyState({ title: 'Aucun utilisateur', iconName: 'users' }),
    }),
  });
}

function modulesTab(org) {
  const legend = [
    ['Capacité', 'Livrée dans le code (registre)', 'server'],
    ['Droit', 'Inclus dans le plan ou le contrat', 'layers'],
    ['Drapeau', 'Déploiement technique progressif', 'flag'],
    ['Configuration', 'Activé par le club', 'settings'],
  ];
  const rows = MODULES.map((m) => ({ m, a: moduleAvailability(m, org, { plans: PLANS, flags: FLAGS }) }));
  const yes = (v, labelYes, labelNo) => (v ? badge(labelYes, 'success') : badge(labelNo, 'neutral'));
  return html`
    <div class="grid legend-grid">
      ${legend.map(([t, d, i]) => html`<div class="card legend-card"><span class="legend-title">${icon(i, 16)}${t}</span><span class="muted small">${d}</span></div>`)}
    </div>
    ${card({
      title: 'Modules',
      subtitle: 'Disponible = capacité ∧ droit ∧ drapeau ∧ configuration. Chaque notion reste distincte.',
      flush: true,
      body: dataTable({
        caption: 'Disponibilité des modules',
        stack: 'md',
        columns: [
          { key: 'module', label: 'Module', render: ({ m }) => html`<div><div style="font-weight:600">${m.label}</div><div class="muted" style="font-size:12px">${m.desc}</div></div>`, className: 'wrap' },
          { key: 'capability', label: 'Capacité', render: ({ m }) => statusBadge(CAPABILITY, m.capability) },
          { key: 'entitlement', label: 'Droit (plan)', render: ({ a }) => yes(a.entitlement, 'Inclus', 'Non inclus') },
          { key: 'flag', label: 'Drapeau', render: ({ m, a }) => (m.flag ? html`<div><span class="mono">${m.flag}</span><div>${a.flagOn ? badge(a.flag.state === 'pilot' ? 'Pilote : oui' : 'Actif', 'info', { dot: false }) : badge(a.flag.state === 'pilot' ? 'Pilote : non' : 'Inactif', 'neutral', { dot: false })}</div></div>` : html`<span class="muted">Aucun</span>`) },
          { key: 'config', label: 'Configuration', render: ({ m, a }) => toggle({ id: `cfg-${m.key}`, checked: a.configured, label: `${m.label} activé par le club`, action: 'proto-toast', disabled: true }) },
          { key: 'result', label: 'Résultat', render: ({ a }) => (a.available ? badge('Disponible', 'success') : badge(a.reason, 'warning', { dot: false })) },
        ],
        rows,
      }),
    })}`;
}

function domainsTab(org) {
  const rows = DOMAINS.filter((d) => d.orgId === org.id);
  return card({
    title: 'Domaines de l’organisation',
    actions: html`<button type="button" class="btn btn-secondary btn-sm" data-action="proto-toast" data-message="Ajout d’un domaine personnalisé">${icon('plus', 14)}Ajouter un domaine</button>`,
    flush: true,
    body: dataTable({
      caption: 'Domaines',
      stack: true,
      columns: [
        { key: 'host', label: 'Domaine', render: (d) => html`<span class="mono">${d.hostname}</span> ${d.primary ? badge('Principal', 'info', { dot: false }) : ''}` },
        { key: 'type', label: 'Type', render: (d) => (d.type === 'platform' ? 'Plateforme' : 'Personnalisé') },
        { key: 'status', label: 'Statut', render: (d) => statusBadge(DOMAIN_STATUS, d.status) },
        { key: 'ssl', label: 'SSL', render: (d) => statusBadge(SSL, d.ssl, { dot: false }) },
        { key: 'check', label: 'Dernière vérification', render: (d) => html`<span class="muted">${relative(d.lastCheckAt)}</span>` },
      ],
      rows,
      empty: emptyState({ title: 'Aucun domaine', iconName: 'globe' }),
    }),
  });
}

function billingTab(org, plan) {
  const invoices = org.mrrCents
    ? [['2026-09-01', 'Payée'], ['2026-08-01', 'Payée'], ['2026-07-01', 'Payée']].map(([d, s], i) => ({ id: `INV-2026-${String(9 - i).padStart(2, '0')}-${org.initials}`, date: d, status: org.billing.status === 'PAST_DUE' && i === 0 ? 'Échec du prélèvement' : org.billing.status === 'UNPAID' && i < 2 ? 'Impayée' : s, amount: org.mrrCents }))
    : [];
  return html`<div class="grid grid-2">
    ${card({
      title: 'Abonnement SaaS',
      subtitle: 'Grand livre A — plateforme ← club (données fictives)',
      body: kvList([
        ['Plan', `${plan.name} · ${formatEuros(plan.priceCents)} / mois`],
        ['Mode', org.billing.mode === 'manual' ? 'Facturation manuelle' : 'Prestataire de facturation (bac à sable)'],
        ['État miroir', statusBadge(BILLING, org.billing.status)],
        ['Fin de grâce', org.billing.graceUntil ? html`${formatDateTime(org.billing.graceUntil)} <span class="muted">(${relative(org.billing.graceUntil)})</span>` : html`<span class="muted">—</span>`],
        ['Revenu mensuel', org.mrrCents ? formatEuros(org.mrrCents) : html`<span class="muted">0 €</span>`],
      ]),
    })}
    ${card({
      title: 'Règle de sécurité',
      body: html`<div class="stack">${notice('info', 'Un paiement, même tardif, met seulement à jour l’état de facturation. Le mode d’accès est ensuite recalculé ; il ne redevient complet que si le cycle de vie l’autorise. Un webhook ne réactive jamais une organisation résiliée.')}</div>`,
    })}
    ${card({
      title: 'Factures',
      flush: true,
      className: 'span-2',
      body: dataTable({
        caption: 'Factures',
        stack: true,
        columns: [
          { key: 'id', label: 'Facture', render: (i) => html`<span class="mono">${i.id}</span>` },
          { key: 'date', label: 'Date', render: (i) => formatDate(i.date) },
          { key: 'amount', label: 'Montant', align: 'right', render: (i) => html`<span class="num">${formatEuros(i.amount)}</span>` },
          { key: 'status', label: 'Statut', render: (i) => badge(i.status, i.status === 'Payée' ? 'success' : 'danger') },
        ],
        rows: invoices,
        empty: emptyState({ title: 'Aucune facture', text: 'Organisation en essai, en onboarding ou facturée hors plateforme.', iconName: 'card' }),
      }),
    })}
  </div>`;
}

function activityTab(org, ctx) {
  const items = [
    ...AUDIT.filter((a) => a.orgId === org.id).map((a) => ({ at: a.at, text: `${a.actor} · ${auditLabel(a.action)}`, iconName: 'scroll' })),
    ...(org.lastDeployAt ? [{ at: org.lastDeployAt, text: 'Site public publié (nouvelle version)', iconName: 'globe' }] : []),
    { at: org.lastActivityAt, text: 'Dernière connexion d’un administrateur du club', iconName: 'user' },
    { at: org.createdAt, text: 'Organisation créée', iconName: 'sparkles' },
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  return card({
    title: 'Activité',
    flush: true,
    body: region(ctx, html`<ul class="feed">${items.map((i) => html`<li><span class="icon-bubble tone-neutral">${icon(i.iconName, 15)}</span><div><div class="what">${i.text}</div><div class="when">${formatDateTime(i.at)} · ${relative(i.at)}</div></div></li>`)}</ul>`),
  });
}

function auditTab(org, ctx) {
  const rows = AUDIT.filter((a) => a.orgId === org.id);
  return card({
    title: 'Journal d’audit de l’organisation',
    subtitle: 'Actions de la plateforme sur ce club (ajout seul)',
    flush: true,
    body: region(
      ctx,
      dataTable({
        caption: 'Audit',
        stack: true,
        columns: [
          { key: 'at', label: 'Date', render: (a) => html`<span class="num">${formatDateTime(a.at)}</span>` },
          { key: 'actor', label: 'Acteur', render: (a) => a.actor },
          { key: 'action', label: 'Action', render: (a) => html`<span class="mono">${a.action}</span>` },
          { key: 'resource', label: 'Ressource', render: (a) => html`<span class="muted">${a.resource}</span>` },
          { key: 'result', label: 'Résultat', render: (a) => statusBadge(AUDIT_RESULT, a.result) },
        ],
        rows,
        empty: emptyState({ title: 'Aucune entrée', text: 'Aucune action de la plateforme sur cette organisation pour le moment.', iconName: 'scroll' }),
      })
    ),
  });
}

// --- Page ---------------------------------------------------------------------------------------------------------
export function render(ctx) {
  const org = orgById(ctx.route.id);
  if (!org) {
    return emptyState({ title: 'Organisation introuvable', text: 'Cette organisation n’existe pas dans les données de démonstration.', iconName: 'building', actions: html`<a class="btn btn-secondary" href="#/organisations">Retour aux organisations</a>` });
  }
  const plan = PLANS.find((p) => p.key === org.plan);
  const tab = ctx.route.tab;
  const content = {
    apercu: () => overview(org, plan),
    configuration: () => configuration(org),
    utilisateurs: () => usersTab(org),
    modules: () => modulesTab(org),
    domaines: () => domainsTab(org),
    facturation: () => billingTab(org, plan),
    activite: () => activityTab(org, ctx),
    audit: () => auditTab(org, ctx),
  }[tab]();

  const issue = organizationIssue(org);
  const acc = org.access;
  return html`
    <section class="card org-hero" aria-label="Organisation">
      <div class="org-hero-top">
        <div class="org-hero-main">
          ${orgLogo(org, 'lg', { presence: true })}
          <div class="org-hero-text">
            <div class="org-hero-title"><h1>${org.name}</h1>${healthBadge(org.health)}</div>
            <div class="org-hero-meta">
              <span>${icon('trophy', 14)}${org.sports.map((s) => SPORTS[s]?.label ?? s).join(' · ')}</span>
              <span>${icon('layers', 14)}Plan ${plan.name}</span>
              <span class="mono">${icon('globe', 14)}${org.domain}</span>
              <button type="button" class="id-copy mono" data-action="copy-id" data-id="${org.id}" data-tip="${org.id}" aria-label="Copier l’identifiant ${org.id}">${shortId(org.id)} ${icon('copy', 13)}</button>
            </div>
            ${issue ? html`<div class="org-hero-issue">${signal(issue)}</div>` : ''}
          </div>
        </div>
        <div class="org-hero-actions">
          <button type="button" class="btn btn-secondary" data-action="support-session" data-id="${org.id}">${icon('lifebuoy', 16)}Session d’assistance</button>
          ${dropdown({
            id: 'menu-org-actions',
            label: 'Autres actions',
            trigger: { className: 'btn btn-secondary btn-icon', content: icon('more', 18) },
            items: [
              { label: 'Recalculer l’accès', iconName: 'refresh', action: 'proto-toast', data: { message: 'Recalcul de la projection d’accès' } },
              { label: 'Revérifier les domaines', iconName: 'globe', action: 'proto-toast', data: { message: 'Revérification des domaines' } },
              { label: 'Exporter les données', iconName: 'download', action: 'proto-toast', data: { message: 'Export complet de l’organisation' } },
              'sep',
              { label: 'Suspendre l’accès…', iconName: 'lock', action: 'suspend', danger: true, data: { id: org.id } },
              { label: 'Archiver (échéancier contractuel)', iconName: 'pause', action: 'noop', disabled: true },
            ],
          })}
        </div>
      </div>
      <div class="states" role="group" aria-label="Trois états distincts de l’organisation">
        <div class="state">
          <span class="state-kicker">Contrat <span class="tech">TenantLifecycle</span></span>
          ${statusBadge(LIFECYCLE, org.lifecycle)}
          <span class="state-note">Modifié par l’opérateur ou l’échéancier contractuel</span>
        </div>
        <div class="state">
          <span class="state-kicker">Facturation <span class="tech">BillingState</span></span>
          ${statusBadge(BILLING, org.billing.status)}
          <span class="state-note">${org.billing.mode === 'manual' ? 'Facturation manuelle' : 'Miroir du prestataire'} · ${formatEuros(plan.priceCents)} / mois</span>
        </div>
        <div class="state derived">
          <span class="state-kicker">Accès dérivé <span class="tech">AccessMode</span></span>
          ${statusBadge(ACCESS, acc.mode)}
          <span class="state-note">${acc.validUntil ? `Jusqu’au ${formatDate(acc.validUntil)}, puis ${ACCESS[acc.modeAfter]?.label ?? 'recalcul'}` : REASONS[acc.reason] ?? ''}</span>
        </div>
      </div>
    </section>
    <div class="section-gap">
      ${tabs({ items: ORG_TABS.map((k) => ({ key: k, label: TAB_LABELS[k] })), current: tab, label: `Sections de ${org.name}`, hrefFor: (k) => href('organisations', org.id, k) })}
      ${tabPanel(tab, content)}
    </div>`;
}

export const actions = {
  suspend: (el) => confirmSuspend(el.dataset.id),
  'support-session': (el) => supportSession(orgById(el.dataset.id)),
};

export const orgName = (id) => orgById(id)?.name ?? '';
