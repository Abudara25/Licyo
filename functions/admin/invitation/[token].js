// Acceptation d'une invitation au bureau (lot 1 Licyo, 2026-11-16) : la personne invitée choisit son mot de passe,
// son compte est créé et elle est connectée. Organisation déduite du DOMAINE (jamais du navigateur) : un lien d'un
// club ne fonctionne pas sur le site d'un autre. Lien valable 7 jours, une seule fois (admin-users.js).
import { resolveOrganization } from '../../_shared/organization.js';
import { adminHead, adminScripts, createSession, withCookies, escapeHtml, flash, icon } from '../../_shared/admin-auth.js';
import { findInvite, acceptInvite, AdminUserError, ROLE_LABELS, MIN_PASSWORD_LENGTH } from '../../_shared/admin-users.js';
import { clientKey, hitRateLimit } from '../../_shared/security.js';

const LIMIT = { limit: 10, windowSeconds: 15 * 60 };
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin' } });

function shell(content) {
  return `${adminHead('Invitation', 'adm adm-login-body')}
<main class="adm-login">
  <div class="adm-login-card">
    <p class="adm-eyebrow">Espace admin</p>
    ${content}
  </div>
</main>
${adminScripts('admin-login')}
</body></html>`;
}

const invalidPage = () =>
  shell(`<h1>Lien plus valable</h1>
    <p class="adm-help">Ce lien d’invitation a expiré, a déjà servi ou a été annulé. Demandez au président du club de vous en envoyer un nouveau.</p>
    <p style="margin-top:16px;"><a class="adm-btn adm-btn-ghost adm-btn-block" href="/admin/a-traiter">Aller à la connexion</a></p>`);

function formPage(invite, error = '') {
  return shell(`<h1>Bienvenue, ${escapeHtml(invite.name)}</h1>
    <p class="adm-help">Rôle : <strong>${ROLE_LABELS[invite.role]}</strong>. Choisissez votre mot de passe pour activer votre compte.</p>
    ${error ? flash('error', escapeHtml(error)) : ''}
    <form method="POST">
      <div class="form-field">
        <label for="invite-email">Adresse e-mail (votre identifiant)</label>
        <input type="email" id="invite-email" name="username" value="${escapeHtml(invite.email)}" autocomplete="username" readonly>
      </div>
      <div class="form-field">
        <label for="new-password">Mot de passe</label>
        <div class="adm-password">
          <input type="password" id="new-password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" required autofocus>
          <button type="button" class="adm-password-toggle" data-password-toggle="new-password" aria-pressed="false" aria-label="Afficher le mot de passe" hidden>${icon('eye')}</button>
        </div>
      </div>
      <div class="form-field">
        <label for="confirm-password">Confirmer le mot de passe</label>
        <input type="password" id="confirm-password" name="confirm" autocomplete="new-password" minlength="${MIN_PASSWORD_LENGTH}" maxlength="200" required>
      </div>
      <p class="adm-help">${MIN_PASSWORD_LENGTH} caractères au moins. Une phrase de quelques mots est facile à retenir et difficile à deviner.</p>
      <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Activer mon compte</button>
    </form>`);
}

export async function onRequestGet({ request, env, params }) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return html(invalidPage(), 404);
  const invite = await findInvite(env.DB, organization.id, String(params.token || '')).catch(() => null);
  return invite ? html(formPage(invite)) : html(invalidPage(), 410);
}

export async function onRequestPost({ request, env, params }) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return html(invalidPage(), 404);
  const { allowed } = await hitRateLimit(env.DB, `invite:${await clientKey(request)}`, LIMIT).catch(() => ({ allowed: true }));
  if (!allowed) return html(shell('<h1>Trop de tentatives</h1><p class="adm-help">Réessayez dans 15 minutes.</p>'), 429);
  const token = String(params.token || '');
  const form = await request.formData();
  try {
    const user = await acceptInvite(env.DB, organization.id, token, String(form.get('password') || ''), String(form.get('confirm') || ''));
    const cookies = await createSession(env, organization.id, user.id);
    return withCookies(new Response('', { status: 303, headers: { Location: '/admin/a-traiter', 'Cache-Control': 'no-store' } }), cookies);
  } catch (error) {
    if (!(error instanceof AdminUserError)) throw error;
    const invite = await findInvite(env.DB, organization.id, token).catch(() => null);
    return invite ? html(formPage(invite, error.message), 400) : html(invalidPage(), 410);
  }
}
