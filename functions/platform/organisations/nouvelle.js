// Nouvelle organisation : club, sport, domaine, puis accès du président (invitation de compte du bureau, lot 1).
// La maquette prévoit un assistant en 9 étapes ; cette première version réunit en une page ce qui est réellement
// branché (offre, facturation et import viendront avec leurs lots).
import { html } from '../../_shared/platform-ui/html.js';
import { icon } from '../../_shared/platform-ui/icons.js';
import { pageHeader, card } from '../../_shared/platform-ui/card.js';
import { consolePage, notice } from '../../_shared/platform-ui/kit.js';
import { createOrganization, SPORTS } from '../../_shared/platform-data.js';
import { PlatformError } from '../../_shared/platform-auth.js';
import { renderOrganization } from './[id].js';

const field = (id, label, control, hint = '') => html`<div class="field"><label for="${id}">${label}</label>${control}${hint ? html`<span class="hint">${hint}</span>` : ''}</div>`;

function formView(values = {}, error = '') {
  return html`
    ${pageHeader({ title: 'Nouvelle organisation', description: 'Le club est créé en service, avec son domaine. Son président reçoit un lien personnel pour créer son compte et ouvrir le CRM.' })}
    ${error ? notice('danger', error, 'alert') : ''}
    <form method="POST" class="stack">
      ${card({
        title: 'Le club',
        body: html`<div class="form-grid">
          ${field('name', 'Nom du club', html`<input class="input" id="name" name="name" maxlength="120" value="${values.name || ''}" required autofocus>`)}
          ${field('sport', 'Sport principal', html`<select class="select" id="sport" name="sport" required><option value="">Choisir…</option>${Object.entries(SPORTS).map(([k, s]) => html`<option value="${k}" ${values.sport === k ? 'selected' : ''}>${s.label}</option>`)}</select>`)}
          ${field('domain', 'Domaine du site', html`<input class="input" id="domain" name="domain" maxlength="253" value="${values.domain || ''}" placeholder="www.monclub.fr" autocapitalize="off" spellcheck="false" required>`, 'Adresse du site du club. Le DNS se règle ensuite chez le registraire.')}
          ${field('email', 'E-mail du club (facultatif)', html`<input class="input" id="email" name="email" type="email" maxlength="200" value="${values.email || ''}" inputmode="email">`)}
          ${field('slug', 'Identifiant court (facultatif)', html`<input class="input" id="slug" name="slug" maxlength="48" value="${values.slug || ''}" placeholder="déduit du nom" autocapitalize="off" spellcheck="false">`, 'Lettres, chiffres et tirets. Sert aux exports et au support.')}
        </div>`,
      })}
      ${card({
        title: 'Président du club',
        subtitle: 'Il recevra un lien valable 7 jours pour créer son compte. Il invitera ensuite le reste du bureau.',
        body: html`<div class="form-grid">
          ${field('presidentName', 'Prénom et nom', html`<input class="input" id="presidentName" name="presidentName" maxlength="120" value="${values.presidentName || ''}" required>`)}
          ${field('presidentEmail', 'Adresse e-mail', html`<input class="input" id="presidentEmail" name="presidentEmail" type="email" maxlength="200" value="${values.presidentEmail || ''}" inputmode="email" required>`)}
        </div>`,
      })}
      <div class="form-actions"><a class="btn btn-secondary" href="/platform/organisations">Annuler</a><button type="submit" class="btn btn-primary">${icon('plus', 16)}Créer l’organisation</button></div>
    </form>`;
}

export async function onRequestGet(context) {
  return consolePage(context, { title: 'Nouvelle organisation', active: 'new', trail: [{ label: 'Organisations', href: '/platform/organisations' }, { label: 'Nouvelle organisation' }], content: formView() });
}

export async function onRequestPost(context) {
  const form = await context.request.formData();
  const values = Object.fromEntries(['name', 'sport', 'domain', 'email', 'slug', 'presidentName', 'presidentEmail'].map((k) => [k, String(form.get(k) || '').trim()]));
  try {
    const origin = new URL(context.request.url).protocol === 'http:' ? 'http' : 'https';
    const created = await createOrganization(context.env, context.data.operator, values, { origin });
    // Le lien du président est affiché ici même, jamais placé dans une URL (historique, journaux).
    return renderOrganization(context, created.id, { message: 'Organisation créée.', invite: created.invite });
  } catch (error) {
    if (!(error instanceof PlatformError)) throw error;
    return consolePage(context, {
      title: 'Nouvelle organisation',
      active: 'new',
      trail: [{ label: 'Organisations', href: '/platform/organisations' }, { label: 'Nouvelle organisation' }],
      content: formView(values, error.message),
      status: 400,
    });
  }
}
