// Onboarding assisté (Master §27) : liste des onboardings en cours et assistant en 9 étapes.
// L'assistant garde sa saisie EN MÉMOIRE seulement ; le bouton final ne crée rien (prototype).
import { html, safeColor } from '../lib/html.js';
import { icon } from '../components/icons.js';
import { pageHeader, card, kvList, progress } from '../components/card.js';
import { badge } from '../components/badge.js';
import { dataTable } from '../components/data-table.js';
import { field, textInput, selectInput, toggle } from '../components/form.js';
import { notice } from '../components/feedback.js';
import { orgLogo } from '../components/avatar.js';
import { ONBOARDINGS, WIZARD_STEPS, PLANS, MODULES, PLATFORM_SITE_DOMAIN, orgById } from '../data/fixtures.js';
import { SPORTS } from '../data/status.js';
import { formatEuros, relative, fold } from '../lib/format.js';
import { region } from './common.js';
import { href } from '../router.js';

const COLORS = ['#3346d3', '#0f766e', '#b45309', '#be185d', '#6d28d9', '#b91c1c', '#0369a1', '#334155'];
export const slugify = (name) => fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const emptyWizard = () => ({
  data: { name: '', slug: '', kind: 'association', timezone: 'Europe/Paris', sport: '', extraSports: [], sections: '', color: COLORS[0], customDomain: '', plan: 'club', modules: {}, adminName: '', adminEmail: '' },
  errors: {},
  done: false,
});

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validation d'une étape : { champ: message }.
export function validateStep(step, d) {
  const e = {};
  if (step === 1) {
    if (d.name.trim().length < 3) e.name = 'Indiquez le nom de l’organisation (3 caractères au moins).';
    if (!SLUG_RE.test(d.slug)) e.slug = 'Lettres minuscules, chiffres et tirets uniquement.';
  }
  if (step === 2 && !d.sport) e.sport = 'Choisissez l’activité principale.';
  if (step === 4 && d.customDomain && !DOMAIN_RE.test(d.customDomain)) e.customDomain = 'Nom de domaine invalide (ex. : monclub.example).';
  if (step === 7) {
    if (d.adminName.trim().length < 2) e.adminName = 'Indiquez le nom de l’administrateur.';
    if (!EMAIL_RE.test(d.adminEmail)) e.adminEmail = 'Adresse e-mail invalide.';
  }
  return e;
}

const STEP_INTROS = [
  'Nom, identifiant court et fuseau horaire de la structure cliente.',
  'L’activité principale oriente les modèles proposés ; d’autres activités pourront être ajoutées ensuite.',
  'Couleur principale du site public et de l’espace membres.',
  'Sous-domaine de la plateforme, disponible tout de suite, et domaine personnalisé facultatif.',
  'Offre de départ : elle fixe les droits de l’organisation.',
  'Modules actifs au démarrage, dans la limite des droits du plan.',
  'Premier propriétaire de l’organisation, invité par e-mail.',
  'Relisez avant le provisionnement ; chaque bloc peut encore être modifié.',
  'Ce que le provisionnement ferait, dans l’ordre et de façon reprenable.',
];

const platformHost = (slug) => `${slug || 'votre-club'}.${PLATFORM_SITE_DOMAIN}`;
const planOf = (d) => PLANS.find((p) => p.key === d.plan) ?? PLANS[0];
const activeModules = (d) => {
  const plan = planOf(d);
  return MODULES.filter((m) => plan.modules.includes(m.key) && m.capability !== 'in_development' && d.modules[m.key] !== false);
};

