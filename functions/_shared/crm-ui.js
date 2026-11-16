// Affichage du CRM dans l'admin (phase 3) : liste des adhérents et fiche d'une personne. Lecture seule : les
// données de personne viennent des inscriptions (voir _shared/crm.js) ; les statuts de dossier, de photo et de
// paiement sont LUS dans l'inscription source (memberships.legacy_inscription_id), jamais copiés.
import { isPartiallyPaid, paymentBalance, formatEuros } from './payments.js';
import { hasPaymentStarted } from './inscriptions-db.js';
import { dossierTag, escapeHtml, icon, statusTag, avatar, formatDateFr, formatBirth, adminHead, adminShell, adminScripts, contactActions, familyActions, flash, PHOTO_TAG, PAIEMENT_TAG, ageAndCategory } from './admin-auth.js';
import { archiveReason, ageGroup, sortAgeGroups, dossierStatus, isPhotoToRedo, isInscriptionComplete, familyHasActionPending } from './inscriptions-db.js';
import { EMAIL_KINDS, isClubEmailKind } from './email-log.js';
import { MEMBER_PAGE_SIZE } from './crm.js';
import { FOLLOWUP_STEPS, FOLLOWUP_FILTERS, LICENCE_DOCS, LICENCE_STAGES, docChoices, licenceStage, licenceMissing, licenceState, tenueState } from './club-followup.js';

// Paiement : « Payé », « Non payé » ou, en plusieurs fois, le reste à payer (_shared/payments.js).
const paymentTag = (m) =>
  isPartiallyPaid(m) ? `<span class="adm-tag is-no">Reste ${formatEuros(paymentBalance(m).reste)}</span>` : statusTag(Boolean(m.paye), PAIEMENT_TAG);

const LONG_DATE = { day: 'numeric', month: 'long', year: 'numeric' };
const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
export { html };

const MEMBERSHIP_LABELS = { pending: ['En attente', 'wait'], active: ['Active', 'yes'], ended: ['Terminée', 'neutral'], cancelled: ['Annulée', 'no'] };
const CONTACT_LABELS = { active: 'Actif', inactive: 'Inactif', archived: 'Archivé' };
const RELATION_LABELS = { parent: 'Parent', legal_guardian: 'Responsable légal', emergency_contact: "Contact d'urgence", sibling: 'Frère ou sœur', other: 'Autre lien' };

export const membershipTag = (status) => {
  const [label, tone] = MEMBERSHIP_LABELS[status] || [status, 'neutral'];
  return `<span class="adm-tag is-${tone}">${escapeHtml(label)}</span>`;
};
const relationLabel = (type) => RELATION_LABELS[type] || String(type);
const fullName = (c) => `${c.first_name} ${c.last_name}`;
const telHref = (phone) => `tel:${escapeHtml(String(phone).replace(/[^\d+]/g, ''))}`;

// L'inscription source, sous forme de ligne « legacy » pour dossierTag() / statusTag().
const legacyRow = (m) => ({ dossier_uploaded_at: m.dossier_uploaded_at, dossier_status: m.dossier_status });

function legacyTags(m) {
  if (!m.inscription_id) return '<span class="adm-tag is-neutral">Sans inscription</span>';
  return `${dossierTag(legacyRow(m))} ${paymentTag(m)}`;
}

// ---------------------------------------------------------------------------------------------
// Liste

// Carte d'adhérent (2026-10-08), même gabarit que les cartes d'Inscriptions : en-tête (photo ou initiales, nom, âge),
// lignes libellé / valeur (adhésion, dossier, paiement, licence), actions en bas.
const stateTag = ({ tone, label }) => `<span class="adm-tag is-${tone}">${escapeHtml(label)}</span>`;

// « Qui manque quoi » : pièces de licence manquantes ou refusées par la FFF, sous la ligne Licence FFF.
function missingLine(r) {
  const missing = licenceMissing(r);
  if (!missing.length) return '';
  return `<p class="adm-licence-missing">${icon('alert')}<span>Manque : ${missing.map((d) => escapeHtml(d.label.toLowerCase()) + (d.refused ? ' (refusé)' : '')).join(', ')}</span></p>`;
}

// Bandeau « Parcours de l'adhérent » (refonte 2026-11-13, inspiré des tableaux de parcours) : toujours visible,
// chaque étape filtre la liste. Licence et tenue sont deux suivis indépendants ; « Prêts à jouer » = les deux faits.
// Mêmes comptages que les compteurs détaillés (mêmes filtres que la liste, sans le filtre de suivi).
export function journeyBanner(counts, filters, qs) {
  if (!counts) return '';
  const sum = (pick) => counts.reduce((n, c) => n + (Number(pick(c)) || 0), 0);
  const stage = (keys) => sum((c) => (keys.includes(c.stage) ? c.n : 0));
  const enCours = ['attente_famille', 'a_verifier', 'a_signer', 'attente_fff', 'refusee'];
  const refusees = stage(['refusee']);
  const steps = [
    { key: 'licence_a_demander', label: 'Licence à demander', n: stage(['a_demander']), tone: 'no' },
    { key: 'licence_en_cours', label: 'Licence en cours', n: stage(enCours), tone: 'wait', note: refusees ? `${refusees} refusée${refusees > 1 ? 's' : ''}` : '' },
    { key: 'licence_validee', label: 'Licence validée', n: stage(['validee']), tone: 'yes' },
    { key: 'tenue_a_commander', label: 'Tenue à commander', n: sum((c) => c.tenue_a_commander), tone: 'no' },
    { key: 'tenue_a_remettre', label: 'Tenue à remettre', n: sum((c) => c.tenue_a_remettre), tone: 'wait' },
    { key: 'pret_a_jouer', label: 'Prêts à jouer', n: sum((c) => (c.stage === 'validee' ? c.tenue_remise : 0)), tone: 'yes' },
  ];
  return `<nav class="adm-journey adm-surface" aria-label="Parcours de l'adhérent : filtrer par étape">
    ${steps
      .map((st) => {
        const active = filters.suivi === st.key;
        return `<a href="${escapeHtml(qs({ suivi: active ? '' : st.key, page: '' }))}" class="adm-journey-step is-${st.tone}${active ? ' is-active' : ''}${st.n ? '' : ' is-zero'}"${active ? ' aria-current="true"' : ''}><strong>${st.n}</strong><span>${escapeHtml(st.label)}</span>${st.note ? `<em>${escapeHtml(st.note)}</em>` : ''}</a>`;
      })
      .join('')}
  </nav>`;
}

// Ligne compacte d'adhérent (refonte « à l'échelle », 2026-11-13) : photo, nom, catégorie, puis licence FFF (avec
// les pièces manquantes), tenue et paiement, et deux boutons. Les adhérents sont tous complets : pas de ligne dossier.
function memberRow(r, ageCtx) {
  const age = ageGroup(r.birth_date, ageCtx);
  const sub = [(age || r.group_label) && ageAndCategory(age, r.group_label), r.birth_date && `né(e) le ${formatBirth(r.birth_date)}`].filter(Boolean).join(' · ');
  const photoRow = r.inscription_id ? { id: r.inscription_id, enfant_prenom: r.first_name, enfant_nom: r.last_name, photo_uploaded_at: r.photo_uploaded_at } : { id: r.contact_id, enfant_prenom: r.first_name, enfant_nom: r.last_name };
  const href = r.inscription_id ? `/admin/inscriptions/${r.inscription_id}` : `/admin/adherents/${r.contact_id}`;
  const cell = (label, value, extra = '') => `<div class="adm-mrow-cell"><span>${label}</span>${value}${extra}</div>`;
  return `<article class="adm-mrow">
    ${avatar(photoRow)}
    <div class="adm-irow-id"><h3><a href="${href}">${escapeHtml(fullName(r))}</a></h3><p>${sub}</p></div>
    ${
      r.inscription_id
        ? `${cell('Licence FFF', stateTag(licenceState(r)), missingLine(r))}${cell('Tenue', stateTag(tenueState(r)))}${cell('Paiement', paymentTag(r))}`
        : `${cell('Inscription', '<span class="adm-tag is-neutral">Sans inscription</span>')}<span></span><span></span>`
    }
    <div class="adm-irow-actions"><a href="${href}" class="adm-btn adm-btn-ghost">Ouvrir</a>${
      r.inscription_id ? `<a class="adm-btn adm-btn-ghost" href="/admin/email?inscription=${Number(r.inscription_id)}">${icon('mail')}E-mail<span class="visually-hidden"> (famille de ${escapeHtml(fullName(r))})</span></a>` : ''
    }</div>
  </article>`;
}

