// Liste des inscriptions (base D1 "DB"), protégée par un mot de passe partagé (variable Cloudflare
// Pages ADMIN_PASSWORD, jamais commitée). Chaque carte mène à la fiche complète de l'inscription
// (functions/admin/inscriptions/[id].js : édition, dépôt du dossier, PDF, archivage). Les actions par
// fiche et groupées sont traitées ici (onRequestPost), tout comme la connexion.
import { isPartiallyPaid, paymentBalance, formatEuros, exemptionLabel } from '../_shared/payments.js';
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
import {
  isAuthed,
  loginPage,
  escapeHtml,
  handleLogin,
  adminHead,
  adminShell,
  adminScripts,
  adminBadges,
  icon,
  archiveReasonFields,
  avatar,
  flash,
  formatDateFr,
  ageAndCategory,
} from '../_shared/admin-auth.js';

const DOSSIER_LABELS = { valide: 'Validé', a_verifier: 'À vérifier', refuse: 'Refusé', manquant: 'Non reçu' };
import { sendReminderEmail, sendReinscriptionEmail } from '../_shared/confirmation-email.js';
import { extendReinscriptionLink } from '../_shared/family-links.js';
import { loadAgeContext } from '../_shared/preinscriptions.js';
import { getCategoriesConfig, getInscriptionStatus, effectiveInscriptionStatus, todayIso } from '../_shared/settings-kv.js';
import { afterInscriptionChange } from '../_shared/automations.js';
import { deleteInscriptionPermanently } from '../_shared/inscription-deletion.js';
import { syncInscriptionSafe } from '../_shared/crm.js';
import { FOLLOWUP_STEPS, LICENCE_DOCS, LICENCE_STAGES, DOC_STATES, licenceStage } from '../_shared/club-followup.js';

function toCsv(rows, ageCtx) {
  const headers = ['Date', 'Enfant', 'Naissance', 'Code postal de naissance', 'Ville de naissance', 'Pays de naissance', 'N° licence FFF', 'Catégorie', "Catégorie d'âge", 'Taille maillot', 'Mode paiement', 'Paiement reçu', 'Exemption de paiement', "Code Pass'Sport", 'Parent', 'E-mail', 'Téléphone', 'Adresse', 'Code postal', 'Ville', 'Autorisation', 'Droit image', 'RGPD', 'Dossier signé', 'Photo reçue', 'Parent 2', 'E-mail parent 2', 'Téléphone parent 2', 'Archivé le', 'Motif corbeille', ...FOLLOWUP_STEPS.map((s) => s.label), 'Étape licence', ...LICENCE_DOCS.map((d) => d.label), 'Dernière relance licence'];
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
      exemptionLabel(r),
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
      LICENCE_STAGES[licenceStage(r)].label,
      ...LICENCE_DOCS.map((d) => DOC_STATES[r[d.column]]?.label || ''),
      r.licence_relance_at ? String(r.licence_relance_at).slice(0, 10) : '',
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
  if (!r.paye && Number(r.montant_recu_cents) > 0) {
    // Solde en cours : il s'enregistre comme un versement sur la fiche, pas par « Marquer payé ».
    return `<a href="/admin/inscriptions/${r.id}#versement" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer un versement</a>`;
  }
  if (!r.paye) {
    return `<form method="POST" action="/admin/inscriptions" class="admin-confirm-form">
      <input type="hidden" name="action" value="toggle-paye"><input type="hidden" name="id" value="${r.id}">${back}
      <button type="submit" class="adm-btn adm-btn-primary" data-confirm="${escapeHtml(`Confirmer que ${rawName} a payé ?`)}">${icon('check')}Marquer payé</button>
    </form>`;
  }
  return '';
}

// ---------- Refonte « à l'échelle » (2026-11-13), même logique que les pré-inscriptions ----------
// Actions d'abord (toutes catégories), tableau des catégories, sélecteur de catégorie avec recherche, une ligne
// compacte par enfant avec trois pastilles (dossier, photo, paiement). Tout est calculé à l'affichage.