// --- Liste ----------------------------------------------------------------------------------------------------------
export function renderList(ctx) {
  return html`
    ${pageHeader({
      eyebrow: 'Organisations',
      title: 'Onboarding',
      description: 'Onboardings assistés par l’équipe : chaque étape est reprenable et journalisée.',
      actions: html`<a class="btn btn-primary" href="#/onboarding/nouveau/1">${icon('plus', 16)}Nouvel onboarding</a>`,
    })}
    ${card({
      title: 'En cours',
      subtitle: `${ONBOARDINGS.length} onboardings`,
      flush: true,
      body: region(
        ctx,
        dataTable({
          caption: 'Onboardings en cours',
          stack: true,
          columns: [
            {
              key: 'org', label: 'Organisation', render: (ob) => {
                const org = orgById(ob.orgId);
                return org
                  ? html`<div class="org-cell">${orgLogo(org)}<div><a class="name" href="${href('organisations', org.id)}">${org.name}</a><div class="sub">${SPORTS[org.sports[0]]?.label}</div></div></div>`
                  : html`<div class="org-cell"><span class="org-logo" style="background:#98a2b3" aria-hidden="true">TA</span><div><span class="name">${ob.draftName}</span><div class="sub">${ob.sport} · brouillon</div></div></div>`;
              },
            },
            { key: 'step', label: 'Étape', render: (ob) => html`<div class="step-cell"><div class="step-cell-label">${ob.step}/9 · ${WIZARD_STEPS[ob.step - 1]}</div>${progress(ob.step / 9, 'Progression')}</div>` },
            { key: 'blocker', label: 'Point bloquant', className: 'wrap', render: (ob) => (ob.blocker ? html`<span class="muted">${ob.blocker}</span>` : badge('Aucun', 'success')) },
            { key: 'owner', label: 'Responsable', hide: 'md', render: (ob) => ob.owner },
            { key: 'started', label: 'Démarré', hide: 'lg', render: (ob) => html`<span class="muted">${relative(ob.startedAt)}</span>` },
            { key: 'go', label: '', srLabel: 'Reprendre', render: (ob) => html`<button type="button" class="btn btn-secondary btn-sm" data-action="wz-resume" data-org="${ob.orgId || ''}" data-draft="${ob.draftName || ''}" data-step="${ob.step}">Reprendre</button>` },
          ],
          rows: ONBOARDINGS,
        })
      ),
    })}`;
}

