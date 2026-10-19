// Tableau de bord admin — première page de la navigation (voir _shared/admin-auth.js). Vue
// synthétique (effectifs par catégorie, part des documents et paiements validés, fiches à compléter)
// plutôt que d'obliger à parcourir /admin/inscriptions carte par carte. Lecture seule, aucune action.
import { ensureInscriptionsTable, isInscriptionComplete, dossierStatus, isTransferredToPreinscription, ageGroup, sortAgeGroups } from '../_shared/inscriptions-db.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon } from '../_shared/admin-auth.js';
import { getCategoriesConfig, getCronState } from '../_shared/settings-kv.js';
import { loadAgeContext } from '../_shared/preinscriptions.js';

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);

// Panne silencieuse de l'automatisation quotidienne (2026-10-09) : si le Worker programmé ne s'exécute plus du tout,
// /api/cron n'est jamais appelé et aucun échec n'est noté (ni e-mail). Le tableau de bord le signale quand le dernier
// passage réussi date de plus de 36 h (un passage par jour à 7 h UTC, plus une marge). Sans aucun passage connu
// (organisation sans automatisation), rien n'est affiché.
export const CRON_STALE_HOURS = 36;
export function cronStaleSince(state, now = new Date()) {
  const last = Date.parse(state?.lastRun || '');
  if (!Number.isFinite(last)) return null;
  return now.getTime() - last > CRON_STALE_HOURS * 3600 * 1000 ? new Date(last) : null;
}

function cronBanner(since) {
  if (!since) return '';
  const when = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(since);
  return `<p class="adm-flash adm-flash-error" role="alert">${icon('alert')}<span><strong>Automatisations à l'arrêt.</strong> Dernier passage réussi le ${escapeHtml(when)}&nbsp;: relances automatiques et récapitulatif du lundi ne partent plus.<a class="adm-btn adm-btn-sm adm-btn-ghost adm-flash-action" href="/admin/parametres">${icon('settings')}Voir les paramètres</a></span></p>`;
}

function kpi({ iconName, label, value, of, link }) {
  return `<div class="adm-surface adm-kpi">
    <span class="adm-kpi-label">${icon(iconName)}${label}</span>
    <span class="adm-kpi-value">${value}${of != null ? ` <small>/ ${of}</small>` : ''}</span>
    ${of != null ? `<span class="adm-bar" role="img" aria-label="${pct(value, of)} %"><span style="width:${pct(value, of)}%"></span></span>` : ''}
    ${link ? `<a href="${link.href}" class="adm-kpi-link">${link.label} →</a>` : ''}
  </div>`;
}

const shortcut = (href, iconName, title, description) =>
  `<a href="${href}" class="adm-shortcut">${icon(iconName)}<span><strong>${title}</strong><small>${description}</small></span></a>`;

