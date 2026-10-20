// Site web du club (permission settings.manage, 2026-10-20) : modifier le brouillon de la configuration du site
// (textes, coordonnées, couleurs), le prévisualiser, puis le publier. Le site public ne lit que la version publiée
// (site-config.js). Logique de modification : _shared/site-editor.js.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr } from '../_shared/admin-auth.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { readSiteConfig, saveDraftSiteConfig, publishSiteConfig, SiteConfigValidationError, ConfigConflictError } from '../_shared/site-config.js';
import { applyEdits, customFields, SiteEditError, STARTER_FIELDS, syncOrganizationContact } from '../_shared/site-editor.js';
import { loadOrganization } from '../_shared/organization.js';
import { paletteVariables } from '../../renderer/palette.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

function field(name, label, value, { multiline = false, max = 200, hint = '' } = {}) {
  const id = `f-${name.replace(/[^a-z0-9]/gi, '-')}`;
  const input = multiline
    ? `<textarea id="${id}" name="${escapeHtml(name)}" maxlength="${max}" rows="${max > 1000 ? 8 : 4}">${escapeHtml(value || '')}</textarea>`
    : `<input type="text" id="${id}" name="${escapeHtml(name)}" value="${escapeHtml(value || '')}" maxlength="${max}">`;
  return `<div class="form-field"><label for="${id}">${escapeHtml(label)}</label>${input}${hint ? `<small class="form-hint">${escapeHtml(hint)}</small>` : ''}</div>`;
}

function colorFields(colors) {
  const primary = colors?.primary || '#801818';
  const accent = colors?.accent || '#f0a030';
  const vars = paletteVariables({ primary, accent });
  return `<div class="adm-site-colors">
      <div class="form-field"><label for="f-primary">Couleur principale</label><input type="color" id="f-primary" name="primary" value="${escapeHtml(primary)}"></div>
      <div class="form-field"><label for="f-accent">Couleur secondaire</label><input type="color" id="f-accent" name="accent" value="${escapeHtml(accent)}"></div>
      <div class="adm-site-swatches" aria-hidden="true">${['primary-900', 'primary-700', 'accent-500', 'accent-100'].map((k) => `<span style="background:${vars[`--brand-${k}`]}"></span>`).join('')}</div>
    </div>
    <p class="form-hint">La couleur principale colore les bandeaux et titres (assombrie si besoin pour rester lisible), la secondaire les boutons et accents.</p>`;
}

function starterForm(config) {
  const p = config.starter;
  const groups = [
    ['Le club', ['name', 'sportLabel', 'city', 'tagline', 'audience']],
    ['Page d’accueil', ['heroTitle', 'heroLead', 'values']],
    ['Page « Le club »', ['about']],
    ['Coordonnées', ['email', 'phone', 'venueName', 'venueAddress', 'facebook', 'instagram']],
    ['Mentions légales', ['legalAddress', 'rna']],
  ];
  return groups
    .map(([title, keys]) => `<fieldset class="adm-site-group"><legend>${escapeHtml(title)}</legend>${keys.map((k) => field(k, STARTER_FIELDS[k].label, p[k], { multiline: STARTER_FIELDS[k].multiline || STARTER_FIELDS[k].max > 200, max: STARTER_FIELDS[k].max })).join('')}</fieldset>`)
    .join('');
}

function customForm(config) {
  const f = customFields(config);
  return `${field('tagline', 'Accroche (sous le nom du club)', f.tagline, { max: 80 })}
    ${f.pages
      .map(
        (page) => `<details class="adm-fold adm-site-page"><summary><span>Page ${escapeHtml(page.route)}</span></summary>
        ${field(`seoTitle:${page.id}`, 'Titre (onglet et Google)', page.seoTitle, { max: 120 })}
        ${field(`seoDescription:${page.id}`, 'Description (Google)', page.seoDescription, { multiline: true, max: 300 })}
        ${page.bannerTitle !== null ? field(`bannerTitle:${page.id}`, 'Titre du bandeau', page.bannerTitle, { max: 120 }) : ''}
        ${page.bannerLead !== null ? field(`bannerLead:${page.id}`, 'Introduction du bandeau', page.bannerLead, { multiline: true, max: 400, hint: 'Un texte modifié remplace aussi les valeurs calculées automatiquement (horaires, groupes).' }) : ''}
      </details>`
      )
      .join('')}`;
}

