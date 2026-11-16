// Pré-inscriptions (liste d'intérêt d'un groupe pas encore ouvert, voir _shared/preinscriptions.js) : compteur
// « X / plafond », liste des familles, export CSV, suppression d'une ligne, réglages (ouvert/fermé, plafond, années).
// Tout est filtré par l'organisation de la session ; le jeton CSRF est injecté dans les formulaires par le middleware.
import { SHIRT_SIZES, ensureInscriptionsTable, ageGroup } from '../_shared/inscriptions-db.js';
import { openPreinscriptionGroupIfFull, inviteWaitingFamily, activeCategoryFor } from '../_shared/preinscription-opening.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr, formatBirth, avatar, phoneLinks, cpLookupButton } from '../_shared/admin-auth.js';
import {
  ensurePreinscriptionsTable,
  getPreinscriptionGroups,
  setPreinscriptionGroups,
  newGroupKey,
  countByGroup,
  MAX_GROUPS,
  listAllPreinscriptions,
  deletePreinscription,
  updatePreinscriptionBirthPlace,
  updatePreinscriptionSize,
  cleanBirthPlace,
  cleanBirthPostcode,
  preinscriptionDedupKey,
  MAX_CAPACITY,
  MAX_BIRTHPLACE_LENGTH,
  INVITE_DAYS,
  loadAgeContext,
} from '../_shared/preinscriptions.js';
import { planTransfer, transferPreinscriptions, parseIds } from '../_shared/preinscription-transfer.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const redirect = (query) => new Response('', { status: 303, headers: { Location: `/admin/preinscriptions${query ? `?${query}` : ''}` } });