// « À faire maintenant » des adhérents : ce que le club doit faire dans le parcours de licence (le bandeau du dessus
// compte déjà les grandes étapes : licences à demander, tenues ; on ne les répète pas ici).
function membersTodo(counts, qs) {
  if (!counts) return '';
  const by = Object.fromEntries(counts.map((c) => [c.stage, Number(c.n) || 0]));
  const missing = counts.reduce((n, c) => n + (c.stage === 'validee' ? 0 : Number(c.missing) || 0), 0);
  const items = [
    { key: 'licence_refusee', n: by.refusee || 0, icon: 'alert', tone: 'no', title: (n) => `${n} ${n > 1 ? 'licences avec une pièce refusée' : 'licence avec une pièce refusée'}`, text: 'La famille doit corriger sur Footclubs : relancez-la depuis la fiche.' },
    { key: 'licence_a_verifier', n: by.a_verifier || 0, icon: 'eye', tone: 'wait', title: (n) => `${n} ${n > 1 ? 'licences à vérifier' : 'licence à vérifier'} par le club`, text: 'Pièces déposées par la famille sur Footclubs.' },
    { key: 'licence_a_signer', n: by.a_signer || 0, icon: 'edit', tone: 'wait', title: (n) => `${n} ${n > 1 ? 'licences à signer' : 'licence à signer'} par le club`, text: 'Pièces vérifiées : à signer et transmettre à la FFF.' },
    { key: 'licence_pieces', n: missing, icon: 'file', tone: 'wait', title: (n) => `${n} ${n > 1 ? 'pièces manquantes' : 'pièce manquante'}`, text: 'Photo, pièce d’identité, questionnaire ou certificat pas encore fournis.' },
  ].filter((t) => t.n);
  if (!items.length) {
    return `<section class="adm-surface adm-pi-todo is-empty"><h2 class="adm-h2">${icon('check')}Rien à faire sur les licences pour le moment</h2><p class="adm-help">Les pièces refusées, licences à vérifier ou à signer et pièces manquantes apparaîtront ici.</p></section>`;
  }
  return `<section class="adm-surface adm-pi-todo"><h2 class="adm-h2">${icon('activity')}À faire maintenant <em>· licences FFF</em></h2><ul>${items
    .map((t) => `<li class="adm-pi-todo-item is-${t.tone}"><span class="adm-pi-todo-ico">${icon(t.icon)}</span><div><strong>${escapeHtml(t.title(t.n))}</strong><p>${escapeHtml(t.text)}</p></div><a class="adm-btn adm-btn-sm adm-btn-ghost" href="${escapeHtml(qs({ suivi: t.key, page: '' }))}">Voir</a></li>`)
    .join('')}</ul></section>`;
}

export function membersPage({ list, options, filters, stats, unmapped, messages = {}, saison, ageCtx = saison, badges = {} }) {
  const qs = (changes) => {
    const params = new URLSearchParams();
    const next = { q: filters.q, age: filters.age, periode: filters.periodId ?? '', groupe: filters.groupLabel, statut: filters.status, suivi: filters.suivi, ...changes };
    for (const [key, value] of Object.entries(next)) if (value !== '' && value != null) params.set(key, String(value));
    const text = params.toString();
    return `/admin/adherents${text ? `?${text}` : ''}`;
  };
  const opt = (value, label, selected) => `<option value="${escapeHtml(value)}"${String(selected ?? '') === String(value) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const advanced = [filters.periodId, filters.groupLabel, filters.status, filters.suivi].filter(Boolean).length;
  const hasFilters = Boolean(filters.q || filters.age || advanced);

  // Sélecteur de catégorie d'âge avec recherche (même composant que Pré-inscriptions et Inscriptions).
  const ages = sortAgeGroups(new Set((options.birthYears || []).map((y) => ageGroup(`${y}-01-01`, ageCtx)).filter(Boolean)));
  const yearsOf = (a) => (options.birthYears || []).filter((y) => ageGroup(`${y}-01-01`, ageCtx) === a).sort();
  const option = (a) => {
    const on = filters.age === a;
    const years = yearsOf(a);
    return `<a class="adm-pi-opt${on ? ' is-active' : ''}" href="${escapeHtml(qs({ age: a, page: '' }))}" data-filter-text="${escapeHtml(`${a} ${years.join(' ')}`.toLowerCase())}"${on ? ' aria-current="true"' : ''}><span><strong>${escapeHtml(a)}</strong><small>${years.length ? `nés en ${years.join(', ')}` : ''}</small></span></a>`;
  };
  const picker =
    ages.length > 1 || filters.age
      ? `<div class="adm-pi-bar-top"><div class="adm-pi-picker">
    <details class="adm-pi-select" data-dismiss>
      <summary aria-label="Choisir une catégorie">${icon('users')}<span>${filters.age ? `<strong>${escapeHtml(filters.age)}</strong>` : `<strong>Toutes les catégories</strong><small>${ages.length}</small>`}</span>${icon('chevron')}</summary>
      <div class="adm-pi-menu">
        <label class="adm-pi-search"><span class="visually-hidden">Chercher une catégorie</span>${icon('search')}<input type="search" placeholder="Chercher une catégorie" data-filter-input="adh-cats" autocomplete="off"></label>
        <nav aria-label="Catégories d’âge" data-filter-list="adh-cats">
          <a class="adm-pi-opt${filters.age ? '' : ' is-active'}" href="${escapeHtml(qs({ age: '', page: '' }))}" data-filter-text="toutes les categories"><span><strong>Toutes les catégories</strong><small>vue d’ensemble</small></span></a>
          ${ages.map(option).join('')}
        </nav>
        <p class="adm-help" data-filter-empty="adh-cats" hidden>Aucune catégorie ne correspond.</p>
      </div>
    </details>
  </div></div>`
      : '';

  // Filtres avancés (période, groupe, adhésion, licence et tenue) : sur la ligne du titre de la liste. Pas de
  // recherche locale : la recherche du haut trouve enfants, parents et éducateurs (pas de doublon).
  const filtersMenu = `<details class="adm-filters" data-dismiss>
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('filter')}Filtres${advanced ? ` <span class="adm-count">${advanced}</span>` : ''}</summary>
      <form method="GET" class="adm-filters-panel">
        ${filters.q ? `<input type="hidden" name="q" value="${escapeHtml(filters.q)}">` : ''}
        ${filters.age ? `<input type="hidden" name="age" value="${escapeHtml(filters.age)}">` : ''}
        <label class="adm-field">Période
          <select name="periode" class="adm-select">${opt('', 'Toutes', filters.periodId)}${options.periods.map((p) => opt(p.id, `${p.name}${p.is_current ? ' (en cours)' : ''}`, filters.periodId)).join('')}</select>
        </label>
        <label class="adm-field">Groupe
          <select name="groupe" class="adm-select">${opt('', 'Tous', filters.groupLabel)}${options.groups.map((g) => opt(g, g, filters.groupLabel)).join('')}</select>
        </label>
        <label class="adm-field">Adhésion
          <select name="statut" class="adm-select">${opt('', 'Toutes', filters.status)}${Object.entries(MEMBERSHIP_LABELS).map(([value, [label]]) => opt(value, label, filters.status)).join('')}</select>
        </label>
        <label class="adm-field">Licence et tenue
          <select name="suivi" class="adm-select">${opt('', 'Tout', filters.suivi)}${Object.entries(FOLLOWUP_FILTERS).map(([value, f]) => opt(value, f.label, filters.suivi)).join('')}</select>
        </label>
        <div class="adm-filters-actions"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">Appliquer</button></div>
      </form>
    </details>`;
  const chips = [
    filters.q && `<span class="adm-tag is-neutral">Recherche : ${escapeHtml(filters.q)}</span>`,
    filters.suivi && FOLLOWUP_FILTERS[filters.suivi] && `<span class="adm-tag is-wait">${escapeHtml(FOLLOWUP_FILTERS[filters.suivi].label)}</span>`,
  ]
    .filter(Boolean)
    .join('');

  const from = list.total ? (list.page - 1) * list.pageSize + 1 : 0;
  const to = Math.min(list.total, list.page * list.pageSize);
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const pager =
    pages > 1
      ? `<nav class="adm-pager" aria-label="Pages">
      ${list.page > 1 ? `<a class="adm-btn adm-btn-sm adm-btn-ghost" href="${escapeHtml(qs({ page: list.page - 1 }))}">${icon('arrowLeft')}Précédent</a>` : '<span></span>'}
      <span class="adm-row-sub">${from}–${to} sur ${list.total}</span>
      ${list.page < pages ? `<a class="adm-btn adm-btn-sm adm-btn-ghost" href="${escapeHtml(qs({ page: list.page + 1 }))}">Suivant</a>` : '<span></span>'}
    </nav>`
      : '';

  const flashes = [
    messages.synced && flash('ok', messages.synced),
    messages.footclubs && flash('ok', messages.footclubs),
    messages.syncError && flash('error', messages.syncError),
    messages.syncBusy && flash('info', messages.syncBusy),
    messages.syncRemaining && flash('info', messages.syncRemaining),
  ]
    .filter(Boolean)
    .join('');
  const syncBlock = unmapped
    ? `<section class="adm-surface adm-sync-notice">
      <p class="adm-help">${icon('refresh')} ${unmapped} fiche${unmapped > 1 ? 's' : ''} récente${unmapped > 1 ? 's ne sont' : " n'est"} pas encore prise${unmapped > 1 ? 's' : ''} en compte dans cette liste. Elle se met à jour chaque matin ; vous pouvez le faire maintenant (aucune fiche n'est modifiée).</p>
      <form method="POST" data-once><input type="hidden" name="action" value="sync"><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('refresh')}Mettre à jour la liste</button></form>
    </section>`
    : '';

  return `${adminHead('Adhérents')}