// --- Assistant ------------------------------------------------------------------------------------------------------
function stepBody(step, w) {
  const d = w.data;
  const err = w.errors;
  switch (step) {
    case 1:
      return html`<div class="form-grid">
        ${field({ id: 'wz-name', label: 'Nom de l’organisation', required: true, valid: d.name.trim().length >= 3, error: err.name, control: textInput({ id: 'wz-name', model: 'wizard.name', value: d.name, placeholder: 'Ex. : Tennis Club des Tilleuls', error: err.name }) })}
        ${field({ id: 'wz-slug', label: 'Identifiant court (slug)', required: true, valid: SLUG_RE.test(d.slug), hint: `Sous-domaine : ${platformHost(d.slug)}`, error: err.slug, control: textInput({ id: 'wz-slug', model: 'wizard.slug', value: d.slug, placeholder: 'tennis-club-des-tilleuls', error: err.slug }) })}
        ${field({ id: 'wz-kind', label: 'Type de structure', control: selectInput({ id: 'wz-kind', model: 'wizard.kind', value: d.kind, options: [['association', 'Association loi 1901'], ['omnisports', 'Club omnisports'], ['academy', 'Académie privée'], ['federation', 'Comité / ligue']] }) })}
        ${field({ id: 'wz-tz', label: 'Fuseau horaire', control: selectInput({ id: 'wz-tz', model: 'wizard.timezone', value: d.timezone, options: [['Europe/Paris', 'Europe/Paris'], ['Europe/Brussels', 'Europe/Brussels'], ['America/Martinique', 'America/Martinique'], ['Indian/Reunion', 'Indian/Reunion']] }) })}
      </div>`;
    case 2:
      return html`<div class="stack-lg">
        <div class="field"><span class="label" id="wz-sport-label">Activité principale<span class="req" aria-hidden="true">*</span><span class="sr-only"> (obligatoire)</span></span>
          <div class="option-grid" role="group" aria-labelledby="wz-sport-label">${Object.entries(SPORTS).map(([k, s]) => html`<button type="button" class="option option-inline" data-action="wz-sport" data-value="${k}" aria-pressed="${d.sport === k}"><span class="option-swatch" style="background:${s.color}" aria-hidden="true"></span><span class="title">${s.label}</span></button>`)}</div>
          ${err.sport ? html`<span class="error" role="alert">${icon('alert', 14)}${err.sport}</span>` : ''}
        </div>
        ${field({ id: 'wz-sections', label: 'Sections (facultatif, séparées par des virgules)', hint: 'Une section est une unité d’organisation ; un sport est une pratique.', control: textInput({ id: 'wz-sections', model: 'wizard.sections', value: d.sections, placeholder: 'Loisir, Compétition, École' }) })}
      </div>`;
    case 3:
      return html`<div class="grid grid-2">
        <div class="stack">
          <div class="field"><span class="label" id="wz-color-label">Couleur principale</span>
            <div class="swatches" role="group" aria-labelledby="wz-color-label">${COLORS.map((c) => html`<button type="button" class="swatch" style="background:${c}" data-action="wz-color" data-value="${c}" aria-pressed="${d.color === c}" aria-label="Couleur ${c}"></button>`)}</div>
          </div>
          ${notice('info', 'Le contraste du texte sur cette couleur sera vérifié (AA) avant la publication du site.')}
        </div>
        <div class="card preview-site" aria-label="Aperçu de l’en-tête du site">
          <div class="preview-site-head" style="background:${safeColor(d.color)}">
            <span class="org-logo" style="background:rgba(255,255,255,.18)">${(d.name || 'Club').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</span>
            <strong>${d.name || 'Nom de l’organisation'}</strong>
          </div>
          <div class="card-body stack"><div class="skeleton sk-line" style="width:70%;animation:none"></div><div class="skeleton sk-line" style="width:45%;animation:none"></div><span class="btn btn-primary btn-sm" style="align-self:flex-start;background:${safeColor(d.color)}">S’inscrire</span></div>
        </div>
      </div>`;
    case 4:
      return html`<div class="stack-lg">
        <div class="domain-auto">
          <span class="icon-bubble tone-success">${icon('globe', 16)}</span>
          <div class="grow"><div class="strong">Sous-domaine de la plateforme</div><div class="mono small">${platformHost(d.slug)}</div></div>
          ${badge('Automatique', 'success')}
        </div>
        ${field({ id: 'wz-domain', label: 'Domaine personnalisé (facultatif)', valid: Boolean(d.customDomain) && DOMAIN_RE.test(d.customDomain), hint: 'Une revendication sera ouverte : preuve TXT unique, puis certificat. Rien n’est vérifié dans ce prototype.', error: err.customDomain, control: textInput({ id: 'wz-domain', model: 'wizard.customDomain', value: d.customDomain, placeholder: 'monclub.example', error: err.customDomain }) })}
      </div>`;
    case 5:
      return html`<div class="grid grid-3">${PLANS.map((p) => html`<button type="button" class="option option-plan" data-action="wz-plan" data-value="${p.key}" aria-pressed="${d.plan === p.key}">
          <span class="title">${p.name}</span><span class="desc">${p.tagline}</span>
          <span class="option-price">${formatEuros(p.priceCents)}<span class="muted"> / mois</span></span>
          <span class="desc">${p.modules.length} modules inclus</span>
        </button>`)}</div>
        <div class="section-gap">${notice('neutral', 'Offres d’exemple, non normatives : les droits réels seront définis dans le plan de contrôle.')}</div>`;
    case 6: {
      const plan = planOf(d);
      return html`<div class="bordered-list">${MODULES.map((m) => {
        const entitled = plan.modules.includes(m.key) && m.capability !== 'in_development';
        const on = entitled && d.modules[m.key] !== false;
        return html`<div class="list-row"><div class="grow"><div class="strong">${m.label}</div><div class="muted small">${entitled ? m.desc : m.capability === 'in_development' ? 'Capacité non livrée' : `Non inclus dans le plan ${plan.name}`}</div></div>${toggle({ id: `wz-mod-${m.key}`, checked: on, label: m.label, action: 'wz-module', disabled: !entitled })}</div>`;
      })}</div>`;
    }
    case 7:
      return html`<div class="form-grid">
        ${field({ id: 'wz-admin-name', label: 'Nom de l’administrateur', required: true, valid: d.adminName.trim().length >= 2, error: err.adminName, control: textInput({ id: 'wz-admin-name', model: 'wizard.adminName', value: d.adminName, placeholder: 'Prénom Nom', error: err.adminName }) })}
        ${field({ id: 'wz-admin-email', label: 'E-mail', required: true, valid: EMAIL_RE.test(d.adminEmail), error: err.adminEmail, control: textInput({ id: 'wz-admin-email', model: 'wizard.adminEmail', value: d.adminEmail, type: 'email', placeholder: 'presidence@monclub.example', error: err.adminEmail }) })}
        <div class="span-2">${notice('info', 'Rôle : Propriétaire de l’organisation. L’invitation (lien à usage unique, 72 h) sera envoyée par la future console, pas par ce prototype.')}</div>
      </div>`;
    case 8: {
      const plan = planOf(d);
      const mods = activeModules(d);
      const block = (s, label, value, sub = '') => html`
        <div class="review-block">
          <div class="rb-head"><span>${label}</span><a class="rb-edit" href="#/onboarding/nouveau/${s}" aria-label="Modifier : ${label}">${icon('settings', 13)}Modifier</a></div>
          <div class="rb-value">${value}</div>
          ${sub ? html`<div class="muted small">${sub}</div>` : ''}
        </div>`;
      return html`<div class="review">
        ${block(1, 'Organisation', d.name || '—', html`<span class="mono">${d.slug}</span> · ${d.timezone}`)}
        ${block(2, 'Activité', SPORTS[d.sport]?.label ?? '—', d.sections || 'Aucune section')}
        ${block(3, 'Identité visuelle', html`<span class="review-swatch" style="background:${safeColor(d.color)}" aria-hidden="true"></span><span class="mono">${d.color}</span>`)}
        ${block(4, 'Domaines', html`<span class="mono">${platformHost(d.slug)}</span>`, d.customDomain ? html`<span class="mono">${d.customDomain}</span> · revendication à ouvrir` : 'Pas de domaine personnalisé')}
        ${block(5, 'Plan', `${plan.name} · ${formatEuros(plan.priceCents)} / mois`, plan.tagline)}
        ${block(6, 'Modules', `${mods.length} module${mods.length > 1 ? 's' : ''} actif${mods.length > 1 ? 's' : ''}`, mods.map((m) => m.label).join(', ') || 'Aucun')}
        <div class="span-2">${block(7, 'Administrateur', d.adminName || '—', d.adminEmail || '—')}</div>
      </div>`;
    }
    case 9:
      return html`<div class="stack-lg">
        <ol class="plan-steps">
          ${[
            ['Compte client, cycle de vie « Provisionnement »', 'building'],
            ['Organisation et configuration de site en brouillon', 'layers'],
            ['Sous-domaine plateforme et revendication du domaine personnalisé', 'globe'],
            ['Droits du plan et modules', 'key'],
            ['Invitation du propriétaire', 'mail'],
            ['Entrée du journal plateforme', 'scroll'],
          ].map(([t, i]) => html`<li><span class="ps-text">${t}</span>${icon(i, 16)}</li>`)}
        </ol>
        ${notice('warning', html`<strong>Prototype :</strong> le bouton ci-dessous ne crée rien et n’envoie aucune requête.`, 'alert')}
      </div>`;
    default:
      return '';
  }
}

