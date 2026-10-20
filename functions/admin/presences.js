// Présences (2026-10-20) : séances du jour proposées d'après le planning, création d'une séance, liste des séances
// récentes. Lecture : inscriptions.read ; création : attendance.write. Un entraîneur ne voit que ses groupes.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr, can } from '../_shared/admin-auth.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { todaySuggestions, availableGroups, createSession, listSessions, todayParis, AttendanceError } from '../_shared/attendance.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const STATUS = { planned: ['À faire', 'is-wait'], done: ['Appel fait', 'is-yes'], cancelled: ['Annulée', 'is-no'] };
const dateLabel = (d) => formatDateFr(`${d} 12:00:00`, { weekday: 'long', day: 'numeric', month: 'long' }) || d;

async function render(env, admin, { message = '', error = '', status = 200 } = {}) {
  const scope = admin.groupScope;
  const [suggestions, groups, sessions] = await Promise.all([
    todaySuggestions(env.DB, admin.organizationId, scope),
    availableGroups(env.DB, admin.organizationId, scope),
    listSessions(env.DB, admin.organizationId, scope),
  ]);
  const write = can(admin, 'attendance.write');
  const today = todayParis().date;
  const suggestionHtml = suggestions.length
    ? `<ul class="adm-att-today" role="list">${suggestions
        .map(
          (s) => `<li><form method="POST"><input type="hidden" name="action" value="create"><input type="hidden" name="group" value="${escapeHtml(s.groupLabel)}"><input type="hidden" name="date" value="${s.date}"><input type="hidden" name="time" value="${escapeHtml(s.startTime)}">
        <button type="submit" class="adm-btn adm-btn-primary adm-btn-block" data-once>${icon('check')}Faire l’appel : ${escapeHtml(s.groupLabel)} · ${escapeHtml(s.startTime.replace(':', 'h'))}</button></form></li>`
        )
        .join('')}</ul>`
    : '<p class="adm-help">Aucune séance prévue aujourd’hui au planning (ou appel déjà commencé, voir la liste).</p>';
  const rows = sessions.length
    ? sessions
        .map((s) => {
          const [label, cls] = STATUS[s.status] || STATUS.planned;
          return `<li class="adm-att-row"><a href="/admin/presences/${s.id}">
          <strong>${escapeHtml(s.group_label)}</strong>
          <span>${escapeHtml(dateLabel(s.session_date))}${s.start_time ? ` · ${escapeHtml(s.start_time.replace(':', 'h'))}` : ''}${s.title ? ` · ${escapeHtml(s.title)}` : ''}</span>
          <span class="adm-att-meta"><span class="adm-tag ${cls}">${label}</span>${s.marked_count ? ` ${Number(s.present_count)} présent${Number(s.present_count) > 1 ? 's' : ''}` : ''}</span>
        </a></li>`;
        })
        .join('')
    : '<p class="adm-help">Aucune séance pour le moment.</p>';
  const body = `${adminHead('Présences')}
${adminShell({
  active: 'presences',
  badges: await adminBadges(env, admin),
  eyebrow: 'Espace admin',
  title: 'Présences',
  subtitle: admin.groupScope ? `Vos groupes : ${admin.groupScope.length ? admin.groupScope.join(', ') : 'aucun (demandez à un responsable de vous en attribuer)'}.` : 'Appel des présents à chaque séance.',
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('calendar')}Aujourd’hui</h2>
    ${message ? flash('ok', message) : ''}
    ${error ? flash('error', error) : ''}
    ${write ? suggestionHtml : '<p class="adm-help">Consultation seulement : votre rôle ne permet pas de faire l’appel.</p>'}
    ${
      write && groups.length
        ? `<details class="adm-fold" style="margin-top:12px;"><summary><span>Autre séance (match, stage, rattrapage)</span></summary>
      <form method="POST" class="adm-att-new">
        <input type="hidden" name="action" value="create">
        <div class="form-row">
          <div class="form-field"><label for="att-group">Groupe</label><select id="att-group" name="group" class="adm-select">${groups.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="att-date">Date</label><input type="date" id="att-date" name="date" value="${today}" required></div>
        </div>
        <div class="form-row">
          <div class="form-field"><label for="att-time">Heure</label><input type="time" id="att-time" name="time"></div>
          <div class="form-field"><label for="att-title">Intitulé (facultatif)</label><input type="text" id="att-title" name="title" maxlength="80" placeholder="Ex. : stage, match amical"></div>
        </div>
        <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary" data-once>${icon('plus')}Créer la séance</button></div>
      </form></details>`
        : ''
    }
  </section>
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('activity')}Séances</h2>
    <ul class="adm-att-list" role="list">${rows}</ul>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
  return html(body, status);
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  await ensureSchema(env.DB);
  return render(env, admin);
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  await ensureSchema(env.DB);
  const form = await request.formData();
  if (form.get('action') !== 'create') return render(env, admin, { error: 'Action inconnue.', status: 400 });
  try {
    const session = await createSession(env.DB, admin.organizationId, {
      groupLabel: String(form.get('group') || ''),
      date: String(form.get('date') || ''),
      startTime: String(form.get('time') || ''),
      title: String(form.get('title') || ''),
      userId: admin.userId,
      scope: admin.groupScope,
    });
    return new Response('', { status: 303, headers: { Location: `/admin/presences/${session.id}` } });
  } catch (error) {
    if (error instanceof AttendanceError) return render(env, admin, { error: error.message, status: error.status });
    throw error;
  }
}