${adminShell({
  active: 'adherents',
  badges,
  eyebrow: saison ? `Période ${escapeHtml(saison)}` : 'CRM',
  title: 'Adhérents',
  subtitle: "Les enfants dont l'inscription est complète (dossier validé, photo et premier paiement), période après période.",
  stats: [
    { value: stats.completeMembers, label: stats.completeMembers > 1 ? 'adhérents' : 'adhérent' },
    { value: stats.currentCompleteMemberships, label: 'adhésions en cours' },
    { value: stats.contacts, label: stats.contacts > 1 ? 'contacts' : 'contact' },
  ],
  actions: `<a href="/admin/adherents/footclubs" class="adm-btn adm-btn-white">${icon('upload')}Importer Footclubs</a>`,
})}
<main id="adm-main" class="adm-wrap adm-main adm-pi">
  ${flashes}
  ${syncBlock}
  ${picker}
  ${journeyBanner(list.licenceCounts, filters, qs)}
  ${membersTodo(list.licenceCounts, qs)}
  <div class="adm-section-head adm-list-head">
    <h2 class="adm-h2">${filters.age ? `Adhérents ${escapeHtml(filters.age)}` : 'Tous les adhérents'} <span class="adm-count">${list.total}</span></h2>
    <div class="adm-list-tools">
      ${chips}
      ${hasFilters ? `<a href="${escapeHtml(filters.age ? qs({ q: '', periode: '', groupe: '', statut: '', suivi: '', page: '' }) : '/admin/adherents')}" class="adm-reset">Réinitialiser</a>` : ''}
      ${filtersMenu}
      <a href="/admin/inscriptions?etat=complet&amp;format=csv" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('download')}CSV</a>
    </div>
  </div>
  ${
    list.rows.length
      ? `<div class="adm-irows adm-members">${list.rows.map((r) => memberRow(r, ageCtx)).join('')}</div>${pager}`
      : `<section class="adm-surface adm-empty">${icon('users')}<p>${hasFilters ? 'Aucun adhérent ne correspond à cette recherche.' : 'Aucun adhérent pour le moment : une inscription arrive ici dès qu\'elle est complète (dossier validé, photo et premier paiement).'}</p><a href="/admin/inscriptions" class="adm-btn adm-btn-ghost">Voir les inscriptions à compléter</a></section>`
  }
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

// ---------------------------------------------------------------------------------------------
// Fiche

const kv = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;

function identitySection(contact) {
  const address = [contact.address_line1, contact.address_line2, [contact.postal_code, contact.city].filter(Boolean).join(' '), contact.country].filter(Boolean).map(escapeHtml).join(', ');
  return `<section class="adm-surface adm-fiche-enfant">
    <h2 class="adm-h2">${icon('user')}Identité</h2>
    <dl class="adm-kv">
      ${kv('Prénom', escapeHtml(contact.first_name))}
      ${kv('Nom', escapeHtml(contact.last_name))}
      ${contact.birth_date ? kv('Naissance', formatBirth(contact.birth_date)) : ''}
      ${contact.email ? kv('E-mail', `<a class="adm-link" href="mailto:${escapeHtml(contact.email)}">${escapeHtml(contact.email)}</a>`) : ''}
      ${contact.phone ? kv('Téléphone', `<a class="adm-link" href="${telHref(contact.phone)}">${escapeHtml(contact.phone)}</a>`) : ''}
      ${address ? kv('Adresse', address) : ''}
      ${kv('Fiche', escapeHtml(CONTACT_LABELS[contact.status] || contact.status))}
    </dl>
  </section>`;
}

function currentMembershipSection(m) {
  if (!m) {
    return `<section class="adm-surface adm-fiche-parent"><h2 class="adm-h2">${icon('tag')}Adhésion</h2><p class="adm-help">Cette personne n'a pas d'adhésion.</p></section>`;
  }
  return `<section class="adm-surface adm-fiche-parent">
    <h2 class="adm-h2">${icon('tag')}Adhésion ${m.is_current ? 'en cours' : 'la plus récente'}</h2>
    <dl class="adm-kv">
      ${kv('Période', escapeHtml(m.period_name))}
      ${kv('Groupe', m.group_label ? escapeHtml(m.group_label) : '—')}
      ${kv('Statut', membershipTag(m.status))}
      ${m.joined_at ? kv('Depuis le', formatDateFr(m.joined_at, LONG_DATE)) : ''}
      ${m.ended_at ? kv('Terminée le', formatDateFr(m.ended_at, LONG_DATE)) : ''}
    </dl>
  </section>`;
}

function dossierSection(m) {
  if (!m || !m.inscription_id) return '';
  return `<section class="adm-surface adm-fiche-dossier">
    <h2 class="adm-h2">${icon('file')}Dossier (inscription source)</h2>
    <dl class="adm-kv">
      ${kv('Document', dossierTag(legacyRow(m)))}
      ${kv('Photo', statusTag(Boolean(m.photo_uploaded_at), PHOTO_TAG))}
      ${kv('Paiement', paymentTag(m))}
      ${kv('Mode de paiement', escapeHtml(m.mode_paiement || '—'))}
      ${m.archived_at ? kv('Archivée', `${formatDateFr(m.archived_at, LONG_DATE)}${archiveReason(m) ? ` · ${escapeHtml(archiveReason(m))}` : ''}`) : ''}
    </dl>
    <p class="adm-help">Le suivi complet (relances, dépôt de fichiers, vérification) reste dans l'inscription.</p>
    <a class="adm-btn adm-btn-sm adm-btn-primary" href="/admin/inscriptions/${m.inscription_id}">${icon('file')}Ouvrir l'inscription n° ${m.inscription_id}</a>
  </section>`;
}

