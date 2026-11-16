// Suivi de l'activité : journal des e-mails envoyés par le site (relances, suivis, alertes club…, voir
// _shared/email-log.js) et événements enregistrés par functions/api/track-event.js (clic téléphone,
// soumission du formulaire de contact) — même garde d'authentification que le reste de /admin.
// Tout est filtré par l'organisation de la session : ni lecture, ni compteur, ni route d'une autre organisation (R0a).
// L'ancienne table globale `events` n'est jamais lue (voir _shared/site-events.js).
import { ensureSiteEventsTable, SITE_EVENT_TYPES } from '../_shared/site-events.js';
import { ensureEmailLogTable, EMAIL_KINDS, EMAIL_ORIGINS } from '../_shared/email-log.js';
import { ensureInscriptionsTable } from '../_shared/inscriptions-db.js';
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, formatDateFr } from '../_shared/admin-auth.js';

const eventLabel = (event) => (Object.hasOwn(SITE_EVENT_TYPES, event) ? SITE_EVENT_TYPES[event].label : event);
const eventIcon = (event) => (Object.hasOwn(SITE_EVENT_TYPES, event) ? SITE_EVENT_TYPES[event].icon : 'activity');
const when = (datetime) => formatDateFr(datetime, { dateStyle: 'short', timeStyle: 'short' }) || '—';
const MAIL_LIMIT = 200;

// Filtres du journal (GET) : type d'e-mail, échecs seulement, fiche d'inscription.
function readFilters(url) {
  const type = url.searchParams.get('type') || '';
  const inscription = Number.parseInt(url.searchParams.get('inscription') || '', 10);
  return {
    type: Object.hasOwn(EMAIL_KINDS, type) ? type : '',
    echecs: url.searchParams.get('statut') === 'echec',
    inscription: Number.isInteger(inscription) && inscription > 0 ? inscription : null,
  };
}

async function loadMails(db, organizationId, filters) {
  const where = ['l.organization_id = ?'];
  const params = [organizationId];
  if (filters.type) {
    where.push('l.kind = ?');
    params.push(filters.type);
  }
  if (filters.echecs) where.push('l.ok = 0');
  if (filters.inscription) {
    where.push('l.inscription_id = ?');
    params.push(filters.inscription);
  }
  const { results } = await db
    .prepare(
      `SELECT l.*, i.enfant_prenom, i.enfant_nom FROM email_log l LEFT JOIN inscriptions i ON i.organization_id = l.organization_id AND i.id = l.inscription_id
       WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ${MAIL_LIMIT}`
    )
    .bind(...params)
    .all();
  return results;
}

function mailKpis(stats) {
  const tile = (label, iconName, value, sub) => `<div class="adm-surface adm-kpi">
      <span class="adm-kpi-label">${icon(iconName)}${label}</span>
      <span class="adm-kpi-value">${value}</span>
      <span class="adm-kpi-sub">${sub}</span>
    </div>`;
  return `<div class="adm-kpis adm-kpis-auto">
    ${tile('E-mails envoyés (7 jours)', 'send', stats.semaine || 0, `Dernier : ${when(stats.dernier)}`)}
    ${tile('Relances (30 jours)', 'refresh', stats.relances || 0, `Dernière : ${when(stats.derniere_relance)}`)}
    ${tile(
      'Récapitulatif du lundi',
      'calendar',
      stats.derniere_recap ? formatDateFr(stats.derniere_recap, { day: '2-digit', month: '2-digit' }) : '—',
      stats.derniere_recap ? `Dernier envoi au club, à ${formatDateFr(stats.derniere_recap, { timeStyle: 'short' })}` : 'Jamais envoyé'
    )}
    ${tile('Échecs (30 jours)', 'alert', stats.echecs || 0, stats.echecs ? '<a href="?statut=echec#emails">Voir les échecs</a>' : 'Aucun échec')}
  </div>`;
}

function mailRow(m) {
  const enfant = [m.enfant_prenom, m.enfant_nom].filter(Boolean).join(' ');
  const fiche = m.inscription_id
    ? `<a href="/admin/inscriptions/${m.inscription_id}">${escapeHtml(enfant || `Fiche n° ${m.inscription_id}`)}</a>
       · <a href="?inscription=${m.inscription_id}#emails">tous ses e-mails</a>`
    : '';
  const status = m.ok
    ? `<span class="adm-tag is-yes">${icon('check')}Envoyé</span>`
    : `<span class="adm-tag is-no" title="${escapeHtml(m.error || '')}">Échec${m.status ? ` (${escapeHtml(String(m.status))})` : ''}</span>`;
  return `<li class="adm-mail">
      <div class="adm-mail-top">
        <strong class="adm-mail-kind">${escapeHtml(EMAIL_KINDS[m.kind] || m.kind)}</strong>
        <time class="adm-mail-date">${when(m.created_at)}</time>
      </div>
      <div class="adm-mail-tags">${status}${m.origin ? `<span class="adm-tag is-neutral">${escapeHtml(EMAIL_ORIGINS[m.origin] || m.origin)}</span>` : ''}</div>
      <p class="adm-mail-meta">À : ${escapeHtml(m.recipients || '—')}</p>
      ${m.subject ? `<p class="adm-mail-meta">Objet : ${escapeHtml(m.subject)}</p>` : ''}
      ${!m.ok && m.error ? `<p class="adm-mail-meta adm-mail-error">${escapeHtml(m.error)}</p>` : ''}
      ${fiche ? `<p class="adm-mail-meta">${icon('user')}${fiche}</p>` : ''}
    </li>`;
}

