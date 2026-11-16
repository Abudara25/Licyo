// Comptes du bureau (lot 1 Licyo, 2026-11-16) : le président invite les membres du bureau, choisit leur rôle, peut
// le changer ou désactiver un compte. Réservé à la permission club.admin (vérifiée par le middleware, voir
// _shared/admin-permissions.js, et de nouveau ici). Règles métier et garde-fous : _shared/admin-users.js.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, formatDateFr } from '../_shared/admin-auth.js';
import {
  ADMIN_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  INVITE_DAYS,
  AdminUserError,
  can,
  createInvite,
  revokeInvite,
  pendingInvites,
  listUsers,
  setUserRole,
  setUserStatus,
} from '../_shared/admin-users.js';
import { sendAdminInviteEmail, mailConfigured } from '../_shared/confirmation-email.js';
import { forbiddenPage } from '../_shared/admin-permissions.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store' } });

const roleOptions = (selected) =>
  ADMIN_ROLES.map((role) => `<option value="${role}"${role === selected ? ' selected' : ''}>${ROLE_LABELS[role]}</option>`).join('');

function inviteResult(created) {
  if (!created) return '';
  return `${flash('ok', `Invitation créée pour ${escapeHtml(created.name)}.${created.emailed ? ' Elle lui a été envoyée par e-mail.' : ' Aucun e-mail n’est parti : transmettez-lui ce lien vous-même.'}`)}
    <div class="form-field">
      <label for="invite-link">Lien personnel (valable ${INVITE_DAYS} jours, une seule fois)</label>
      <input type="text" id="invite-link" class="adm-copy" readonly value="${escapeHtml(created.url)}">
    </div>
    <p class="adm-help">Ce lien ne sera plus affiché. Ne le publiez pas : il permet de créer le compte.</p>`;
}

function page({ admin, users, invites, badges, message, error, created, form = {} }) {
  const rows = users.length
    ? users
        .map((u) => {
          const self = admin.userId === u.id;
          const disabled = u.status === 'disabled';
          return `<li class="adm-person">
        <div>
          <strong>${escapeHtml(u.name)}</strong>${self ? ' <span class="adm-tag">Vous</span>' : ''}${disabled ? ' <span class="adm-tag is-no">Désactivé</span>' : ''}
          <div class="adm-row-sub">${escapeHtml(u.email)} · ${ROLE_LABELS[u.role]} · ${u.last_login_at ? `dernière connexion le ${escapeHtml(formatDateFr(u.last_login_at))}` : 'jamais connecté'}</div>
        </div>
        ${
          self
            ? ''
            : `<div class="adm-account-actions">
          <form method="POST" class="adm-account-role">
            <input type="hidden" name="action" value="role"><input type="hidden" name="userId" value="${u.id}">
            <label class="visually-hidden" for="role-${u.id}">Rôle de ${escapeHtml(u.name)}</label>
            <select id="role-${u.id}" name="role" class="adm-select">${roleOptions(u.role)}</select>
            <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Changer</button>
          </form>
          <form method="POST" class="admin-confirm-form">
            <input type="hidden" name="action" value="${disabled ? 'enable' : 'disable'}"><input type="hidden" name="userId" value="${u.id}">
            <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost"${disabled ? '' : ` data-confirm="Désactiver le compte de ${escapeHtml(u.name)} ? Ses connexions en cours sont fermées aussitôt."`}>${disabled ? 'Réactiver' : 'Désactiver'}</button>
          </form>
        </div>`
        }
      </li>`;
        })
        .join('')
    : '<li class="adm-help">Aucun compte pour le moment. Invitez le premier membre du bureau ci-dessous.</li>';

  const pending = invites.length
    ? `<h3 class="adm-h3" style="margin-top:20px;">Invitations en attente</h3>
      <ul class="adm-people">${invites
        .map(
          (i) => `<li class="adm-person">
        <div><strong>${escapeHtml(i.name)}</strong><div class="adm-row-sub">${escapeHtml(i.email)} · ${ROLE_LABELS[i.role]} · expire le ${escapeHtml(formatDateFr(i.expires_at))}</div></div>
        <form method="POST"><input type="hidden" name="action" value="invite-revoke"><input type="hidden" name="inviteId" value="${i.id}">
          <button type="submit" class="adm-btn adm-btn-sm adm-btn-ghost">Annuler</button></form>
      </li>`
        )
        .join('')}</ul>`
    : '';

  return `${adminHead('Comptes du bureau')}
${adminShell({
  active: 'comptes',
  badges,
  eyebrow: 'Espace admin',
  title: 'Comptes du bureau',
  subtitle: 'Chaque membre du bureau a son accès, avec les droits de son rôle.',
})}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  ${message ? flash('ok', escapeHtml(message)) : ''}
  ${error ? flash('error', escapeHtml(error)) : ''}
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('users')}Comptes</h2>
    ${admin.shared ? `<p class="adm-help" style="margin-top:8px;">Vous êtes connecté avec le mot de passe commun du club. Créez votre propre compte de président, puis utilisez-le : chaque action sera rattachée à une personne.</p>` : ''}
    <ul class="adm-people" style="margin-top:12px;">${rows}</ul>
    ${pending}
  </section>

  <section class="adm-surface" id="inviter">
    <h2 class="adm-h2">${icon('plus')}Inviter un membre du bureau</h2>
    ${inviteResult(created)}
    <form method="POST" style="margin-top:12px;">
      <input type="hidden" name="action" value="invite">
      <div class="form-row">
        <div class="form-field">
          <label for="invite-name">Prénom et nom</label>
          <input type="text" id="invite-name" name="name" maxlength="120" autocomplete="off" required value="${escapeHtml(form.name || '')}">
        </div>
        <div class="form-field">
          <label for="invite-email">Adresse e-mail</label>
          <input type="email" id="invite-email" name="email" maxlength="200" inputmode="email" autocomplete="off" required value="${escapeHtml(form.email || '')}">
        </div>
      </div>
      <div class="form-field">
        <label for="invite-role">Rôle</label>
        <select id="invite-role" name="role" required>${roleOptions(form.role || 'secretary')}</select>
      </div>
      <ul class="adm-help" style="margin:8px 0 16px 18px;">${ADMIN_ROLES.map((r) => `<li><strong>${ROLE_LABELS[r]}</strong> : ${ROLE_DESCRIPTIONS[r]}</li>`).join('')}</ul>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('send')}Créer l’invitation</button></div>
    </form>
  </section>
</main>
${adminScripts('admin-nav')}
</body></html>`;
}

