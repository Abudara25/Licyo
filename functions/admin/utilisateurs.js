// Utilisateurs du club (permission users.manage) : liste des comptes qui ont accès à l'espace admin, invitation par
// e-mail avec un rôle, changement de rôle, retrait d'accès, renvoi d'une invitation. Seul un « Responsable du club »
// peut nommer, modifier ou retirer un responsable ; le club garde toujours au moins un responsable (accounts.js).
import {
  isAuthed,
  loginPage,
  escapeHtml,
  adminHead,
  adminShell,
  adminScripts,
  adminBadges,
  icon,
  flash,
  formatDateFr,
} from '../_shared/admin-auth.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { listMembers, inviteMember, changeRole, revokeMember, AccountError, ROLES, ROLE_KEYS, PERMISSIONS, roleLabel, logAudit } from '../_shared/accounts.js';
import { sendAdminInvitation, mailConfigured } from '../_shared/confirmation-email.js';
import { loadOrganization } from '../_shared/organization.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
const assignable = (actorRole) => ROLE_KEYS.filter((r) => r !== 'owner' || actorRole === 'owner');

function roleOptions(actorRole, selected) {
  return assignable(actorRole)
    .map((r) => `<option value="${r}"${r === selected ? ' selected' : ''}>${escapeHtml(ROLES[r].label)}</option>`)
    .join('');
}

