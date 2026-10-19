// Gestion des catégories d'âge (U6-U7, U8-U9...), du tarif, des lieux et des créneaux (D1, source de vérité :
// _shared/public-data.js) et de la saison en cours (KV, _shared/settings-kv.js). Le KV garde en plus une copie
// des catégories pour Sportville seulement (compatibilité / retour arrière). Ajoutée pour que le
// club puisse ouvrir une nouvelle saison (nouvelles tranches de naissance, nouveaux liens HelloAsso)
// ou créer une nouvelle catégorie sans session Claude Code — voir CLAUDE.md. Consommée par :
// - functions/api/categories.js (public, alimente le <select> d'inscription.html) ;
// - functions/admin/inscriptions/[id].js (select catégorie du formulaire d'édition, libellé de
//   saison et tarif injectés dans le PDF régénéré depuis la fiche) ;
// - functions/_shared/confirmation-email.js (libellé de saison dans l'e-mail de confirmation).
// L'action "Archiver les saisons précédentes" (onRequestPost, archive-previous-seasons) compare le
// libellé de saison courant à la colonne D1 "saison" (_shared/inscriptions-db.js), écrite à
// l'inscription par functions/api/inscriptions.js.
// Le champ "categorie" stocké en base D1 reste le libellé texte (ex. "U6 - U7"), pas l'id interne
// ci-dessous : renommer une catégorie ne modifie donc pas les inscriptions déjà enregistrées (comme
// pour le filtre "année de naissance", dérivé des données existantes plutôt que d'une liste figée).
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash } from '../_shared/admin-auth.js';
import { getCategoriesConfig, setCategoriesConfig } from '../_shared/settings-kv.js';
import { ensureInscriptionsTable } from '../_shared/inscriptions-db.js';
import {
  getAdminPublicData,
  saveLocation,
  deleteLocation,
  saveSchedule,
  deleteSchedule,
  weekdayLabel,
  ConfigConflictError,
} from '../_shared/public-data.js';

function slugify(label) {
  const base = String(label)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'categorie';
}

// Rappel visuel (pas d'e-mail automatique : ce projet est une Pages Function sans wrangler.toml/
// Cron Trigger, une automatisation par e-mail programmée serait un chantier d'infra à part — voir
// la discussion avec l'utilisateur). Fenêtre du 1er mai au 31 août de l'année de fin de la saison
// enregistrée (ex. mai-août 2027 pour "2026-2027") : la saison se termine en juin, les inscriptions
// de la suivante démarrent juste après pour l'anticiper (voir CLAUDE.md). Se recale tout seul
// l'année suivante dès que l'admin met à jour le libellé de saison ci-dessous — pas d'état à
// stocker ni de "ne plus afficher" à gérer.
function seasonEndYear(saison) {
  const match = /(\d{4})\s*-\s*(\d{4})/.exec(saison || '');
  return match ? Number(match[2]) : null;
}

function showSeasonReminder(saison) {
  const endYear = seasonEndYear(saison);
  if (!endYear) return false;
  const now = Date.now();
  const start = Date.UTC(endYear, 4, 1);
  const end = Date.UTC(endYear, 7, 31, 23, 59, 59);
  return now >= start && now <= end;
}

