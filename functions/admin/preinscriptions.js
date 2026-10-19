// Pré-inscriptions (liste d'intérêt d'un groupe pas encore ouvert, voir _shared/preinscriptions.js) : compteur
// « X / plafond », liste des familles, export CSV, suppression d'une ligne, réglages (ouvert/fermé, plafond, années).
// Tout est filtré par l'organisation de la session ; le jeton CSRF est injecté dans les formulaires par le middleware.
import { SHIRT_SIZES, ensureInscriptionsTable, ageGroup } from '../_shared/inscriptions-db.js';
import { openPreinscriptionGroupIfFull } from '../_shared/preinscription-opening.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr, formatBirth, avatar } from '../_shared/admin-auth.js';
import {
  ensurePreinscriptionsTable,
  getPreinscriptionConfig,
  setPreinscriptionConfig,
  listPreinscriptions,
  deletePreinscription,
  updatePreinscriptionBirthPlace,
  updatePreinscriptionSize,
  cleanBirthPlace,
  preinscriptionDedupKey,
  MAX_CAPACITY,
  MAX_BIRTHPLACE_LENGTH,
  loadAgeContext,
} from '../_shared/preinscriptions.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const redirect = (query) => new Response('', { status: 303, headers: { Location: `/admin/preinscriptions${query ? `?${query}` : ''}` } });

// Une cellule qui commence par = + - @ serait interprétée comme une formule par un tableur.
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