function familySection(profile) {
  const guardians = profile.guardians;
  const dependents = profile.dependents;
  if (!guardians.length && !dependents.length) return '';
  // Inscription où figure l'adresse de la personne (responsable 1 ou 2) : le bouton « E-mail » écrit depuis l'admin.
  const same = (a, b) => Boolean(a) && String(a).trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const inscriptionFor = (p) => (profile.memberships || []).find((m) => m.inscription_id && (same(p.email, m.email) || same(p.email, m.parent2_email)))?.inscription_id || null;
  const person = (p, extra) => `<li class="adm-person">
      <strong><a class="adm-link" href="/admin/contacts/${p.id}">${escapeHtml(fullName(p))}</a></strong>
      <span class="adm-row-sub">${escapeHtml(extra)}</span>
      ${p.phone ? `<span class="adm-person-coord">${escapeHtml(p.phone)}</span>` : ''}
      ${p.email ? `<span class="adm-person-coord">${escapeHtml(p.email)}</span>` : ''}
      ${contactActions({ phone: p.phone, email: p.email, name: fullName(p), inscriptionId: inscriptionFor(p) })}
    </li>`;
  return `<section class="adm-surface adm-fiche-family">
    <h2 class="adm-h2">${icon('users')}${dependents.length && !guardians.length ? 'Personnes liées' : 'Responsables et famille'}</h2>
    <ul class="adm-people">
      ${guardians.map((g) => person(g, `${relationLabel(g.relationship_type)}${g.is_primary ? ' · principal' : ''}`)).join('')}
      ${dependents.map((d) => person(d, `${relationLabel(d.relationship_type)} de cette personne${d.birth_date ? ` · né(e) le ${d.birth_date.split('-').reverse().join('/')}` : ''}`)).join('')}
    </ul>
  </section>`;
}

// Historique : uniquement des faits enregistrés (jamais d'événement reconstitué).
function historySection(memberships, folded = false) {
  if (!memberships.length) return '';
  const events = [];
  for (const m of memberships) {
    if (m.inscription_created_at) events.push({ at: m.inscription_created_at, text: `Inscription reçue (période ${m.period_name}, inscription n° ${m.inscription_id})` });
    if (m.group_label && m.group_started_at) events.push({ at: m.group_started_at, text: `Rattaché au groupe ${m.group_label} (${m.period_name})` });
    if (m.status === 'ended' && m.ended_at) {
      events.push({ at: m.ended_at, text: `Adhésion ${m.period_name} terminée${archiveReason(m) ? ` : ${archiveReason(m)}` : ''}` });
    }
  }
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const periods = memberships
    .map(
      (m) => `<li class="adm-person">
      <strong>${escapeHtml(m.period_name)}${m.is_current ? ' <span class="adm-count">en cours</span>' : ''}</strong>
      <span class="adm-row-sub">${m.group_label ? escapeHtml(m.group_label) : 'Sans groupe'}</span>
      ${membershipTag(m.status)} ${m.inscription_id ? `<a class="adm-link" href="/admin/inscriptions/${m.inscription_id}">Inscription n° ${m.inscription_id}</a>` : ''}
    </li>`
    )
    .join('');
  const body = `<h3 class="adm-h3">Adhésions</h3>
    <ul class="adm-people">${periods}</ul>
    <h3 class="adm-h3" style="margin-top:16px;">Chronologie</h3>
    <ul class="adm-timeline">${events.map((e) => `<li><time>${formatDateFr(e.at, LONG_DATE)}</time><span>${escapeHtml(e.text)}</span></li>`).join('')}</ul>`;
  if (folded) return fold('Historique', 'activity', body);
  return `<section class="adm-surface adm-fiche-history">
    <h2 class="adm-h2">${icon('activity')}Historique</h2>
    ${body}
  </section>`;
}

// Points à vérifier par un humain : ressemblances (jamais fusionnées) et adhésions en double sur une période.
function reviewSection(profile) {
  const notes = [];
  if (profile.duplicatePeriod) {
    notes.push("<p class=\"adm-help\">Plusieurs adhésions existent pour la même période : à vérifier (doublon possible). Aucune inscription n'a été modifiée ni supprimée.</p>");
  }
  if (profile.duplicates.length) {
    notes.push(
      `<p class="adm-help">Ce contact ressemble à ${profile.duplicates.length > 1 ? "d'autres contacts" : 'un autre contact'} (même nom et mêmes coordonnées ou même date de naissance). Ils n'ont PAS été fusionnés : une fusion demande une vérification humaine.</p>
      <ul class="adm-people">${profile.duplicates.map((d) => `<li class="adm-person"><a class="adm-link" href="/admin/contacts/${d.id}">${escapeHtml(fullName(d))}</a></li>`).join('')}</ul>`
    );
  }
  if (!notes.length) return '';
  return `<section class="adm-surface adm-fiche-review"><h2 class="adm-h2">${icon('alert')}À vérifier</h2>${notes.join('')}</section>`;
}

const fold = (title, iconName, body, open = false) => `<details class="adm-surface adm-fold"${open ? ' open' : ''}>
    <summary><h2 class="adm-h2">${icon(iconName)}${title}</h2>${icon('chevron')}</summary>
    <div class="adm-fold-body">${body}</div>
  </details>`;


// ---------------------------------------------------------------------------------------------
// Fiche adhérent (refaite le 2026-10-14, demande de l'utilisateur) : répondre d'abord à « que dois-je faire ? »
// (prochaine étape), puis « où en est-il ? » (parcours dans l'ordre réel : inscription, dossier,
// photo, paiement, licence FFF), « qui appeler ? » (responsables, colonne de droite), « qui est l'enfant ? », et
// « qu'a-t-on envoyé à la famille ? » (journal des e-mails). Statuts toujours LUS dans l'inscription source.

const SHORT_DATE = { day: 'numeric', month: 'short', year: 'numeric' };
const DATE_TIME = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
const STATE_ICON = { ok: 'check', wait: 'activity', todo: 'alert', no: 'alert' };

// État de chaque étape du parcours : 'ok' (fait), 'wait' (attend le club), 'todo' (attend la famille), 'no' (refusé).
function parcoursSteps(m) {
  const dossier = dossierStatus(m);
  return [
    {
      key: 'inscription',
      title: 'Inscription envoyée',
      state: 'ok',
      detail: `Le ${formatDateFr(m.inscription_created_at, LONG_DATE)} · catégorie choisie : ${escapeHtml(m.categorie || '—')}`,
    },
    {
      key: 'dossier',
      title: 'Dossier signé',
      state: { valide: 'ok', a_verifier: 'wait', refuse: 'no', manquant: 'todo' }[dossier],
      detail: {
        valide: m.dossier_verified_at ? `Validé le ${formatDateFr(m.dossier_verified_at, LONG_DATE)}` : 'Validé',
        a_verifier: `Reçu le ${formatDateFr(m.dossier_uploaded_at, LONG_DATE)}, à vérifier par le club`,
        refuse: `Refusé${m.dossier_refused_at ? ` le ${formatDateFr(m.dossier_refused_at, LONG_DATE)}` : ''}, en attente d’un dossier corrigé`,
        manquant: 'Pas encore reçu',
      }[dossier],
      action: dossier === 'a_verifier' ? { href: `/admin/inscriptions/${m.inscription_id}/apercu`, label: 'Vérifier le dossier' } : m.dossier_key ? { href: `/admin/inscriptions/${m.inscription_id}/apercu`, label: 'Voir le dossier' } : null,
    },
    {
      key: 'photo',
      title: 'Photo de l’enfant',
      state: m.photo_uploaded_at ? 'ok' : isPhotoToRedo(m) ? 'no' : 'todo',
      detail: m.photo_uploaded_at ? `Reçue le ${formatDateFr(m.photo_uploaded_at, LONG_DATE)}` : isPhotoToRedo(m) ? 'À refaire, nouvelle photo demandée à la famille' : 'Pas encore reçue',
      action: m.photo_key ? { href: `/admin/inscriptions/${m.inscription_id}/photo`, label: 'Voir la photo', newTab: true } : null,
    },
    {
      key: 'paiement',
      title: 'Paiement',
      state: hasPaymentStarted(m) ? 'ok' : 'todo',
      detail: `${m.paye ? 'Reçu' : isPartiallyPaid(m) ? `${formatEuros(paymentBalance(m).recu)} reçus · reste ${formatEuros(paymentBalance(m).reste)}` : 'En attente'}${m.mode_paiement ? ` · ${escapeHtml(m.mode_paiement)}` : ''}${m.pass_sport_code ? ` · Pass’Sport ${escapeHtml(m.pass_sport_code)}` : ''}`,
    },
    {
      key: 'licence',
      title: 'Licence FFF',
      state: m.numero_licence ? 'ok' : 'wait',
      detail: m.numero_licence ? `N° <strong>${escapeHtml(m.numero_licence)}</strong>` : 'À enregistrer sur Footclubs par le club, puis à saisir ici.',
    },
  ];
}