// État principal d'une inscription à compléter, dans l'ordre où le club doit agir.
export function inscriptionState(r) {
  if (r.archived_at) return { label: 'Corbeille', tone: 'neutral' };
  const dossier = dossierStatus(r);
  if (dossier === 'a_verifier') return { label: 'Dossier à vérifier', tone: 'wait' };
  if (dossier === 'refuse') return { label: 'Dossier refusé', tone: 'no' };
  if (dossier === 'manquant') return { label: 'Dossier manquant', tone: 'no' };
  if (isPartiallyPaid(r)) return { label: `Reste ${formatEuros(paymentBalance(r).reste)}`, tone: 'wait' };
  if (!r.paye) return { label: 'Paiement en attente', tone: 'wait' };
  if (r.photo_refused_at && !r.photo_uploaded_at) return { label: 'Photo à refaire', tone: 'no' };
  if (!r.photo_uploaded_at) return { label: 'Photo manquante', tone: 'wait' };
  return { label: 'À compléter', tone: 'neutral' };
}

// Pastilles D (dossier signé), P (photo), € (paiement) : vert fait, orange en cours, rouge refusé, gris rien.
function stepDots(r) {
  const dossier = { valide: 'yes', a_verifier: 'wait', refuse: 'no', manquant: 'none' }[dossierStatus(r)];
  const photo = r.photo_uploaded_at ? 'yes' : r.photo_refused_at ? 'no' : 'none';
  const pay = r.paye ? 'yes' : isPartiallyPaid(r) ? 'wait' : 'none';
  const word = { yes: 'fait', wait: 'en cours', no: 'refusé', none: 'manquant' };
  const dot = (letter, label, tone) => `<span class="adm-dot-step is-${tone}" title="${label} : ${word[tone]}">${letter}<span class="visually-hidden"> ${label} : ${word[tone]}</span></span>`;
  return `<span class="adm-dots-steps">${dot('D', 'Dossier signé', dossier)}${dot('P', 'Photo', photo)}${dot('€', 'Paiement', pay)}</span>`;
}

// Actions à faire, toutes catégories : une entrée par type, avec les enfants concernés.
const TODO_DEFS = [
  { key: 'verifier', icon: 'eye', tone: 'no', title: (n) => `${n} dossier${n > 1 ? 's' : ''} signé${n > 1 ? 's' : ''} à vérifier`, test: (r) => dossierStatus(r) === 'a_verifier', filter: { dossier: 'a_verifier' }, button: 'Vérifier' },
  { key: 'relancer', icon: 'send', tone: 'wait', title: (n) => `${n} famille${n > 1 ? 's' : ''} sans dossier signé`, test: (r) => ['manquant', 'refuse'].includes(dossierStatus(r)), filter: { dossier: 'manquant' }, button: 'Voir' },
  { key: 'payer', icon: 'card', tone: 'wait', title: (n) => `${n} paiement${n > 1 ? 's' : ''} à encaisser au club`, test: (r) => !r.paye && dossierStatus(r) === 'valide' && r.mode_paiement && r.mode_paiement !== 'HelloAsso', filter: { paye: 'non' }, button: 'Voir' },
  { key: 'photo', icon: 'camera', tone: 'wait', title: (n) => `${n} photo${n > 1 ? 's' : ''} à refaire`, test: (r) => Boolean(r.photo_refused_at) && !r.photo_uploaded_at, filter: { photo: 'manquante' }, button: 'Voir' },
];

export function inscriptionTodos(rows, ageCtx) {
  return TODO_DEFS.map((def) => {
    const items = rows.filter(def.test);
    const byAge = new Map();
    for (const r of items) {
      const age = ageGroup(r.naissance, ageCtx) || r.categorie || '—';
      byAge.set(age, (byAge.get(age) || 0) + 1);
    }
    return { ...def, items, where: sortAgeGroups(new Set(byAge.keys())).map((a) => (byAge.get(a) > 1 ? `${a} (${byAge.get(a)})` : a)) };
  }).filter((t) => t.items.length);
}