function memberRow(m, admin) {
  const self = m.id === admin.userId;
  const canTouch = !self && (m.role !== 'owner' || admin.role === 'owner');
  const status = m.status === 'invited' ? '<span class="adm-tag is-no">Invitation envoyée</span>' : '';
  const last = m.last_login_at ? `Dernière connexion : ${escapeHtml(formatDateFr(m.last_login_at, { dateStyle: 'short', timeStyle: 'short' }))}` : 'Jamais connecté(e)';
  const actions = canTouch
    ? `<form method="POST">
         <input type="hidden" name="action" value="role"><input type="hidden" name="userId" value="${escapeHtml(m.id)}">
         <label class="visually-hidden" for="role-${escapeHtml(m.id)}">Rôle de ${escapeHtml(m.name || m.email)}</label>
         <select id="role-${escapeHtml(m.id)}" name="role">${roleOptions(admin.role, m.role)}</select>
         <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Changer</button>
       </form>
       ${m.status === 'invited' ? `<form method="POST"><input type="hidden" name="action" value="resend"><input type="hidden" name="userId" value="${escapeHtml(m.id)}"><button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">${icon('send')}Renvoyer</button></form>` : ''}
       <form method="POST" class="admin-confirm-form">
         <input type="hidden" name="action" value="revoke"><input type="hidden" name="userId" value="${escapeHtml(m.id)}">
         <button type="submit" class="adm-btn adm-btn-sm adm-btn-danger" data-confirm="Retirer l’accès de ${escapeHtml(m.name || m.email)} à l’espace admin ?">${icon('trash')}Retirer</button>
       </form>`
    : self
      ? '<span class="adm-help">C’est vous</span>'
      : '';
  return `<li class="adm-user-row">
    <div>
      <h3>${escapeHtml(m.name || m.email)} ${status}</h3>
      <p>${escapeHtml(m.email)} · <strong>${escapeHtml(roleLabel(m.role))}</strong></p>
      <p>${last}</p>
    </div>
    <div class="adm-user-actions">${actions}</div>
  </li>`;
}

async function render(env, admin, { message = '', error = '', email = '', role = 'secretary', status = 200 } = {}) {
  const members = await listMembers(env.DB, admin.organizationId);
  const badges = await adminBadges(env, admin);
  const roles = ROLE_KEYS.map(
    (r) => `<li><strong>${escapeHtml(ROLES[r].label)}</strong> : ${escapeHtml(ROLES[r].description)}${ROLES[r].permissions.length ? ` <span class="adm-help">(${ROLES[r].permissions.map((p) => escapeHtml(PERMISSIONS[p])).join(' ; ')})</span>` : ''}</li>`
  ).join('');
  const body = `${adminHead('Utilisateurs')}
${adminShell({
  active: 'utilisateurs',
  badges,
  eyebrow: 'Espace admin',
  title: 'Utilisateurs',
  subtitle: 'Chaque responsable a son propre compte et un rôle. Personne ne partage de mot de passe.',
  stats: [{ value: members.filter((m) => m.status === 'active').length, label: 'Accès actifs' }, { value: members.filter((m) => m.status === 'invited').length, label: 'Invitations en attente' }],
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('send')}Inviter une personne</h2>
    ${message ? flash('ok', message) : ''}
    ${error ? flash('error', error) : ''}
    ${mailConfigured(env) ? '' : flash('error', 'Aucun service d’envoi n’est configuré : l’invitation ne pourra pas partir par e-mail.')}
    <form method="POST">
      <input type="hidden" name="action" value="invite">
      <div class="form-row">
        <div class="form-field">
          <label for="invite-email">Adresse e-mail</label>
          <input type="email" id="invite-email" name="email" value="${escapeHtml(email)}" required maxlength="200" autocomplete="off">
        </div>
        <div class="form-field">
          <label for="invite-role">Rôle</label>
          <select id="invite-role" name="role">${roleOptions(admin.role, role)}</select>
        </div>
      </div>
      <p class="adm-help">La personne reçoit un lien personnel, valable 7 jours, pour choisir son mot de passe.</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('send')}Envoyer l’invitation</button></div>
    </form>
  </section>

  <section class="adm-surface">
    <h2 class="adm-h2">${icon('users')}Accès au club</h2>
    <ul class="adm-users" role="list">${members.map((m) => memberRow(m, admin)).join('')}</ul>
    <p class="adm-help" style="margin-top:14px;"><a class="adm-link" href="/admin/journal">Journal des actions</a></p>
  </section>

  <section class="adm-surface">
    <h2 class="adm-h2">${icon('lock')}Les rôles</h2>
    <ul class="adm-roles">${roles}</ul>
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
  const action = String(form.get('action') || '');
  const userId = String(form.get('userId') || '');
  const siteUrl = new URL(request.url).origin;
  const actor = { userId: admin.userId, role: admin.role };

  try {
    if (action === 'invite' || action === 'resend') {
      let email = String(form.get('email') || '');
      let role = String(form.get('role') || '');
      if (action === 'resend') {
        const target = (await listMembers(env.DB, admin.organizationId)).find((m) => m.id === userId && m.status === 'invited');
        if (!target) return render(env, admin, { error: 'Invitation introuvable.', status: 404 });
        email = target.email;
        role = target.role;
      }
      const invited = await inviteMember(env.DB, admin.organizationId, { email, role, actor });
      const organization = await loadOrganization(env, admin.organizationId).catch(() => null);
      const sent = await sendAdminInvitation(env, {
        to: invited.user.email,
        roleLabel: roleLabel(role),
        inviterName: admin.user?.name || '',
        clubName: organization?.name || 'Club',
        link: `${siteUrl}/admin/invitation/${invited.token}`,
        existing: invited.existing,
        siteUrl,
        organizationId: admin.organizationId,
      });
      await logAudit(env.DB, admin.organizationId, { userId: admin.userId, action: `utilisateur.${action === 'resend' ? 'invitation-renvoyee' : 'invitation'}`, target: invited.user.id });
      return render(env, admin, sent
        ? { message: `Invitation envoyée à ${invited.user.email}.` }
        : { error: `L’invitation est enregistrée mais l’e-mail n’a pas pu partir (service d’envoi). Réessayez avec « Renvoyer ».` });
    }
    if (action === 'role') {
      const role = String(form.get('role') || '');
      if (userId === admin.userId) return render(env, admin, { error: 'Vous ne pouvez pas changer votre propre rôle.', status: 400 });
      await changeRole(env.DB, admin.organizationId, { userId, role, actor });
      await logAudit(env.DB, admin.organizationId, { userId: admin.userId, action: `utilisateur.role:${role}`, target: userId });
      return render(env, admin, { message: 'Rôle mis à jour.' });
    }
    if (action === 'revoke') {
      if (userId === admin.userId) return render(env, admin, { error: 'Vous ne pouvez pas retirer votre propre accès.', status: 400 });
      await revokeMember(env.DB, admin.organizationId, { userId, actor });
      await logAudit(env.DB, admin.organizationId, { userId: admin.userId, action: 'utilisateur.retrait', target: userId });
      return render(env, admin, { message: 'Accès retiré. Ses sessions ouvertes ont été fermées.' });
    }
  } catch (error) {
    if (error instanceof AccountError) {
      return render(env, admin, { error: error.message, email: String(form.get('email') || ''), role: String(form.get('role') || 'secretary'), status: error.code === 'forbidden' ? 403 : 400 });
    }
    throw error;
  }
  return render(env, admin, { error: 'Action inconnue.', status: 400 });
}