function uniqueId(base, existingIds) {
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function categoryCard(c, { isFirst, isLast }) {
  const id = escapeHtml(c.id);
  return `<section class="adm-surface">
    <div class="adm-surface-head">
      <h3 class="adm-h3">${escapeHtml(c.label)}</h3>
      <span class="adm-tag ${c.active ? 'is-yes' : 'is-neutral'}">${c.active ? `${icon('check')}Active` : 'Inactive'}</span>
    </div>
    <form method="POST">
      <input type="hidden" name="id" value="${id}">
      <div class="form-row">
        <div class="form-field">
          <label for="label-${id}">Nom de la catégorie</label>
          <input type="text" id="label-${id}" name="label" value="${escapeHtml(c.label)}" required maxlength="40">
        </div>
        <div class="form-field adm-check-field">
          <label class="adm-check"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}><span>Catégorie active (visible sur le formulaire d'inscription)</span></label>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="annee-min-${id}">Naissance — année la plus ancienne</label>
          <input type="number" id="annee-min-${id}" name="anneeMin" value="${c.anneeMin ?? ''}" required min="2000" max="2100">
        </div>
        <div class="form-field">
          <label for="annee-max-${id}">Naissance — année la plus récente</label>
          <input type="number" id="annee-max-${id}" name="anneeMax" value="${c.anneeMax ?? ''}" required min="2000" max="2100">
        </div>
      </div>
      <div class="form-field">
        <label for="ha-url-${id}">Lien de paiement HelloAsso (onglet « Diffuser » → Bouton &amp; widget → lien classique)</label>
        <input type="url" id="ha-url-${id}" name="helloAssoUrl" value="${escapeHtml(c.helloAssoUrl || '')}" placeholder="https://www.helloasso.com/beta/associations/...">
      </div>
      <div class="form-field">
        <label for="ha-widget-${id}">Lien widget HelloAsso (même onglet, sans « /beta », se terminant par « /widget »)</label>
        <input type="url" id="ha-widget-${id}" name="helloAssoWidgetUrl" value="${escapeHtml(c.helloAssoWidgetUrl || '')}" placeholder="https://www.helloasso.com/associations/.../widget">
      </div>
      <div class="adm-form-actions">
        <button type="submit" name="action" value="update" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button>
        ${!isFirst ? '<button type="submit" name="action" value="move-up" class="adm-btn adm-btn-sm adm-btn-ghost" formnovalidate>&uarr; Monter</button>' : ''}
        ${!isLast ? '<button type="submit" name="action" value="move-down" class="adm-btn adm-btn-sm adm-btn-ghost" formnovalidate>&darr; Descendre</button>' : ''}
      </div>
    </form>
    <hr class="adm-divider">
    <form method="POST" class="admin-confirm-form">
      <input type="hidden" name="action" value="delete">
      <input type="hidden" name="id" value="${id}">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-danger" data-confirm="Supprimer la catégorie « ${escapeHtml(c.label)} » ? Les inscriptions déjà enregistrées avec cette catégorie ne seront pas modifiées, mais elle disparaîtra du formulaire d'inscription et des filtres.">${icon('trash')}Supprimer la catégorie</button>
    </form>
  </section>`;
}

// Lieux et créneaux d'entraînement (phase 2) : source de vérité des horaires affichés sur le site.
function venueSection(venue) {
  if (!venue) {
    return `<section class="adm-surface"><h2 class="adm-h2">${icon('calendar')}Lieux et horaires</h2><p class="adm-help" style="margin-top:8px;">Indisponible pour le moment (base de données injoignable).</p></section>`;
  }
  const option = (value, label, selected) => `<option value="${escapeHtml(String(value))}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const weekdayOptions = (current) => [1, 2, 3, 4, 5, 6, 7].map((d) => option(d, weekdayLabel(d).replace(/^./, (c) => c.toUpperCase()), d === current)).join('');
  const locationOptions = (current) => option('', 'Aucun lieu', !current) + venue.locations.map((l) => option(l.id, l.name, l.id === current)).join('');
  const groupOptions = (current) => option('', 'Tous les groupes', !current) + venue.groups.map((g) => option(g.id, g.name, g.id === current)).join('');
  const scheduleFields = (s, prefix) => `
      <div class="form-row adm-schedule-row">
        <div class="form-field"><label for="${prefix}-day">Jour</label><select id="${prefix}-day" name="weekday" required>${weekdayOptions(s?.weekday ?? 1)}</select></div>
        <div class="form-field"><label for="${prefix}-group">Groupe</label><select id="${prefix}-group" name="groupId">${groupOptions(s?.group_id)}</select></div>
        <div class="form-field"><label for="${prefix}-start">Début</label><input type="time" id="${prefix}-start" name="start" required value="${escapeHtml(s?.start_time || '')}"></div>
        <div class="form-field"><label for="${prefix}-end">Fin</label><input type="time" id="${prefix}-end" name="end" required value="${escapeHtml(s?.end_time || '')}"></div>
        <div class="form-field adm-field-wide"><label for="${prefix}-loc">Lieu</label><select id="${prefix}-loc" name="locationId">${locationOptions(s?.location_id)}</select></div>
      </div>`;
  const schedules = venue.schedules
    .map(
      (s) => `<div class="adm-venue-item">
      <form method="POST">
        <input type="hidden" name="action" value="save-schedule"><input type="hidden" name="id" value="${s.id}">
        ${scheduleFields(s, `sch-${s.id}`)}
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></div>
      </form>
      <form method="POST" class="admin-confirm-form">
        <input type="hidden" name="action" value="delete-schedule"><input type="hidden" name="id" value="${s.id}">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-danger" data-confirm="Supprimer ce créneau ? Il disparaîtra du site.">${icon('trash')}Supprimer</button>
      </form>
    </div>`
    )
    .join('');
  const locations = venue.locations
    .map(
      (l) => `<div class="adm-venue-item">
      <form method="POST">
        <input type="hidden" name="action" value="save-location"><input type="hidden" name="id" value="${l.id}">
        <div class="form-row">
          <div class="form-field"><label for="loc-${l.id}-name">Nom du lieu</label><input type="text" id="loc-${l.id}-name" name="name" required maxlength="80" value="${escapeHtml(l.name)}"></div>
          <div class="form-field"><label for="loc-${l.id}-addr">Adresse</label><input type="text" id="loc-${l.id}-addr" name="address" maxlength="200" value="${escapeHtml(l.address || '')}"></div>
        </div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></div>
      </form>
      <form method="POST" class="admin-confirm-form">
        <input type="hidden" name="action" value="delete-location"><input type="hidden" name="id" value="${l.id}">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-danger" data-confirm="Supprimer ce lieu ? Les créneaux qui s'y déroulent resteront, sans lieu.">${icon('trash')}Supprimer</button>
      </form>
    </div>`
    )
    .join('');
  return `<section class="adm-surface" id="horaires">
    <h2 class="adm-h2">${icon('calendar')}Horaires d'entraînement</h2>
    <p class="adm-help" style="margin-top:8px;">Les créneaux affichés sur le site (pages Accueil, Entraînements, Le club, Inscription, Contact). « Tous les groupes » : créneau commun à toutes les catégories.</p>
    ${schedules || '<p class="adm-help">Aucun créneau enregistré.</p>'}
    <details class="adm-venue-add">
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Ajouter un créneau</summary>
      <form method="POST">
        <input type="hidden" name="action" value="add-schedule">
        ${scheduleFields(null, 'new-sch')}
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('plus')}Ajouter le créneau</button></div>
      </form>
    </details>
  </section>

  <section class="adm-surface" id="lieux">
    <h2 class="adm-h2">${icon('tag')}Lieux</h2>
    ${locations || '<p class="adm-help" style="margin-top:8px;">Aucun lieu enregistré.</p>'}
    <details class="adm-venue-add">
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Ajouter un lieu</summary>
      <form method="POST">
        <input type="hidden" name="action" value="add-location">
        <div class="form-row">
          <div class="form-field"><label for="new-loc-name">Nom du lieu</label><input type="text" id="new-loc-name" name="name" required maxlength="80" placeholder="Gymnase…"></div>
          <div class="form-field"><label for="new-loc-addr">Adresse</label><input type="text" id="new-loc-addr" name="address" maxlength="200"></div>
        </div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('plus')}Ajouter le lieu</button></div>
      </form>
    </details>
  </section>`;
}

// Chaque formulaire renvoie la version de la configuration affichée : si quelqu'un d'autre l'a modifiée
// entre-temps, l'enregistrement est refusé (voir writeGroupsConfig) au lieu d'écraser sa modification.
function page(props) {
  const html = renderPage(props);
  const version = props.config.configVersion;
  return Number.isInteger(version)
    ? html.replace(/<form method="POST"([^>]*)>/g, (form) => `${form}<input type="hidden" name="configVersion" value="${version}">`)
    : html;
}

function renderPage({ config, venue, error, ok, archivedMessage, badges }) {
  const cards = config.categories.map((c, i) => categoryCard(c, { isFirst: i === 0, isLast: i === config.categories.length - 1 })).join('');

  return `${adminHead('Catégories et horaires')}