function inscriptionRow(r, returnTo, ageCtx) {
  const name = `${escapeHtml(r.enfant_prenom)} ${escapeHtml(r.enfant_nom)}`;
  const ficheHref = `/admin/inscriptions/${r.id}`;
  const state = inscriptionState(r);
  const sub = r.archived_at
    ? `${escapeHtml(r.categorie)} · archivé le ${formatDateFr(r.archived_at)}${r.archive_motif ? ` · ${escapeHtml(ARCHIVE_MOTIFS[r.archive_motif] || r.archive_motif)}` : ''}`
    : `${ageAndCategory(ageGroup(r.naissance, ageCtx), r.categorie)} · inscription du ${formatDateFr(r.created_at)}`;
  return `<article class="adm-irow" id="inscription-${r.id}">
    <label class="insc-select-wrap"><input type="checkbox" class="insc-select" data-id="${r.id}" aria-label="Sélectionner ${name}"></label>
    ${avatar(r)}
    <div class="adm-irow-id"><h3><a href="${ficheHref}">${name}</a></h3><p>${sub}${r.mode_paiement && !r.archived_at ? ` · ${escapeHtml(r.mode_paiement)}` : ''}</p></div>
    ${r.archived_at ? '<span></span>' : stepDots(r)}
    <span class="adm-tag is-${state.tone}">${escapeHtml(state.label)}</span>
    <div class="adm-irow-actions">${primaryAction(r, returnTo)}${r.archived_at ? '' : `<a class="adm-btn adm-btn-ghost" href="/admin/email?inscription=${r.id}">${icon('mail')}E-mail<span class="visually-hidden"> (famille de ${name})</span></a>`}</div>
  </article>`;
}