async function render(request, env, admin, props = {}, status = 200) {
  const [users, invites, badges] = await Promise.all([
    listUsers(env.DB, admin.organizationId),
    pendingInvites(env.DB, admin.organizationId),
    adminBadges(env, admin),
  ]);
  return html(page({ admin, users, invites, badges, ...props }), status);
}

async function guard(request, env) {
  const admin = await isAuthed(request, env);
  if (!admin) return { response: html(loginPage(), 401) };
  if (!can(admin, 'club.admin')) return { response: html(forbiddenPage(admin), 403) };
  return { admin };
}

export async function onRequestGet({ request, env }) {
  const { admin, response } = await guard(request, env);
  return response || render(request, env, admin);
}

export async function onRequestPost({ request, env }) {
  const { admin, response } = await guard(request, env);
  if (response) return response;
  const form = await request.formData();
  const action = String(form.get('action') || '');
  const org = admin.organizationId;
  const options = { actorUserId: admin.userId };
  try {
    if (action === 'invite') {
      const input = { name: form.get('name'), email: form.get('email'), role: String(form.get('role') || '') };
      try {
        const invite = await createInvite(env.DB, org, input, { invitedBy: admin.userId });
        const url = `${new URL(request.url).origin}/admin/invitation/${invite.token}`;
        const emailed = mailConfigured(env)
          ? await sendAdminInviteEmail(env, { email: invite.email, name: invite.name, roleLabel: ROLE_LABELS[invite.role], url, days: INVITE_DAYS, organizationId: org }).catch(() => false)
          : false;
        return render(request, env, admin, { created: { name: invite.name, url, emailed } });
      } catch (error) {
        if (error instanceof AdminUserError) return render(request, env, admin, { error: error.message, form: { name: input.name, email: input.email, role: input.role } }, 400);
        throw error;
      }
    }
    if (action === 'invite-revoke') {
      await revokeInvite(env.DB, org, form.get('inviteId'));
      return render(request, env, admin, { message: 'Invitation annulée : son lien ne fonctionne plus.' });
    }
    if (action === 'role') {
      await setUserRole(env.DB, org, form.get('userId'), String(form.get('role') || ''), options);
      return render(request, env, admin, { message: 'Rôle mis à jour.' });
    }
    if (action === 'disable' || action === 'enable') {
      await setUserStatus(env.DB, org, form.get('userId'), action === 'disable' ? 'disabled' : 'active', options);
      return render(request, env, admin, { message: action === 'disable' ? 'Compte désactivé, ses connexions sont fermées.' : 'Compte réactivé.' });
    }
  } catch (error) {
    if (error instanceof AdminUserError) return render(request, env, admin, { error: error.message }, 400);
    throw error;
  }
  return render(request, env, admin);
}