function csv(rows, config) {
  const header = ['N°', 'Date', 'Prénom enfant', 'Nom enfant', 'Naissance', 'Ville de naissance', 'Pays de naissance', 'Taille de tenue', 'Prénom parent', 'Nom parent', 'E-mail', 'Téléphone',
    'Prénom 2e responsable', 'Nom 2e responsable', 'E-mail 2e responsable', 'Téléphone 2e responsable', 'Message'];
  const lines = rows.map((r, i) =>
    [i + 1, r.created_at, r.enfant_prenom, r.enfant_nom, r.naissance, r.ville_naissance || '', r.pays_naissance || '', r.taille_maillot || '', r.parent_prenom, r.parent_nom, r.email, r.telephone,
      r.parent2_prenom || '', r.parent2_nom || '', r.parent2_email || '', r.parent2_telephone || '', r.commentaire || '']
      .map(csvCell)
      .join(';')
  );
  return new Response(`﻿${[header.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv;charset=UTF-8',
      'Content-Disposition': `attachment; filename="preinscriptions-${config.groupe.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

const MESSAGES = {
  saved: ['ok', 'Réglages enregistrés.'],
  opened: ['ok', 'Réglages enregistrés : les places sont prises, le groupe est ouvert et les familles ont été invitées à s’inscrire.'],
  deleted: ['ok', 'Pré-inscription supprimée.'],
  transfert: ['ok', "Inscription transférée dans la pré-inscription (la fiche d'inscription est conservée, lien sur la carte)."],
  retire: ['ok', "L'enfant était déjà dans la pré-inscription : sa fiche a été retirée des inscriptions (conservée, lien sur la carte)."],
  birthplace: ['ok', 'Fiche mise à jour.'],
  sizeInvalid: ['error', 'Choisissez une taille de maillot.'],
  birthplaceInvalid: ['error', 'Indiquez la ville et le pays de naissance (100 caractères au plus).'],
  invalid: ['error', 'Réglages invalides : vérifiez les années et le nombre de places.'],
  error: ['error', 'Opération impossible pour le moment. Réessayez.'],
};

function progress(count, capacity) {
  const pct = Math.min(100, Math.round((count / capacity) * 100));
  return `<div class="adm-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${capacity}" aria-valuenow="${count}" aria-label="Pré-inscrits">
      <span style="width:${pct}%"></span>
    </div>`;
}

// Informations manquantes d'une pré-inscription enregistrée avant l'ajout des champs (complétables sur la carte).
const missing = (r) => [!(r.ville_naissance && r.pays_naissance) && 'lieu de naissance', !r.taille_maillot && 'taille de tenue'].filter(Boolean).join(', ');


// Fiches d'inscription du même enfant (même prénom, nom et naissance) : { active, transferred } (ids) ou {}.
const inscriptionsOf = (r, links) => links.get(preinscriptionDedupKey({ enfantPrenom: r.enfant_prenom, enfantNom: r.enfant_nom, naissance: r.naissance })) || {};

async function inscriptionLinks(db, organizationId) {
  const { results } = await db
    .prepare("SELECT id, enfant_prenom, enfant_nom, naissance, archived_at, archive_motif FROM inscriptions WHERE organization_id = ? AND (archived_at IS NULL OR archive_motif = 'preinscription') ORDER BY id")
    .bind(organizationId)
    .all();
  const links = new Map();
  for (const row of results) {
    const key = preinscriptionDedupKey({ enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance });
    const entry = links.get(key) || {};
    if (row.archived_at) entry.transferred = row.id;
    else entry.active = row.id;
    links.set(key, entry);
  }
  return links;
}

const tel = (value) => escapeHtml(String(value || '').replace(/[^\d+]/g, ''));
const TODO = '<span class="adm-tag is-no">À compléter</span>';

// Carte compacte, sur le modèle des cartes d'Inscriptions : en-tête (initiales, nom, âge), lignes libellé / valeur,
// actions en bas ; le formulaire « Compléter / Modifier » reste replié.
function row(r, i, links, ageCtx) {
  const enfant = escapeHtml(`${r.enfant_prenom} ${r.enfant_nom}`);
  const age = ageGroup(r.naissance, ageCtx);
  const lieu = r.ville_naissance
    ? `${escapeHtml(r.ville_naissance)}${r.pays_naissance && r.pays_naissance !== 'France' ? ` <small>(${escapeHtml(r.pays_naissance)})</small>` : ''}`
    : TODO;
  const found = inscriptionsOf(r, links);
  const second =
    r.parent2_prenom || r.parent2_nom
      ? `<div class="adm-line"><span>2e responsable</span><span class="adm-line-value">${escapeHtml(`${r.parent2_prenom || ''} ${r.parent2_nom || ''}`.trim())}${
          r.parent2_telephone ? ` · <a href="tel:${tel(r.parent2_telephone)}">${escapeHtml(r.parent2_telephone)}</a>` : ''
        }</span></div>`
      : '';
  // Boutons de la carte : mobile = Appeler + E-mail, ordinateur = E-mail seul ; « E-mail » écrit depuis l'admin.
  const mails = [r.email, r.parent2_email].filter(Boolean).join(',');
  return `<li class="adm-card adm-prein">
    <div class="adm-card-top">
      ${avatar({ id: r.id, enfant_prenom: r.enfant_prenom, enfant_nom: r.enfant_nom })}
      <div class="adm-card-id">
        <h3>${enfant}</h3>
        <p>${age ? `<strong>${age}</strong> · ` : ''}né(e) le ${formatBirth(r.naissance)} · n° ${i + 1}</p>
      </div>
    </div>
    ${
      found.active
        ? `<p class="adm-prein-alert">${icon('alert')}<span>Aussi dans les inscriptions : <a class="adm-link" href="/admin/inscriptions/${found.active}">fiche n° ${found.active}</a> (doublon à retirer depuis la fiche)</span></p>`
        : ''
    }
    <div class="adm-lines">
      <div class="adm-line"><span>Tenue</span>${r.taille_maillot ? `<strong>${escapeHtml(r.taille_maillot)}</strong>` : TODO}</div>
      <div class="adm-line"><span>Lieu de naissance</span><span class="adm-line-value">${lieu}</span></div>
      <div class="adm-line"><span>Responsable</span><span class="adm-line-value">${escapeHtml(`${r.parent_prenom} ${r.parent_nom}`)}</span></div>
      ${r.telephone ? `<div class="adm-line adm-desk-only"><span>Téléphone</span><span class="adm-line-value">${escapeHtml(r.telephone)}</span></div>` : ''}
      ${mails ? `<div class="adm-line adm-desk-only"><span>E-mail</span><span class="adm-line-value">${escapeHtml(mails.replace(/,/g, ', '))}</span></div>` : ''}
      ${second}
      <div class="adm-line"><span>Pré-inscrit(e) le</span><span>${formatDateFr(r.created_at, { dateStyle: 'short' })}</span></div>
      ${r.invited_at ? `<div class="adm-line"><span>Invitée à s'inscrire</span><span class="adm-tag is-yes">${formatDateFr(r.invited_at, { dateStyle: 'short' })}</span></div>` : ''}
    </div>
    ${r.commentaire ? `<p class="adm-prein-comment">${escapeHtml(r.commentaire)}</p>` : ''}
    ${found.transferred ? `<a class="adm-link adm-prein-origin" href="/admin/inscriptions/${found.transferred}">${icon('file')}Fiche d'inscription d'origine</a>` : ''}
    <div class="adm-card-actions adm-contact-actions">
      ${r.telephone ? `<a class="adm-btn adm-btn-ghost adm-touch-only" href="tel:${tel(r.telephone)}">${icon('phone')}Appeler</a>` : ''}
      <a class="adm-btn adm-btn-ghost" href="/admin/email?preinscription=${Number(r.id)}">${icon('mail')}E-mail</a>
    </div>
    <div class="adm-prein-tools">
      <details class="adm-prein-edit">
        <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('edit')}${missing(r) ? 'Compléter la fiche' : 'Modifier'}</summary>
        <form method="POST" class="adm-prein-edit-form">
          <input type="hidden" name="action" value="birthplace">
          <input type="hidden" name="id" value="${r.id}">
          <div class="form-field"><label for="prein-pays-${r.id}">Pays de naissance</label>
            <input type="text" id="prein-pays-${r.id}" name="paysNaissance" value="${escapeHtml(r.pays_naissance || 'France')}" maxlength="${MAX_BIRTHPLACE_LENGTH}" required></div>
          <div class="form-field"><label for="prein-ville-${r.id}">Ville de naissance</label>
            <input type="text" id="prein-ville-${r.id}" name="villeNaissance" value="${escapeHtml(r.ville_naissance || '')}" maxlength="${MAX_BIRTHPLACE_LENGTH}" required></div>
          <div class="form-field"><label for="prein-taille-${r.id}">Taille de maillot</label>
            <select id="prein-taille-${r.id}" name="tailleMaillot" required>
              <option value="" disabled${r.taille_maillot ? '' : ' selected'}>Choisir une taille</option>
              ${SHIRT_SIZES.map((size) => `<option value="${size}"${r.taille_maillot === size ? ' selected' : ''}>${size}</option>`).join('')}
            </select></div>
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button>
        </form>
      </details>
      <form method="POST" class="admin-confirm-form">
        <input type="hidden" name="action" value="delete">
        <input type="hidden" name="id" value="${r.id}">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" aria-label="Supprimer la pré-inscription de ${enfant}" data-confirm="Supprimer définitivement la pré-inscription de ${enfant} ? Une place se libère sur le formulaire.">${icon('trash')}Supprimer</button>
      </form>
    </div>
  </li>`;
}

function settingsForm(config) {
  return `<section class="adm-surface" id="reglages">
    <h2 class="adm-h2">${icon('settings')}Réglages</h2>
    <form method="POST" class="adm-prein-settings">
      <input type="hidden" name="action" value="config">
      <label class="adm-check"><input type="checkbox" name="open" value="1"${config.open ? ' checked' : ''}><span>Formulaire ouvert sur le site</span></label>
      <div class="form-row">
        <div class="form-field">
          <label for="prein-label">Nom du groupe</label>
          <input type="text" id="prein-label" name="label" value="${escapeHtml(config.label)}" maxlength="40" required>
        </div>
        <div class="form-field">
          <label for="prein-capacity">Nombre de places</label>
          <input type="number" id="prein-capacity" name="capacity" value="${config.capacity}" min="1" max="${MAX_CAPACITY}" required>
        </div>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="prein-min">Naissance — année la plus ancienne</label>
          <input type="number" id="prein-min" name="anneeMin" value="${config.anneeMin}" min="2000" max="2100" required>
        </div>
        <div class="form-field">
          <label for="prein-max">Naissance — année la plus récente</label>
          <input type="number" id="prein-max" name="anneeMax" value="${config.anneeMax}" min="2000" max="2100" required>
        </div>
      </div>
      <p class="adm-help">Baisser le nombre de places ne supprime personne : le formulaire affiche simplement « complet ».</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
  </section>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const url = new URL(request.url);
  const config = await getPreinscriptionConfig(env, admin.organizationId);
  if (!config) {
    return html(`${adminHead('Pré-inscriptions')}
${adminShell({ active: 'preinscriptions', badges: await adminBadges(env, admin), eyebrow: 'Liste d’intérêt', title: 'Pré-inscriptions' })}
<main id="adm-main" class="adm-wrap adm-main"><section class="adm-surface"><p>Aucune pré-inscription n'est configurée pour votre club.</p></section></main>
${adminScripts('admin-nav')}
</body></html>`);
  }
  await ensurePreinscriptionsTable(env.DB);
  const rows = await listPreinscriptions(env.DB, admin.organizationId, config.groupe);
  await ensureInscriptionsTable(env.DB);
  const links = await inscriptionLinks(env.DB, admin.organizationId);
  const ageCtx = await loadAgeContext(env, admin.organizationId);
  if (url.searchParams.get('format') === 'csv') return csv(rows, config);

  const count = rows.length;
  const remaining = Math.max(0, config.capacity - count);
  const message = MESSAGES[url.searchParams.get('msg')];
  const status = config.openedAt ? 'Groupe ouvert' : !config.open ? 'Fermé' : remaining ? 'Ouvert' : 'Complet';
  const emails = [...new Set(rows.flatMap((r) => [r.email, r.parent2_email].filter(Boolean)))];
  const years = config.anneeMin === config.anneeMax ? `nés en ${config.anneeMin}` : `nés de ${config.anneeMin} à ${config.anneeMax}`;

  return html(`${adminHead('Pré-inscriptions')}
${adminShell({
  active: 'preinscriptions',
  badges: await adminBadges(env, admin),
  eyebrow: 'Liste d’intérêt',
  title: `Pré-inscriptions ${escapeHtml(config.label)}`,
  subtitle: `Enfants ${escapeHtml(years)}. Sans paiement ni dossier : vous recontactez les familles à l'ouverture du groupe.`,
  stats: [
    { value: `${count}<small> / ${config.capacity}</small>`, label: 'Pré-inscrits' },
    { value: String(remaining), label: remaining > 1 ? 'Places restantes' : 'Place restante' },
    { value: escapeHtml(status), label: 'Formulaire' },
  ],
})}
<main id="adm-main" class="adm-wrap adm-main">
  <section class="adm-surface">
    <div class="adm-surface-head">
      <h2 class="adm-h2">${icon('users')}${count} enfant${count > 1 ? 's' : ''} sur ${config.capacity}</h2>
      <a href="/pre-inscription-u10" class="adm-btn adm-btn-sm adm-btn-ghost" target="_blank" rel="noopener">${icon('eye')}Voir le formulaire</a>
    </div>
    ${message ? flash(message[0], message[1]) : ''}
    ${
      config.openedAt
        ? `<p class="adm-prein-opened">${icon('check')}<span><strong>Groupe ${escapeHtml(config.label)} ouvert le ${formatDateFr(config.openedAt.slice(0, 19).replace('T', ' '), { dateStyle: 'long' })}</strong> : c'est désormais une <a class="adm-link" href="/admin/categories">catégorie d'inscription</a> comme les autres et chaque famille a reçu un lien pour l'inscription définitive. Les inscriptions arrivent dans <a class="adm-link" href="/admin/inscriptions">Inscriptions</a>.</span></p>`
        : `<p class="adm-help">Dès que les ${config.capacity} places sont prises, le groupe devient automatiquement une catégorie d'inscription et chaque famille reçoit un lien pour s'inscrire.</p>`
    }
    ${progress(count, config.capacity)}
    <div class="adm-form-actions">
      ${count ? `<a href="?format=csv" class="adm-btn adm-btn-sm">${icon('download')}Exporter en CSV</a>` : ''}
      ${emails.length ? `<a href="/admin/email?groupe=preinscriptions" class="adm-btn adm-btn-sm">${icon('send')}Écrire à toutes les familles</a>
      <button type="button" class="adm-btn adm-btn-sm adm-desk-only" data-copy="${escapeHtml(emails.join(', '))}" data-copied="E-mails copiés">${icon('send')}Copier les e-mails</button>` : ''}
    </div>
  </section>
  ${count ? `<ol class="adm-cards adm-prein-list">${rows.map((r, i) => row(r, i, links, ageCtx)).join('')}</ol>` : '<section class="adm-surface"><p class="adm-help">Aucune pré-inscription pour le moment.</p></section>'}
  ${settingsForm(config)}