// Colonne latérale : étapes (retour possible vers toute étape atteignable) et récapitulatif de la saisie.
function wizardSide(step, w) {
  const d = w.data;
  const todo = html`<span class="todo">À compléter</span>`;
  return html`
    <aside class="wizard-side">
      <nav class="card" aria-label="Étapes de l’onboarding">
        <ol class="stepper">
          ${WIZARD_STEPS.map((label, i) => {
            const n = i + 1;
            const state = n < step ? 'done' : n === step ? 'current' : '';
            const mark = html`<span class="n">${n < step ? icon('check', 14) : n}</span><span class="label">${label}</span>`;
            if (n === step) return html`<li class="step current" aria-current="step"><span>${mark}</span></li>`;
            return firstInvalidStep(n, d) === null
              ? html`<li class="step ${state}"><a href="#/onboarding/nouveau/${n}" aria-label="Étape ${n} : ${label}${n < step ? ' (terminée)' : ''}">${mark}</a></li>`
              : html`<li class="step"><span aria-disabled="true">${mark}</span></li>`;
          })}
        </ol>
      </nav>
      <section class="card recap" aria-labelledby="wz-recap-t">
        <header class="card-head"><div><h2 id="wz-recap-t">Récapitulatif</h2><p>Mis à jour pendant la saisie</p></div></header>
        <div class="card-body">
          ${kvList([
            ['Nom', d.name || todo],
            ['Activité', SPORTS[d.sport]?.label ?? todo],
            ['Domaine', html`<span class="mono" title="${platformHost(d.slug)}">${platformHost(d.slug)}</span>`],
            ['Plan', planOf(d).name],
            ['Admin', d.adminEmail || todo],
          ])}
        </div>
      </section>
    </aside>`;
}