function page({ total, archivedCount, payeCount, dossierCount, dossierAVerifier, firstToVerify, completCount, categorieCounts, saison, badges, cronStale }) {
  const categories = sortAgeGroups(Object.keys(categorieCounts));

  return `${adminHead('Tableau de bord')}
${adminShell({
  active: 'dashboard',
  badges,
  eyebrow: `Saison ${escapeHtml(saison)}`,
  title: 'Tableau de bord',
  subtitle: "Vue d'ensemble des inscriptions du club.",
  actions: `<a href="/admin/inscriptions" class="adm-btn adm-btn-white">${icon('users')}Voir les inscriptions</a>`,
})}
<main id="adm-main" class="adm-wrap adm-main">
  ${cronBanner(cronStale)}
  <div class="adm-kpis">
    ${kpi({ iconName: 'users', label: 'Inscriptions actives', value: total, link: { href: '/admin/inscriptions', label: 'Voir la liste' } })}
    ${kpi({
      iconName: 'file',
      label: 'Documents validés',
      value: dossierCount,
      of: total,
      // Droit sur le plus ancien dossier à vérifier : on valide ou refuse sur le document, puis le suivant s'ouvre.
      link: dossierAVerifier ? { href: `/admin/inscriptions/${firstToVerify}/apercu`, label: `Vérifier ${dossierAVerifier > 1 ? `les ${dossierAVerifier} dossiers` : 'le dossier'}` } : null,
    })}
    ${kpi({ iconName: 'card', label: 'Payés', value: payeCount, of: total })}
    ${kpi({ iconName: 'send', label: 'À compléter', value: total - completCount, link: { href: '/admin/inscriptions?etat=incomplet', label: 'Voir et relancer' } })}
  </div>
  <div class="adm-dash-grid">
    <section class="adm-surface">
      <div class="adm-surface-head">
        <h2 class="adm-h2">${icon('tag')}Répartition par catégorie</h2>
        <a href="/admin/categories" class="adm-btn adm-btn-sm adm-btn-ghost">Gérer</a>
      </div>
      ${
        categories.length
          ? `<ul class="adm-bars">${categories
              .map(
                (c) =>
                  `<li><span>${escapeHtml(c)}</span><span class="adm-bar" role="img" aria-label="${pct(categorieCounts[c], total)} %"><span style="width:${pct(categorieCounts[c], total)}%"></span></span><span class="adm-bars-value">${categorieCounts[c]}</span></li>`
              )
              .join('')}</ul>`
          : '<p class="adm-help">Aucune inscription active pour le moment.</p>'
      }
    </section>
    <section class="adm-surface">
      <div class="adm-surface-head"><h2 class="adm-h2">${icon('dashboard')}Raccourcis</h2></div>
      <div class="adm-shortcuts">
        ${shortcut('/admin/adherents', 'users', 'Adhérents', `${completCount} dossier${completCount > 1 ? 's' : ''} complet${completCount > 1 ? 's' : ''}`)}
        ${shortcut('/admin/reinscription', 'refresh', 'Réinscription', 'Campagne de réinscription prioritaire')}
        ${shortcut('/admin/inscriptions?view=archive', 'trash', 'Corbeille', `${archivedCount} profil${archivedCount > 1 ? 's' : ''} archivé${archivedCount > 1 ? 's' : ''}`)}
        ${shortcut('/admin/email', 'send', 'Écrire un e-mail', 'Aux familles, depuis contact@')}
        ${shortcut('/admin/events', 'activity', 'Événements', 'Clics téléphone et formulaire de contact')}
        ${shortcut('/admin/parametres', 'settings', 'Paramètres', 'Notifications et mot de passe')}
      </div>
    </section>
  </div>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  await ensureInscriptionsTable(env.DB);
  const { results } = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ?').bind(admin.organizationId).all();
  const active = results.filter((r) => !r.archived_at);
  const categoriesConfig = await getCategoriesConfig(env, admin.organizationId);
  const { saison } = categoriesConfig;
  const ageCtx = await loadAgeContext(env, admin.organizationId, categoriesConfig);
  // Répartition par catégorie (U6 - U7, U8 - U9…, d'après l'année de naissance) ; à défaut de date, la catégorie saisie.
  const categorieCounts = {};
  for (const r of active) {
    const key = ageGroup(r.naissance, ageCtx) || r.categorie;
    categorieCounts[key] = (categorieCounts[key] || 0) + 1;
  }
  const toVerify = active
    .filter((r) => dossierStatus(r) === 'a_verifier')
    .sort((a, b) => String(a.dossier_uploaded_at).localeCompare(String(b.dossier_uploaded_at)) || a.id - b.id);

  return new Response(
    page({
      total: active.length,
      archivedCount: results.filter((r) => r.archived_at && !isTransferredToPreinscription(r)).length,
      payeCount: active.filter((r) => r.paye).length,
      dossierCount: active.filter((r) => dossierStatus(r) === 'valide').length,
      dossierAVerifier: toVerify.length,
      firstToVerify: toVerify[0]?.id,
      completCount: active.filter(isInscriptionComplete).length,
      categorieCounts,
      saison,
      badges: await adminBadges(env, admin),
      cronStale: await getCronState(env, admin.organizationId).then((state) => cronStaleSince(state), () => null),
    }),
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}