// Haut de la liste : sélecteur de catégorie, puis soit la vue d'ensemble (actions de toutes les catégories et tableau
// des catégories), soit l'en-tête de la catégorie choisie (jauge et actions de la catégorie).
function overview({ viewRows, ages, filters, ageCtx, hrefWith }) {
  const ageOf = (r) => ageGroup(r.naissance, ageCtx);
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const summaries = ages.map((age) => {
    const rows = viewRows.filter((r) => ageOf(r) === age);
    const todos = inscriptionTodos(rows, ageCtx);
    return {
      age,
      rows,
      todos,
      todoCount: new Set(todos.flatMap((t) => t.items.map((r) => r.id))).size,
      aVerifier: rows.filter((r) => dossierStatus(r) === 'a_verifier').length,
      nonPayes: rows.filter((r) => !r.paye).length,
      years: [...new Set(rows.map((r) => String(r.naissance || '').slice(0, 4)).filter(Boolean))].sort(),
    };
  });
  const current = filters.age
    ? summaries.find((x) => x.age === filters.age) || { age: filters.age, rows: [], todos: [], todoCount: 0, aVerifier: 0, nonPayes: 0, years: [] }
    : null;
  const yearsText = (x) => (x.years.length ? `nés en ${x.years.join(', ')}` : '');
  const ageHref = (age) => escapeHtml(hrefWith({ age, categorie: '' }));

  // Sélecteur (même composant que les pré-inscriptions) et flèches vers la catégorie à traiter suivante.
  const todo = summaries.filter((x) => x.todoCount);
  const isCurrent = (x) => Boolean(current && x.age === current.age);
  const option = (x) =>
    `<a class="adm-pi-opt${isCurrent(x) ? ' is-active' : ''}" href="${ageHref(x.age)}" data-filter-text="${escapeHtml(`${x.age} ${x.years.join(' ')}`.toLowerCase())}"${isCurrent(x) ? ' aria-current="true"' : ''}><span><strong>${escapeHtml(x.age)}</strong><small>${escapeHtml(yearsText(x))} · ${plural(x.rows.length, 'inscription', 'inscriptions')}</small></span>${x.todoCount ? `<b>${x.todoCount}</b>` : ''}</a>`;
  const cycle = todo.length ? todo : summaries;
  const at = current ? cycle.findIndex((x) => x.age === current.age) : -1;
  const arrow = (x, label, cls = '') => `<a class="adm-btn adm-btn-sm adm-btn-ghost${cls}" href="${ageHref(x.age)}" aria-label="${label}">${icon('arrowLeft')}</a>`;
  let arrows = '';
  if (current && at >= 0 && cycle.length > 1) {
    arrows = `<div class="adm-pi-steps">${arrow(cycle[(at - 1 + cycle.length) % cycle.length], 'Catégorie précédente')}<span>${todo.length ? 'À traiter' : 'Catégorie'} ${at + 1} sur ${cycle.length}</span>${arrow(cycle[(at + 1) % cycle.length], 'Catégorie suivante', ' adm-pi-next')}</div>`;
  } else if (current && at < 0 && todo.length) {
    arrows = `<div class="adm-pi-steps"><span>${plural(todo.length, 'catégorie à traiter', 'catégories à traiter')}</span><a class="adm-btn adm-btn-sm adm-btn-ghost adm-pi-goto" href="${ageHref(todo[0].age)}">${escapeHtml(todo[0].age)}<span class="adm-pi-next">${icon('arrowLeft')}</span></a></div>`;
  }
  const others = summaries.filter((x) => !x.todoCount);
  const picker =
    summaries.length > 1 || current
      ? `<div class="adm-pi-bar-top"><div class="adm-pi-picker">
    <details class="adm-pi-select" data-dismiss>
      <summary aria-label="Choisir une catégorie">${icon('users')}<span>${current ? `<strong>${escapeHtml(current.age)}</strong><small>${escapeHtml(yearsText(current))}</small>` : `<strong>Toutes les catégories</strong><small>${summaries.length}</small>`}</span>${icon('chevron')}</summary>
      <div class="adm-pi-menu">
        <label class="adm-pi-search"><span class="visually-hidden">Chercher une catégorie</span>${icon('search')}<input type="search" placeholder="Chercher une catégorie" data-filter-input="insc-cats" autocomplete="off"></label>
        <nav aria-label="Catégories d’âge" data-filter-list="insc-cats">
          <a class="adm-pi-opt${current ? '' : ' is-active'}" href="${ageHref('')}" data-filter-text="toutes les categories"><span><strong>Toutes les catégories</strong><small>vue d’ensemble</small></span></a>
          ${todo.length ? `<p class="adm-pi-lab" data-filter-label>À traiter</p>${todo.map(option).join('')}` : ''}
          ${others.length ? `<p class="adm-pi-lab" data-filter-label>${todo.length ? 'Autres catégories' : 'Catégories'}</p>${others.map(option).join('')}` : ''}
        </nav>
        <p class="adm-help" data-filter-empty="insc-cats" hidden>Aucune catégorie ne correspond.</p>
      </div>
    </details>
    ${arrows}
  </div></div>`
      : '';

  const todoLine = (t, scope) => {
    // Vérification : directement l'aperçu du plus ancien dossier déposé.
    const oldest = [...t.items].sort((a, b) => String(a.dossier_uploaded_at || '').localeCompare(String(b.dossier_uploaded_at || '')))[0];
    const href = t.key === 'verifier' ? `/admin/inscriptions/${oldest.id}/apercu` : hrefWith({ ...t.filter, age: scope ? scope.age : '', categorie: '' });
    const names = t.items.slice(0, 2).map((r) => escapeHtml(`${r.enfant_prenom} ${r.enfant_nom}`)).join(', ') + (t.items.length > 2 ? '…' : '');
    return `<li class="adm-pi-todo-item is-${t.tone}"><span class="adm-pi-todo-ico">${icon(t.icon)}</span><div><strong>${escapeHtml(t.title(t.items.length))}</strong><p>${scope ? names : `${escapeHtml(t.where.join(' · '))} — ${names}`}</p></div><a class="adm-btn adm-btn-sm ${t.key === 'verifier' ? 'adm-btn-primary' : 'adm-btn-ghost'}" href="${escapeHtml(href)}">${t.button}</a></li>`;
  };

  if (current) {
    return `${picker}
  <section class="adm-surface adm-pi-head">
    <div class="adm-surface-head"><h2 class="adm-h2">${escapeHtml(current.age)} <small class="adm-pi-years">${escapeHtml(yearsText(current))}</small></h2></div>
    <div class="adm-pi-gauge">
      <div><strong>${current.rows.length}</strong><span>${current.rows.length > 1 ? 'inscriptions à compléter' : 'inscription à compléter'}</span></div>
      <div><strong>${current.todoCount}</strong><span>à faire par le club</span></div>
      <div><strong>${current.aVerifier}</strong><span>dossiers à vérifier</span></div>
      <div><strong>${current.nonPayes}</strong><span>paiements en attente</span></div>
    </div>
    ${current.todos.length ? `<ul class="adm-pi-todo-list">${current.todos.map((t) => todoLine(t, current)).join('')}</ul>` : '<p class="adm-help adm-pi-none">Rien à faire pour le club dans cette catégorie : les familles complètent leur inscription.</p>'}
  </section>`;
  }

  const all = inscriptionTodos(viewRows, ageCtx);
  const total = new Set(all.flatMap((t) => t.items.map((r) => r.id))).size;
  const todoPanel = all.length
    ? `<section class="adm-surface adm-pi-todo"><h2 class="adm-h2">${icon('activity')}À faire maintenant <em>· ${plural(total, 'inscription concernée', 'inscriptions concernées')}${todo.length > 1 ? ` dans ${todo.length} catégories` : ''}</em></h2><ul>${all.map((t) => todoLine(t, null)).join('')}</ul></section>`
    : `<section class="adm-surface adm-pi-todo is-empty"><h2 class="adm-h2">${icon('check')}Rien à faire pour le moment</h2><p class="adm-help">Les dossiers à vérifier, paiements à encaisser, dossiers manquants et photos à refaire apparaîtront ici.</p></section>`;
  const row = (x) => {
    const n = x.todoCount;
    const detail = [x.aVerifier && plural(x.aVerifier, 'dossier à vérifier', 'dossiers à vérifier'), x.nonPayes && plural(x.nonPayes, 'paiement en attente', 'paiements en attente')].filter(Boolean).join(' · ');
    return `<li class="adm-pi-group" data-filter-text="${escapeHtml(`${x.age} ${x.years.join(' ')}`.toLowerCase())}">
      <div class="adm-pi-g-name"><a href="${ageHref(x.age)}">${escapeHtml(x.age)}</a><small>${escapeHtml(yearsText(x))}</small></div>
      <div class="adm-pi-g-fill"><b>${plural(x.rows.length, 'inscription', 'inscriptions')}</b></div>
      <div class="adm-pi-g-state"><small>${detail || 'Les familles complètent'}</small></div>
      <div class="adm-pi-g-todo">${n ? `<strong>${n} à faire</strong>` : '<span>Rien à faire</span>'}</div>
      <a class="adm-btn adm-btn-sm ${n ? 'adm-btn-primary' : 'adm-btn-ghost'}" href="${ageHref(x.age)}">${n ? 'Traiter' : 'Ouvrir'}<span class="visually-hidden"> ${escapeHtml(x.age)}</span></a>
    </li>`;
  };
  const table =
    summaries.length > 1
      ? `<section class="adm-surface adm-pi-table" id="categories">
    <div class="adm-pi-table-head"><h2 class="adm-h2">${icon('tag')}Par catégorie</h2>
      <label class="adm-pi-search"><span class="visually-hidden">Chercher une catégorie</span>${icon('search')}<input type="search" placeholder="Chercher une catégorie" data-filter-input="insc-table" autocomplete="off"></label></div>
    <ul class="adm-pi-groups" data-filter-list="insc-table"><li class="adm-pi-group adm-pi-ghead" aria-hidden="true"><span>Catégorie</span><span>En cours</span><span>Détail</span><span>À faire</span><span></span></li>${[...summaries].sort((a, b) => b.todoCount - a.todoCount).map(row).join('')}</ul>
    <p class="adm-help adm-pi-noresult" data-filter-empty="insc-table" hidden>Aucune catégorie ne correspond.</p>
  </section>`
      : '';
  return `${picker}${todoPanel}${table}`;
}