function doneScreen(w) {
  const d = w.data;
  const plan = planOf(d);
  return html`
    <section class="card done-card" aria-labelledby="wz-done-t">
      <div class="empty success" role="status">
        <span class="icon-bubble">${icon('check', 24)}</span>
        <h2 id="wz-done-t">Organisation prête à être provisionnée</h2>
        <p><strong>${d.name}</strong> a passé toutes les vérifications de l’assistant.</p>
      </div>
      <div class="done-summary">
        <div class="review-block"><div class="rb-head"><span>Organisation</span></div><div class="rb-value">${d.name}</div><div class="muted small">${SPORTS[d.sport]?.label ?? ''}</div></div>
        <div class="review-block"><div class="rb-head"><span>Plan</span></div><div class="rb-value">${plan.name}</div><div class="muted small">${activeModules(d).length} modules au démarrage</div></div>
        <div class="review-block"><div class="rb-head"><span>Domaine</span></div><div class="rb-value mono">${platformHost(d.slug)}</div><div class="muted small">${d.customDomain ? `+ ${d.customDomain}` : 'Sans domaine personnalisé'}</div></div>
      </div>
      <div class="done-foot">
        ${notice('neutral', 'Aucune ressource n’a été créée : pas d’organisation, pas de domaine, pas d’invitation. Dans la future console, cette étape déclenchera un provisionnement journalisé et reprenable.')}
        <div class="done-actions"><a class="btn btn-secondary" href="#/onboarding">Retour à l’onboarding</a><button type="button" class="btn btn-primary" data-action="wz-reset">${icon('plus', 16)}Nouvel onboarding</button></div>
      </div>
    </section>`;
}

// Première étape invalide avant `step` (une étape ne s'atteint pas par l'URL sans les précédentes).
export const firstInvalidStep = (step, data) => Array.from({ length: step - 1 }, (_, i) => i + 1).find((s) => Object.keys(validateStep(s, data)).length) ?? null;

export function renderWizard(ctx) {
  const w = ctx.state.wizard;
  if (w.done) return doneScreen(w);
  const blocked = firstInvalidStep(ctx.route.step, w.data);
  if (blocked) {
    queueMicrotask(() => ctx.navigate(`#/onboarding/nouveau/${blocked}`, { replace: true }));
    return '';
  }
  const step = ctx.route.step;
  const errorCount = Object.values(w.errors).filter(Boolean).length;
  return html`
    ${pageHeader({ eyebrow: 'Onboarding', title: 'Nouvelle organisation', description: 'Les informations restent dans cet onglet et ne sont envoyées nulle part.' })}
    <div class="wizard">
      ${wizardSide(step, w)}
      <section class="card" aria-labelledby="wz-title">
        <header class="step-head">
          <span class="step-kicker">Étape ${step} sur 9</span>
          <h2 id="wz-title">${WIZARD_STEPS[step - 1]}</h2>
          <p>${STEP_INTROS[step - 1]}</p>
          ${progress(step / 9, 'Progression de l’onboarding')}
        </header>
        <div class="step-body">
          ${errorCount ? html`<div class="step-errors">${notice('danger', `${errorCount} champ${errorCount > 1 ? 's' : ''} à corriger avant de passer à l’étape suivante.`, 'alert')}</div>` : ''}
          ${stepBody(step, w)}
        </div>
        <div class="wizard-foot">
          ${step > 1 ? html`<a class="btn btn-secondary" href="#/onboarding/nouveau/${step - 1}">${icon('chevronLeft', 16)}Précédent</a>` : html`<a class="btn btn-ghost" href="#/onboarding">Annuler</a>`}
          ${step < 9 ? html`<span class="next-hint">Ensuite : ${WIZARD_STEPS[step]}</span>` : ''}
          ${step < 9
            ? html`<button type="button" class="btn btn-primary" data-action="wz-next" data-step="${step}">${step === 8 ? 'Confirmer' : 'Continuer'}${icon('chevronRight', 16)}</button>`
            : html`<button type="button" class="btn btn-primary" data-action="wz-create">${icon('sparkles', 16)}Simuler la création</button>`}
        </div>
      </section>
    </div>`;
}

