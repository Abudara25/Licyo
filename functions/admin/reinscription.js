// Page dédiée à la campagne de réinscription prioritaire — contrairement à /admin/inscriptions
// (qui mélange toutes les saisons présentes en base, actives ou archivées), cette page ne montre
// QUE les adhérents de la saison précédente : ceux dont saison != saison en cours (voir
// _shared/settings-kv.js). Objectif explicite (demande utilisateur) : éviter qu'un responsable du
// club sélectionne par erreur des familles déjà inscrites cette saison en travaillant sur la liste
// générale, en ne lui montrant que la bonne population dès le départ.
// L'envoi (premier lien ou rappel) réutilise les actions bulk-reinscription/bulk-reinscription-
// rappel de functions/admin/inscriptions.js (génère le reinscription_token si besoin + e-mail via
// sendReinscriptionEmail) — cette page ne fait que POSTer dessus avec redirectTo=/admin/reinscription
// pour revenir ici après coup, et la sélection multiple réutilise telle quelle
// assets/js/admin-inscriptions.js (mêmes id/classes : #bulk-form, #bulk-action, #bulk-select-all,
// #bulk-count, #bulk-ids-container, .insc-select, [data-bulk-action]).
// onRequestPost ci-dessous (action=generate-link) gère en plus la génération du lien pour UNE seule
// fiche sans envoyer d'e-mail, affiché/copiable directement dans une ligne (voir linkBlock) — c'est
// la seule page où ce lien apparaît : à la demande explicite de l'utilisateur, il n'est plus affiché
// ni généré depuis la fiche /admin/inscriptions/<id>.
import { ageGroup, sortAgeGroups, ensureInscriptionsTable, isInscriptionComplete, familyHasActionPending, reinscriptionIds } from '../_shared/inscriptions-db.js';
import { photoTag, isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, avatar, flash, formatBirth, dossierTag, statusTag, PHOTO_TAG, PAIEMENT_TAG, ageAndCategory } from '../_shared/admin-auth.js';
import { getCategoriesConfig } from '../_shared/settings-kv.js';
import { extendReinscriptionLink, isReinscriptionLinkValid } from '../_shared/family-links.js';
import { loadAgeContext } from '../_shared/preinscriptions.js';

function statusTags(row) {
  // Un retardataire archivé (voir "Fin de saison" dans /admin/categories) reste actionnable ici même
  // après archivage — ce badge le signale, plutôt que de le faire disparaître silencieusement.
  const tags = row.archived_at ? ['<span class="adm-tag is-neutral">Archivé</span>'] : [];
  if (row.dejaReinscrit) tags.push(`<span class="adm-tag is-yes">${icon('check')}Réinscrit</span>`);
  else if (row.reinscription_token && !isReinscriptionLinkValid(row)) tags.push('<span class="adm-tag is-no">Lien expiré</span>');
  else if (row.reinscription_token) tags.push('<span class="adm-tag is-wait">Lien envoyé, en attente</span>');
  else tags.push('<span class="adm-tag is-no">Pas encore contacté</span>');
  return `<div class="adm-tags">${tags.join('')}</div>`;
}

function linkBlock(r, siteUrl, returnTo) {
  if (r.dejaReinscrit) return '';
  if (r.reinscription_token && !isReinscriptionLinkValid(r)) {
    return '<p class="adm-help">Lien expiré : renvoyez-le par e-mail (il redevient valable 30 jours), ou la famille en redemande un depuis la page.</p>';
  }
  if (r.reinscription_token) {
    return `<input type="text" readonly class="adm-copy" value="${escapeHtml(`${siteUrl}/reinscription/${r.reinscription_token}`)}" aria-label="Lien de réinscription de ${escapeHtml(r.enfant_prenom)} (triple-cliquer pour sélectionner)">`;
  }
  return `<form method="POST">
    <input type="hidden" name="action" value="generate-link">
    <input type="hidden" name="id" value="${r.id}">
    <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">
    <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('link')}Générer le lien (sans e-mail)</button>
  </form>`;
}

