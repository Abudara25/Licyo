// Offres SaaS : EXEMPLES d'interface, non normatifs. Droits (plans) et drapeaux (déploiement) restent séparés (ADR-013).
import { html } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card } from '../components/card.js';
import { badge, statusBadge } from '../components/badge.js';
import { dataTable } from '../components/data-table.js';
import { notice } from '../components/feedback.js';
import { PLANS, MODULES, FLAGS, ORGANIZATIONS } from '../data/fixtures.js';
import { CAPABILITY } from '../data/status.js';
import { formatEuros, formatNumber } from '../lib/format.js';
import { region } from './common.js';

const quota = (v, unit = '') => (v === null ? 'Illimité' : `${formatNumber(v)}${unit}`);

export function render(ctx) {
  const planCard = (p) => {
    const count = ORGANIZATIONS.filter((o) => o.plan === p.key && !['ARCHIVED', 'TERMINATED'].includes(o.lifecycle)).length;
    return html`<article class="card plan-card ${p.key === 'club' ? 'featured' : ''}">
      <div class="card-body stack">
        <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="font-size:18px">${p.name}</h2>${p.key === 'club' ? badge('Le plus choisi', 'violet', { dot: false }) : ''}</div>
        <p class="muted">${p.tagline}</p>
        <div><span style="font-size:30px;font-weight:680;letter-spacing:-.02em">${formatEuros(p.priceCents)}</span><span class="muted"> / mois HT</span></div>
        <ul class="plan-list">
          <li>${icon('users', 16)}${p.quotas.members === null ? 'Membres illimités' : `${quota(p.quotas.members)} membres`}</li>
          <li>${icon('user', 16)}${p.quotas.admins === null ? 'Administrateurs illimités' : `${quota(p.quotas.admins)} administrateurs`}</li>
          <li>${icon('disk', 16)}${p.quotas.storageGb} Go de stockage</li>
          <li>${icon('mail', 16)}${quota(p.quotas.emailsPerMonth)} e-mails / mois</li>
          <li>${icon('globe', 16)}${p.quotas.customDomains ? `${p.quotas.customDomains} domaine${p.quotas.customDomains > 1 ? 's' : ''} personnalisé${p.quotas.customDomains > 1 ? 's' : ''}` : 'Sous-domaine plateforme'}</li>
        </ul>
        <div class="muted" style="font-size:12.5px">${count} organisation${count > 1 ? 's' : ''} sur ce plan</div>
        <button type="button" class="btn btn-secondary" data-action="proto-toast" data-message="Modification de l’offre ${p.name}">Modifier l’offre</button>
      </div>
    </article>`;
  };

  return html`
    ${pageHeader({
      title: 'Plans & fonctionnalités',
      description: 'Ce qu’une offre inclut (droits) et ce que l’équipe technique déploie (drapeaux) : deux notions distinctes.',
      actions: html`<button type="button" class="btn btn-primary" data-action="proto-toast" data-message="Création d’une offre">${icon('plus', 16)}Nouvelle offre</button>`,
    })}
    <div style="margin-bottom:16px">${notice('neutral', 'Exemples d’interface : ces trois offres ne constituent pas une décision d’architecture ni une grille tarifaire.')}</div>
    ${region(ctx, html`<div class="grid grid-3">${PLANS.map(planCard)}</div>`, { rows: 4 })}
    <div class="section-gap">
      ${card({
        title: 'Modules inclus par offre (droits)',
        subtitle: 'Un module n’est disponible que si sa capacité est livrée dans le code',
        flush: true,
        body: region(
          ctx,
          dataTable({
            caption: 'Matrice des droits',
            rows: MODULES,
            columns: [
              { key: 'm', label: 'Module', render: (m) => html`<span style="font-weight:600">${m.label}</span>` },
              { key: 'cap', label: 'Capacité', render: (m) => statusBadge(CAPABILITY, m.capability) },
              ...PLANS.map((p) => ({ key: p.key, label: p.name, render: (m) => (p.modules.includes(m.key) ? html`<span style="color:var(--tone-success)" aria-label="Inclus">${icon('check', 18)}</span>` : html`<span class="muted" aria-label="Non inclus">—</span>`) })),
            ],
          })
        ),
      })}
    </div>
    <div class="section-gap">
      ${card({
        title: 'Drapeaux techniques',
        subtitle: 'Déploiement progressif et coupe-circuits — jamais un argument commercial',
        flush: true,
        body: region(
          ctx,
          dataTable({
            caption: 'Drapeaux',
            rows: Object.entries(FLAGS).map(([key, f]) => ({ key, ...f })),
            columns: [
              { key: 'key', label: 'Drapeau', render: (f) => html`<span class="mono">${f.key}</span>` },
              { key: 'desc', label: 'Description', className: 'wrap', render: (f) => f.desc },
              { key: 'state', label: 'État', render: (f) => (f.state === 'on' ? badge('Actif pour tous', 'success') : f.state === 'pilot' ? badge(`Pilote (${f.pilots.length})`, 'info') : badge('Inactif', 'neutral')) },
            ],
          })
        ),
      })}
    </div>`;
}

export const actions = {};
