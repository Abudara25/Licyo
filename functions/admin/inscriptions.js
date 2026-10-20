// Liste des inscriptions (base D1 "DB"), protégée par un mot de passe partagé (variable Cloudflare
// Pages ADMIN_PASSWORD, jamais commitée). Chaque carte mène à la fiche complète de l'inscription
// (functions/admin/inscriptions/[id].js : édition, dépôt du dossier, PDF, archivage). Les actions par
// fiche et groupées sont traitées ici (onRequestPost), tout comme la connexion.
import {
  ensureInscriptionsTable,
  isInscriptionComplete,
  dossierStatus,
  familyHasActionPending,
  hasBirthPlace,
  reinscriptionIds,
  archiveReason,
  readArchiveReason,
  ARCHIVE_MOTIFS,
  isTransferredToPreinscription,
  ageGroup,
  sortAgeGroups,
} from '../_shared/inscriptions-db.js';
import { photoTag,
  isAuthed,
  loginPage,
  escapeHtml,
  handleLogin,
  adminHead,
  adminShell,
  adminScripts,
  adminBadges,
  familyActions,
  icon,
  archiveReasonFields,
  avatar,
  statusTag,
  dossierTag,
  PHOTO_TAG,
  PAIEMENT_TAG,
  flash,
  formatDateFr,
  ageAndCategory,
  scopeRows,
} from '../_shared/admin-auth.js';

const DOSSIER_LABELS = { valide: 'Validé', a_verifier: 'À vérifier', refuse: 'Refusé', manquant: 'Non reçu' };
import { sendReminderEmail, sendReinscriptionEmail } from '../_shared/confirmation-email.js';
import { extendReinscriptionLink } from '../_shared/family-links.js';
import { loadAgeContext } from '../_shared/preinscriptions.js';
import { getCategoriesConfig, getInscriptionStatus, effectiveInscriptionStatus, todayIso } from '../_shared/settings-kv.js';
import { afterInscriptionChange } from '../_shared/automations.js';
import { deleteInscriptionPermanently } from '../_shared/inscription-deletion.js';
import { syncInscriptionSafe } from '../_shared/crm.js';
import { FOLLOWUP_STEPS } from '../_shared/club-followup.js';

function toCsv(rows, ageCtx) {
  const headers = ['Date', 'Enfant', 'Naissance', 'Code postal de naissance', 'Ville de naissance', 'Pays de naissance', 'N° licence FFF', 'Catégorie', "Catégorie d'âge", 'Taille maillot', 'Mode paiement', 'Paiement reçu', "Code Pass'Sport", 'Parent', 'E-mail', 'Téléphone', 'Adresse', 'Code postal', 'Ville', 'Autorisation', 'Droit image', 'RGPD', 'Dossier signé', 'Photo reçue', 'Parent 2', 'E-mail parent 2', 'Téléphone parent 2', 'Archivé le', 'Motif corbeille', ...FOLLOWUP_STEPS.map((s) => s.label)];
  // Un champ commençant par =, +, -, @, tab ou retour chariot est préfixé d'une apostrophe :
  // sinon Excel/Sheets peut l'interpréter comme une formule (injection CSV) à l'ouverture de
  // l'export si un parent a saisi ce genre de contenu dans le formulaire public.
  const escapeCsv = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) =>
    [
      r.created_at,
      `${r.enfant_prenom} ${r.enfant_nom}`,
      r.naissance,
      r.cp_naissance,
      r.ville_naissance,
      r.pays_naissance,
      r.numero_licence,
      r.categorie,
      ageGroup(r.naissance, ageCtx),
      r.taille_maillot,
      r.mode_paiement,
      r.paye ? 'Oui' : 'Non',
      r.pass_sport_code,
      `${r.parent_prenom} ${r.parent_nom}`,
      r.email,
      r.telephone,
      r.adresse,
      r.code_postal,
      r.ville,
      r.autorisation ? 'Oui' : 'Non',
      r.droit_image ? 'Oui' : 'Non',
      r.rgpd ? 'Oui' : 'Non',
      DOSSIER_LABELS[dossierStatus(r)],
      r.photo_uploaded_at ? 'Oui' : 'Non',
      [r.parent2_prenom, r.parent2_nom].filter(Boolean).join(' '),
      r.parent2_email,
      r.parent2_telephone,
      r.archived_at,
      r.archived_at ? archiveReason(r) : '',
      ...FOLLOWUP_STEPS.map((s) => (r[s.column] ? String(r[s.column]).slice(0, 10) : '')),
    ]
      .map(escapeCsv)
      .join(',')
  );
  return [headers.map(escapeCsv).join(','), ...lines].join('\r\n');
}

const SORTS = {
  date_desc: (a, b) => b.created_at.localeCompare(a.created_at),
  date_asc: (a, b) => a.created_at.localeCompare(b.created_at),
  nom_asc: (a, b) => a.enfant_nom.localeCompare(b.enfant_nom, 'fr') || a.enfant_prenom.localeCompare(b.enfant_prenom, 'fr'),
  nom_desc: (a, b) => b.enfant_nom.localeCompare(a.enfant_nom, 'fr') || b.enfant_prenom.localeCompare(a.enfant_prenom, 'fr'),
  naissance_asc: (a, b) => a.naissance.localeCompare(b.naissance),
  naissance_desc: (a, b) => b.naissance.localeCompare(a.naissance),
};