// Une seule chose à faire, la plus urgente, formulée comme une consigne.
function nextAction(m, steps) {
  if (m.archived_at) {
    return { tone: 'neutral', title: 'Adhésion archivée', text: `Archivée le ${formatDateFr(m.archived_at, LONG_DATE)}${archiveReason(m) ? ` · ${escapeHtml(archiveReason(m))}` : ''}.` };
  }
  const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));
  if (byKey.dossier.state === 'wait') {
    return { tone: 'wait', title: 'Dossier signé à vérifier', text: 'La famille a déposé son dossier : vérifiez la signature, le lieu et la date.', action: byKey.dossier.action };
  }
  const famille = steps.filter((s) => s.state === 'todo' || s.state === 'no').map((s) => s.title.toLowerCase());
  if (famille.length) {
    return {
      tone: 'todo',
      title: 'En attente de la famille',
      text: `Il manque : ${escapeHtml(famille.join(', '))}. Les relances automatiques s’en chargent, ou relancez ci-dessous.`,
      action: { href: `/admin/inscriptions/${m.inscription_id}`, label: 'Ouvrir l’inscription' },
    };
  }
  if (!m.numero_licence) {
    return {
      tone: 'wait',
      title: 'Licence FFF à enregistrer',
      text: 'Le dossier est complet. Enregistrez la licence sur Footclubs : la famille reçoit alors l’e-mail de la FFF à remplir. Saisissez ensuite le n° de licence ci-dessous.',
      action: { href: '#licence', label: 'Saisir le n° de licence' },
    };
  }
  return { tone: 'yes', title: 'Tout est en ordre', text: `Dossier complet et licence FFF n° ${escapeHtml(m.numero_licence)} enregistrée.` };
}

const actionLink = (a, cls = 'adm-btn adm-btn-sm adm-btn-ghost') =>
  a ? `<a class="${cls}" href="${escapeHtml(a.href)}"${a.newTab ? ' target="_blank" rel="noopener"' : ''}>${escapeHtml(a.label)}</a>` : '';

// Actions rapides (2026-10-16) : « Marquer payé » et « Relancer » sans passer par l'inscription. Mêmes actions que la
// fiche d'inscription (POST /admin/inscriptions), retour sur la fiche adhérent (safeRedirect l'autorise).
function quickActions(m, contactId) {
  if (!m?.inscription_id || m.archived_at) return '';
  const back = `<input type="hidden" name="redirectTo" value="/admin/adherents/${contactId}">`;
  const name = escapeHtml(`${m.enfant_prenom || ''} ${m.enfant_nom || ''}`.trim());
  const forms = [];
  if (isPartiallyPaid(m)) {
    // Paiement en plusieurs fois : le solde s'enregistre comme un versement (montant, date), pas « Marquer payé ».
    forms.push(`<a class="adm-btn adm-btn-sm adm-btn-primary" href="/admin/inscriptions/${m.inscription_id}#versement">${icon('check')}Enregistrer un versement</a>`);
  } else if (!m.paye) {
    forms.push(`<form method="POST" action="/admin/inscriptions" class="admin-confirm-form">
        <input type="hidden" name="action" value="toggle-paye"><input type="hidden" name="id" value="${m.inscription_id}">${back}
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary" data-confirm="Confirmer que ${name} a payé ? La famille reçoit l’e-mail de suivi.">${icon('check')}Marquer payé</button>
      </form>`);
  }
  if (familyHasActionPending(m)) {
    forms.push(`<form method="POST" action="/admin/inscriptions" class="admin-confirm-form">
        <input type="hidden" name="action" value="bulk-reminder"><input type="hidden" name="ids" value="${m.inscription_id}">${back}
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="Envoyer une relance par e-mail à la famille de ${name} ?">${icon('send')}Relancer la famille</button>
      </form>`);
  }
  return forms.length ? `<div class="adm-next-quick">${forms.join('')}</div>` : '';
}

function nextActionSection(next, quick = '') {
  const iconName = { yes: 'check', wait: 'activity', todo: 'alert', neutral: 'archive' }[next.tone];
  return `<section class="adm-surface adm-next is-${next.tone}" aria-labelledby="prochaine-etape">
    <span class="adm-next-ico" aria-hidden="true">${icon(iconName)}</span>
    <div class="adm-next-body">
      <p class="adm-next-eyebrow">Prochaine étape</p>
      <h2 class="adm-h2" id="prochaine-etape">${next.title}</h2>
      <p>${next.text}</p>
    </div>
    ${next.action ? actionLink(next.action, `adm-btn ${quick && next.tone === 'todo' ? 'adm-btn-ghost' : 'adm-btn-primary'} adm-next-btn`) : ''}
    ${quick}
  </section>`;
}

function licenceForm(m, contactId, messages) {
  return `<form method="POST" action="/admin/inscriptions/${m.inscription_id}" class="adm-licence adm-step-form" id="licence">
      <input type="hidden" name="action" value="licence">
      <input type="hidden" name="retour" value="/admin/adherents/${contactId}">
      <label for="numero-licence">${m.numero_licence ? 'Modifier le n° de licence' : 'N° de licence FFF'}</label>
      ${messages.licenceError ? flash('error', 'N° invalide : chiffres et lettres uniquement (40 caractères au plus).') : ''}
      <div class="adm-licence-row">
        <input type="text" id="numero-licence" name="numeroLicence" value="${escapeHtml(m.numero_licence || '')}" maxlength="40" inputmode="numeric" autocomplete="off"${messages.licenceError ? ' aria-invalid="true"' : ''}>
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button>
      </div>
    </form>`;
}

function parcoursSection(m, steps, contactId, messages) {
  const done = steps.filter((s) => s.state === 'ok').length;
  const label = { ok: 'Fait', wait: 'À faire', todo: 'En attente', no: 'À refaire' };
  const items = steps
    .map(
      (s) => `<li class="adm-step is-${s.state}">
        <span class="adm-step-dot" aria-hidden="true">${icon(STATE_ICON[s.state])}</span>
        <div class="adm-step-body">
          <div class="adm-step-head"><h3>${s.title}</h3><span class="adm-tag is-${s.state === 'ok' ? 'yes' : s.state === 'no' ? 'no' : 'wait'}">${label[s.state]}<span class="visually-hidden"> : ${s.state === 'ok' ? 'étape faite' : s.state === 'wait' ? 'à faire par le club' : 'à faire par la famille'}</span></span></div>
          <p>${s.detail}</p>
          ${s.key === 'licence' ? licenceForm(m, contactId, messages) : actionLink(s.action)}
        </div>
      </li>`
    )
    .join('');
  // Replié par défaut (2026-10-16, demande de l'utilisateur) : « Prochaine étape » dit déjà quoi faire ;
  // la barre de progression reste visible dans l'en-tête replié.
  const open = Boolean(messages.licenceOk || messages.licenceError);
  return `<details class="adm-surface adm-fold adm-parcours"${open ? ' open' : ''}>
    <summary>
      <span class="adm-fold-head">
        <h2 class="adm-h2" id="parcours-titre">${icon('check')}Suivi de l’adhésion</h2>
        <span class="adm-progress-label">${done} / ${steps.length} étapes · ${escapeHtml(m.period_name)}</span>
        <span class="adm-progress" role="progressbar" aria-label="Étapes faites" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}"><span style="width:${Math.round((done / steps.length) * 100)}%"></span></span>
      </span>
      ${icon('chevron')}
    </summary>
    <div class="adm-fold-body">
      ${messages.licenceOk ? flash('ok', 'N° de licence enregistré.') : ''}
      <ol class="adm-steps">${items}</ol>
    </div>
  </details>`;
}