// Une cellule qui commence par = + - @ serait interprétée comme une formule par un tableur.
const csvCell = (value) => {
  const text = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

function csv(rows, config, labels = null) {
  const header = [...(labels ? ['Groupe'] : []), 'N°', 'Date', 'Prénom enfant', 'Nom enfant', 'Naissance', 'Ville de naissance', 'Code postal de naissance', 'Pays de naissance', 'Taille de tenue', 'Prénom parent', 'Nom parent', 'E-mail', 'Téléphone',
    'Prénom 2e responsable', 'Nom 2e responsable', 'E-mail 2e responsable', 'Téléphone 2e responsable', 'Message'];
  // Numéro d'arrivée propre à chaque groupe (export de tous les groupes).
  const rank = new Map();
  const lines = rows.map((r) => {
    rank.set(r.groupe, (rank.get(r.groupe) || 0) + 1);
    return [...(labels ? [labels[r.groupe] || r.groupe] : []), rank.get(r.groupe), r.created_at, r.enfant_prenom, r.enfant_nom, r.naissance, r.ville_naissance || '', r.cp_naissance || '', r.pays_naissance || '', r.taille_maillot || '', r.parent_prenom, r.parent_nom, r.email, r.telephone,
      r.parent2_prenom || '', r.parent2_nom || '', r.parent2_email || '', r.parent2_telephone || '', r.commentaire || '']
      .map(csvCell)
      .join(';');
  });
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
  invalid: ['error', 'Réglages invalides : vérifiez les années (sans recouvrir un autre groupe) et le nombre de places.'],
  groupAdded: ['ok', 'Groupe créé : il est proposé sur la page de pré-inscription.'],
  groupInvalid: ['error', 'Groupe non créé : vérifiez le nom, les années (sans recouvrir un autre groupe) et le nombre de places.'],
  groupDeleted: ['ok', 'Groupe supprimé.'],
  groupNotEmpty: ['error', 'Ce groupe a des pré-inscriptions (ou est déjà ouvert) : il ne peut pas être supprimé.'],
  invited: ['ok', "Famille invitée : elle a reçu le lien du formulaire d'inscription."],
  inviteAlready: ['ok', 'Cette famille avait déjà été invitée.'],
  inviteNoCategory: ['error', "Aucune catégorie d'inscription active ne couvre ces années : ouvrez-la dans Catégories avant d'inviter."],
  transferNone: ['error', 'Sélectionnez au moins un enfant à transférer.'],
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

// Suivi du délai d'inscription après une invitation (preinscription-deadlines.js).
function inviteState(r) {
  const short = (v) => formatDateFr(v, { dateStyle: 'short' });
  if (r.completed_at) return `<div class="adm-line"><span>Inscription</span><span class="adm-tag is-yes">Finalisée le ${short(r.completed_at)}</span></div>`;
  if (r.expired_at) return `<div class="adm-line"><span>Délai</span><span class="adm-tag is-no">Dépassé le ${short(r.expired_at)} : place libérée</span></div>`;
  if (!r.invite_deadline_at) return '';
  return `<div class="adm-line"><span>À finaliser avant le</span><strong>${short(r.invite_deadline_at)}</strong></div>${
    r.invite_reminded_at ? `<div class="adm-line"><span>Rappel envoyé</span><span>${short(r.invite_reminded_at)}</span></div>` : ''
  }`;
}

const tel = (value) => escapeHtml(String(value || '').replace(/[^\d+]/g, ''));
const TODO = '<span class="adm-tag is-no">À compléter</span>';

// Carte compacte, sur le modèle des cartes d'Inscriptions : en-tête (initiales, nom, âge), lignes libellé / valeur,
// actions en bas ; le formulaire « Compléter / Modifier » reste replié.
// invite : salle d'attente avec une catégorie active (bouton « Inviter à s'inscrire » sur les familles non invitées).
function row(r, i, links, ageCtx, invite = false, now = Date.now()) {
  const state = rowState(r, now);
  const enfant = escapeHtml(`${r.enfant_prenom} ${r.enfant_nom}`);
  const age = ageGroup(r.naissance, ageCtx);
  const lieu = r.ville_naissance
    ? `${escapeHtml(r.ville_naissance)}${r.cp_naissance ? ` (${escapeHtml(r.cp_naissance)})` : ''}${r.pays_naissance && r.pays_naissance !== 'France' ? ` <small>(${escapeHtml(r.pays_naissance)})</small>` : ''}`
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
  // Case de sélection pour le transfert en inscription (rattachée au formulaire #prein-transfer par l'attribut form :
  // la carte contient déjà ses propres formulaires).
  const select = r.inscription_id
    ? ''
    : `<label class="insc-select-wrap"><input type="checkbox" class="insc-select" name="ids" value="${r.id}" form="prein-transfer" aria-label="Sélectionner ${enfant}"></label>`;
  return `<li class="adm-card adm-prein${r.expired_at ? ' is-expired' : ''}" id="prein-${r.id}">
    <div class="adm-card-top">
      ${select}
      ${avatar({ id: r.id, enfant_prenom: r.enfant_prenom, enfant_nom: r.enfant_nom })}
      <div class="adm-card-id">
        <h3>${enfant}</h3>
        <p>${age ? `<strong>${age}</strong> · ` : ''}né(e) le ${formatBirth(r.naissance)} · n° ${i + 1}</p>
      </div>
      <span class="adm-tag is-${state.tone} adm-pi-state">${escapeHtml(state.label)}</span>
    </div>
    ${
      r.inscription_id
        ? `<p class="adm-prein-opened">${icon('check')}<span>Transféré(e) en inscription : <a class="adm-link" href="/admin/inscriptions/${Number(r.inscription_id)}">fiche n° ${Number(r.inscription_id)}</a>. Compte toujours dans les places du groupe.</span></p>`
        : found.active
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
      ${r.invited_at ? `<div class="adm-line"><span>Invitée à s'inscrire</span><span>${formatDateFr(r.invited_at, { dateStyle: 'short' })}</span></div>` : ''}
      ${inviteState(r)}
    </div>
    ${r.commentaire ? `<p class="adm-prein-comment">${escapeHtml(r.commentaire)}</p>` : ''}
    ${found.transferred && !r.inscription_id ? `<a class="adm-link adm-prein-origin" href="/admin/inscriptions/${found.transferred}">${icon('file')}Fiche d'inscription d'origine</a>` : ''}
    <div class="adm-card-actions adm-contact-actions">
      ${phoneLinks(r.telephone).join('')}
      <a class="adm-btn adm-btn-ghost" href="/admin/email?preinscription=${Number(r.id)}">${icon('mail')}E-mail</a>
    </div>
    ${
      invite && !r.invited_at
        ? `<form method="POST" class="admin-confirm-form adm-prein-invite">
      <input type="hidden" name="action" value="invite">
      <input type="hidden" name="id" value="${r.id}">
      <button type="submit" class="adm-btn adm-btn-primary" data-once data-confirm="Inviter la famille de ${enfant} à s'inscrire ? Elle reçoit un e-mail avec le lien du formulaire d'inscription.">${icon('send')}Inviter à s'inscrire</button>
    </form>`
        : ''
    }
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
          <div class="form-field"><label for="prein-cp-${r.id}">Code postal de naissance <small>(si né en France)</small></label>
            <input type="text" id="prein-cp-${r.id}" name="cpNaissance" value="${escapeHtml(r.cp_naissance || '')}" inputmode="numeric" maxlength="5" pattern="[0-9]{5}">
            ${cpLookupButton(`prein-cp-${r.id}`, r)}</div>
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


// Champs communs aux réglages d'un groupe et à l'ajout d'un groupe. p : préfixe des identifiants.
function groupFields(p, g = {}) {
  // Groupe déjà ouvert : le choix n'a plus d'effet, la valeur est conservée telle quelle.
  const auto = g.openedAt
    ? '<input type="hidden" name="autoCategory" value="1">'
    : `<label class="adm-check adm-prein-auto"><input type="checkbox" name="autoCategory" value="1"${g.autoCategory !== false ? ' checked' : ''}><span><strong>Créer automatiquement une catégorie quand le groupe est complet</strong>
        <small>Coché : pour un nouveau groupe. Dès que les places sont prises, la catégorie d'inscription est créée et chaque famille reçoit le lien d'inscription. Décoché : liste d'attente. Rien n'est créé, vous êtes prévenu quand la liste est pleine et vous invitez chaque famille quand une place se libère dans une catégorie existante.</small></span></label>`;
  return `<label class="adm-check"><input type="checkbox" name="open" value="1"${g.open !== false ? ' checked' : ''}><span>Formulaire ouvert sur le site</span></label>
      ${auto}
      <div class="form-row">
        <div class="form-field">
          <label for="${p}-label">Nom du groupe</label>
          <input type="text" id="${p}-label" name="label" value="${escapeHtml(g.label || '')}" maxlength="40" placeholder="Ex. : U11" required>
        </div>
        <div class="form-field">
          <label for="${p}-capacity">Nombre de places</label>
          <input type="number" id="${p}-capacity" name="capacity" value="${g.capacity || 15}" min="1" max="${MAX_CAPACITY}" required>
        </div>
      </div>
      <div class="form-field">
        <label for="${p}-days">Délai pour finaliser l'inscription après l'invitation (jours)</label>
        <input type="number" id="${p}-days" name="inviteDays" value="${g.inviteDays || INVITE_DAYS.default}" min="${INVITE_DAYS.min}" max="${INVITE_DAYS.max}" required>
        <small class="form-hint">Formulaire, dossier signé et première cotisation. Rappel automatique 2 jours avant ; sans rien de finalisé à l'échéance, la place est libérée.</small>
      </div>
      <div class="form-row">
        <div class="form-field">
          <label for="${p}-min">Naissance — année la plus ancienne</label>
          <input type="number" id="${p}-min" name="anneeMin" value="${g.anneeMin || ''}" min="2000" max="2100" required>
        </div>
        <div class="form-field">
          <label for="${p}-max">Naissance — année la plus récente</label>
          <input type="number" id="${p}-max" name="anneeMax" value="${g.anneeMax || ''}" min="2000" max="2100" required>
        </div>
      </div>`;
}

function settingsForm(config, count) {
  return `<details class="adm-surface adm-pi-panel" id="reglages">
    <summary class="adm-h2">${icon('settings')}Réglages du groupe ${escapeHtml(config.label)}<small>places, années, ouverture, délai</small></summary>
    <form method="POST" class="adm-prein-settings">
      <input type="hidden" name="action" value="config">
      <input type="hidden" name="groupe" value="${escapeHtml(config.groupe)}">
      ${groupFields('prein', config)}
      <p class="adm-help">Baisser le nombre de places ne supprime personne : le formulaire affiche simplement « complet ».</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
    ${
      count === 0 && !config.openedAt
        ? `<form method="POST" class="admin-confirm-form adm-prein-delete-group">
      <input type="hidden" name="action" value="delete-group">
      <input type="hidden" name="groupe" value="${escapeHtml(config.groupe)}">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Supprimer le groupe ${escapeHtml(config.label)} ? Il n'a aucune pré-inscription.">${icon('trash')}Supprimer ce groupe</button>
    </form>`
        : ''
    }
  </details>`;
}

function addGroupForm(groups) {
  if (groups.length >= MAX_GROUPS) return '';
  return `<section class="adm-surface" id="nouveau-groupe">
    <details class="adm-prein-add"${groups.length ? '' : ' open'}>
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('plus')}Ajouter un groupe en pré-inscription</summary>
      <form method="POST" class="adm-prein-settings">
        <input type="hidden" name="action" value="add-group">
        ${groupFields('prein-new', { open: true, autoCategory: false })}
        <p class="adm-help">Les années ne doivent pas recouvrir celles d'un autre groupe : l'année de naissance choisit le groupe.</p>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Créer le groupe</button></div>
      </form>
    </details>
  </section>`;
}

const yearsText = (g) => (g.anneeMin === g.anneeMax ? `nés en ${g.anneeMin}` : `nés de ${g.anneeMin} à ${g.anneeMax}`);

// ---------- Refonte « à l'échelle » (2026-11-13) ----------
// Pensée pour un nombre de groupes qui grandit : l'écran part des actions (tous groupes confondus), les groupes sont
// un tableau compact (ceux sans action repliés), on entre dans un groupe par un sélecteur avec recherche et des
// flèches « groupe à traiter suivant ». États et actions sont calculés à l'affichage depuis les colonnes existantes.

const DAY = 86400000;
const toMs = (v) => (v ? Date.parse(String(v).includes('T') ? v : `${String(v).replace(' ', 'T')}Z`) : NaN);
const daysLeft = (deadline, now) => Math.ceil((toMs(deadline) - now) / DAY);
const groupHref = (g, extra = '') => `/admin/preinscriptions?groupe=${encodeURIComponent(g.groupe)}${extra}`;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// État d'une pré-inscription : inscrit (transféré ou finalisé), délai dépassé, invité, en attente.
export function rowState(r, now = Date.now()) {
  if (r.inscription_id) return { key: 'inscrits', label: 'Transféré(e)', tone: 'yes' };
  if (r.completed_at) return { key: 'inscrits', label: 'Inscrit(e)', tone: 'yes' };
  if (r.expired_at) return { key: 'expires', label: 'Délai dépassé', tone: 'neutral' };
  if (r.invited_at) {
    if (!r.invite_deadline_at) return { key: 'invites', label: 'Invité(e)', tone: 'wait' };
    const left = daysLeft(r.invite_deadline_at, now);
    return { key: 'invites', label: left > 0 ? `Invité(e) · J-${left}` : 'Invité(e) · dernier jour', tone: left <= 2 ? 'no' : 'wait' };
  }
  return { key: 'attente', label: 'En attente', tone: 'neutral' };
}

export const ROW_FILTERS = {
  'a-faire': 'À faire',
  attente: 'En attente',
  invites: 'Invités',
  inscrits: 'Inscrits',
  expires: 'Délai dépassé',
};

// Résumé d'un groupe : chiffres, statut et actions à faire (une entrée par enfant concerné).
export function summarizeGroup(g, rows, links, category, now = Date.now()) {
  const count = rows.filter((r) => !r.expired_at).length;
  const remaining = Math.max(0, g.capacity - count);
  const waitlist = g.autoCategory === false && !g.openedAt;
  const status = g.openedAt ? 'Groupe ouvert' : !g.open ? 'Fermé' : remaining ? 'Ouvert' : waitlist ? 'Liste complète' : 'Complet';
  const tone = g.openedAt ? 'yes' : !g.open ? 'neutral' : remaining ? 'wait' : 'yes';
  const live = rows.filter((r) => !r.inscription_id && !r.expired_at && !r.completed_at);
  const todos = [];
  for (const r of live) {
    const name = `${r.enfant_prenom} ${r.enfant_nom}`;
    const found = inscriptionsOf(r, links);
    if (found.active) todos.push({ type: 'doublon', row: r, name, text: `aussi dans les inscriptions (fiche n° ${found.active})`, href: `/admin/inscriptions/${found.active}`, button: 'Vérifier' });
    const lack = missing(r);
    if (lack) todos.push({ type: 'fiche', row: r, name, text: `${lack} à compléter`, href: groupHref(g, `&etat=a-faire#prein-${r.id}`), button: 'Compléter' });
    if (r.invited_at && r.invite_deadline_at) {
      const left = daysLeft(r.invite_deadline_at, now);
      if (left <= 3) todos.push({ type: 'delai', row: r, name, text: left > 0 ? `délai d'inscription dans ${plural(left, 'jour', 'jours')}` : "délai d'inscription aujourd'hui", href: `/admin/email?preinscription=${Number(r.id)}`, button: 'Relancer' });
    }
  }
  // Liste d'attente avec une catégorie active : une famille à la fois. Quand aucune invitation n'est en cours, la
  // première famille non invitée est proposée (place libérée, délai dépassé ou première invitation).
  const waiting = live.filter((r) => !r.invited_at);
  const pending = live.some((r) => r.invited_at);
  if (waitlist && category && waiting.length && !pending) {
    const r = waiting[0];
    todos.unshift({ type: 'inviter', row: r, name: `${r.enfant_prenom} ${r.enfant_nom}`, text: `première famille de la liste (${plural(waiting.length, 'en attente', 'en attente')})`, href: groupHref(g, `&etat=a-faire#prein-${r.id}`), button: 'Inviter', invite: true });
  }
  const todoIds = new Set(todos.map((t) => t.row.id));
  const counts = { 'a-faire': todoIds.size, attente: 0, invites: 0, inscrits: 0, expires: 0 };
  for (const r of rows) counts[rowState(r, now).key] += 1;
  return { g, rows, count, remaining, waitlist, category, status, tone, todos, todoIds, counts };
}

const TODO_TYPES = {
  inviter: { icon: 'send', title: (n) => `Inviter ${plural(n, 'famille', 'familles')}`, tone: 'wait' },
  delai: { icon: 'calendar', title: (n) => `${plural(n, "délai d'inscription se termine", "délais d'inscription se terminent")} bientôt`, tone: 'no' },
  fiche: { icon: 'edit', title: (n) => `${plural(n, 'fiche à compléter', 'fiches à compléter')}`, tone: 'wait' },
  doublon: { icon: 'users', title: (n) => `${plural(n, 'enfant déjà dans les inscriptions', 'enfants déjà dans les inscriptions')}`, tone: 'no' },
};

// « À faire maintenant » : une ligne par type d'action, qui nomme les groupes et les premiers enfants concernés.
function todoPanel(summaries, scoped = false) {
  const all = summaries.flatMap((s) => s.todos.map((t) => ({ ...t, s })));
  if (!all.length) return `<section class="adm-surface adm-pi-todo is-empty"><h2 class="adm-h2">${icon('check')}Rien à faire pour le moment</h2><p class="adm-help">Les invitations, délais, fiches incomplètes et doublons apparaîtront ici.</p></section>`;
  const groupsWith = new Set(all.map((t) => t.s.g.groupe)).size;
  const lines = Object.entries(TODO_TYPES)
    .map(([type, def]) => {
      const items = all.filter((t) => t.type === type);
      if (!items.length) return '';
      const where = scoped
        ? items.slice(0, 3).map((t) => escapeHtml(t.name)).join(', ') + (items.length > 3 ? `, +${items.length - 3}` : '')
        : [...new Set(items.map((t) => t.s.g.label))].slice(0, 4).map(escapeHtml).join(' · ') + ` — ${items.slice(0, 2).map((t) => escapeHtml(t.name)).join(', ')}${items.length > 2 ? '…' : ''}`;
      const first = items[0];
      const href = items.length === 1 || scoped ? (items.length === 1 ? first.href : groupHref(first.s.g, '&etat=a-faire')) : groupHref(first.s.g, '&etat=a-faire');
      return `<li class="adm-pi-todo-item is-${def.tone}"><span class="adm-pi-todo-ico">${icon(def.icon)}</span><div><strong>${def.title(items.length)}</strong><p>${where}</p></div><a class="adm-btn adm-btn-sm ${type === 'inviter' ? 'adm-btn-primary' : 'adm-btn-ghost'}" href="${href}">${escapeHtml(first.button)}</a></li>`;
    })
    .join('');
  return `<section class="adm-surface adm-pi-todo">
    <h2 class="adm-h2">${icon('activity')}À faire maintenant <em>· ${plural(all.length, 'action', 'actions')}${scoped ? '' : ` dans ${plural(groupsWith, 'groupe', 'groupes')}`}</em></h2>
    <ul>${lines}</ul>
  </section>`;
}

function fillBar(s) {
  const pct = Math.min(100, Math.round((s.count / s.g.capacity) * 100));
  return `<span class="adm-pi-fill"><b>${s.count}/${s.g.capacity}</b><span class="adm-pi-bar" aria-hidden="true"><i class="${s.remaining ? '' : 'is-full'}" style="width:${pct}%"></i></span></span>`;
}

const modeText = (s) => (s.g.openedAt ? 'Catégorie créée, familles invitées' : s.waitlist ? (s.category ? `Liste d'attente pour ${s.category.label}` : "Liste d'attente sans catégorie active") : `Catégorie créée à ${s.g.capacity} enfants`);

function groupRow(s) {
  const n = s.todoIds.size;
  return `<li class="adm-pi-group" data-filter-text="${escapeHtml(`${s.g.label} ${s.g.anneeMin} ${s.g.anneeMax}`.toLowerCase())}">
    <div class="adm-pi-g-name"><a href="${groupHref(s.g)}">${escapeHtml(s.g.label)}</a><small>${escapeHtml(yearsText(s.g))}</small></div>
    <div class="adm-pi-g-fill">${fillBar(s)}</div>
    <div class="adm-pi-g-state"><span class="adm-tag is-${s.tone}">${escapeHtml(s.status)}</span><small>${escapeHtml(modeText(s))}</small></div>
    <div class="adm-pi-g-todo">${n ? `<strong>${n} à faire</strong>` : '<span>Rien à faire</span>'}</div>
    <a class="adm-btn adm-btn-sm ${n ? 'adm-btn-primary' : 'adm-btn-ghost'}" href="${groupHref(s.g, n ? '&etat=a-faire' : '')}">${n ? 'Traiter' : 'Ouvrir'}<span class="visually-hidden"> ${escapeHtml(s.g.label)}</span></a>
  </li>`;
}

const GROUP_VIEWS = {
  'a-traiter': ['À traiter', (s) => s.todoIds.size > 0],
  tous: ['Tous', () => true],
  ouverts: ['Ouverts', (s) => s.g.open && !s.g.openedAt && s.remaining > 0],
  complets: ['Complets', (s) => s.g.openedAt || s.remaining === 0],
  fermes: ['Fermés', (s) => !s.g.open && !s.g.openedAt],
};
const FOLD_AFTER = 5;

function groupsTable(summaries, view) {
  const chips = Object.entries(GROUP_VIEWS)
    .map(([key, [label, keep]]) => {
      const n = summaries.filter(keep).length;
      const active = key === view;
      return `<a class="adm-chip${active ? ' is-active' : ''}" href="/admin/preinscriptions?vue=${key}"${active ? ' aria-current="true"' : ''}>${label} <b>${n}</b></a>`;
    })
    .join('');
  const shown = summaries.filter(GROUP_VIEWS[view][1]).sort((a, b) => b.todoIds.size - a.todoIds.size);
  const withTodo = shown.filter((s) => s.todoIds.size);
  const rest = shown.filter((s) => !s.todoIds.size);
  const head = '<li class="adm-pi-group adm-pi-ghead" aria-hidden="true"><span>Groupe</span><span>Places</span><span>État</span><span>À faire</span><span></span></li>';
  const sep = withTodo.length && rest.length ? `<li class="adm-pi-sep">Rien à faire · ${plural(rest.length, 'groupe', 'groupes')}</li>` : '';
  const list = (inner) => `<ul class="adm-pi-groups" data-filter-list="pi-groups">${inner}</ul>`;
  // Beaucoup de groupes sans action : repliés sous les groupes à traiter (rouverts par une recherche).
  const body = rest.length > FOLD_AFTER && withTodo.length
    ? `${list(head + withTodo.map(groupRow).join('') + sep)}<details class="adm-pi-more" data-filter-open="pi-groups"><summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('chevron')}Afficher ${plural(rest.length, 'groupe sans action', 'groupes sans action')}</summary>${list(rest.map(groupRow).join(''))}</details>`
    : list(head + withTodo.map(groupRow).join('') + sep + rest.map(groupRow).join(''));
  return `<section class="adm-surface adm-pi-table" id="groupes">
    <div class="adm-pi-table-head">
      <h2 class="adm-h2">${icon('users')}Groupes</h2>
      <nav class="adm-chips" aria-label="Filtrer les groupes">${chips}</nav>
      <label class="adm-pi-search"><span class="visually-hidden">Chercher un groupe</span>${icon('search')}<input type="search" placeholder="Chercher un groupe" data-filter-input="pi-groups" autocomplete="off"></label>
    </div>
    ${shown.length ? body :`<p class="adm-help">Aucun groupe dans cette vue. <a class="adm-link" href="/admin/preinscriptions?vue=tous">Voir tous les groupes</a>.</p>`}
    <p class="adm-help adm-pi-noresult" data-filter-empty="pi-groups" hidden>Aucun groupe ne correspond.</p>
  </section>`;
}

// Sélecteur de groupe : liste de liens dans un menu repliable, avec recherche (assets/js/admin-nav.js, data-filter-*).
// Sans JavaScript, la liste reste une simple liste de liens.
function groupPicker(summaries, current) {
  const option = (s) => `<a class="adm-pi-opt${current && s.g.groupe === current.groupe ? ' is-active' : ''}" href="${groupHref(s.g)}" data-filter-text="${escapeHtml(`${s.g.label} ${s.g.anneeMin} ${s.g.anneeMax}`.toLowerCase())}"${current && s.g.groupe === current.groupe ? ' aria-current="true"' : ''}><span><strong>${escapeHtml(s.g.label)}</strong><small>${escapeHtml(yearsText(s.g))} · ${s.count}/${s.g.capacity}</small></span>${s.todoIds.size ? `<b>${s.todoIds.size}</b>` : ''}</a>`;
  const todo = summaries.filter((s) => s.todoIds.size);
  const rest = summaries.filter((s) => !s.todoIds.size);
  const label = current
    ? `<strong>${escapeHtml(current.label)}</strong><small>${escapeHtml(yearsText(current))}</small>`
    : `<strong>Tous les groupes</strong><small>${summaries.length}</small>`;
  // Flèches : groupe à traiter précédent / suivant (tous les groupes s'il n'y en a aucun à traiter).
  const cycle = todo.length ? todo : summaries;
  const at = current ? cycle.findIndex((s) => s.g.groupe === current.groupe) : -1;
  const prev = at >= 0 ? cycle[(at - 1 + cycle.length) % cycle.length] : null;
  const next = at >= 0 ? cycle[(at + 1) % cycle.length] : cycle[0];
  const arrow = (target, label, cls = '') => `<a class="adm-btn adm-btn-sm adm-btn-ghost${cls}" href="${groupHref(target.g)}" aria-label="${label}">${icon('arrowLeft')}</a>`;
  let arrows = '';
  if (current && at >= 0 && cycle.length > 1) {
    arrows = `<div class="adm-pi-steps">${arrow(prev, 'Groupe précédent')}<span>${todo.length ? 'À traiter' : 'Groupe'} ${at + 1} sur ${cycle.length}</span>${arrow(next, 'Groupe suivant', ' adm-pi-next')}</div>`;
  } else if (current && at < 0 && todo.length) {
    // Groupe sans action : lien direct vers le premier groupe à traiter.
    arrows = `<div class="adm-pi-steps"><span>${plural(todo.length, 'groupe à traiter', 'groupes à traiter')}</span><a class="adm-btn adm-btn-sm adm-btn-ghost adm-pi-goto" href="${groupHref(next.g)}">${escapeHtml(next.g.label)}<span class="adm-pi-next">${icon('arrowLeft')}</span></a></div>`;
  }
  return `<div class="adm-pi-picker">
    <details class="adm-pi-select" data-dismiss>
      <summary aria-label="Choisir un groupe">${icon('users')}<span>${label}</span>${icon('chevron')}</summary>
      <div class="adm-pi-menu">
        <label class="adm-pi-search"><span class="visually-hidden">Chercher un groupe</span>${icon('search')}<input type="search" placeholder="Chercher un groupe" data-filter-input="pi-picker" autocomplete="off"></label>
        <nav aria-label="Groupes en pré-inscription" data-filter-list="pi-picker">
          <a class="adm-pi-opt${current ? '' : ' is-active'}" href="/admin/preinscriptions?vue=tous" data-filter-text="tous les groupes"><span><strong>Tous les groupes</strong><small>vue d'ensemble</small></span></a>
          ${todo.length ? `<p class="adm-pi-lab" data-filter-label>À traiter</p>${todo.map(option).join('')}` : ''}
          ${rest.length ? `<p class="adm-pi-lab" data-filter-label>${todo.length ? 'Autres groupes' : 'Groupes'}</p>${rest.map(option).join('')}` : ''}
        </nav>
        <p class="adm-help" data-filter-empty="pi-picker" hidden>Aucun groupe ne correspond.</p>
      </div>
    </details>
    ${arrows}
  </div>`;
}

// Barre de transfert : cases sur les cartes, « Tout sélectionner », bouton vers l'écran de confirmation.
function transferBar(rows, config) {
  const open = rows.filter((r) => !r.inscription_id);
  const done = rows.length - open.length;
  if (!rows.length) return '';
  return `<section class="adm-surface adm-prein-transfer" id="transfert">
    <h2 class="adm-h2">${icon('send')}Transférer en inscription</h2>
    <p class="adm-help">Cochez les enfants sur leur carte : une fiche est créée dans la catégorie qui correspond à leur année de naissance (création proposée si elle n'existe pas), et chaque famille reçoit un e-mail pour compléter l'inscription (adresse, autorisations, dossier signé, photo, paiement). Les enfants transférés restent comptés dans les ${config.capacity} places du groupe.${done ? ` Déjà transféré${done > 1 ? 's' : ''} : ${done}.` : ''}</p>
    ${
      open.length
        ? `<form id="prein-transfer" method="POST" class="adm-prein-transfer-form">
      <input type="hidden" name="action" value="transfer-preview">
      <input type="hidden" name="groupe" value="${escapeHtml(config.groupe)}">
      <label class="adm-check"><input type="checkbox" data-check-all="prein-transfer"><span>Tout sélectionner</span></label>
      <span class="adm-help" data-check-count="prein-transfer" aria-live="polite"></span>
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('send')}Transférer la sélection</button>
    </form>`
        : ''
    }
  </section>`;
}

const ISSUES = {
  already: 'déjà transféré(e)',
  size: 'taille de tenue à compléter sur sa carte',
  no_category: "aucune catégorie d'inscription pour son année de naissance",
};

// Écran de confirmation (réponse au POST « transfer-preview ») : rien n'est encore écrit.
function previewPage({ plan, groupe, badges }) {
  const back = `/admin/preinscriptions?groupe=${encodeURIComponent(groupe)}`;
  const creatable = new Set(plan.toCreate.map((g) => g.groupe));
  const willCreate = (item) => item.issue === 'no_category' && item.group && creatable.has(item.group.groupe);
  const ready = plan.items.filter((i) => !i.issue || willCreate(i));
  const lines = plan.items
    .map((i) => {
      const name = escapeHtml(`${i.row.enfant_prenom} ${i.row.enfant_nom}`);
      const target = !i.issue
        ? `<strong>${escapeHtml(i.category.label)}</strong>`
        : willCreate(i)
          ? `<strong>${escapeHtml(i.group.label)}</strong> <small>(catégorie à créer)</small>`
          : `<span class="adm-tag is-no">Non transféré : ${escapeHtml(ISSUES[i.issue])}</span>`;
      return `<li class="adm-line"><span>${name} <small>né(e) le ${formatBirth(i.row.naissance)}</small></span><span class="adm-line-value">${target}</span></li>`;
    })
    .join('');
  const create = plan.toCreate.length
    ? `<label class="adm-check adm-prein-auto"><input type="checkbox" name="createCategory" value="1" checked><span><strong>Créer la catégorie ${plan.toCreate
        .map((g) => `${escapeHtml(g.label)} (${escapeHtml(yearsText(g))})`)
        .join(', ')}</strong><small>Elle apparaît ensuite dans Catégories et sur le formulaire d'inscription du site, comme les autres. Le lien HelloAsso de la catégorie se règle dans Catégories. Décochée : ces enfants ne sont pas transférés.</small></span></label>`
    : '';
  return `${adminHead('Transférer en inscription')}
${adminShell({ active: 'preinscriptions', badges, eyebrow: 'Pré-inscriptions', title: 'Transférer en inscription', back: { href: back, label: 'Pré-inscriptions' } })}
<main id="adm-main" class="adm-wrap adm-main">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('users')}${plan.items.length} enfant${plan.items.length > 1 ? 's' : ''} sélectionné${plan.items.length > 1 ? 's' : ''}</h2>
    <ul class="adm-lines adm-transfer-plan">${lines}</ul>
    ${
      ready.length
        ? `<form method="POST" action="/admin/preinscriptions" data-once class="adm-prein-settings">
      <input type="hidden" name="action" value="transfer">
      <input type="hidden" name="groupe" value="${escapeHtml(groupe)}">
      ${ready.map((i) => `<input type="hidden" name="ids" value="${i.row.id}">`).join('')}
      ${create}
      <label class="adm-check adm-prein-auto"><input type="checkbox" name="notify" value="1" checked><span><strong>Prévenir les familles par e-mail</strong><small>Lien vers leur espace famille pour donner adresse, mode de paiement et autorisations, puis déposer le dossier signé et la photo.</small></span></label>
      <p class="adm-help">Les fiches sont créées « à compléter ». Les pré-inscriptions restent dans la liste et comptent toujours dans les places du groupe.</p>
      <div class="adm-form-actions">
        <button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Transférer ${ready.length} enfant${ready.length > 1 ? 's' : ''}</button>
        <a href="${back}" class="adm-btn adm-btn-ghost">Annuler</a>
      </div>
    </form>`
        : `<p class="adm-help">Aucun enfant ne peut être transféré.</p><div class="adm-form-actions"><a href="${back}" class="adm-btn adm-btn-ghost">Retour</a></div>`
    }
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

// Bilan affiché après le transfert.
function transferSummary(result) {
  const parts = [];
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  if (result.categories.length) parts.push(`Catégorie créée : ${result.categories.join(', ')}.`);
  if (result.created) parts.push(`${plural(result.created, 'fiche d’inscription créée', 'fiches d’inscription créées')} (à compléter par la famille).`);
  if (result.restored) parts.push(`${plural(result.restored, 'fiche restaurée', 'fiches restaurées')} depuis la corbeille.`);
  if (result.linked) parts.push(`${plural(result.linked, 'enfant déjà inscrit rattaché', 'enfants déjà inscrits rattachés')}.`);
  if (result.mailed) parts.push(`${plural(result.mailed, 'famille prévenue', 'familles prévenues')} par e-mail.`);
  if (result.skipped.length) parts.push(`Non transféré : ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(', ')}.`);
  return parts.join(' ') || 'Aucun enfant transféré.';
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const url = new URL(request.url);
  const groups = await getPreinscriptionGroups(env, admin.organizationId);
  const message = MESSAGES[url.searchParams.get('msg')];
  const badges = await adminBadges(env, admin);
  if (!groups.length) {
    return html(`${adminHead('Pré-inscriptions')}
${adminShell({ active: 'preinscriptions', badges, eyebrow: 'Liste d’intérêt', title: 'Pré-inscriptions' })}
<main id="adm-main" class="adm-wrap adm-main"><section class="adm-surface">${message ? flash(message[0], message[1]) : ''}<p>Aucun groupe en pré-inscription pour le moment.</p></section>${addGroupForm(groups)}</main>
${adminScripts('admin-nav')}
</body></html>`);
  }
  const org = admin.organizationId;
  // Un seul groupe : directement son détail. Plusieurs : vue d'ensemble, sauf groupe demandé.
  const config = groups.find((g) => g.groupe === url.searchParams.get('groupe')) || (groups.length === 1 ? groups[0] : null);
  await ensurePreinscriptionsTable(env.DB);
  await ensureInscriptionsTable(env.DB);
  const [allRows, links, ageCtx] = await Promise.all([listAllPreinscriptions(env.DB, org), inscriptionLinks(env.DB, org), loadAgeContext(env, org)]);
  const rowsOf = (g) => allRows.filter((r) => r.groupe === g.groupe).sort((a, b) => a.id - b.id);
  if (url.searchParams.get('format') === 'csv') {
    return config ? csv(rowsOf(config), config) : csv(groups.flatMap(rowsOf), { groupe: 'tous-les-groupes' }, Object.fromEntries(groups.map((g) => [g.groupe, g.label])));
  }
  const now = Date.now();
  const categories = await Promise.all(groups.map((g) => (g.autoCategory === false && !g.openedAt ? activeCategoryFor(env, org, g) : null)));
  const summaries = groups.map((g, i) => summarizeGroup(g, rowsOf(g), links, categories[i], now));
  const bilan = String(url.searchParams.get('bilan') || '').slice(0, 1000);
  const notices = `${message ? flash(message[0], message[1]) : ''}${bilan ? flash(url.searchParams.get('bilanError') === '1' ? 'error' : 'ok', bilan) : ''}`;
  const emails = (rows) => [...new Set(rows.flatMap((r) => [r.email, r.parent2_email].filter(Boolean)))];

  if (!config) return html(overviewPage({ summaries, groups, allRows, badges, notices, url, emails: emails(allRows) }));
  const summary = summaries.find((s) => s.g.groupe === config.groupe);
  return html(groupPage({ summary, summaries, groups, links, ageCtx, badges, notices, url, now, emails: emails(summary.rows) }));
}

function overviewPage({ summaries, groups, allRows, badges, notices, url, emails }) {
  const todoCount = summaries.reduce((n, s) => n + s.todos.length, 0);
  const askedView = url.searchParams.get('vue');
  const view = GROUP_VIEWS[askedView] ? askedView : summaries.some((s) => s.todoIds.size) ? 'a-traiter' : 'tous';
  const children = allRows.filter((r) => !r.expired_at).length;
  return `${adminHead('Pré-inscriptions')}
${adminShell({
  active: 'preinscriptions',
  badges,
  eyebrow: 'Liste d’intérêt',
  title: 'Pré-inscriptions',
  subtitle: `${plural(groups.length, 'groupe', 'groupes')} · ${plural(children, 'enfant', 'enfants')}. Sans paiement ni dossier : vous recontactez les familles à l'ouverture de chaque groupe.`,
  stats: [
    { value: String(todoCount), label: todoCount > 1 ? 'Actions à faire' : 'Action à faire' },
    { value: String(groups.length), label: groups.length > 1 ? 'Groupes' : 'Groupe' },
    { value: String(children), label: 'Pré-inscrits' },
  ],
})}
<main id="adm-main" class="adm-wrap adm-main adm-pi">
  <div class="adm-pi-bar-top">
    ${groupPicker(summaries, null)}
    <div class="adm-pi-actions">
      ${allRows.length ? `<a href="/admin/preinscriptions?format=csv" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('download')}CSV</a>` : ''}
      ${emails.length ? `<a href="/admin/email?groupe=preinscriptions" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('send')}Écrire à toutes les familles</a>` : ''}
      <a href="#nouveau-groupe" class="adm-btn adm-btn-sm adm-btn-primary">${icon('plus')}Nouveau groupe</a>
    </div>
  </div>
  ${notices}
  ${todoPanel(summaries)}
  ${groupsTable(summaries, view)}
  ${addGroupForm(groups)}
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

function groupPage({ summary: s, summaries, groups, links, ageCtx, badges, notices, url, now, emails }) {
  const config = s.g;
  const { rows, count, remaining, waitlist, category } = s;
  const self = groupHref(config);
  const invitedCount = rows.filter((r) => r.invited_at).length;
  const etat = ROW_FILTERS[url.searchParams.get('etat')] ? url.searchParams.get('etat') : '';
  const numbered = rows.map((r, i) => ({ r, i }));
  const visible = etat === 'a-faire' ? numbered.filter(({ r }) => s.todoIds.has(r.id)) : etat ? numbered.filter(({ r }) => rowState(r, now).key === etat) : numbered;
  const first = s.todos[0];
  const filters = [['', 'Tous', rows.length], ...Object.entries(ROW_FILTERS).map(([k, label]) => [k, label, s.counts[k]])]
    .filter(([k, , n]) => !k || n || k === etat)
    .map(([k, label, n]) => `<a class="adm-chip${k === etat ? ' is-active' : ''}" href="${self}${k ? `&amp;etat=${k}` : ''}#familles"${k === etat ? ' aria-current="true"' : ''}>${label} <b>${n}</b></a>`)
    .join('');
  const callout = first
    ? `<div class="adm-pi-callout is-${TODO_TYPES[first.type].tone}">${icon(TODO_TYPES[first.type].icon)}<div><strong>${escapeHtml(first.name)}</strong><span> : ${escapeHtml(first.text)}</span>${s.todos.length > 1 ? `<small><a class="adm-link" href="${self}&amp;etat=a-faire#familles">${plural(s.todos.length - 1, 'autre action', 'autres actions')}</a></small>` : ''}</div>${
        first.invite
          ? `<form method="POST" class="admin-confirm-form"><input type="hidden" name="action" value="invite"><input type="hidden" name="id" value="${first.row.id}"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-once data-confirm="Inviter la famille de ${escapeHtml(first.name)} à s'inscrire ? Elle reçoit un e-mail avec le lien du formulaire d'inscription.">${icon('send')}Inviter</button></form>`
          : `<a class="adm-btn adm-btn-sm adm-btn-primary" href="${first.href}">${escapeHtml(first.button)}</a>`
      }</div>`
    : '';
  return `${adminHead(`Pré-inscriptions ${config.label}`)}
${adminShell({
  active: 'preinscriptions',
  badges,
  eyebrow: groups.length > 1 ? `Liste d’intérêt · ${groups.length} groupes` : 'Liste d’intérêt',
  title: `Pré-inscriptions ${escapeHtml(config.label)}`,
  subtitle: `Enfants ${escapeHtml(yearsText(config))}. Sans paiement ni dossier : vous recontactez les familles à l'ouverture du groupe.`,
  stats: [
    { value: `${count}<small> / ${config.capacity}</small>`, label: 'Pré-inscrits' },
    { value: String(remaining), label: remaining > 1 ? 'Places restantes' : 'Place restante' },
    { value: escapeHtml(s.status), label: 'Formulaire' },
  ],
})}
<main id="adm-main" class="adm-wrap adm-main adm-pi">
  ${groups.length > 1 ? `<div class="adm-pi-bar-top">${groupPicker(summaries, config)}</div>` : ''}
  ${notices}
  <section class="adm-surface adm-pi-head">
    <div class="adm-surface-head">
      <h2 class="adm-h2">${escapeHtml(config.label)} <span class="adm-tag is-${s.tone}">${escapeHtml(s.status)}</span></h2>
      <div class="adm-pi-actions">
        ${count ? `<a href="${self}&amp;format=csv" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('download')}<span class="adm-pi-long">Exporter en </span>CSV</a>` : ''}
        ${emails.length ? `<a href="/admin/email?groupe=preinscriptions" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('send')}Écrire<span class="adm-pi-long"> à toutes les familles</span></a>
        <button type="button" class="adm-btn adm-btn-sm adm-btn-ghost adm-desk-only adm-pi-copy" data-copy="${escapeHtml(emails.join(', '))}" data-copied="E-mails copiés">${icon('copy')}Copier les e-mails</button>` : ''}
        <a href="#reglages" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('settings')}Réglages</a>
        <a href="/pre-inscription-u10" class="adm-btn adm-btn-sm adm-btn-ghost" target="_blank" rel="noopener">${icon('eye')}<span class="adm-pi-long">Voir le formulaire</span><span class="adm-pi-short">Formulaire</span></a>
      </div>
    </div>
    ${
      config.openedAt
        ? `<p class="adm-prein-opened">${icon('check')}<span><strong>Groupe ${escapeHtml(config.label)} ouvert le ${formatDateFr(config.openedAt.slice(0, 19).replace('T', ' '), { dateStyle: 'long' })}</strong> : c'est désormais une <a class="adm-link" href="/admin/categories">catégorie d'inscription</a> comme les autres et chaque famille a reçu un lien pour l'inscription définitive. Les inscriptions arrivent dans <a class="adm-link" href="/admin/inscriptions">Inscriptions</a>.</span></p>`
        : waitlist
          ? `<p class="adm-help"><strong>Liste d'attente</strong> : aucune catégorie n'est créée automatiquement. Quand une place se libère${
              category ? ` dans la catégorie <strong>${escapeHtml(category.label)}</strong>` : ''
            }, invitez une famille avec « Inviter à s'inscrire » sur sa carte (${invitedCount} invitée${invitedCount > 1 ? 's' : ''} sur ${count}).</p>${
              category ? '' : `<p class="adm-prein-alert">${icon('alert')}<span>Aucune catégorie d'inscription active ne couvre ces années : <a class="adm-link" href="/admin/categories">ouvrez-la dans Catégories</a> pour pouvoir inviter les familles.</span></p>`
            }`
          : `<p class="adm-help">Dès que les ${config.capacity} places sont prises, le groupe devient automatiquement une catégorie d'inscription et chaque famille reçoit un lien pour s'inscrire.</p>`
    }
    <div class="adm-pi-gauge">
      <div><strong>${count}<small> / ${config.capacity}</small></strong><span>places prises</span>${progress(count, config.capacity)}</div>
      <div><strong>${s.todoIds.size}</strong><span>à faire</span></div>
      <div><strong>${s.counts.invites}</strong><span>invités en cours</span></div>
      <div><strong>${s.counts.inscrits}</strong><span>inscrits ou transférés</span></div>
    </div>
    ${callout}
  </section>
  ${transferBar(rows, config)}
  <section class="adm-pi-families" id="familles">
    ${rows.length ? `<nav class="adm-chips" aria-label="Filtrer les familles">${filters}</nav>` : ''}
    ${
      visible.length
        ? `<ol class="adm-cards adm-prein-list">${visible.map(({ r, i }) => row(r, i, links, ageCtx, Boolean(category), now)).join('')}</ol>`
        : `<div class="adm-surface"><p class="adm-help">${rows.length ? 'Aucune famille dans ce filtre.' : 'Aucune pré-inscription pour le moment.'}</p></div>`
    }
  </section>
  ${settingsForm(config, count)}
  ${addGroupForm(groups)}
</main>
${adminScripts('admin-nav', 'naissance-autocomplete')}
</body></html>`;
}