// Filtrage/tri appliqués côté JS après le SELECT * (peu de lignes attendues pour un seul club) —
// plus simple et plus sûr qu'une clause WHERE dynamique construite à partir des query params.
function filterAndSort(rows, { q, etat, categorie, age, annee, paiement, dossier, paye, photo, sort }, ageCtx) {
  const needle = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (etat === 'complet' && !isInscriptionComplete(r)) return false;
    if (etat === 'incomplet' && isInscriptionComplete(r)) return false;
    if (categorie && r.categorie !== categorie) return false;
    if (age && ageGroup(r.naissance, ageCtx) !== age) return false;
    if (paiement && r.mode_paiement !== paiement) return false;
    if (annee && !String(r.naissance || '').startsWith(annee)) return false;
    // 'recu' : ancienne valeur du filtre (avant la vérification des dossiers), gardée pour les liens existants.
    if (dossier && dossier in DOSSIER_LABELS && dossierStatus(r) !== dossier) return false;
    if (dossier === 'recu' && dossierStatus(r) !== 'valide') return false;
    if (paye === 'oui' && !r.paye) return false;
    if (paye === 'non' && r.paye) return false;
    if (photo === 'recue' && !r.photo_uploaded_at) return false;
    if (photo === 'manquante' && r.photo_uploaded_at) return false;
    if (needle) {
      const haystack = `${r.enfant_prenom} ${r.enfant_nom} ${r.parent_prenom} ${r.parent_nom} ${r.email} ${r.parent2_prenom || ''} ${r.parent2_nom || ''} ${r.parent2_email || ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  return filtered.sort(SORTS[sort] || SORTS.date_desc);
}

const FILTER_KEYS = ['q', 'etat', 'categorie', 'age', 'annee', 'paiement', 'dossier', 'paye', 'photo', 'sort'];

function parseFilters(searchParams) {
  const etat = searchParams.get('etat');
  return {
    q: searchParams.get('q') || '',
    etat: etat === 'complet' || etat === 'incomplet' ? etat : '',
    categorie: searchParams.get('categorie') || '',
    age: /^[\w -]{1,40}$/.test(searchParams.get('age') || '') ? searchParams.get('age') : '',
    annee: searchParams.get('annee') || '',
    paiement: searchParams.get('paiement') || '',
    dossier: searchParams.get('dossier') || '',
    paye: searchParams.get('paye') || '',
    photo: searchParams.get('photo') || '',
    view: searchParams.get('view') === 'archive' ? 'archive' : 'active',
    sort: searchParams.get('sort') || 'date_desc',
  };
}

// Redirection après une action : uniquement la liste (filtres compris) ou une fiche, jamais une
// redirection ouverte — permet de revenir exactement là où l'action a été lancée.
// Retour après une action : liste ou fiche d'inscription, ou page Réinscription (réinscriptions à finaliser).
// adherents/<id> : actions rapides de la fiche adhérent (2026-10-16).
const safeRedirect = (value, fallback) => (/^\/admin\/(inscriptions(\/\d+)?|reinscription|adherents\/\d+)(\?[^\s#]*)?$/.test(value || '') ? value : fallback);
const withParam = (url, param) => `${url}${url.includes('?') ? '&' : '?'}${param}`;

// Action principale d'une carte, selon ce qui manque : vérifier un dossier déposé par la famille, relancer
// la famille si le dossier signé manque ou a été refusé, sinon confirmer le paiement, sinon relancer pour
// la photo ; rien si l'inscription est complète (tout le reste est sur la fiche).
function primaryAction(r, returnTo) {
  const dossier = dossierStatus(r);
  const rawName = `${r.enfant_prenom} ${r.enfant_nom}`;
  const back = `<input type="hidden" name="redirectTo" value="${escapeHtml(returnTo)}">`;
  if (r.archived_at) {
    return `<form method="POST" action="/admin/inscriptions">
      <input type="hidden" name="action" value="restore"><input type="hidden" name="id" value="${r.id}">${back}
      <button type="submit" class="adm-btn adm-btn-primary">${icon('refresh')}Restaurer</button>
    </form>`;
  }
  if (dossier === 'a_verifier') {
    // Directement sur le document, où l'on peut valider ou refuser (puis enchaîner sur le suivant).
    return `<a href="/admin/inscriptions/${r.id}/apercu" class="adm-btn adm-btn-primary">${icon('eye')}Vérifier le dossier</a>`;
  }
  if (dossier === 'manquant' || dossier === 'refuse' || (r.paye && (!r.photo_uploaded_at || !hasBirthPlace(r)))) {
    return `<form method="POST" action="/admin/inscriptions" class="admin-confirm-form">
      <input type="hidden" name="action" value="bulk-reminder"><input type="hidden" name="ids" value="${r.id}">${back}
      <button type="submit" class="adm-btn adm-btn-primary" data-confirm="${escapeHtml(`Envoyer une relance par e-mail à la famille de ${rawName} ?`)}">${icon('send')}Relancer</button>
    </form>`;
  }
  if (!r.paye) {
    return `<form method="POST" action="/admin/inscriptions" class="admin-confirm-form">
      <input type="hidden" name="action" value="toggle-paye"><input type="hidden" name="id" value="${r.id}">${back}
      <button type="submit" class="adm-btn adm-btn-primary" data-confirm="${escapeHtml(`Confirmer que ${rawName} a payé ?`)}">${icon('check')}Marquer payé</button>
    </form>`;
  }
  return '';
}

function inscriptionCard(r, returnTo, ageCtx) {
  const name = `${escapeHtml(r.enfant_prenom)} ${escapeHtml(r.enfant_nom)}`;
  const ficheHref = `/admin/inscriptions/${r.id}`;
  const sub = r.archived_at
    ? `${escapeHtml(r.categorie)} · archivé le ${formatDateFr(r.archived_at)}${r.archive_motif ? ` · ${escapeHtml(ARCHIVE_MOTIFS[r.archive_motif] || r.archive_motif)}` : ''}`
    : `${ageAndCategory(ageGroup(r.naissance, ageCtx), r.categorie)} · inscription du ${formatDateFr(r.created_at)}`;
  return `<article class="adm-card">
    <div class="adm-card-top">
      <label class="insc-select-wrap"><input type="checkbox" class="insc-select" data-id="${r.id}" aria-label="Sélectionner ${name}"></label>
      ${avatar(r)}
      <div class="adm-card-id">
        <h3><a href="${ficheHref}">${name}</a></h3>
        <p>${sub}</p>
      </div>
    </div>
    <div class="adm-lines">
      <div class="adm-line"><span>Document</span>${dossierTag(r)}</div>
      <div class="adm-line"><span>Photo</span>${photoTag(r)}</div>
      <div class="adm-line"><span>Paiement${r.mode_paiement ? ` <small>· ${escapeHtml(r.mode_paiement)}</small>` : ''}</span>${statusTag(r.paye, PAIEMENT_TAG)}</div>
    </div>
    <div class="adm-card-actions">
      <a href="${ficheHref}" class="adm-btn adm-btn-ghost">Voir la fiche</a>
      ${primaryAction(r, returnTo)}
    </div>
    ${r.archived_at ? '' : familyActions({ phone: r.telephone, inscriptionId: r.id, child: `${r.enfant_prenom} ${r.enfant_nom}` })}
  </article>`;
}

// options : filters (vue + filtres courants), years/categories (valeurs distinctes présentes en
// base, pas la liste éditable de /admin/categories, pour que le filtre reste exact même après un
// renommage), total (nombre de fiches de la vue avant filtres), counts (compteurs de la vue),
// returnTo (chemin+query courant, pour revenir sur cette vue filtrée après une action),
// messages (dossierError/dossierOk/bulkOk), inscriptionStatus (brut, KV) et effectiveStatus (tenant
// compte de la date limite de réinscription, voir _shared/settings-kv.js), saison.
function listPage(rows, { filters, years, categories, ages, total, counts, returnTo, messages, inscriptionStatus, effectiveStatus, dateFermetureInscriptions, saison, ageCtx, badges }) {
  const isArchive = filters.view === 'archive';

  const paramsWith = (changes = {}) => {
    const params = new URLSearchParams();
    for (const key of FILTER_KEYS) {
      const value = key in changes ? changes[key] : filters[key];
      if (value && !(key === 'sort' && value === 'date_desc')) params.set(key, value);
    }
    if (isArchive) params.set('view', 'archive');
    return params;
  };
  const hrefWith = (changes) => {
    const qs = paramsWith(changes).toString();
    return `/admin/inscriptions${qs ? `?${qs}` : ''}`;
  };
  const hiddenInputs = (exclude) =>
    [...paramsWith().entries()]
      .filter(([key]) => !exclude.includes(key))
      .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
      .join('');

  const csvParams = paramsWith();
  csvParams.set('format', 'csv');
  const csvHref = `/admin/inscriptions?${csvParams.toString()}`;
  const advancedCount = [filters.annee, filters.paiement, filters.dossier, filters.paye, filters.photo].filter(Boolean).length;
  const hasActiveFilters = Boolean(filters.q || filters.categorie || advancedCount);
  const resetHref = isArchive ? '/admin/inscriptions?view=archive' : '/admin/inscriptions';

  const option = (name, value, label) =>
    `<option value="${escapeHtml(value)}" ${filters[name] === value ? 'selected' : ''}>${escapeHtml(label)}</option>`;

  const search = `<form method="GET" class="adm-search" role="search">
      ${hiddenInputs(['q'])}
      ${icon('search')}
      <label for="insc-q" class="visually-hidden">Rechercher</label>
      <input type="search" id="insc-q" name="q" value="${escapeHtml(filters.q)}" placeholder="Nom, prénom ou e-mail…">
      <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Chercher</button>
    </form>`;

  // <details> plutôt qu'un menu en JS : fonctionne sans script ; assets/js/admin-nav.js le referme
  // simplement au clic à l'extérieur (attribut data-dismiss).
  const filtersMenu = `<details class="adm-filters" data-dismiss>
      <summary class="adm-btn adm-btn-ghost">${icon('filter')}Filtres${advancedCount ? ` <span class="adm-count">${advancedCount}</span>` : ''}</summary>
      <form method="GET" class="adm-filters-panel insc-filters">
        ${hiddenInputs(['annee', 'paiement', 'dossier', 'paye', 'photo', 'sort'])}
        <label class="adm-field">Année de naissance
          <select name="annee" class="adm-select">${option('annee', '', 'Toutes')}${years.map((y) => option('annee', y, y)).join('')}</select>
        </label>
        <label class="adm-field">Mode de paiement
          <select name="paiement" class="adm-select">${option('paiement', '', 'Tous')}${['HelloAsso', 'Carte bancaire', 'Espèces', 'Chèque'].map((m) => option('paiement', m, m)).join('')}</select>
        </label>
        <label class="adm-field">Document
          <select name="dossier" class="adm-select">${option('dossier', '', 'Tous')}${Object.entries(DOSSIER_LABELS)
            .map(([value, label]) => option('dossier', value, label))
            .join('')}</select>
        </label>
        <label class="adm-field">Paiement
          <select name="paye" class="adm-select">${option('paye', '', 'Tous')}${option('paye', 'oui', 'Payé')}${option('paye', 'non', 'Non payé')}</select>
        </label>
        <label class="adm-field">Photo
          <select name="photo" class="adm-select">${option('photo', '', 'Toutes')}${option('photo', 'recue', 'Reçue')}${option('photo', 'manquante', 'Non reçue')}</select>
        </label>
        <label class="adm-field adm-field-wide">Trier par
          <select name="sort" class="adm-select">
            ${option('sort', 'date_desc', "Plus récentes d'abord")}
            ${option('sort', 'date_asc', "Plus anciennes d'abord")}
            ${option('sort', 'nom_asc', 'Enfant A → Z')}
            ${option('sort', 'nom_desc', 'Enfant Z → A')}
            ${option('sort', 'naissance_asc', "Naissance : plus âgé d'abord")}
            ${option('sort', 'naissance_desc', "Naissance : plus jeune d'abord")}
          </select>
        </label>
        <div class="adm-filters-actions">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">Appliquer</button>
          ${hasActiveFilters ? `<a href="${resetHref}" class="adm-btn adm-btn-sm adm-btn-ghost">Tout réinitialiser</a>` : ''}
        </div>
      </form>
    </details>`;

  const segLink = (changes, label, active) =>
    `<a href="${escapeHtml(hrefWith(changes))}" class="${active ? 'is-active' : ''}"${active ? ' aria-current="true"' : ''}>${label}</a>`;
  const etatSeg = `<nav class="adm-seg" aria-label="Filtrer par état du dossier">
      ${segLink({ etat: '', dossier: '' }, isArchive ? 'Tous' : `À compléter <em>${counts.total}</em>`, filters.dossier !== 'a_verifier')}
      ${segLink({ etat: '', dossier: 'a_verifier' }, `Dossiers à vérifier <em>${counts.aVerifier}</em>`, filters.dossier === 'a_verifier')}
    </nav>`;
  // Une inscription complète quitte cette liste pour Adhérents ; une réinscription incomplète se suit dans Réinscription.
  const separation = isArchive
    ? ''
    : `<p class="adm-help adm-help-separation">Dès qu'une inscription est complète (dossier validé, paiement et photo), elle passe dans <a href="/admin/adherents" class="adm-link">Adhérents</a> (${counts.adherents}). Les réinscriptions de la saison pas encore complètes se suivent dans <a href="/admin/reinscription#a-finaliser" class="adm-link">Réinscription</a> (${counts.reinscriptions}).</p>`;
  // Une pastille par catégorie d'âge (U6, U7, U8…), demandée par l'utilisateur à la place de « U6 - U7 » / « U8 - U9 ».
  const catSeg =
    ages.length > 1
      ? `<nav class="adm-seg" aria-label="Filtrer par catégorie d'âge">
      ${segLink({ age: '', categorie: '' }, 'Toutes', !filters.age && !filters.categorie)}
      ${ages.map((a) => segLink({ age: a, categorie: '' }, escapeHtml(a), filters.age === a)).join('')}
    </nav>`
      : '';

  const toolbar = `<section class="adm-surface adm-toolbar" aria-label="Recherche et filtres">
    <div class="adm-toolbar-row">${search}${filtersMenu}</div>
    <div class="adm-toolbar-row">${etatSeg}${catSeg}${hasActiveFilters ? `<a href="${resetHref}" class="adm-reset">Réinitialiser</a>` : ''}</div>
    ${separation}
  </section>`;

  const frDate = (iso) => escapeHtml(String(iso).split('-').reverse().join('/'));
  const autoClosed = Boolean(dateFermetureInscriptions && todayIso() >= dateFermetureInscriptions);
  const heroNote = autoClosed
    ? `Fermeture automatique depuis le ${frDate(dateFermetureInscriptions)} — pour rouvrir, retirez ou repoussez la date dans <a href="/admin/categories">Catégories</a>.`
    : effectiveStatus === 'open' && inscriptionStatus === 'closed'
      ? 'Rouverture automatique : la date limite de réinscription est atteinte (voir Catégories).'
      : dateFermetureInscriptions
        ? `Fermeture automatique prévue le ${frDate(dateFermetureInscriptions)} (voir <a href="/admin/categories">Catégories</a>).`
        : '';
  // Pendant une fermeture automatique, le bouton "Rouvrir" n'aurait aucun effet : on le masque.
  const statusBlock = isArchive
    ? ''
    : `<div class="adm-hero-status ${effectiveStatus === 'closed' ? 'is-closed' : 'is-open'}">
        <span class="adm-dot" aria-hidden="true"></span>
        <span class="adm-hero-status-text"><strong>Inscriptions ${effectiveStatus === 'closed' ? 'fermées' : 'ouvertes'}</strong> <small>sur le site</small></span>
        ${
          autoClosed
            ? ''
            : inscriptionStatus === 'closed'
              ? `<form method="POST" action="/admin/inscription-status">
          <input type="hidden" name="status" value="open">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-white">Rouvrir les inscriptions</button>
        </form>`
              : // Fermeture : libellé explicite et confirmation (le formulaire public disparaît pour toutes les familles).
                `<form method="POST" action="/admin/inscription-status" class="admin-confirm-form">
          <input type="hidden" name="status" value="closed">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-white" data-confirm="Fermer les inscriptions sur le site ? Le formulaire public sera remplacé par le message « Inscriptions fermées » pour toutes les familles, jusqu'à ce que vous les rouvriez.">Fermer les inscriptions</button>
        </form>`
        }
      </div>
      ${heroNote ? `<p class="adm-hero-note">${heroNote}</p>` : ''}`;

  const plural = (n, word) => `${word}${n > 1 ? 's' : ''}`;
  const shell = adminShell({
    active: isArchive ? 'archive' : 'inscriptions',
    badges,
    eyebrow: isArchive ? 'Inscriptions archivées' : `Saison ${escapeHtml(saison)}`,
    title: isArchive ? 'Corbeille' : 'Inscriptions',
    subtitle: isArchive ? 'Profils archivés, récupérables à tout moment.' : '',
    stats: isArchive
      ? [{ value: counts.total, label: `${plural(counts.total, 'profil')} ${plural(counts.total, 'archivé')}` }]
      : [
          { value: counts.total, label: 'à compléter' },
          { value: `${counts.dossier}/${counts.total}`, label: 'documents validés' },
          { value: `${counts.photo}/${counts.total}`, label: 'photos reçues' },
          { value: `${counts.paye}/${counts.total}`, label: 'payés' },
        ],
    actions: statusBlock,
  });

  const flashes = [
    messages.dossierError && flash('error', messages.dossierError),
    messages.dossierOk && flash('ok', 'Dossier enregistré.'),
    messages.bulkOk && flash('ok', messages.bulkOk),
    messages.bulkError && flash('error', messages.bulkError),
  ]
    .filter(Boolean)
    .join('');

  // Les cases à cocher sont dans les cartes, pas dans #bulk-form (une carte contient déjà ses propres
  // <form>, et imbriquer des <form> est invalide) : assets/js/admin-inscriptions.js injecte un
  // <input name="ids"> par case cochée dans #bulk-ids-container juste avant l'envoi.
  const bulkBar = `<form method="POST" action="/admin/inscriptions" id="bulk-form" class="adm-surface adm-bulk">
    <input type="hidden" name="action" id="bulk-action" value="">
    <input type="hidden" name="redirectTo" value="${escapeHtml(returnTo)}">
    <div id="bulk-ids-container"></div>
    <label class="adm-bulk-all"><input type="checkbox" id="bulk-select-all">Tout sélectionner</label>
    <span id="bulk-count" class="adm-bulk-count">0 sélectionné(s)</span>
    <button type="button" class="adm-btn adm-btn-sm adm-btn-ghost" data-bulk-action="bulk-export" disabled>${icon('download')}Exporter</button>
    ${
      isArchive
        ? ''
        : `<button type="button" class="adm-btn adm-btn-sm adm-btn-gold" data-bulk-action="bulk-reminder" data-confirm="Envoyer une relance par e-mail aux profils sélectionnés dont l'inscription n'est pas complète (dossier, photo ou paiement manquant) ? Les profils déjà complets ne recevront rien." disabled>${icon('send')}Relancer</button>
    <details class="adm-refuse adm-archive adm-bulk-archive" data-dismiss>
      <summary class="adm-btn adm-btn-sm adm-btn-danger">${icon('archive')}Archiver</summary>
      <div class="adm-refuse-form adm-archive-form">
        ${archiveReasonFields('bulk')}
        <button type="button" class="adm-btn adm-btn-danger-solid adm-btn-block" data-bulk-action="bulk-archive" data-confirm="Mettre les profils sélectionnés à la corbeille ? Ils restent récupérables à tout moment." disabled>${icon('archive')}Mettre à la corbeille</button>
      </div>
    </details>`
    }
  </form>`;

  const emptyText = hasActiveFilters
    ? 'Aucune inscription ne correspond à ces filtres.'
    : isArchive
      ? 'La corbeille est vide.'
      : 'Aucune inscription à compléter : les inscriptions complètes sont dans Adhérents.';
  const list = rows.length
    ? `${bulkBar}<div class="adm-cards">${rows.map((r) => inscriptionCard(r, returnTo, ageCtx)).join('')}</div>`
    : `<div class="adm-surface adm-empty">${icon(isArchive ? 'trash' : 'users')}<p>${emptyText}</p>${
        hasActiveFilters ? `<a href="${resetHref}" class="adm-btn adm-btn-ghost">Réinitialiser les filtres</a>` : ''
      }</div>`;

  return `${adminHead(isArchive ? 'Corbeille' : 'Inscriptions')}
${shell}
<main id="adm-main" class="adm-wrap adm-main">
  ${flashes}
  ${toolbar}
  <div class="adm-section-head">
    <h2 class="adm-h2">${isArchive ? 'Profils archivés' : "Dossiers d'inscription"} <span class="adm-count">${rows.length}${rows.length !== total ? ` / ${total}` : ''}</span></h2>
    ${rows.length ? `<a href="${escapeHtml(csvHref)}" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('download')}<span class="adm-hide-sm">Exporter en </span>CSV${hasActiveFilters ? ' (filtré)' : ''}</a>` : ''}
  </div>
  ${list}
</main>
${adminScripts('admin-nav', 'admin-inscriptions')}
</body></html>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  await ensureInscriptionsTable(env.DB);
  const { results: allRows } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? ORDER BY created_at DESC').bind(admin.organizationId).all();
  // Entraîneur : seulement ses groupes (admin.groupScope), y compris dans le CSV et les compteurs.
  const results = scopeRows(admin, allRows);

  const { searchParams } = new URL(request.url);
  const filters = parseFilters(searchParams);
  const categoriesConfig = await getCategoriesConfig(env, admin.organizationId);
  const { saison, dateLimiteReinscription, dateFermetureInscriptions } = categoriesConfig;
  const ageCtx = await loadAgeContext(env, admin.organizationId, categoriesConfig);
  const isCsv = searchParams.get('format') === 'csv';
  // Les inscriptions complètes sont dans Adhérents ; l'ancien onglet « Complets » y mène. Le CSV des complets
  // (?etat=complet&format=csv, bouton d'export de la page Adhérents) reste servi ici.
  if (filters.view === 'active' && filters.etat === 'complet' && !isCsv) {
    return new Response('', { status: 302, headers: { Location: '/admin/adherents' } });
  }
  // La corbeille (filters.view === 'archive') et la liste active se partagent la même requête
  // SELECT * ; on scope sur archived_at avant d'appliquer les autres filtres (recherche,
  // catégorie…), pour que les deux vues restent filtrables/triables indépendamment.
  // Liste active = inscriptions à compléter, hors réinscriptions de la saison (suivies dans /admin/reinscription).
  const activeRows = results.filter((r) => !r.archived_at);
  const reinscrits = reinscriptionIds(results, saison);
  const viewRows =
    filters.view === 'archive'
      ? results.filter((r) => r.archived_at && !isTransferredToPreinscription(r))
      : filters.etat === 'complet'
        ? activeRows.filter(isInscriptionComplete)
        : activeRows.filter((r) => !isInscriptionComplete(r) && !reinscrits.has(r.id));
  const filtered = filterAndSort(viewRows, filters, ageCtx);

  if (isCsv) {
    return new Response(toCsv(filtered, ageCtx), {
      headers: {
        'Content-Type': 'text/csv;charset=UTF-8',
        'Content-Disposition': `attachment; filename="${filters.etat === 'complet' ? 'adherents' : 'inscriptions'}.csv"`,
      },
    });
  }

  const years = [...new Set(results.map((r) => String(r.naissance || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const categories = [...new Set(results.map((r) => r.categorie).filter(Boolean))].sort();
  const complet = viewRows.filter(isInscriptionComplete).length;
  const counts = {
    total: viewRows.length,
    dossier: viewRows.filter((r) => dossierStatus(r) === 'valide').length,
    aVerifier: viewRows.filter((r) => dossierStatus(r) === 'a_verifier').length,
    photo: viewRows.filter((r) => r.photo_uploaded_at).length,
    paye: viewRows.filter((r) => r.paye).length,
    complet,
    incomplet: viewRows.length - complet,
    adherents: activeRows.filter(isInscriptionComplete).length,
    reinscriptions: activeRows.filter((r) => !isInscriptionComplete(r) && reinscrits.has(r.id)).length,
  };

  // Chemin+query courant, sans les messages ponctuels (pas des filtres à reproduire) — sert de
  // redirectTo aux actions des cartes et de la barre de sélection.
  const returnParams = new URLSearchParams(searchParams);
  ['dossierError', 'dossierOk', 'bulkOk', 'bulkError', 'savedOk'].forEach((key) => returnParams.delete(key));
  const returnTo = `/admin/inscriptions${returnParams.toString() ? `?${returnParams.toString()}` : ''}`;

  let inscriptionStatus = 'open';
  try {
    const value = await getInscriptionStatus(env, admin.organizationId);
    if (value === 'open' || value === 'closed') inscriptionStatus = value;
  } catch {
    // KV indisponible (binding non configuré) : on reste sur "open" par défaut.
  }

  const effectiveStatus = effectiveInscriptionStatus(inscriptionStatus, dateLimiteReinscription, dateFermetureInscriptions);

  return new Response(
    listPage(filtered, {
      ages: sortAgeGroups(new Set(viewRows.map((r) => ageGroup(r.naissance, ageCtx)).filter(Boolean))),
      filters,
      years,
      categories,
      total: viewRows.length,
      counts,
      returnTo,
      messages: {
        dossierError: searchParams.get('dossierError'),
        dossierOk: searchParams.get('dossierOk'),
        bulkOk: searchParams.get('bulkOk'),
        bulkError: searchParams.get('bulkError'),
      },
      inscriptionStatus,
      effectiveStatus,
      dateFermetureInscriptions,
      saison,
      ageCtx,
      badges: await adminBadges(env, admin),
    }),
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}

// Actions ponctuelles par fiche : delete = suppression définitive (proposée seulement depuis la
// corbeille), toggle-paye = bascule le statut de paiement, archive = sort la fiche de la liste
// active vers la corbeille (réversible), restore = l'inverse. Chaque requête est limitée à l'organisation
// de la session (org) : un identifiant d'une autre organisation ne modifie rien.
const ROW_ACTIONS = {
  // Fiche, fichiers R2 et journaux : voir _shared/inscription-deletion.js (appelé directement par onRequestPost).
  delete: null,
  // Repasser en non payé remet complete_notified_at à zéro : « Dossier complet » repartira au vrai paiement.
  'toggle-paye': (db, org, id) =>
    db.prepare('UPDATE inscriptions SET paye = 1 - paye, complete_notified_at = CASE WHEN paye = 1 THEN NULL ELSE complete_notified_at END WHERE organization_id = ? AND id = ?').bind(org, id).run(),
  // Motif obligatoire (readArchiveReason), vérifié par onRequestPost avant l'appel.
  archive: (db, org, id, { motif, commentaire }) =>
    db.prepare("UPDATE inscriptions SET archived_at = datetime('now'), archive_motif = ?, archive_commentaire = ? WHERE organization_id = ? AND id = ?").bind(motif, commentaire, org, id).run(),
  restore: (db, org, id) =>
    db.prepare('UPDATE inscriptions SET archived_at = NULL, archive_motif = NULL, archive_commentaire = NULL WHERE organization_id = ? AND id = ?').bind(org, id).run(),
};

export async function onRequestPost({ request, env, waitUntil }) {
  const form = await request.formData();
  const action = form.get('action');

  const admin = await isAuthed(request, env);

  if (action in ROW_ACTIONS) {
    if (!admin) {
      return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    const id = Number(form.get('id'));
    const fallback = `/admin/inscriptions${form.get('view') === 'archive' ? '?view=archive' : ''}`;
    const reason = action === 'archive' ? readArchiveReason(form) : null;
    if (reason?.error) {
      const back = safeRedirect(form.get('redirectTo'), fallback);
      return new Response('', { status: 302, headers: { Location: withParam(back, `bulkError=${encodeURIComponent(reason.error)}`) } });
    }
    if (id && action === 'delete') {
      const result = await deleteInscriptionPermanently(env, admin.organizationId, id);
      if (result.error) {
        return new Response('', { status: 302, headers: { Location: withParam(fallback, `bulkError=${encodeURIComponent(result.error)}`) } });
      }
    } else if (id) {
      await ensureInscriptionsTable(env.DB);
      const before =
        action === 'toggle-paye'
          ? await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first()
          : null;
      await ROW_ACTIONS[action](env.DB, admin.organizationId, id, reason);
      // L'adhésion CRM suit l'archivage / la restauration de l'inscription.
      if (action === 'archive' || action === 'restore') waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
      // Paiement tout juste validé : e-mail de suivi / "Dossier complet" à la famille (_shared/automations.js).
      if (before && !before.paye) {
        waitUntil(
          afterInscriptionChange(env, { organizationId: admin.organizationId, id, before, step: 'paiement', source: 'admin', siteUrl: new URL(request.url).origin })
        );
      }
    }
    // Une fiche supprimée n'existe plus : jamais de retour sur sa page après un "delete".
    const redirectTo = action === 'delete' ? fallback : safeRedirect(form.get('redirectTo'), fallback);
    return new Response('', { status: 302, headers: { Location: redirectTo } });
  }

  // Actions groupées (barre #bulk-form, voir assets/js/admin-inscriptions.js) ou relance d'une seule
  // fiche (bouton "Relancer" d'une carte ou d'une fiche, qui poste directement un seul ids).
  if (action === 'bulk-archive' || action === 'bulk-export' || action === 'bulk-reminder') {
    if (!admin) {
      return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    await ensureInscriptionsTable(env.DB);
    const ids = form.getAll('ids').map(Number).filter(Boolean);
    const redirectTo = safeRedirect(form.get('redirectTo'), `/admin/inscriptions${form.get('view') === 'archive' ? '?view=archive' : ''}`);

    if (!ids.length) {
      return new Response('', { status: 302, headers: { Location: redirectTo } });
    }

    if (action === 'bulk-archive') {
      const reason = readArchiveReason(form);
      if (reason.error) {
        return new Response('', { status: 302, headers: { Location: withParam(redirectTo, `bulkError=${encodeURIComponent(reason.error)}`) } });
      }
      for (const id of ids) {
        await ROW_ACTIONS.archive(env.DB, admin.organizationId, id, reason);
        waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
      }
      const msg = encodeURIComponent(`${ids.length} profil${ids.length > 1 ? 's' : ''} archivé${ids.length > 1 ? 's' : ''}.`);
      return new Response('', { status: 302, headers: { Location: withParam(redirectTo, `bulkOk=${msg}`) } });
    }

    const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(admin.organizationId).all();
    const selected = results.filter((r) => ids.includes(r.id));

    if (action === 'bulk-export') {
      return new Response(toCsv(selected), {
        headers: {
          'Content-Type': 'text/csv;charset=UTF-8',
          'Content-Disposition': 'attachment; filename="inscriptions-selection.csv"',
        },
      });
    }

    // bulk-reminder : un e-mail par profil sélectionné n'ayant pas encore payé ou pas encore envoyé
    // son dossier (sendReminderEmail ignore elle-même les profils déjà complets, renvoie alors
    // false — compté comme "ignoré" ici plutôt que comme un échec d'envoi).
    const siteUrl = new URL(request.url).origin;
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of selected) {
      // Complet, ou seul un dossier en attente de vérification par le club : rien à demander à la famille.
      if (!familyHasActionPending(row)) {
        skipped++;
        continue;
      }
      const ok = await sendReminderEmail(env, row, siteUrl);
      if (ok) {
        sent++;
        // Compte aussi pour l'espacement des relances automatiques (_shared/automations.js).
        await env.DB.prepare("UPDATE inscriptions SET last_reminder_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(admin.organizationId, row.id).run();
      } else {
        failed++;
      }
    }
    const parts = [`${sent} relance${sent > 1 ? 's' : ''} envoyée${sent > 1 ? 's' : ''}`];
    if (skipped) parts.push(`${skipped} ignoré${skipped > 1 ? 's' : ''} (rien à faire côté famille : complet ou dossier à vérifier)`);
    if (failed) parts.push(`${failed} échec${failed > 1 ? 's' : ''}`);
    const msg = encodeURIComponent(`${parts.join(', ')}.`);
    return new Response('', { status: 302, headers: { Location: withParam(redirectTo, `bulkOk=${msg}`) } });
  }

  // bulk-reinscription : génère (si besoin) un reinscription_token par fiche sélectionnée puis
  // envoie à chaque famille son lien personnel /reinscription/<token> (functions/reinscription/
  // [token].js) — voir sendReinscriptionEmail. bulk-reinscription-rappel : même envoi, mais wording
  // de relance (isRappel) et réservé aux familles déjà contactées une première fois (un rappel n'a
  // de sens que si un lien existe déjà) — déclenché à la main autant de fois que nécessaire avant la
  // date limite (/admin/categories) depuis /admin/reinscription, pas d'automatisation programmée
  // (pas de Cron Trigger pour ce projet, voir la discussion avec l'utilisateur). Lancée depuis
  // /admin/inscriptions (sélection libre) ou /admin/reinscription (déjà scopée aux adhérents de la
  // saison précédente) — redirectTo ramène sur la page d'où l'action a été lancée, jamais une
  // redirection ouverte (allowlist ci-dessous).
  if (action === 'bulk-reinscription' || action === 'bulk-reinscription-rappel') {
    if (!admin) {
      return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
    }
    const isRappel = action === 'bulk-reinscription-rappel';
    await ensureInscriptionsTable(env.DB);
    const ids = form.getAll('ids').map(Number).filter(Boolean);
    const redirectView = form.get('view') === 'archive' ? '?view=archive' : '';
    const redirectTo = /^\/admin\/(inscriptions|reinscription)(\?[^\s]*)?$/.test(form.get('redirectTo') || '')
      ? form.get('redirectTo')
      : `/admin/inscriptions${redirectView}`;

    if (!ids.length) {
      return new Response('', { status: 302, headers: { Location: redirectTo } });
    }

    const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(admin.organizationId).all();
    const selected = results.filter((r) => ids.includes(r.id));
    const { saison, dateLimiteReinscription } = await getCategoriesConfig(env, admin.organizationId);
    const siteUrl = new URL(request.url).origin;

    // Une fiche déjà réinscrite pour la saison en cours (même dedup_key qu'une fiche de cette
    // saison — voir _shared/inscriptions-db.js) n'a pas besoin de recevoir le lien une seconde
    // fois : renvoyer "réinscrivez-vous" à une famille qui l'a déjà fait serait déroutant.
    const currentSeasonKeys = new Set(results.filter((r) => r.saison === saison).map((r) => r.dedup_key));

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (let row of selected) {
      if (currentSeasonKeys.has(row.dedup_key)) {
        skipped++;
        continue;
      }
      // Un rappel n'a de sens que pour une famille déjà contactée une première fois — sans lien
      // existant, rien à rappeler (elle recevrait le même message qu'un premier envoi, sous un sujet
      // "Rappel" trompeur).
      if (isRappel && !row.reinscription_token) {
        skipped++;
        continue;
      }
      if (!row.reinscription_token) {
        const token = crypto.randomUUID();
        await env.DB.prepare('UPDATE inscriptions SET reinscription_token = ? WHERE organization_id = ? AND id = ?').bind(token, admin.organizationId, row.id).run();
        row = { ...row, reinscription_token: token };
      }
      // Lien valable FAMILY_LINK_DAYS jours à partir de cet envoi (_shared/family-links.js).
      await extendReinscriptionLink(env.DB, admin.organizationId, row.id);
      const ok = await sendReinscriptionEmail(env, row, siteUrl, dateLimiteReinscription, isRappel);
      if (ok) sent++;
      else failed++;
    }
    const parts = [`${sent} ${isRappel ? 'rappel' : 'lien de réinscription'}${sent > 1 ? 's' : ''} envoyé${sent > 1 ? 's' : ''}`];
    if (skipped) parts.push(`${skipped} ignoré${skipped > 1 ? 's' : ''} (${isRappel ? 'déjà réinscrit ou jamais contacté' : 'déjà réinscrit'}${skipped > 1 ? 's' : ''})`);
    if (failed) parts.push(`${failed} échec${failed > 1 ? 's' : ''} (service d’envoi non configuré ou envoi refusé — le lien reste consultable sur /admin/reinscription)`);
    const msg = encodeURIComponent(`${parts.join(', ')}.`);
    return new Response('', { status: 302, headers: { Location: withParam(redirectTo, `bulkOk=${msg}`) } });
  }

  return handleLogin(request, env, form);
}