// Inscription complète (2026-10-16) : le suivi disparaît, il ne reste que le n° de licence FFF à saisir ou corriger.
function licenceSection(m, contactId, messages) {
  return `<section class="adm-surface adm-member-licence" aria-labelledby="licence-titre">
    <h2 class="adm-h2" id="licence-titre">${icon('file')}Licence FFF</h2>
    ${messages.licenceOk ? flash('ok', 'N° de licence enregistré.') : ''}
    ${licenceForm(m, contactId, messages)}
  </section>`;
}

function childSection(contact, m, ageCtx) {
  const age = ageGroup(contact.birth_date, ageCtx || m?.period_name);
  const yes = (v) => (v ? statusTag(true, { yes: 'Oui', no: 'Non' }) : statusTag(false, { yes: 'Oui', no: 'Non' }));
  const adresse = m ? [m.adresse, [m.code_postal, m.ville].filter(Boolean).join(' ')].filter(Boolean).map(escapeHtml).join('<br>') : '';
  // Champs de la demande de licence FFF (2026-10-16), chacun avec « Copier » : nom, prénom, naissance, ville et pays de
  // naissance (e-mails : carte des responsables). Le pays se choisit dans un menu déroulant chez la FFF : pas de copie.
  const copyKv = (label, value, what) => (value ? kv(label, `<span class="adm-person-coord">${escapeHtml(value)}</span>${copyButton(value, what)}`) : '');
  const nom = m?.enfant_nom || contact.last_name;
  const prenom = m?.enfant_prenom || contact.first_name;
  return `<section class="adm-surface adm-member-child" aria-labelledby="enfant-titre">
    <h2 class="adm-h2" id="enfant-titre">${icon('user')}L’enfant</h2>
    <dl class="adm-kv adm-kv-copy">
      ${copyKv('Nom', nom, 'le nom')}
      ${copyKv('Prénom', prenom, 'le prénom')}
      ${contact.birth_date ? copyKv('Né(e) le', formatBirth(contact.birth_date), 'la date de naissance') : ''}
      ${copyKv('Ville de naissance', m?.ville_naissance, 'la ville de naissance')}
      ${m?.cp_naissance ? copyKv('Code postal de naissance', m.cp_naissance, 'le code postal de naissance') : ''}
      ${m?.pays_naissance ? kv('Pays de naissance', `<span class="adm-person-coord">${escapeHtml(m.pays_naissance)}</span>`) : ''}
      ${m?.inscription_id && !m.ville_naissance ? kv('Lieu de naissance', '<span class="adm-tag is-wait">À compléter</span>') : ''}
    </dl>
    <dl class="adm-kv">
      ${m ? kv('Catégorie', ageAndCategory(age, m.group_label) || '—') : ''}
      ${m?.taille_maillot ? kv('Taille de tenue', escapeHtml(m.taille_maillot)) : ''}
      ${adresse ? kv('Adresse', adresse) : ''}
      ${m?.inscription_id ? kv('Participation autorisée', yes(m.autorisation)) : ''}
      ${m?.inscription_id ? kv('Droit à l’image', yes(m.droit_image)) : ''}
      ${m?.joined_at ? kv('Adhérent depuis', formatDateFr(m.joined_at, LONG_DATE)) : ''}
    </dl>
  </section>`;
}

const ORIGIN_LABELS = { auto: 'Automatique', manuel: 'Envoyé par le club', famille: 'Suite à une action de la famille', doublon: 'Inscription en double' };

function emailItem(e) {
  const club = isClubEmailKind(e.kind);
  const to = String(e.recipients || '').split(',').map((s) => s.trim()).filter(Boolean);
  return `<li class="adm-mh-item${e.ok ? '' : ' is-failed'}">
      <span class="adm-mh-ico" aria-hidden="true">${icon(e.ok ? 'mail' : 'alert')}</span>
      <div class="adm-mh-body">
        <div class="adm-mh-head">
          <strong>${escapeHtml(EMAIL_KINDS[e.kind] || e.kind)}</strong>
          ${club ? '<span class="adm-tag is-neutral">Alerte club</span>' : ''}
          ${e.ok ? '<span class="adm-tag is-yes">Envoyé</span>' : '<span class="adm-tag is-no">Échec</span>'}
        </div>
        ${e.subject ? `<p class="adm-mh-subject">« ${escapeHtml(e.subject)} »</p>` : ''}
        <p class="adm-mh-meta"><time datetime="${escapeHtml(String(e.created_at).replace(' ', 'T'))}Z">${formatDateFr(e.created_at, DATE_TIME)}</time>${e.origin ? ` · ${escapeHtml(ORIGIN_LABELS[e.origin] || e.origin)}` : ''}${to.length ? ` · à ${to.map(escapeHtml).join(', ')}` : ''}</p>
        ${!e.ok && e.error ? `<p class="adm-mh-error">${escapeHtml(e.error)}</p>` : ''}
      </div>
    </li>`;
}

const VISIBLE_EMAILS = 6;

export function emailsSection(emails, m, { open = false } = {}) {
  const journal = m?.inscription_id ? `/admin/events?inscription=${m.inscription_id}` : '/admin/events';
  if (emails === null) {
    return `<section class="adm-surface adm-member-mails" id="emails"><h2 class="adm-h2">${icon('mail')}E-mails envoyés</h2>${flash('error', 'Journal des e-mails momentanément indisponible.')}</section>`;
  }
  // Replié par défaut (2026-10-16) : le résumé (nombre, date du dernier, échecs) reste visible ;
  // ouvert d'office s'il y a un échec, pour qu'il ne passe pas inaperçu.
  const family = emails.filter((e) => !isClubEmailKind(e.kind));
  const failed = emails.filter((e) => !e.ok).length;
  const last = family[0];
  const summary = emails.length
    ? `${family.length} e-mail${family.length > 1 ? 's' : ''} à la famille${last ? `, le dernier le ${formatDateFr(last.created_at, SHORT_DATE)}` : ''}${failed ? ` · <strong class="adm-mh-failed">${failed} en échec</strong>` : ''}.`
    : 'Aucun e-mail enregistré pour cette famille.';
  const visible = emails.slice(0, VISIBLE_EMAILS).map(emailItem).join('');
  const rest = emails.slice(VISIBLE_EMAILS);
  return `<details class="adm-surface adm-fold adm-member-mails" id="emails"${failed || open ? ' open' : ''}>
    <summary>
      <span class="adm-fold-head">
        <h2 class="adm-h2" id="emails-titre">${icon('mail')}E-mails envoyés</h2>
        <span class="adm-fold-meta">${summary}</span>
      </span>
      ${icon('chevron')}
    </summary>
    <div class="adm-fold-body">
      ${m?.inscription_id ? `<p><a class="adm-btn adm-btn-sm adm-btn-ghost" href="/admin/email?inscription=${m.inscription_id}">${icon('send')}Écrire à la famille</a></p>` : ''}
      ${emails.length ? `<ul class="adm-mh-list">${visible}</ul>` : ''}
      ${rest.length ? `<details class="adm-mh-more"><summary>Voir ${rest.length} e-mail${rest.length > 1 ? 's' : ''} plus ancien${rest.length > 1 ? 's' : ''}</summary><ul class="adm-mh-list">${rest.map(emailItem).join('')}</ul></details>` : ''}
      <p class="adm-help adm-mh-note">« Envoyé » = accepté par le service d’envoi, pas forcément lu. Journal tenu depuis le 23 septembre 2026. <a class="adm-link" href="${journal}">Journal complet</a></p>
    </div>
  </details>`;
}