export async function onRequestPost({ request, env, waitUntil = (p) => p }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  const form = await request.formData();
  const action = form.get('action');
  const org = admin.organizationId;
  const int = (name) => Number.parseInt(String(form.get(name) || ''), 10);
  const fields = () => ({ open: form.get('open') === '1', autoCategory: form.get('autoCategory') === '1', inviteDays: int('inviteDays'), label: String(form.get('label') || '').trim(), capacity: int('capacity'), anneeMin: int('anneeMin'), anneeMax: int('anneeMax') });
  const back = (g, msg) => redirect(`groupe=${encodeURIComponent(g)}&msg=${msg}`);
  try {
    const groups = await getPreinscriptionGroups(env, org);
    if (action === 'add-group') {
      const values = fields();
      const groupe = newGroupKey(values.label, groups);
      try {
        await setPreinscriptionGroups(env, org, [...groups, { ...values, groupe }]);
      } catch {
        return redirect('msg=groupInvalid');
      }
      return back(groupe, 'groupAdded');
    }
    // Transfert en inscription : identifiants filtrés par l'organisation de la session (planTransfer), catégorie
    // choisie par le serveur d'après l'année de naissance.
    if (action === 'transfer-preview' || action === 'transfer') {
      const groupe = String(form.get('groupe') || '');
      const ids = parseIds(form.getAll('ids'));
      if (!ids.length) return back(groupe, 'transferNone');
      if (action === 'transfer-preview') {
        const plan = await planTransfer(env, org, ids);
        if (!plan.items.length) return back(groupe, 'transferNone');
        return html(previewPage({ plan, groupe, badges: await adminBadges(env, admin) }));
      }
      const result = await transferPreinscriptions(env, org, ids, {
        createCategory: form.get('createCategory') === '1',
        notify: form.get('notify') === '1',
        siteUrl: new URL(request.url).origin,
        waitUntil,
      });
      const ok = result.created + result.restored + result.linked > 0;
      return redirect(`groupe=${encodeURIComponent(groupe)}&bilan=${encodeURIComponent(transferSummary(result))}${ok ? '' : '&bilanError=1'}`);
    }
    // Pré-inscription concernée (suppression, fiche) : son groupe est lu en base, jamais pris du formulaire.
    if (action === 'delete' || action === 'birthplace' || action === 'invite') {
      const id = int('id');
      if (!Number.isInteger(id) || id <= 0) return redirect('msg=error');
      await ensurePreinscriptionsTable(env.DB);
      const rowGroup = (await env.DB.prepare('SELECT groupe FROM preinscriptions WHERE organization_id = ? AND id = ?').bind(org, id).first())?.groupe;
      if (!rowGroup) return redirect('msg=error');
      const siteUrl = new URL(request.url).origin;
      if (action === 'invite') {
        const result = await inviteWaitingFamily(env, org, siteUrl, id);
        return back(rowGroup, { invited: 'invited', already: 'inviteAlready', no_category: 'inviteNoCategory' }[result] || 'error');
      }
      if (action === 'delete') {
        const ok = await deletePreinscription(env.DB, org, id);
        // Place libérée : la liste d'attente pourra prévenir à nouveau le club quand elle sera de nouveau pleine.
        if (ok) await openPreinscriptionGroupIfFull(env, org, siteUrl, rowGroup).catch(() => null);
        return back(rowGroup, ok ? 'deleted' : 'error');
      }
      const villeNaissance = cleanBirthPlace(form.get('villeNaissance'));
      const paysNaissance = cleanBirthPlace(form.get('paysNaissance'));
      if (!villeNaissance || !paysNaissance) return back(rowGroup, 'birthplaceInvalid');
      const cpNaissance = cleanBirthPostcode(form.get('cpNaissance'), paysNaissance);
      if (cpNaissance === null) return back(rowGroup, 'birthplaceInvalid');
      const tailleMaillot = String(form.get('tailleMaillot') || '');
      if (!SHIRT_SIZES.includes(tailleMaillot)) return back(rowGroup, 'sizeInvalid');
      const ok = await updatePreinscriptionBirthPlace(env.DB, org, id, { villeNaissance, paysNaissance, cpNaissance });
      if (ok) await updatePreinscriptionSize(env.DB, org, id, tailleMaillot);
      return back(rowGroup, ok ? 'birthplace' : 'error');
    }
    // Réglages d'un groupe : sans champ groupe (ancien formulaire resté ouvert), le premier groupe.
    const key = String(form.get('groupe') || '');
    const config = key ? groups.find((g) => g.groupe === key) : groups[0];
    if (!config) return redirect('msg=error');
    if (action === 'delete-group') {
      await ensurePreinscriptionsTable(env.DB);
      const counts = await countByGroup(env.DB, org);
      if (counts[config.groupe] || config.openedAt) return back(config.groupe, 'groupNotEmpty');
      await setPreinscriptionGroups(env, org, groups.filter((g) => g.groupe !== config.groupe));
      return redirect('msg=groupDeleted');
    }
    if (action === 'config') {
      try {
        await setPreinscriptionGroups(env, org, groups.map((g) => (g.groupe === config.groupe ? { ...g, ...fields() } : g)));
      } catch {
        return back(config.groupe, 'invalid');
      }
      // Plafond abaissé au nombre d'inscrits : même ouverture automatique que la dernière place prise.
      const opening = await openPreinscriptionGroupIfFull(env, org, new URL(request.url).origin, config.groupe).catch(() => null);
      return back(config.groupe, opening?.status === 'opened' && opening.invited ? 'opened' : 'saved');
    }
  } catch {
    return redirect('msg=error');
  }
  return redirect('msg=error');
}