</main>
${adminScripts('admin-nav')}
</body></html>`);
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const form = await request.formData();
  const action = form.get('action');
  try {
    const config = await getPreinscriptionConfig(env, admin.organizationId);
    if (!config) return redirect('msg=error');
    if (action === 'delete') {
      const id = Number.parseInt(String(form.get('id') || ''), 10);
      if (!Number.isInteger(id) || id <= 0) return redirect('msg=error');
      await ensurePreinscriptionsTable(env.DB);
      return redirect((await deletePreinscription(env.DB, admin.organizationId, id)) ? 'msg=deleted' : 'msg=error');
    }
    if (action === 'birthplace') {
      const id = Number.parseInt(String(form.get('id') || ''), 10);
      const villeNaissance = cleanBirthPlace(form.get('villeNaissance'));
      const paysNaissance = cleanBirthPlace(form.get('paysNaissance'));
      if (!Number.isInteger(id) || id <= 0) return redirect('msg=error');
      if (!villeNaissance || !paysNaissance) return redirect('msg=birthplaceInvalid');
      const tailleMaillot = String(form.get('tailleMaillot') || '');
      if (!SHIRT_SIZES.includes(tailleMaillot)) return redirect('msg=sizeInvalid');
      await ensurePreinscriptionsTable(env.DB);
      const ok = await updatePreinscriptionBirthPlace(env.DB, admin.organizationId, id, { villeNaissance, paysNaissance });
      if (ok) await updatePreinscriptionSize(env.DB, admin.organizationId, id, tailleMaillot);
      return redirect(ok ? 'msg=birthplace' : 'msg=error');
    }
    if (action === 'config') {
      const int = (name) => Number.parseInt(String(form.get(name) || ''), 10);
      try {
        await setPreinscriptionConfig(env, admin.organizationId, {
          ...config,
          open: form.get('open') === '1',
          label: String(form.get('label') || '').trim(),
          capacity: int('capacity'),
          anneeMin: int('anneeMin'),
          anneeMax: int('anneeMax'),
        });
      } catch {
        return redirect('msg=invalid');
      }
      // Plafond abaissé au nombre d'inscrits : même ouverture automatique que la dernière place prise.
      const opening = await openPreinscriptionGroupIfFull(env, admin.organizationId, new URL(request.url).origin).catch(() => null);
      return redirect(opening?.status === 'opened' && opening.invited ? 'msg=opened' : 'msg=saved');
    }
  } catch {
    return redirect('msg=error');
  }
  return redirect('msg=error');
}