async function render(env, admin, { message = '', error = '', status = 200 } = {}) {
  const state = await readSiteConfig(env, admin.organizationId);
  const badges = await adminBadges(env, admin);
  const config = state?.config;
  const pages = (config?.pages || []).filter((p) => p.id !== config.notFoundPage);
  const statusLine = !state
    ? 'Aucun site pour ce club.'
    : state.publishedAt
      ? `Publié le ${formatDateFr(state.publishedAt, { dateStyle: 'long', timeStyle: 'short' }) || state.publishedAt}${state.hasUnpublishedChanges ? ' · modifications non publiées' : ' · à jour'}`
      : 'Jamais publié';
  const body = `${adminHead('Site web')}
${adminShell({
  active: 'site',
  badges,
  eyebrow: 'Espace admin',
  title: 'Site web',
  subtitle: 'Modifiez les textes et les couleurs, vérifiez l’aperçu, puis publiez.',
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('eye')}État du site</h2>
    ${message ? flash('ok', message) : ''}
    ${error ? flash('error', error) : ''}
    <p class="adm-site-status${state?.hasUnpublishedChanges ? ' is-pending' : ''}">${escapeHtml(statusLine)}</p>
    ${
      config
        ? `<form method="GET" action="/admin/site/apercu" target="_blank" class="adm-site-preview">
      <label class="visually-hidden" for="preview-page">Page à prévisualiser</label>
      <select id="preview-page" name="page" class="adm-select">${pages.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.seo?.title?.split('|')[0].trim() || p.route)} (${escapeHtml(p.route)})</option>`).join('')}</select>
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('eye')}Aperçu du brouillon</button>
    </form>
    <form method="POST" class="admin-confirm-form adm-site-publish">
      <input type="hidden" name="action" value="publish"><input type="hidden" name="revision" value="${state.draftRevision}">
      <button type="submit" class="adm-btn adm-btn-primary"${state.hasUnpublishedChanges ? '' : ' disabled'} data-confirm="Publier ces modifications sur le site public ?">${icon('check')}Publier le site</button>
    </form>`
        : '<p class="adm-help">Le site de ce club n’a pas encore été créé. Contactez le support Licyo.</p>'
    }
  </section>
  ${
    config
      ? `<section class="adm-surface">
    <h2 class="adm-h2">${icon('edit')}Modifier le brouillon</h2>
    <p class="adm-help">Les modifications sont enregistrées en brouillon : le site public ne change qu’après « Publier le site ».</p>
    <form method="POST" class="adm-site-form">
      <input type="hidden" name="action" value="save"><input type="hidden" name="revision" value="${state.draftRevision}">
      <fieldset class="adm-site-group"><legend>Couleurs</legend>${colorFields(config.starter?.colors || config.theme?.colors)}</fieldset>
      ${config.starter ? starterForm(config) : customForm(config)}
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary" data-once>${icon('check')}Enregistrer le brouillon</button></div>
    </form>
  </section>`
      : ''
  }
</main>
${adminScripts('admin-nav')}
</body></html>`;
  return html(body, status);
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  await ensureSchema(env.DB);
  return render(env, admin);
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  await ensureSchema(env.DB);
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const revision = Number.parseInt(String(form.get('revision') || ''), 10);
  try {
    if (action === 'save') {
      const state = await readSiteConfig(env, admin.organizationId);
      if (!state?.config) return render(env, admin, { error: 'Aucun site pour ce club.', status: 404 });
      if (revision !== state.draftRevision) throw new ConfigConflictError();
      const organization = await loadOrganization(env, admin.organizationId);
      const next = applyEdits(state.config, form, { organizationId: admin.organizationId, slug: organization?.slug || 'club', siteUrl: new URL(request.url).origin });
      await saveDraftSiteConfig(env, admin.organizationId, next, { expectedRevision: revision });
      // Site de départ : nom et coordonnées publiques du club suivent le profil (affichés par le site en ligne).
      if (next.starter) await syncOrganizationContact(env, admin.organizationId, next.starter);
      return render(env, admin, { message: 'Brouillon enregistré. Vérifiez l’aperçu, puis publiez.' });
    }
    if (action === 'publish') {
      await publishSiteConfig(env, admin.organizationId, { expectedRevision: revision });
      return render(env, admin, { message: 'Site publié. Il est en ligne dans la minute.' });
    }
  } catch (error) {
    if (error instanceof SiteEditError) return render(env, admin, { error: error.message, status: 400 });
    if (error instanceof ConfigConflictError) return render(env, admin, { error: 'Le site a été modifié entre-temps (autre onglet ou autre responsable). Rechargez la page et recommencez.', status: 409 });
    if (error instanceof SiteConfigValidationError) return render(env, admin, { error: `Le brouillon ne peut pas être publié : ${String(error.message).split('\n').slice(0, 4).join(' ')}`, status: 400 });
    throw error;
  }
  return render(env, admin, { error: 'Action inconnue.', status: 400 });
}