// options : filters (vue + filtres courants), years/categories (valeurs distinctes présentes en
// base, pas la liste éditable de /admin/categories, pour que le filtre reste exact même après un
// renommage), total (nombre de fiches de la vue avant filtres), counts (compteurs de la vue),
// returnTo (chemin+query courant, pour revenir sur cette vue filtrée après une action),
// messages (dossierError/dossierOk/bulkOk), inscriptionStatus (brut, KV) et effectiveStatus (tenant
// compte de la date limite de réinscription, voir _shared/settings-kv.js), saison.
function listPage(rows, { filters, years, categories, ages, total, counts, returnTo, messages, inscriptionStatus, effectiveStatus, dateFermetureInscriptions, saison, ageCtx, badges, viewRows = [] }) {
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

  // Plus de cadre « Recherche et filtres » (2026-11-13, doublons retirés à la demande de l'utilisateur) : la
  // recherche est celle de la barre du haut, les dossiers à vérifier sont dans « À faire maintenant ». Restent les
  // filtres avancés et l'export, sur la ligne du titre de la liste, et un lien discret vers Adhérents / Réinscription.
  const searchChip = filters.q
    ? `<span class="adm-tag is-neutral">Recherche : ${escapeHtml(filters.q)}</span>`
    : '';
  const dossierChip = filters.dossier === 'a_verifier' ? '<span class="adm-tag is-wait">Dossiers à vérifier</span>' : '';
  const separation = isArchive
    ? ''
    : `<p class="adm-help adm-help-separation">Les inscriptions complètes sont dans <a href="/admin/adherents" class="adm-link">Adhérents</a> (${counts.adherents})${
        counts.reinscriptions ? `, les réinscriptions à finaliser dans <a href="/admin/reinscription#a-finaliser" class="adm-link">Réinscription</a> (${counts.reinscriptions})` : ''
      }.</p>`;

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
    ? `${bulkBar}<div class="adm-irows">${rows.map((r) => inscriptionRow(r, returnTo, ageCtx)).join('')}</div>`
    : `<div class="adm-surface adm-empty">${icon(isArchive ? 'trash' : 'users')}<p>${emptyText}</p>${
        hasActiveFilters ? `<a href="${resetHref}" class="adm-btn adm-btn-ghost">Réinitialiser les filtres</a>` : ''
      }</div>`;

  return `${adminHead(isArchive ? 'Corbeille' : 'Inscriptions')}
${shell}
<main id="adm-main" class="adm-wrap adm-main adm-pi">
  ${flashes}
  ${isArchive ? '' : overview({ viewRows, ages, filters, ageCtx, hrefWith, csvHref })}
  <div class="adm-section-head adm-list-head">
    <h2 class="adm-h2">${isArchive ? 'Profils archivés' : "Dossiers d'inscription"} <span class="adm-count">${rows.length}${rows.length !== total ? ` / ${total}` : ''}</span></h2>
    <div class="adm-list-tools">
      ${searchChip}${dossierChip}
      ${hasActiveFilters || filters.dossier ? `<a href="${resetHref}" class="adm-reset">Réinitialiser</a>` : ''}
      ${filtersMenu}
      ${rows.length ? `<a href="${escapeHtml(csvHref)}" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('download')}CSV${hasActiveFilters ? ' (filtré)' : ''}</a>` : ''}
    </div>
  </div>
  ${list}
  ${separation}
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
  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? ORDER BY created_at DESC').bind(admin.organizationId).all();

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
      viewRows,
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
  // Fiche avec versements : statut tenu par les montants (fiche, onglet Paiement), jamais basculé ici.
  'toggle-paye': (db, org, id) =>
    db.prepare('UPDATE inscriptions SET paye = 1 - paye, complete_notified_at = CASE WHEN paye = 1 THEN NULL ELSE complete_notified_at END WHERE organization_id = ? AND id = ? AND COALESCE(montant_recu_cents, 0) = 0 AND paiement_exempte IS NULL').bind(org, id).run(),
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
      if (before && Number(before.montant_recu_cents) > 0) {
        const back = safeRedirect(form.get('redirectTo'), fallback);
        const message = 'Paiement enregistré par versements : modifiez ou supprimez un versement dans l’historique, ou corrigez les montants.';
        return new Response('', { status: 302, headers: { Location: withParam(back, `bulkError=${encodeURIComponent(message)}`) } });
      }
      const result = await ROW_ACTIONS[action](env.DB, admin.organizationId, id, reason);
      // L'adhésion CRM suit l'archivage / la restauration de l'inscription.
      if (action === 'archive' || action === 'restore') waitUntil(syncInscriptionSafe(env, admin.organizationId, id));
      // Paiement tout juste validé : e-mail de suivi / "Dossier complet" à la famille (_shared/automations.js).
      if (before && !before.paye && result?.meta?.changes) {
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
