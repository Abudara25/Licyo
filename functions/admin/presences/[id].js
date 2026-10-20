// Appel d'une séance : liste des inscrits du groupe, un statut par enfant (présent, en retard, excusé, absent),
// enregistré d'un coup. Gros boutons pour le téléphone au bord du terrain.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr, can, avatar } from '../../_shared/admin-auth.js';
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { getSession, sessionRoster, saveMarks, setSessionStatus, MARK_STATUSES, AttendanceError } from '../../_shared/attendance.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const notFound = () => new Response('Séance introuvable.', { status: 404, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });

function page(admin, session, roster, { badges, message = '', error = '' }) {
  const write = can(admin, 'attendance.write');
  const present = roster.filter((r) => r.mark === 'present' || r.mark === 'late').length;
  const date = formatDateFr(`${session.session_date} 12:00:00`, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) || session.session_date;
  const rows = roster
    .map((r) => {
      const name = `${r.enfant_prenom} ${r.enfant_nom}`;
      const choices = Object.entries(MARK_STATUSES)
        .map(
          ([value, label]) =>
            `<label class="adm-att-choice is-${value}"><input type="radio" name="m_${r.id}" value="${value}"${r.mark === value ? ' checked' : ''}${write ? '' : ' disabled'}><span>${escapeHtml(label)}</span></label>`
        )
        .join('');
      return `<li class="adm-att-kid">
        <div class="adm-att-name">${avatar(r)}<strong>${escapeHtml(name)}</strong></div>
        <fieldset class="adm-att-choices"><legend class="visually-hidden">Présence de ${escapeHtml(name)}</legend>${choices}</fieldset>
      </li>`;
    })
    .join('');
  return `${adminHead('Appel')}
${adminShell({
  active: 'presences',
  badges,
  eyebrow: 'Présences',
  title: session.group_label,
  subtitle: `${date}${session.start_time ? ` · ${session.start_time.replace(':', 'h')}` : ''}${session.title ? ` · ${session.title}` : ''}`,
  back: { href: '/admin/presences', label: 'Séances' },
  stats: [{ value: present, label: 'Présents' }, { value: roster.length, label: 'Inscrits' }],
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    ${message ? flash('ok', message) : ''}
    ${error ? flash('error', error) : ''}
    ${session.status === 'cancelled' ? flash('error', 'Séance annulée.') : ''}
    ${
      roster.length
        ? `<form method="POST" class="adm-att-form">
      <input type="hidden" name="action" value="save">
      ${write ? '<div class="adm-att-quick"><button type="button" class="adm-btn adm-btn-sm adm-btn-ghost" data-all-present>Tous présents</button></div>' : ''}
      <ul class="adm-att-kids" role="list">${rows}</ul>
      ${write ? `<div class="adm-form-actions adm-att-save"><button type="submit" class="adm-btn adm-btn-primary adm-btn-block" data-once>${icon('check')}Enregistrer l’appel</button></div>` : ''}
    </form>`
        : '<p class="adm-help">Aucun inscrit actif dans ce groupe.</p>'
    }
  </section>
  ${
    write
      ? `<section class="adm-surface"><form method="POST" class="admin-confirm-form">
      <input type="hidden" name="action" value="${session.status === 'cancelled' ? 'reopen' : 'cancel'}">
      <button type="submit" class="adm-btn adm-btn-sm ${session.status === 'cancelled' ? 'adm-btn-ghost' : 'adm-btn-danger'}" data-confirm="${session.status === 'cancelled' ? 'Rétablir cette séance ?' : 'Annuler cette séance (météo, terrain indisponible) ? Elle ne comptera pas dans les présences.'}">${session.status === 'cancelled' ? 'Rétablir la séance' : 'Annuler la séance'}</button>
    </form></section>`
      : ''
  }
</main>
${adminScripts('admin-nav', 'admin-presences')}
</body></html>`;
}

async function load(request, env, params) {
  const admin = await isAuthed(request, env);
  if (!admin) return { response: html(loginPage(), request.method === 'GET' ? 200 : 401) };
  await ensureSchema(env.DB);
  const session = await getSession(env.DB, admin.organizationId, Number(params.id), admin.groupScope);
  if (!session) return { response: notFound() };
  return { admin, session };
}

export async function onRequestGet({ request, env, params }) {
  const { response, admin, session } = await load(request, env, params);
  if (response) return response;
  const url = new URL(request.url);
  return html(page(admin, session, await sessionRoster(env.DB, admin.organizationId, session), { badges: await adminBadges(env, admin), message: url.searchParams.has('ok') ? 'Appel enregistré.' : '' }));
}

export async function onRequestPost({ request, env, params }) {
  const { response, admin, session } = await load(request, env, params);
  if (response) return response;
  const form = await request.formData();
  const action = String(form.get('action') || '');
  try {
    if (action === 'save') {
      const marks = {};
      for (const [key, value] of form.entries()) if (key.startsWith('m_')) marks[key.slice(2)] = String(value);
      await saveMarks(env.DB, admin.organizationId, session, marks, { userId: admin.userId });
      return new Response('', { status: 303, headers: { Location: `/admin/presences/${session.id}?ok=1` } });
    }
    if (action === 'cancel' || action === 'reopen') {
      await setSessionStatus(env.DB, admin.organizationId, session, action === 'cancel' ? 'cancelled' : 'planned');
      return new Response('', { status: 303, headers: { Location: `/admin/presences/${session.id}` } });
    }
  } catch (error) {
    if (error instanceof AttendanceError) {
      return html(page(admin, session, await sessionRoster(env.DB, admin.organizationId, session), { badges: await adminBadges(env, admin), error: error.message }), error.status);
    }
    throw error;
  }
  return notFound();
}