// Bouton « Copier » en icône seule (2026-10-16) : data-copy géré par assets/js/admin-nav.js (coche verte 2 s).
const copyButton = (value, what) =>
  `<button type="button" class="adm-copy-btn" data-copy="${escapeHtml(value)}" aria-label="Copier ${what}" title="Copier">${icon('copy')}${icon('check')}</button>`;

function guardiansSection(profile) {
  if (!profile.guardians.length) {
    return `<section class="adm-surface adm-member-family"><h2 class="adm-h2">${icon('phone')}Responsables légaux</h2><p class="adm-help">Aucun responsable enregistré.</p></section>`;
  }
  const same = (a, b) => Boolean(a) && String(a).trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const inscriptionFor = (p) => (profile.memberships || []).find((m) => m.inscription_id && (same(p.email, m.email) || same(p.email, m.parent2_email)))?.inscription_id || null;
  const people = profile.guardians
    .map(
      (g) => `<li class="adm-guardian">
        <div class="adm-guardian-id">
          <strong><a class="adm-link" href="/admin/contacts/${g.id}">${escapeHtml(fullName(g))}</a></strong>
          <span class="adm-row-sub">${escapeHtml(`${relationLabel(g.relationship_type)}${g.is_primary ? ' · principal' : ''}`)}</span>
        </div>
        <dl class="adm-guardian-coords">
          ${g.phone ? `<div><dt>Téléphone</dt><dd><span class="adm-person-coord">${escapeHtml(g.phone)}</span>${copyButton(g.phone, 'le téléphone')}</dd></div>` : ''}
          ${g.email ? `<div><dt>E-mail</dt><dd><span class="adm-person-coord">${escapeHtml(g.email)}</span>${copyButton(g.email, 'l’e-mail')}</dd></div>` : ''}
        </dl>
        ${contactActions({ phone: g.phone, email: g.email, name: fullName(g), inscriptionId: inscriptionFor(g) })}
      </li>`
    )
    .join('');
  return `<section class="adm-surface adm-member-family" aria-labelledby="responsables-titre">
    <h2 class="adm-h2" id="responsables-titre">${icon('phone')}${profile.guardians.length > 1 ? 'Responsables légaux' : 'Responsable légal'}</h2>
    <ul class="adm-guardians">${people}</ul>
  </section>`;
}

function shortcutsSection(m) {
  if (!m?.inscription_id) return '';
  const self = `/admin/inscriptions/${m.inscription_id}`;
  return `<section class="adm-surface adm-member-links" aria-labelledby="raccourcis-titre">
    <h2 class="adm-h2" id="raccourcis-titre">${icon('file')}Documents et actions</h2>
    <div class="adm-member-actions">
      ${m.dossier_key ? `<a href="${self}/apercu" class="adm-btn adm-btn-ghost">${icon('eye')}Dossier signé</a>` : ''}
      ${m.photo_key ? `<a href="${self}/photo" class="adm-btn adm-btn-ghost" target="_blank" rel="noopener">${icon('camera')}Photo</a>` : ''}
      <a href="${self}#dossier" class="adm-btn adm-btn-ghost">${icon('card')}Paiement et versements</a>
      <a href="${self}" class="adm-btn adm-btn-ghost">${icon('file')}Ouvrir l'inscription</a>
    </div>
    <p class="adm-help">Versements, chèques, relances, archiver : sur l’inscription n° ${m.inscription_id}.</p>
  </section>`;
}

// Note interne (2026-10-16) : masquée tant qu'on ne clique pas, pour pouvoir montrer l'écran (un téléphone) à un
// parent sans qu'il la lise. Jamais montrée à la famille ni envoyée par e-mail.
export function noteSection(m, contactId, messages, retour = `/admin/adherents/${contactId}`) {
  if (!m?.inscription_id) return '';
  const note = m.note_interne || '';
  return `<section class="adm-surface adm-member-note" id="note" aria-labelledby="note-titre">
    <h2 class="adm-h2" id="note-titre">${icon('lock')}Note interne</h2>
    ${messages.noteOk ? flash('ok', 'Note enregistrée.') : ''}
    ${messages.noteError ? flash('error', 'Note trop longue (2 000 caractères au plus).') : ''}
    <details class="adm-note"${messages.noteError ? ' open' : ''}>
      <summary class="adm-btn adm-btn-sm adm-btn-ghost">${icon('eye')}<span class="adm-note-show">${note ? 'Afficher la note' : 'Ajouter une note'}</span><span class="adm-note-hide">Masquer la note</span></summary>
      <form method="POST" action="/admin/inscriptions/${m.inscription_id}" class="adm-note-form">
        <input type="hidden" name="action" value="note">
        ${retour ? `<input type="hidden" name="retour" value="${escapeHtml(retour)}">` : ''}
        <label for="note-interne" class="visually-hidden">Note interne</label>
        <textarea id="note-interne" name="noteInterne" rows="5" maxlength="2000">${escapeHtml(note)}</textarea>
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer la note</button>
      </form>
    </details>
    <p class="adm-help">${note ? 'Une note est enregistrée. ' : ''}Réservée au club, jamais montrée à la famille.</p>
  </section>`;
}

// Ce que le club doit faire à chaque étape de la licence.
const LICENCE_HINTS = {
  a_demander: 'Faire la demande de licence sur Footclubs, puis cocher la première étape.',
  attente_famille: 'La famille doit compléter sa demande depuis l’e-mail reçu de la FFF. Relancez-la si besoin.',
  a_verifier: 'Vérifier chaque pièce sur Footclubs et noter son état ci-dessous.',
  a_signer: 'Signer la demande sur Footclubs pour la transmettre à la FFF.',
  attente_fff: 'Rien à faire : la FFF étudie la demande (quelques jours en général).',
  refusee: 'Une pièce a été refusée : relancez la famille pour qu’elle la dépose de nouveau.',
  validee: 'Licence validée. Pensez à saisir le n° de licence s’il manque.',
};