function mailFilters(filters) {
  const option = (value, label, selected) => `<option value="${value}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const active = filters.type || filters.echecs || filters.inscription;
  return `<form method="GET" action="/admin/events#emails" class="adm-mail-filters">
      ${filters.inscription ? `<input type="hidden" name="inscription" value="${filters.inscription}">` : ''}
      <label class="adm-field">Type d'e-mail
        <select name="type" class="adm-select">${option('', 'Tous', !filters.type)}${Object.entries(EMAIL_KINDS)
          .map(([key, label]) => option(key, label, filters.type === key))
          .join('')}</select>
      </label>
      <label class="adm-field">Résultat
        <select name="statut" class="adm-select">${option('', 'Tous', !filters.echecs)}${option('echec', 'Échecs seulement', filters.echecs)}</select>
      </label>
      <div class="adm-mail-filters-actions">
        <button type="submit" class="adm-btn adm-btn-sm">${icon('filter')}Filtrer</button>
        ${active ? '<a href="/admin/events#emails" class="adm-reset">Réinitialiser</a>' : ''}
      </div>
    </form>`;
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  const filters = readFilters(new URL(request.url));
  await Promise.all([ensureSiteEventsTable(env.DB), ensureEmailLogTable(env.DB), ensureInscriptionsTable(env.DB)]);

  const [mails, stats, { results: totals }, { results: recent }] = await Promise.all([
    loadMails(env.DB, admin.organizationId, filters),
    env.DB.prepare(
      `SELECT
        SUM(ok = 1 AND created_at >= datetime('now', '-7 days')) AS semaine,
        MAX(CASE WHEN ok = 1 THEN created_at END) AS dernier,
        SUM(ok = 1 AND kind = 'relance' AND created_at >= datetime('now', '-30 days')) AS relances,
        MAX(CASE WHEN ok = 1 AND kind = 'relance' THEN created_at END) AS derniere_relance,
        MAX(CASE WHEN ok = 1 AND kind = 'recap' THEN created_at END) AS derniere_recap,
        SUM(ok = 0 AND created_at >= datetime('now', '-30 days')) AS echecs
      FROM email_log WHERE organization_id = ?`
    )
      .bind(admin.organizationId)
      .first(),
    env.DB.prepare(
      'SELECT event, COUNT(*) AS total, MAX(created_at) AS derniere FROM site_events WHERE organization_id = ? GROUP BY event ORDER BY total DESC, event'
    )
      .bind(admin.organizationId)
      .all(),
    env.DB.prepare('SELECT event, page, created_at FROM site_events WHERE organization_id = ? ORDER BY id DESC LIMIT 50').bind(admin.organizationId).all(),
  ]);

  const ficheName = filters.inscription && mails[0] ? [mails[0].enfant_prenom, mails[0].enfant_nom].filter(Boolean).join(' ') : '';
  const mailTitle = filters.inscription ? `E-mails de ${escapeHtml(ficheName || `la fiche n° ${filters.inscription}`)}` : 'E-mails envoyés';
  const mailList = mails.length
    ? `<ul class="adm-mail-list">${mails.map(mailRow).join('')}</ul>
       ${mails.length === MAIL_LIMIT ? `<p class="adm-mail-note">Seuls les ${MAIL_LIMIT} plus récents sont affichés : filtrez pour remonter plus loin.</p>` : ''}`
    : `<p class="adm-mail-note">Aucun e-mail ${filters.type || filters.echecs || filters.inscription ? 'pour ces filtres' : 'enregistré pour le moment'}.</p>`;

  const totalsHtml = totals.length
    ? `<div class="adm-kpis adm-kpis-auto">${totals
        .map(
          (t) => `<div class="adm-surface adm-kpi">
      <span class="adm-kpi-label">${icon(eventIcon(t.event))}${escapeHtml(eventLabel(t.event))}</span>
      <span class="adm-kpi-value">${t.total}</span>
      <span class="adm-kpi-sub">Dernier : ${when(t.derniere)}</span>
    </div>`
        )
        .join('')}</div>`
    : '';

  const recentHtml = recent
    .map((r) => `<tr><td>${when(r.created_at)}</td><td>${escapeHtml(eventLabel(r.event))}</td><td>${escapeHtml(r.page || '—')}</td></tr>`)
    .join('');

  return new Response(
    `${adminHead('Événements')}
${adminShell({
  active: 'events',
  badges: await adminBadges(env, admin),
  eyebrow: 'Suivi du site',
  title: 'Événements',
  subtitle: 'E-mails envoyés (relances, suivis, alertes), clics sur le téléphone et formulaire de contact.',
})}
<main id="adm-main" class="adm-wrap adm-main">
  ${mailKpis(stats || {})}
  <section class="adm-surface" id="emails">
    <div class="adm-surface-head">
      <h2 class="adm-h2">${icon('mail')}${mailTitle}</h2>
      ${filters.inscription ? `<a href="/admin/inscriptions/${filters.inscription}" class="adm-btn adm-btn-sm">${icon('user')}Voir la fiche</a>` : ''}
    </div>
    ${mailFilters(filters)}
    ${mailList}
    <p class="adm-mail-note">« Envoyé » : e-mail accepté par Brevo. La remise dans la boîte de réception (ou un rejet) se vérifie dans les journaux Brevo.</p>
  </section>
  ${totalsHtml}
  <section class="adm-surface">
    <div class="adm-surface-head"><h2 class="adm-h2">${icon('activity')}50 derniers événements du site</h2></div>
    <div class="adm-table-wrap">
      <table class="adm-table">
        <thead><tr><th>Date</th><th>Événement</th><th>Page</th></tr></thead>
        <tbody>${recentHtml || '<tr><td colspan="3">Aucun événement.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="adm-mail-note">Clics enregistrés pour votre site uniquement. Les clics antérieurs à la séparation des mesures par site ne sont pas repris.</p>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`,
    { headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );
}