// Ligne compacte (lot 3, 2026-11-13) : case, photo, enfant et responsable, lien personnel, état, Voir la fiche / E-mail.
function row(r, siteUrl, returnTo, ageCtx) {
  const name = `${escapeHtml(r.enfant_prenom)} ${escapeHtml(r.enfant_nom)}`;
  return `<article class="adm-rrow">
    <label class="insc-select-wrap"><input type="checkbox" class="insc-select" data-id="${r.id}" aria-label="Sélectionner ${name}" ${r.dejaReinscrit ? 'disabled' : ''}></label>
    ${avatar(r)}
    <div class="adm-irow-id"><h3><a href="/admin/inscriptions/${r.id}">${name}</a></h3><p>${ageAndCategory(ageGroup(r.naissance, ageCtx), r.categorie)} · né(e) le ${formatBirth(r.naissance)} · ${escapeHtml(r.parent_prenom)} ${escapeHtml(r.parent_nom)}</p></div>
    <div class="adm-rrow-link">${linkBlock(r, siteUrl, returnTo)}</div>
    ${statusTags(r)}
    <div class="adm-irow-actions"><a href="/admin/inscriptions/${r.id}" class="adm-btn adm-btn-ghost">Ouvrir</a><a href="/admin/email?inscription=${r.id}" class="adm-btn adm-btn-ghost">${icon('mail')}E-mail</a></div>
  </article>`;
}

// Réinscription de la saison en cours pas encore complète : elle reste ici jusqu'à être complète (dossier validé,
// paiement, photo), puis passe dans Adhérents. Les actions postent sur /admin/inscriptions et reviennent ici.
function pendingRow(r, returnTo, ageCtx) {
  const name = `${escapeHtml(r.enfant_prenom)} ${escapeHtml(r.enfant_nom)}`;
  const relance = familyHasActionPending(r)
    ? `<form method="POST" action="/admin/inscriptions" class="admin-confirm-form">
        <input type="hidden" name="action" value="bulk-reminder"><input type="hidden" name="ids" value="${r.id}">
        <input type="hidden" name="redirectTo" value="${escapeHtml(returnTo)}">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost" data-confirm="${escapeHtml(`Envoyer une relance par e-mail à la famille de ${r.enfant_prenom} ${r.enfant_nom} ?`)}">${icon('send')}Relancer</button>
      </form>`
    : '';
  return `<article class="adm-surface adm-row">
    ${avatar(r, 'sm')}
    <div class="adm-row-main">
      <strong><a href="/admin/inscriptions/${r.id}" class="adm-link">${name}</a></strong>
      <span class="adm-row-sub">${ageAndCategory(ageGroup(r.naissance, ageCtx), r.categorie)} · né(e) le ${formatBirth(r.naissance)} · saison ${escapeHtml(r.saison)}</span>
      <div class="adm-steps-tags"><span>Dossier ${dossierTag(r)}</span><span>Photo ${photoTag(r)}</span><span>Paiement ${statusTag(r.paye, PAIEMENT_TAG)}</span></div>
    </div>
    <div class="adm-row-side">
      <a href="/admin/inscriptions/${r.id}" class="adm-btn adm-btn-sm adm-btn-primary">Voir la fiche</a>
      ${relance}
    </div>
  </article>`;
}

// État d'une famille de la saison précédente : réinscrite, lien expiré, contactée (en attente), pas encore contactée.
export function reinscState(r) {
  if (r.dejaReinscrit) return 'reinscrits';
  if (r.reinscription_token && !isReinscriptionLinkValid(r)) return 'expires';
  if (r.reinscription_token) return 'attente';
  return 'non-contactes';
}
const ETATS = { 'non-contactes': 'Pas encore contactés', attente: 'Lien envoyé, sans réponse', expires: 'Lien expiré', reinscrits: 'Réinscrits' };