${adminShell({
  active: 'categories',
  badges,
  eyebrow: `Saison ${escapeHtml(config.saison)}`,
  title: 'Catégories et horaires',
  subtitle: "Catégories d'âge, tranches de naissance et liens de paiement HelloAsso du formulaire d'inscription — pour préparer la saison suivante sans coder.",
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${
    showSeasonReminder(config.saison)
      ? `<p class="adm-flash adm-flash-info" role="status">${icon('calendar')}<span>La saison <strong>${escapeHtml(config.saison)}</strong> touche à sa fin — c'est le bon moment pour préparer la suivante : mettre à jour le libellé de saison et le tarif ci-dessous, ajuster les tranches de naissance de chaque catégorie, demander les nouveaux liens HelloAsso au club si besoin, puis utiliser « Archiver les inscriptions des saisons précédentes » une fois la nouvelle saison enregistrée.</span></p>`
      : ''
  }
  ${error ? flash('error', error) : ''}
  ${archivedMessage ? flash('ok', archivedMessage) : ok ? flash('ok', 'Modifications enregistrées.') : ''}

  <section class="adm-surface">
    <h2 class="adm-h2">${icon('calendar')}Saison et tarif</h2>
    <form method="POST" id="saison-form">
      <input type="hidden" name="action" value="save-saison">
      <div class="form-row" style="margin-top:12px;">
        <div class="form-field">
          <label for="saison">Libellé de saison (ex. « 2026-2027 »)</label>
          <input type="text" id="saison" name="saison" value="${escapeHtml(config.saison)}" data-current-saison="${escapeHtml(config.saison)}" required maxlength="20" placeholder="2026-2027">
        </div>
        <div class="form-field">
          <label for="prix">Tarif de l'adhésion (€)</label>
          <input type="number" id="prix" name="prix" value="${config.prix ?? ''}" required min="0" max="9999" step="1">
        </div>
      </div>
      <p class="adm-help">Utilisés dans le formulaire d'inscription, le PDF et l'e-mail de confirmation (le tarif est unique pour toutes les catégories). Changer le libellé de saison fait automatiquement basculer tous les adhérents actuels dans <a href="/admin/reinscription">Réinscription</a> — une confirmation vous sera demandée. Les pages « Entraînements » et « Le Club » (equipe.html) contiennent aussi des tranches de naissance et la saison en toutes lettres dans leur texte — ce contenu éditorial reste à mettre à jour à la main chaque saison, il n'est pas piloté par cette page.</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
    ${
      config.previousSaison && config.previousSaison !== config.saison
        ? `<hr class="adm-divider">
    <form method="POST" class="admin-confirm-form">
      <input type="hidden" name="action" value="revert-saison">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Revenir à la saison « ${escapeHtml(config.previousSaison)} » ? La saison actuelle (« ${escapeHtml(config.saison)} ») redeviendra « saison précédente » — vous pourrez y revenir de la même façon. Le tarif et les tranches de naissance déjà modifiés depuis ne sont pas annulés.">${icon('arrowLeft')}Revenir à la saison « ${escapeHtml(config.previousSaison)} »</button>
    </form>`
        : ''
    }
  </section>

  <section class="adm-surface">
    <h2 class="adm-h2">${icon('refresh')}Réinscription prioritaire</h2>
    <p class="adm-help" style="margin-top:8px;">Une fois la nouvelle saison et la date limite enregistrées, tout le pilotage de la campagne (liste des familles à contacter, envoi du lien, rappels) se fait sur la page <a href="/admin/reinscription">Réinscription</a> — pas ici. Tant que la date limite n'est pas atteinte et que les inscriptions sont fermées, le site public affiche « réinscription prioritaire en cours » plutôt qu'un simple « fermé ». Une fois la date atteinte, <strong>le formulaire public se rouvre automatiquement</strong> — inutile de cliquer sur « Rouvrir » dans Inscriptions, sauf pour rouvrir plus tôt.</p>
    <div class="adm-inline-forms">
      <form method="POST">
        <input type="hidden" name="action" value="save-deadline">
        <div class="form-field">
          <label for="date-limite">Date limite de réinscription prioritaire</label>
          <input type="date" id="date-limite" name="dateLimiteReinscription" value="${escapeHtml(config.dateLimiteReinscription || '')}">
        </div>
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer la date</button>
      </form>
      ${
        config.dateLimiteReinscription
          ? `<form method="POST">
        <input type="hidden" name="action" value="save-deadline">
        <input type="hidden" name="dateLimiteReinscription" value="">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Retirer la date</button>
      </form>`
          : ''
      }
    </div>
    <hr class="adm-divider">
    <a href="/admin/reinscription" class="adm-btn adm-btn-sm adm-btn-ghost">Aller à la réinscription →</a>
  </section>

  <section class="adm-surface">
    <h2 class="adm-h2">${icon('lock')}Fermeture automatique des inscriptions</h2>
    <p class="adm-help" style="margin-top:8px;">À partir de la date choisie, le formulaire d'inscription public se ferme tout seul — même si les inscriptions sont « ouvertes » dans Inscriptions. Pour rouvrir ensuite, retirez ou repoussez la date.</p>
    <div class="adm-inline-forms">
      <form method="POST">
        <input type="hidden" name="action" value="save-fermeture">
        <div class="form-field">
          <label for="date-fermeture">Date de fermeture automatique</label>
          <input type="date" id="date-fermeture" name="dateFermetureInscriptions" value="${escapeHtml(config.dateFermetureInscriptions || '')}">
        </div>
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer la date</button>
      </form>
      ${
        config.dateFermetureInscriptions
          ? `<form method="POST">
        <input type="hidden" name="action" value="save-fermeture">
        <input type="hidden" name="dateFermetureInscriptions" value="">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Retirer la date</button>
      </form>`
          : ''
      }
    </div>
  </section>

  ${venueSection(venue)}
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('archive')}Fin de saison</h2>
    <p class="adm-help" style="margin-top:8px;">Dernière étape, une fois la campagne de réinscription bien avancée (pas besoin d'attendre que 100% aient répondu — les retardataires restent visibles sur la page Réinscription même après archivage) : cette action déplace vers la corbeille (récupérable) toutes les inscriptions actives rattachées à une saison différente de « ${escapeHtml(config.saison)} » — pratique pour repartir propre sur le tableau de bord et les filtres sans perdre l'historique. Les inscriptions créées avant l'ajout de cette fonctionnalité (sans saison enregistrée) sont considérées comme faisant partie de la saison en cours et ne sont jamais touchées.</p>
    <form method="POST" class="admin-confirm-form">
      <input type="hidden" name="action" value="archive-previous-seasons">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Archiver toutes les inscriptions actives d'une saison autre que ${escapeHtml(config.saison)} ? Elles resteront consultables et récupérables depuis la Corbeille.">${icon('archive')}Archiver les inscriptions des saisons précédentes</button>
    </form>
  </section>

  <div class="adm-section-head"><h2 class="adm-h2">${icon('tag')}Catégories <span class="adm-count">${config.categories.length}</span></h2></div>
  ${cards}

  <form method="POST" class="adm-surface">
    <h2 class="adm-h2">${icon('plus')}Ajouter une catégorie</h2>
    <input type="hidden" name="action" value="add">
    <div class="form-field" style="margin-top:12px;">
      <label for="new-label">Nom de la catégorie</label>
      <input type="text" id="new-label" name="label" placeholder="U10 - U11" required maxlength="40">
    </div>
    <div class="form-row">
      <div class="form-field">
        <label for="new-annee-min">Naissance — année la plus ancienne</label>
        <input type="number" id="new-annee-min" name="anneeMin" required min="2000" max="2100" placeholder="2016">
      </div>
      <div class="form-field">
        <label for="new-annee-max">Naissance — année la plus récente</label>
        <input type="number" id="new-annee-max" name="anneeMax" required min="2000" max="2100" placeholder="2017">
      </div>
    </div>
    <div class="form-field">
      <label for="new-ha-url">Lien de paiement HelloAsso (facultatif, à compléter dès qu'il existe)</label>
      <input type="url" id="new-ha-url" name="helloAssoUrl" placeholder="https://www.helloasso.com/beta/associations/...">
    </div>
    <div class="form-field">
      <label for="new-ha-widget">Lien widget HelloAsso (facultatif)</label>
      <input type="url" id="new-ha-widget" name="helloAssoWidgetUrl" placeholder="https://www.helloasso.com/associations/.../widget">
    </div>
    <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('plus')}Ajouter la catégorie</button></div>
  </form>
</main>
${adminScripts('admin-nav', 'admin-categories')}
</body></html>`;
}

function parseCategoryFields(form) {
  const label = String(form.get('label') || '').trim();
  const anneeMin = Number(form.get('anneeMin'));
  const anneeMax = Number(form.get('anneeMax'));
  const helloAssoUrl = String(form.get('helloAssoUrl') || '').trim();
  const helloAssoWidgetUrl = String(form.get('helloAssoWidgetUrl') || '').trim();

  if (!label) return { error: 'Le nom de la catégorie est obligatoire.' };
  if (!Number.isInteger(anneeMin) || !Number.isInteger(anneeMax) || anneeMin < 2000 || anneeMax > 2100) {
    return { error: 'Les années de naissance doivent être des nombres entiers valides.' };
  }
  if (anneeMin > anneeMax) {
    return { error: "L'année la plus ancienne doit être inférieure ou égale à l'année la plus récente." };
  }
  if (helloAssoUrl && !/^https:\/\//.test(helloAssoUrl)) {
    return { error: 'Le lien de paiement HelloAsso doit commencer par https://.' };
  }
  if (helloAssoWidgetUrl && !/^https:\/\//.test(helloAssoWidgetUrl)) {
    return { error: 'Le lien widget HelloAsso doit commencer par https://.' };
  }

  return { fields: { label, anneeMin, anneeMax, helloAssoUrl, helloAssoWidgetUrl } };
}

async function render(env, organizationId, props, status = 200) {
  let venue = null;
  try {
    venue = await getAdminPublicData(env, organizationId);
  } catch {
    // base injoignable : la section l'indique, le reste de la page fonctionne
  }
  const badges = await adminBadges(env, { organizationId });
  return new Response(page({ ...props, venue, badges }), { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }
  const config = await getCategoriesConfig(env, admin.organizationId);
  return render(env, admin.organizationId, { config });
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const config = await getCategoriesConfig(env, admin.organizationId);
  const form = await request.formData();
  const action = form.get('action');

  const withError = (error, status = 400) =>
    render(env, admin.organizationId, { config, error }, status);

  // Version de la configuration que l'administrateur a sous les yeux (champ caché du formulaire), à défaut
  // celle lue au début de cette requête (qui protège au moins de deux requêtes simultanées).
  const submitted = Number.parseInt(String(form.get('configVersion') ?? ''), 10);
  const expectedVersion = Number.isInteger(submitted) ? submitted : config.configVersion;
  const persist = async (nextConfig) => {
    try {
      await setCategoriesConfig(env, admin.organizationId, nextConfig, { expectedVersion });
    } catch (error) {
      if (!(error instanceof ConfigConflictError)) throw error;
      const current = await getCategoriesConfig(env, admin.organizationId);
      return render(env, admin.organizationId, { config: current, error: 'Ces réglages ont été modifiés par quelqu’un d’autre pendant que vous les consultiez. Rien n’a été enregistré : la page affiche maintenant la version à jour, refaites votre modification.' }, 409);
    }
    return render(env, admin.organizationId, { config: await getCategoriesConfig(env, admin.organizationId), ok: true });
  };

  if (action === 'save-saison') {
    const saison = String(form.get('saison') || '').trim();
    const prix = Number(form.get('prix'));
    if (!saison) return withError('Le libellé de saison est obligatoire.');
    if (!Number.isInteger(prix) || prix < 0 || prix > 9999) return withError('Le tarif doit être un nombre entier valide.');
    const nextConfig = { ...config, saison, prix };
    // Ne mémorise l'ancienne valeur que si la saison change réellement (pas à chaque modification
    // du tarif seul) — voir action=revert-saison ci-dessous et le bouton "Revenir à la saison
    // précédente" du formulaire.
    if (saison !== config.saison) nextConfig.previousSaison = config.saison;
    return persist(nextConfig);
  }

  // Échange saison et previousSaison — un aller-retour reste toujours possible (pas seulement
  // l'annulation d'un seul changement), donc pas de risque à cliquer deux fois par erreur.
  if (action === 'revert-saison') {
    if (!config.previousSaison) return withError('Aucune saison précédente enregistrée.');
    const nextConfig = { ...config, saison: config.previousSaison, previousSaison: config.saison };
    return persist(nextConfig);
  }

  if (action === 'save-deadline') {
    const value = String(form.get('dateLimiteReinscription') || '').trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return withError('Date invalide.');
    const nextConfig = { ...config, dateLimiteReinscription: value || null };
    return persist(nextConfig);
  }

  if (action === 'save-fermeture') {
    const value = String(form.get('dateFermetureInscriptions') || '').trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return withError('Date invalide.');
    const nextConfig = { ...config, dateFermetureInscriptions: value || null };
    return persist(nextConfig);
  }

  if (action === 'add') {
    const { error, fields } = parseCategoryFields(form);
    if (error) return withError(error);
    const id = uniqueId(slugify(fields.label), config.categories.map((c) => c.id));
    const nextConfig = { ...config, categories: [...config.categories, { id, ...fields, active: true }] };
    return persist(nextConfig);
  }

  if (action === 'update') {
    const id = form.get('id');
    const { error, fields } = parseCategoryFields(form);
    if (error) return withError(error);
    const active = form.get('active') === 'on';
    const nextConfig = {
      ...config,
      categories: config.categories.map((c) => (c.id === id ? { ...c, ...fields, active } : c)),
    };
    return persist(nextConfig);
  }

  if (action === 'delete') {
    const id = form.get('id');
    const nextConfig = { ...config, categories: config.categories.filter((c) => c.id !== id) };
    return persist(nextConfig);
  }

  // Lieux et créneaux (phase 2) : organisation de la session, références vérifiées dans public-data.js.
  const venueActions = {
    'add-location': () => saveLocation(env, admin.organizationId, null, Object.fromEntries(form)),
    'save-location': () => saveLocation(env, admin.organizationId, Number(form.get('id')), Object.fromEntries(form)),
    'delete-location': () => deleteLocation(env, admin.organizationId, Number(form.get('id'))),
    'add-schedule': () => saveSchedule(env, admin.organizationId, null, Object.fromEntries(form)),
    'save-schedule': () => saveSchedule(env, admin.organizationId, Number(form.get('id')), Object.fromEntries(form)),
    'delete-schedule': () => deleteSchedule(env, admin.organizationId, Number(form.get('id'))),
  };
  if (action in venueActions) {
    const result = await venueActions[action]();
    return result.error ? withError(result.error) : render(env, admin.organizationId, { config, ok: true });
  }

  if (action === 'archive-previous-seasons') {
    await ensureInscriptionsTable(env.DB);
    // saison IS NOT NULL AND != '' : une fiche sans saison enregistrée date d'avant l'ajout de
    // cette colonne (voir _shared/inscriptions-db.js) — traitée comme "saison en cours", jamais
    // archivée automatiquement par erreur.
    const { results } = await env.DB.prepare(
      "SELECT id FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL AND saison IS NOT NULL AND saison != '' AND saison != ?"
    )
      .bind(admin.organizationId, config.saison)
      .all();
    for (const row of results) {
      await env.DB.prepare("UPDATE inscriptions SET archived_at = datetime('now'), archive_motif = 'fin_saison', archive_commentaire = NULL WHERE organization_id = ? AND id = ?")
        .bind(admin.organizationId, row.id)
        .run();
    }
    const archivedMessage = results.length
      ? `${results.length} inscription${results.length > 1 ? 's' : ''} d'une saison précédente archivée${results.length > 1 ? 's' : ''}.`
      : "Aucune inscription d'une saison précédente à archiver.";
    return render(env, admin.organizationId, { config, archivedMessage });
  }

  if (action === 'move-up' || action === 'move-down') {
    const id = form.get('id');
    const categories = [...config.categories];
    const index = categories.findIndex((c) => c.id === id);
    const swapWith = action === 'move-up' ? index - 1 : index + 1;
    if (index === -1 || swapWith < 0 || swapWith >= categories.length) {
      return render(env, admin.organizationId, { config });
    }
    [categories[index], categories[swapWith]] = [categories[swapWith], categories[index]];
    const nextConfig = { ...config, categories };
    return persist(nextConfig);
  }

  return render(env, admin.organizationId, { config });
}