// Suivi licence FFF et tenue (club-followup.js) : étapes Footclubs, état de chaque pièce, tenue. Enregistré dès qu'une
// case ou une liste change (admin-nav.js, formulaire data-autosubmit ; bouton « Enregistrer » sans JavaScript).
export function followupSection(m, contactId, messages, retour = `/admin/adherents/${contactId}`) {
  if (!m?.inscription_id) return '';
  const stage = licenceStage(m);
  const missing = licenceMissing(m);
  const box = (s, i) => `<label class="adm-check adm-followup-item${m[s.column] ? ' is-done' : ''}">
        <input type="checkbox" name="${s.key}" value="1"${m[s.column] ? ' checked' : ''}>
        <span>${i === undefined ? '' : `<b class="adm-followup-num" aria-hidden="true">${i + 1}</b>`}${escapeHtml(s.label)}${m[s.column] ? `<small>le ${formatDateFr(m[s.column], SHORT_DATE)}</small>` : ''}</span>
      </label>`;
  const doc = (d) => {
    const value = String(m[d.column] ?? '');
    const tone = value ? (['manquant', 'refuse'].includes(value) ? 'no' : value === 'non_requis' ? 'neutral' : 'yes') : 'wait';
    return `<label class="adm-doc-row is-${tone}">
        <span>${escapeHtml(d.label)}${d.certificat ? '<small>Requis seulement si « oui » au questionnaire</small>' : ''}</span>
        <select name="${d.key}" class="adm-select">${docChoices(d).map(([k, label]) => `<option value="${k}"${k === value ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>
      </label>`;
  };
  const canRemind = ['attente_famille', 'a_verifier', 'refusee'].includes(stage) || missing.length > 0;
  return `<section class="adm-surface adm-member-followup" id="suivi-club" aria-labelledby="suivi-club-titre">
    <h2 class="adm-h2" id="suivi-club-titre">${icon('check')}Suivi licence et tenue</h2>
    ${messages.suiviOk ? flash('ok', 'Suivi enregistré.') : ''}
    ${messages.relanceOk ? flash('ok', 'Relance notée.') : ''}
    <div class="adm-lic-status is-${LICENCE_STAGES[stage].tone}">
      <p class="adm-lic-stage">${escapeHtml(LICENCE_STAGES[stage].label)}</p>
      ${missing.length ? `<p class="adm-licence-missing">${icon('alert')}<span>Manque : ${missing.map((d) => `<strong>${escapeHtml(d.label.toLowerCase())}</strong>${d.refused ? ' (refusé, à corriger)' : ''}`).join(', ')}</span></p>` : ''}
      <p class="adm-help">${escapeHtml(LICENCE_HINTS[stage])}${m.licence_relance_at ? ` Dernière relance le ${formatDateFr(m.licence_relance_at, SHORT_DATE)}.` : ''}</p>
      ${m.licence_footclubs_statut ? `<p class="adm-help">Footclubs : <strong>${escapeHtml(m.licence_footclubs_statut)}</strong>${m.licence_footclubs_at ? ` (import du ${formatDateFr(m.licence_footclubs_at, SHORT_DATE)})` : ''}.</p>` : ''}
      ${
        canRemind
          ? `<div class="adm-lic-actions">
        <a href="/admin/email?inscription=${m.inscription_id}&amp;modele=licence" class="adm-btn adm-btn-sm adm-btn-primary">${icon('mail')}Relancer par e-mail</a>
        <form method="POST" action="/admin/inscriptions/${m.inscription_id}">
          <input type="hidden" name="action" value="licence-relance">
          ${retour ? `<input type="hidden" name="retour" value="${escapeHtml(retour)}">` : ''}
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('phone')}Noter une relance</button>
        </form>
      </div>`
          : ''
      }
    </div>
    <form method="POST" action="/admin/inscriptions/${m.inscription_id}" class="adm-followup" data-autosubmit>
      <input type="hidden" name="action" value="suivi-club">
      ${retour ? `<input type="hidden" name="retour" value="${escapeHtml(retour)}">` : ''}
      <fieldset class="adm-followup-group adm-followup-steps"><legend>Étapes Footclubs</legend>${FOLLOWUP_STEPS.filter((s) => s.group === 'licence').map(box).join('')}</fieldset>
      <fieldset class="adm-followup-group adm-followup-docs"><legend>Pièces à déposer par la famille</legend>${LICENCE_DOCS.map(doc).join('')}
        <p class="adm-help">C’est à la famille de les déposer. « Ajouté par le club » seulement en dernier recours.</p>
      </fieldset>
      <fieldset class="adm-followup-group"><legend>Tenue</legend>${FOLLOWUP_STEPS.filter((s) => s.group === 'tenue').map((s) => box(s)).join('')}</fieldset>
      <noscript><button type="submit" class="adm-btn adm-btn-sm adm-btn-primary">${icon('check')}Enregistrer</button></noscript>
    </form>
  </section>`;
}

function memberPageBody(profile, current, { ageCtx, emails, messages }) {
  const { contact, memberships } = profile;
  const steps = current?.inscription_id ? parcoursSteps(current) : null;
  const complete = Boolean(steps && isInscriptionComplete(current));
  return `<div class="adm-member-layout">
    <div class="adm-member-col">
      ${messages.savedOk || messages.bulkOk || messages.bulkError
        ? `<div class="adm-member-flash">${messages.savedOk ? flash('ok', 'Fiche mise à jour.') : ''}${messages.bulkOk ? flash('ok', messages.bulkOk) : ''}${messages.bulkError ? flash('error', messages.bulkError) : ''}</div>`
        : ''}
      ${steps ? nextActionSection(nextAction(current, steps), quickActions(current, contact.id)) : ''}
      ${reviewSection(profile)}
      ${steps ? (complete ? licenceSection(current, contact.id, messages) : parcoursSection(current, steps, contact.id, messages)) : ''}
      ${followupSection(current, contact.id, messages)}
      ${childSection(contact, current, ageCtx)}
      ${emailsSection(emails, current)}
      ${historySection(memberships, true)}
    </div>
    <aside class="adm-member-col adm-member-side" aria-label="Contacts et documents">
      ${guardiansSection(profile)}
      ${shortcutsSection(current)}
      ${noteSection(current, contact.id, messages)}
    </aside>
  </div>`;
}

export function profilePage(profile, { asMember, ageCtx = null, badges = {}, emails = [], messages = {} }) {
  const { contact, memberships } = profile;
  const current = memberships.find((m) => m.is_current) || memberships[0] || null;
  const name = escapeHtml(fullName(contact));
  const page = `${adminHead(fullName(contact))}
${adminShell({
  active: 'adherents',
  badges,
  back: asMember ? { href: '/admin/adherents', label: 'Adhérents' } : { href: '/admin/adherents', label: 'Adhérents' },
  lead: avatar(
    current?.inscription_id && current.photo_uploaded_at
      ? { id: current.inscription_id, enfant_prenom: contact.first_name, enfant_nom: contact.last_name, photo_uploaded_at: current.photo_uploaded_at }
      : { id: contact.id, enfant_prenom: contact.first_name, enfant_nom: contact.last_name },
    'lg'
  ),
  eyebrow: memberships.length ? 'Fiche adhérent' : 'Fiche contact',
  title: name,
  subtitle: current
    ? [escapeHtml(current.period_name), ageAndCategory(ageGroup(contact.birth_date, ageCtx || current.period_name), current.group_label), asMember && contact.birth_date && `né(e) le ${formatBirth(contact.birth_date)}`].filter(Boolean).join(' · ')
    : 'Personne liée à un adhérent',
  meta: !current
    ? ''
    : asMember
      ? `<div class="adm-hero-tags"><span class="adm-hero-pair">Adhésion ${membershipTag(current.status)}</span>${
          current.inscription_id
            ? `<span class="adm-hero-pair">Licence FFF ${current.numero_licence ? `<span class="adm-tag is-yes">N° ${escapeHtml(current.numero_licence)}</span>` : '<span class="adm-tag is-wait">À saisir</span>'}</span>`
            : ''
        }</div>`
      : `<div class="adm-hero-tags"><span>Adhésion</span>${membershipTag(current.status)}${current.inscription_id ? `<span>Dossier</span>${legacyTags(current)}` : ''}</div>`,
  // « Modifier » en haut de la fiche (2026-10-16) : formulaire de l'inscription, qui revient ici après l'enregistrement.
  actions:
    asMember && current?.inscription_id
      ? `<a href="/admin/inscriptions/${current.inscription_id}?edit=1&amp;retour=/admin/adherents/${contact.id}" class="adm-btn adm-btn-white">${icon('edit')}Modifier</a>
         <a href="/admin/email?inscription=${current.inscription_id}" class="adm-btn adm-btn-white">${icon('mail')}Écrire à la famille</a>`
      : '',
})}
<main id="adm-main" class="adm-wrap adm-main">
  ${
    asMember
      ? memberPageBody(profile, current, { ageCtx, emails, messages })
      : `<div class="adm-fiche-grid adm-crm-grid">
    ${identitySection(contact)}
    ${currentMembershipSection(current)}
    ${familySection(profile)}
    ${dossierSection(current)}
    ${reviewSection(profile)}
    ${historySection(memberships)}
  </div>`
  }
  <p class="adm-help">${
    asMember && current?.inscription_id
      ? `Ces informations viennent de l’inscription n° ${current.inscription_id} et suivent ses modifications. Pour corriger, bouton « Modifier » en haut de la fiche.`
      : 'Données en lecture seule : elles proviennent des inscriptions et sont mises à jour avec elles.'
  }</p>
</main>
${adminScripts('admin-nav')}
</body></html>`;
  return page;
}

export const notFoundPage = () => new Response('Fiche introuvable.', { status: 404 });
export { MEMBER_PAGE_SIZE };