export const actions = {
  'wz-sport': (el, ctx) => ctx.set({ wizard: { ...ctx.state.wizard, data: { ...ctx.state.wizard.data, sport: el.dataset.value }, errors: { ...ctx.state.wizard.errors, sport: undefined } } }),
  'wz-color': (el, ctx) => ctx.set({ wizard: { ...ctx.state.wizard, data: { ...ctx.state.wizard.data, color: el.dataset.value } } }),
  'wz-plan': (el, ctx) => ctx.set({ wizard: { ...ctx.state.wizard, data: { ...ctx.state.wizard.data, plan: el.dataset.value } } }),
  'wz-module': (el, ctx) => {
    if (el.getAttribute('aria-disabled') === 'true') return;
    const key = el.id.replace('wz-mod-', '');
    const d = ctx.state.wizard.data;
    ctx.set({ wizard: { ...ctx.state.wizard, data: { ...d, modules: { ...d.modules, [key]: el.getAttribute('aria-checked') !== 'true' } } } });
  },
  'wz-next': (el, ctx) => {
    const step = Number(el.dataset.step);
    const errors = validateStep(step, ctx.state.wizard.data);
    ctx.set({ wizard: { ...ctx.state.wizard, errors } });
    if (Object.keys(errors).length) {
      document.querySelector('[aria-invalid="true"], .field .error')?.closest('.field')?.querySelector('input, button')?.focus();
      return;
    }
    ctx.navigate(`#/onboarding/nouveau/${step + 1}`);
  },
  'wz-create': (el, ctx) => ctx.set({ wizard: { ...ctx.state.wizard, done: true } }),
  // Reprise : pré-remplit l'assistant avec les données fictives de l'onboarding choisi.
  'wz-resume': (el, ctx) => {
    const org = orgById(el.dataset.org);
    const base = emptyWizard();
    const name = org ? org.name : el.dataset.draft;
    base.data = {
      ...base.data,
      name,
      slug: org ? org.slug : slugify(name),
      sport: org ? org.sports[0] : '',
      color: org ? org.colors[0] : base.data.color,
      plan: org ? org.plan : base.data.plan,
      sections: org ? org.sections.join(', ') : '',
      customDomain: org && !org.domain.endsWith(`.${PLATFORM_SITE_DOMAIN}`) ? org.domain : '',
    };
    ctx.set({ wizard: base });
    ctx.navigate(`#/onboarding/nouveau/${el.dataset.step}`);
  },
  'wz-reset': (el, ctx) => {
    ctx.set({ wizard: emptyWizard() });
    ctx.navigate('#/onboarding/nouveau/1');
  },
};

// Saisie : le slug suit le nom tant qu'il n'a pas été modifié à la main.
export const models = {
  wizard: (ctx, key, value) => {
    const w = ctx.state.wizard;
    const data = { ...w.data, [key]: value };
    if (key === 'name' && (w.data.slug === '' || w.data.slug === slugify(w.data.name))) data.slug = slugify(value);
    if (key === 'customDomain') data.customDomain = value.trim().toLowerCase();
    ctx.set({ wizard: { ...w, data, errors: { ...w.errors, [key]: undefined } } }, { silent: false });
  },
};