// Refonte « à l'échelle » (2026-11-13), même logique que Pré-inscriptions, Inscriptions et Adhérents : sélecteur de
// catégorie (catégorie de la NOUVELLE saison), « À faire maintenant », tableau par catégorie, filtres par état.
// Plus de recherche locale (la recherche du haut trouve enfants et parents) ni de paragraphes d'aide répétés.
function page({ all, rows, pending, saison, ageCtx, q, age, etat, bulkOk, bulkError, siteUrl, returnTo, dateLimiteReinscription, badges }) {
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const ageOf = (r) => ageGroup(r.naissance, ageCtx) || r.categorie || '—';
  const href = (changes) => {
    const params = new URLSearchParams();
    const next = { q, age, etat, ...changes };
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v);
    const text = params.toString();
    return `/admin/reinscription${text ? `?${text}` : ''}`;
  };
  const count = (list, key) => list.filter((r) => reinscState(r) === key).length;
  const ages = sortAgeGroups(new Set([...all, ...pending].map(ageOf)));
  const summaries = ages.map((a) => {
    const list = all.filter((r) => ageOf(r) === a);
    const fin = pending.filter((r) => ageOf(r) === a).length;
    const todo = count(list, 'non-contactes') + count(list, 'expires') + fin;
    return { age: a, list, fin, todo, reinscrits: count(list, 'reinscrits'), attente: count(list, 'attente') };
  });
  const scope = age ? all.filter((r) => ageOf(r) === age) : all;
  const scopePending = age ? pending.filter((r) => ageOf(r) === age) : pending;

  // Sélecteur de catégorie avec recherche.
  const todoAges = summaries.filter((x) => x.todo);
  const option = (x) => {
    const on = x.age === age;
    return `<a class="adm-pi-opt${on ? ' is-active' : ''}" href="${escapeHtml(href({ age: x.age, etat: '' }))}" data-filter-text="${escapeHtml(x.age.toLowerCase())}"${on ? ' aria-current="true"' : ''}><span><strong>${escapeHtml(x.age)}</strong><small>${plural(x.list.length, 'ancien adhérent', 'anciens adhérents')} · ${x.reinscrits} réinscrit${x.reinscrits > 1 ? 's' : ''}</small></span>${x.todo ? `<b>${x.todo}</b>` : ''}</a>`;
  };
  const picker =
    summaries.length > 1 || age
      ? `<div class="adm-pi-bar-top"><div class="adm-pi-picker">
    <details class="adm-pi-select" data-dismiss>
      <summary aria-label="Choisir une catégorie">${icon('users')}<span>${age ? `<strong>${escapeHtml(age)}</strong><small>saison ${escapeHtml(saison)}</small>` : `<strong>Toutes les catégories</strong><small>${summaries.length}</small>`}</span>${icon('chevron')}</summary>
      <div class="adm-pi-menu">
        <label class="adm-pi-search"><span class="visually-hidden">Chercher une catégorie</span>${icon('search')}<input type="search" placeholder="Chercher une catégorie" data-filter-input="reinsc-cats" autocomplete="off"></label>
        <nav aria-label="Catégories d’âge" data-filter-list="reinsc-cats">
          <a class="adm-pi-opt${age ? '' : ' is-active'}" href="${escapeHtml(href({ age: '', etat: '' }))}" data-filter-text="toutes les categories"><span><strong>Toutes les catégories</strong><small>vue d’ensemble</small></span></a>
          ${todoAges.length ? `<p class="adm-pi-lab" data-filter-label>À traiter</p>${todoAges.map(option).join('')}` : ''}
          ${summaries.length > todoAges.length ? `<p class="adm-pi-lab" data-filter-label>${todoAges.length ? 'Autres catégories' : 'Catégories'}</p>${summaries.filter((x) => !x.todo).map(option).join('')}` : ''}
        </nav>
        <p class="adm-help" data-filter-empty="reinsc-cats" hidden>Aucune catégorie ne correspond.</p>
      </div>
    </details>
  </div></div>`
      : '';

  // « À faire maintenant » (dans la catégorie choisie, ou toutes).
  const items = [
    { n: count(scope, 'non-contactes'), icon: 'send', tone: 'wait', title: (n) => `${plural(n, 'famille pas encore contactée', 'familles pas encore contactées')}`, text: 'Cochez-les dans la liste et « Envoyer le lien ».', link: href({ etat: 'non-contactes' }), button: 'Voir', primary: true },
    { n: count(scope, 'expires'), icon: 'alert', tone: 'no', title: (n) => `${plural(n, 'lien expiré', 'liens expirés')}`, text: 'Renvoyez le lien par e-mail : il redevient valable 30 jours.', link: href({ etat: 'expires' }), button: 'Voir' },
    { n: scopePending.length, icon: 'file', tone: 'wait', title: (n) => `${plural(n, 'réinscription à finaliser', 'réinscriptions à finaliser')}`, text: 'Dossier, photo ou paiement manquant pour la nouvelle saison.', link: '#a-finaliser', button: 'Voir' },
    { n: count(scope, 'attente'), icon: 'calendar', tone: 'neutral', title: (n) => `${plural(n, 'famille contactée sans réponse', 'familles contactées sans réponse')}`, text: 'Un rappel peut être envoyé depuis la liste.', link: href({ etat: 'attente' }), button: 'Voir' },
  ].filter((t) => t.n);
  const deadline = dateLimiteReinscription
    ? `Réinscription prioritaire jusqu’au <strong>${escapeHtml(dateLimiteReinscription.split('-').reverse().join('/'))}</strong> · <a class="adm-link" href="/admin/categories">modifier</a>`
    : 'Aucune date limite de réinscription prioritaire · <a class="adm-link" href="/admin/categories">en définir une</a>';
  const todoPanel = `<section class="adm-surface adm-pi-todo${items.length ? '' : ' is-empty'}">
    <h2 class="adm-h2">${icon(items.length ? 'activity' : 'check')}${items.length ? 'À faire maintenant' : 'Rien à faire pour le moment'}${age ? ` <em>· ${escapeHtml(age)}</em>` : ''}</h2>
    ${items.length ? `<ul>${items.map((t) => `<li class="adm-pi-todo-item is-${t.tone}"><span class="adm-pi-todo-ico">${icon(t.icon)}</span><div><strong>${escapeHtml(t.title(t.n))}</strong><p>${escapeHtml(t.text)}</p></div><a class="adm-btn adm-btn-sm ${t.primary ? 'adm-btn-primary' : 'adm-btn-ghost'}" href="${escapeHtml(t.link)}">${t.button}</a></li>`).join('')}</ul>` : ''}
    <p class="adm-help adm-pi-deadline">${deadline}</p>
  </section>`;

  // Tableau par catégorie (sans catégorie choisie).
  const table =
    !age && summaries.length > 1
      ? `<section class="adm-surface adm-pi-table" id="categories">
    <div class="adm-pi-table-head"><h2 class="adm-h2">${icon('tag')}Par catégorie <small class="adm-pi-years">saison ${escapeHtml(saison)}</small></h2></div>
    <ul class="adm-pi-groups"><li class="adm-pi-group adm-pi-ghead" aria-hidden="true"><span>Catégorie</span><span>Réinscrits</span><span>Détail</span><span>À faire</span><span></span></li>${[...summaries]
      .sort((a, b) => b.todo - a.todo)
      .map((x) => {
        const pct = x.list.length ? Math.round((x.reinscrits / x.list.length) * 100) : 0;
        const detail = [x.attente && `${x.attente} sans réponse`, x.fin && `${x.fin} à finaliser`].filter(Boolean).join(' · ');
        return `<li class="adm-pi-group">
      <div class="adm-pi-g-name"><a href="${escapeHtml(href({ age: x.age, etat: '' }))}">${escapeHtml(x.age)}</a><small>${plural(x.list.length, 'ancien adhérent', 'anciens adhérents')}</small></div>
      <div class="adm-pi-g-fill"><span class="adm-pi-fill"><b>${x.reinscrits}/${x.list.length}</b><span class="adm-pi-bar" aria-hidden="true"><i style="width:${pct}%"></i></span></span></div>
      <div class="adm-pi-g-state"><small>${detail || '—'}</small></div>
      <div class="adm-pi-g-todo">${x.todo ? `<strong>${x.todo} à faire</strong>` : '<span>Rien à faire</span>'}</div>
      <a class="adm-btn adm-btn-sm ${x.todo ? 'adm-btn-primary' : 'adm-btn-ghost'}" href="${escapeHtml(href({ age: x.age, etat: '' }))}">${x.todo ? 'Traiter' : 'Ouvrir'}<span class="visually-hidden"> ${escapeHtml(x.age)}</span></a>
    </li>`;
      })
      .join('')}</ul>
  </section>`
      : '';

  const chips = `<nav class="adm-chips" aria-label="Filtrer par état">${[['', 'Tous', scope.length], ...Object.entries(ETATS).map(([k, label]) => [k, label, count(scope, k)])]
    .filter(([k, , n]) => !k || n || k === etat)
    .map(([k, label, n]) => `<a class="adm-chip${k === etat ? ' is-active' : ''}" href="${escapeHtml(href({ etat: k }))}#liste"${k === etat ? ' aria-current="true"' : ''}>${label} <b>${n}</b></a>`)
    .join('')}</nav>`;
  const emptyText = etat || q ? 'Aucune famille dans ce filtre.' : "Aucun adhérent de la saison précédente à réinscrire : soit c'est la toute première saison du club, soit tout le monde est déjà à jour.";

  return `${adminHead('Réinscription')}
${adminShell({
  active: 'reinscription',
  badges,
  eyebrow: `Saison ${escapeHtml(saison)}`,
  title: 'Réinscription',
  subtitle: 'Adhérents de la saison précédente, pas encore rattachés à la saison en cours.',
  stats: [
    { value: all.length, label: 'anciens adhérents' },
    { value: count(all, 'reinscrits'), label: 'déjà réinscrits' },
    { value: pending.length, label: 'à finaliser' },
  ],
})}
<main id="adm-main" class="adm-wrap adm-main adm-pi">
  ${bulkOk ? flash('ok', bulkOk) : ''}
  ${bulkError ? flash('error', bulkError) : ''}
  ${picker}
  ${todoPanel}
  ${table}
  <section class="adm-pi-families" id="a-finaliser" aria-labelledby="a-finaliser-titre">
    <div class="adm-section-head"><h2 class="adm-h2" id="a-finaliser-titre">${icon('file')}Réinscriptions à finaliser <span class="adm-count">${scopePending.length}</span></h2></div>
    ${scopePending.length ? `<div class="adm-rows">${scopePending.map((r) => pendingRow(r, returnTo, ageCtx)).join('')}</div>` : '<p class="adm-help">Aucune : les réinscriptions complètes (dossier validé, photo et premier paiement) sont dans <a href="/admin/adherents" class="adm-link">Adhérents</a>.</p>'}
  </section>
  <section class="adm-pi-families" id="liste">
    <div class="adm-section-head adm-list-head">
      <h2 class="adm-h2">${icon('refresh')}À réinscrire (saison précédente) <span class="adm-count">${rows.length}</span></h2>
      <div class="adm-list-tools">${q ? `<span class="adm-tag is-neutral">Recherche : ${escapeHtml(q)}</span><a href="${escapeHtml(href({ q: '' }))}" class="adm-reset">Réinitialiser</a>` : ''}</div>
    </div>
    ${scope.length ? chips : ''}
    ${
      rows.length
        ? `<form method="POST" action="/admin/inscriptions" id="bulk-form" class="adm-surface adm-bulk">
    <input type="hidden" name="action" id="bulk-action" value="">
    <input type="hidden" name="redirectTo" value="${escapeHtml(returnTo)}">
    <div id="bulk-ids-container"></div>
    <label class="adm-bulk-all"><input type="checkbox" id="bulk-select-all">Tout sélectionner (hors déjà réinscrits)</label>
    <span id="bulk-count" class="adm-bulk-count">0 sélectionné(s)</span>
    <button type="button" class="adm-btn adm-btn-sm adm-btn-gold" data-bulk-action="bulk-reinscription" data-confirm="Envoyer aux profils sélectionnés leur lien personnel de réinscription prioritaire ?" disabled>${icon('send')}Envoyer le lien</button>
    <button type="button" class="adm-btn adm-btn-sm adm-btn-ghost" data-bulk-action="bulk-reinscription-rappel" data-confirm="Envoyer un rappel aux profils sélectionnés déjà contactés mais pas encore réinscrits ? (ignoré pour les profils jamais contactés)" disabled>${icon('refresh')}Envoyer un rappel</button>
  </form>
  <div class="adm-irows">${rows.map((r) => row(r, siteUrl, returnTo, ageCtx)).join('')}</div>`
        : `<div class="adm-surface adm-empty">${icon('refresh')}<p>${emptyText}</p></div>`
    }
  </section>
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
  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(admin.organizationId).all();
  const categoriesConfig = await getCategoriesConfig(env, admin.organizationId);
  const { saison, dateLimiteReinscription } = categoriesConfig;
  const ageCtx = await loadAgeContext(env, admin.organizationId, categoriesConfig);

  // Une fiche de la saison en cours partageant la même dedup_key qu'une fiche de la saison
  // précédente = cette famille s'est déjà réinscrite (voir _shared/inscriptions-db.js,
  // findCurrentSeasonSubmission — même logique, mais calculée ici une fois pour tout le monde
  // plutôt qu'en une requête par fiche : la table reste petite, un seul SELECT * suffit).
  const currentSeasonKeys = new Set(results.filter((r) => r.saison === saison).map((r) => r.dedup_key));
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim().slice(0, 100);
  const matchQ = (r) => !q || `${r.enfant_prenom} ${r.enfant_nom} ${r.parent_prenom} ${r.parent_nom} ${r.email}`.toLowerCase().includes(q.toLowerCase());
  const all = results
    .filter((r) => r.saison && r.saison !== saison)
    .map((r) => ({ ...r, dejaReinscrit: currentSeasonKeys.has(r.dedup_key) }))
    .filter(matchQ);
  const ageOf = (r) => ageGroup(r.naissance, ageCtx) || r.categorie || '—';
  const ageParam = /^[\w -]{1,40}$/.test(searchParams.get('age') || '') ? searchParams.get('age') : '';
  const etatParam = ['non-contactes', 'attente', 'expires', 'reinscrits'].includes(searchParams.get('etat')) ? searchParams.get('etat') : '';
  let rows = all.filter((r) => (!ageParam || ageOf(r) === ageParam) && (!etatParam || reinscState(r) === etatParam));

  rows.sort((a, b) => a.enfant_nom.localeCompare(b.enfant_nom, 'fr') || a.enfant_prenom.localeCompare(b.enfant_prenom, 'fr'));

  // Réinscriptions de la saison pas encore complètes (même recherche que la liste ci-dessous).
  const reinscrits = reinscriptionIds(results, saison);
  const pending = results.filter((r) => reinscrits.has(r.id) && !r.archived_at && !isInscriptionComplete(r) && matchQ(r));
  pending.sort((a, b) => a.enfant_nom.localeCompare(b.enfant_nom, 'fr') || a.enfant_prenom.localeCompare(b.enfant_prenom, 'fr'));

  const siteUrl = new URL(request.url).origin;
  const returnParams = new URLSearchParams(Object.entries({ q, age: ageParam, etat: etatParam }).filter(([, v]) => v));
  const returnTo = `/admin/reinscription${returnParams.toString() ? `?${returnParams}` : ''}`;

  const badges = await adminBadges(env, admin);
  return new Response(page({ all, rows, pending, saison, ageCtx, q, age: ageParam, etat: etatParam, bulkOk: searchParams.get('bulkOk'), bulkError: searchParams.get('bulkError'), siteUrl, returnTo, dateLimiteReinscription, badges }), {
    headers: { 'Content-Type': 'text/html;charset=UTF-8' },
  });
}

// Génère (si besoin) le lien de réinscription d'une seule fiche, sans envoyer d'e-mail — pour le cas
// où l'admin veut distribuer le lien à la main (SMS, message perso) plutôt que via l'e-mail
// automatique. returnTo (posté par linkBlock ci-dessus) ramène sur la recherche/page en cours ;
// jamais une redirection ouverte (allowlist identique à celle de bulk-reinscription dans
// functions/admin/inscriptions.js).
export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const form = await request.formData();
  const returnTo = /^\/admin\/reinscription(\?[^\s]*)?$/.test(form.get('returnTo') || '') ? form.get('returnTo') : '/admin/reinscription';

  if (form.get('action') === 'generate-link') {
    const id = Number(form.get('id'));
    if (id) {
      await ensureInscriptionsTable(env.DB);
      const existing = await env.DB.prepare('SELECT reinscription_token FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first();
      if (existing && !existing.reinscription_token) {
        await env.DB.prepare('UPDATE inscriptions SET reinscription_token = ? WHERE organization_id = ? AND id = ?').bind(crypto.randomUUID(), admin.organizationId, id).run();
        await extendReinscriptionLink(env.DB, admin.organizationId, id);
      }
    }
  }

  return new Response('', { status: 302, headers: { Location: returnTo } });
}
