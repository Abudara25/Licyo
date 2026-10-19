// Journal plateforme (ajout seul). Aucun secret, jeton ni contenu personnel ; adresses IP masquées.
import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card } from '../components/card.js';
import { badge, statusBadge } from '../components/badge.js';
import { dataTable } from '../components/data-table.js';
import { searchInput, selectInput } from '../components/form.js';
import { emptyState } from '../components/feedback.js';
import { AUDIT, orgById } from '../data/fixtures.js';
import { AUDIT_RESULT } from '../data/status.js';
import { formatDateTime, fold } from '../lib/format.js';
import { region, orgLink } from './common.js';

const LABELS = {
  'organization.created': 'a créé l’organisation',
  'domain.verified': 'a vérifié un domaine',
  'domain.challenge_issued': 'a émis un défi DNS',
  'domain.provisioning_started': 'a lancé le provisionnement d’un domaine',
  'domain.ssl_failed': 'a constaté un échec de certificat',
  'domain.quarantined': 'a placé un domaine en quarantaine',
  'entitlement.changed': 'a modifié un droit',
  'access.recalculated': 'a recalculé l’accès',
  'support_session.started': 'a ouvert une session d’assistance',
  'security_hold.set': 'a posé un blocage de sécurité',
  'operator_hold.scheduled': 'a programmé une maintenance',
  'admin.login': 'a tenté de se connecter',
  'billing.state_synced': 'a synchronisé la facturation',
  'flag.pilot_added': 'a ajouté un pilote à un drapeau',
  'lifecycle.transitioned': 'a changé le cycle de vie',
};
export const auditLabel = (action) => LABELS[action] ?? action;
const ACTOR_TYPES = { operator: ['Opérateur', 'violet'], system: ['Système', 'neutral'], anonymous: ['Anonyme', 'warning'] };

export function render(ctx) {
  const f = ctx.state.audit;
  const needle = fold(f.q.trim());
  const rows = AUDIT.filter((a) => (!f.result || a.result === f.result) && (!needle || fold(`${a.action} ${a.actor} ${a.resource} ${orgById(a.orgId)?.name ?? ''}`).includes(needle)));
  return html`
    ${pageHeader({
      title: 'Audit',
      description: 'Toute action d’un opérateur ou du système sur la plateforme. Journal en ajout seul, sans secret ni donnée sensible.',
      actions: html`<button type="button" class="btn btn-secondary" data-action="proto-toast" data-message="Export du journal (permission et MFA requises)">${icon('download', 16)}Exporter</button>`,
    })}
    ${card({
      flush: true,
      body: html`
        <div class="toolbar">
          ${searchInput({ id: 'audit-q', model: 'audit.q', value: f.q, placeholder: 'Action, acteur, ressource, organisation…', label: 'Rechercher dans le journal' })}
          ${selectInput({ id: 'audit-result', model: 'audit.result', value: f.result, label: 'Filtrer par résultat', options: [['', 'Tous les résultats'], ...Object.entries(AUDIT_RESULT).map(([k, v]) => [k, v.label])] })}
          <span class="muted" style="margin-left:auto" aria-live="polite">${rows.length} entrée${rows.length > 1 ? 's' : ''}</span>
        </div>
        ${region(
          ctx,
          dataTable({
            caption: 'Journal plateforme',
            stack: true,
            rows,
            columns: [
              { key: 'at', label: 'Date', render: (a) => html`<span class="num">${formatDateTime(a.at)}</span>` },
              { key: 'actor', label: 'Acteur', render: (a) => html`<div>${a.actor}<div>${badge(...ACTOR_TYPES[a.actorType], { dot: false })}</div></div>` },
              { key: 'org', label: 'Organisation', hide: 'md', render: (a) => orgLink(a.orgId) },
              { key: 'action', label: 'Action', render: (a) => html`<span class="mono">${a.action}</span>` },
              { key: 'resource', label: 'Ressource', className: 'wrap', hide: 'lg', render: (a) => html`<span class="muted">${a.resource}</span>` },
              { key: 'result', label: 'Résultat', render: (a) => statusBadge(AUDIT_RESULT, a.result) },
              { key: 'ip', label: 'IP', hide: 'lg', render: (a) => html`<span class="mono muted">${a.ip}</span>` },
              { key: 'req', label: 'Requête', hide: 'xl', render: (a) => html`<span class="mono muted">${a.requestId}</span>` },
            ],
            empty: emptyState({ title: 'Aucune entrée', text: 'Aucune entrée du journal ne correspond à cette recherche.', iconName: 'scroll' }),
          }),
          { rows: 8 }
        )}`,
      foot: 'Les adresses IP sont masquées ; celles de ce prototype appartiennent aux plages réservées à la documentation.',
    })}`;
}

export const actions = {};
export const models = { audit: (ctx, key, value) => ctx.set({ audit: { ...ctx.state.audit, [key]: value } }) };
