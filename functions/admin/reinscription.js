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
import { ageGroup, ensureInscriptionsTable, isInscriptionComplete, familyHasActionPending, reinscriptionIds } from '../_shared/inscriptions-db.js';
import { photoTag, isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, avatar, flash, formatBirth, dossierTag, statusTag, PHOTO_TAG, PAIEMENT_TAG, ageAndCategory } from '../_shared/admin-auth.js';
import { getCategoriesConfig } from '../_shared/settings-kv.js';
import { extendReinscriptionLink, isReinscriptionLinkValid } from '../_shared/family-links.js';
import { loadAgeContext } from '../_shared/preinscriptions.js';

function statusTags(row) {
  // Un retardataire archivé (voir "Fin de saison" dans /admin/categories) reste actionnable ici même
  // après archivage — ce badge le signale, plutôt que de le faire disparaître silencieusement.
  const tags = row.archived_at ? ['<span class="adm-tag is-neutral">Archivé</span>'] : [];
  if (row.dejaReinscrit) tags.push(`<span class="adm-tag is-yes">${icon('check')}Réinscrit</span>`);
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

function row(r, siteUrl, returnTo, ageCtx) {
  const name = `${escapeHtml(r.enfant_prenom)} ${escapeHtml(r.enfant_nom)}`;
  return `<article class="adm-surface adm-row">
    <label class="insc-select-wrap"><input type="checkbox" class="insc-select" data-id="${r.id}" aria-label="Sélectionner ${name}" ${r.dejaReinscrit ? 'disabled' : ''}></label>
    ${avatar(r, 'sm')}
    <div class="adm-row-main">
      <strong>${name}</strong>
      <span class="adm-row-sub">${ageAndCategory(ageGroup(r.naissance, ageCtx), r.categorie)} · né(e) le ${formatBirth(r.naissance)} · saison ${escapeHtml(r.saison)}</span>
      <span class="adm-row-sub">${escapeHtml(r.parent_prenom)} ${escapeHtml(r.parent_nom)} · <a class="adm-link" href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>${r.telephone ? ` · ${escapeHtml(r.telephone)}` : ''}</span>
      ${linkBlock(r, siteUrl, returnTo)}
    </div>
    <div class="adm-row-side">
      ${statusTags(r)}
      <a href="/admin/inscriptions/${r.id}" class="adm-btn adm-btn-sm adm-btn-ghost">Voir la fiche</a>
    </div>
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

function page({ rows, pending, saison, ageCtx, q, bulkOk, bulkError, total, siteUrl, returnTo, dateLimiteReinscription, badges }) {
  const reinscritCount = rows.filter((r) => r.dejaReinscrit).length;
  const contacteCount = rows.filter((r) => !r.dejaReinscrit && r.reinscription_token).length;
  const nonContacteCount = rows.filter((r) => !r.dejaReinscrit && !r.reinscription_token).length;
  const emptyText = q
    ? 'Aucun adhérent de la saison précédente ne correspond à cette recherche.'
    : total === 0
      ? "Aucun adhérent de la saison précédente à réinscrire — soit c'est la toute première saison du club, soit tout le monde est déjà à jour."
      : 'Tous les adhérents correspondant à cette recherche sont déjà réinscrits.';

  return `${adminHead('Réinscription')}
${adminShell({
  active: 'reinscription',
  eyebrow: `Saison ${escapeHtml(saison)}`,
  title: 'Réinscription',
  subtitle: 'Adhérents de la saison précédente, pas encore rattachés à la saison en cours.',
  stats: [
    { value: total, label: 'à réinscrire' },
    { value: reinscritCount, label: 'déjà réinscrits' },
    { value: contacteCount, label: 'contactés, en attente' },
    { value: nonContacteCount, label: 'pas encore contactés' },
    { value: pending.length, label: 'à finaliser' },
  ],
})}
<main id="adm-main" class="adm-wrap adm-main">
  ${bulkOk ? flash('ok', bulkOk) : ''}
  ${bulkError ? flash('error', bulkError) : ''}
  <section class="adm-surface" id="a-finaliser" aria-labelledby="a-finaliser-titre">
    <h2 class="adm-h2" id="a-finaliser-titre">${icon('file')}Réinscriptions à finaliser <span class="adm-count">${pending.length}</span></h2>
    <p class="adm-help">Familles réinscrites pour la saison ${escapeHtml(saison)} dont le dossier n'est pas encore complet. Une fois complètes (dossier validé, paiement et photo), elles passent dans <a href="/admin/adherents" class="adm-link">Adhérents</a>.</p>
  </section>
  ${pending.length ? `<div class="adm-rows">${pending.map((r) => pendingRow(r, returnTo, ageCtx)).join('')}</div>` : ''}
  <div class="adm-section-head">
    <h2 class="adm-h2">${icon('refresh')}À réinscrire (saison précédente)</h2>
  </div>
  <section class="adm-surface adm-toolbar" aria-label="Recherche">
    <p class="adm-help">Contrairement à la liste générale des <a href="/admin/inscriptions">Inscriptions</a>, cette page ne montre que les familles concernées par la réinscription (saison en cours : « ${escapeHtml(saison)} ») — pas de risque de contacter quelqu'un déjà inscrit cette saison.</p>
    <p class="adm-help">${
      dateLimiteReinscription
        ? `Date limite de réinscription prioritaire : <strong>${escapeHtml(dateLimiteReinscription.split('-').reverse().join('/'))}</strong> (<a href="/admin/categories">modifier</a>). « Envoyer un rappel » relance les familles déjà contactées qui n'ont pas encore validé, autant de fois que nécessaire avant cette date.`
        : 'Aucune date limite réglée — <a href="/admin/categories">en définir une</a> permet d\'informer les familles et de savoir quand rouvrir au public.'
    }</p>
    <div class="adm-toolbar-row">
      <form method="GET" class="adm-search" role="search">
        ${icon('search')}
        <label for="reinsc-q" class="visually-hidden">Rechercher</label>
        <input type="search" id="reinsc-q" name="q" value="${escapeHtml(q)}" placeholder="Nom, prénom ou e-mail…">
        <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Chercher</button>
      </form>
      ${q ? '<a href="/admin/reinscription" class="adm-reset">Réinitialiser</a>' : ''}
    </div>
  </section>

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
  <div class="adm-rows">${rows.map((r) => row(r, siteUrl, returnTo, ageCtx)).join('')}</div>`
      : `<div class="adm-surface adm-empty">${icon('refresh')}<p>${emptyText}</p></div>`
  }
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
  let rows = results
    .filter((r) => r.saison && r.saison !== saison)
    .map((r) => ({ ...r, dejaReinscrit: currentSeasonKeys.has(r.dedup_key) }));

  const total = rows.length;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => `${r.enfant_prenom} ${r.enfant_nom} ${r.parent_prenom} ${r.parent_nom} ${r.email}`.toLowerCase().includes(needle));
  }

  rows.sort((a, b) => a.enfant_nom.localeCompare(b.enfant_nom, 'fr') || a.enfant_prenom.localeCompare(b.enfant_prenom, 'fr'));

  // Réinscriptions de la saison pas encore complètes (même recherche que la liste ci-dessous).
  const reinscrits = reinscriptionIds(results, saison);
  let pending = results.filter((r) => reinscrits.has(r.id) && !r.archived_at && !isInscriptionComplete(r));
  if (q) {
    const needle = q.toLowerCase();
    pending = pending.filter((r) => `${r.enfant_prenom} ${r.enfant_nom} ${r.parent_prenom} ${r.parent_nom} ${r.email}`.toLowerCase().includes(needle));
  }
  pending.sort((a, b) => a.enfant_nom.localeCompare(b.enfant_nom, 'fr') || a.enfant_prenom.localeCompare(b.enfant_prenom, 'fr'));

  const siteUrl = new URL(request.url).origin;
  const returnTo = `/admin/reinscription${q ? `?q=${encodeURIComponent(q)}` : ''}`;

  const badges = await adminBadges(env, admin);
  return new Response(page({ rows, pending, saison, ageCtx, q, bulkOk: searchParams.get('bulkOk'), bulkError: searchParams.get('bulkError'), total, siteUrl, returnTo, dateLimiteReinscription, badges }), {
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
