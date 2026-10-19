// Mon compte (tout compte connecté) : nom, adresse de connexion, rôle dans ce club, et changement de mot de passe.
// Le mot de passe est celui du compte, commun à tous ses clubs : après un changement, toutes ses sessions (tous clubs,
// tous appareils) sont fermées, puis une nouvelle est ouverte ici.
import { isAuthed, loginPage, escapeHtml, adminHead, adminShell, adminScripts, adminBadges, icon, flash, createSession, revokeUserSessions, withCookies } from '../_shared/admin-auth.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { getUser, setName, setPassword, cleanName, passwordProblem, logAudit, PERMISSIONS } from '../_shared/accounts.js';
import { verifyPassword, clientKey, hitRateLimit } from '../_shared/security.js';
import { newPasswordFields, passwordField, confirmMismatch } from '../_shared/account-pages.js';

const html = (body, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

async function render(env, admin, { message = '', error = '', status = 200 } = {}) {
  const user = await getUser(env.DB, admin.userId);
  const badges = await adminBadges(env, admin);
  const rights = admin.permissions.length ? admin.permissions.map((p) => `<li>${escapeHtml(PERMISSIONS[p])}</li>`).join('') : '<li>Tableau de bord seulement</li>';
  return html(
    `${adminHead('Mon compte')}
${adminShell({ active: 'compte', badges, eyebrow: 'Espace admin', title: 'Mon compte', subtitle: `${escapeHtml(user?.email || '')} · ${escapeHtml(admin.roleLabel)}` })}
<main id="adm-main" class="adm-wrap adm-main adm-main-narrow">
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('user')}Mon profil</h2>
    ${message ? flash('ok', message) : ''}
    ${error ? flash('error', error) : ''}
    <form method="POST">
      <input type="hidden" name="action" value="name">
      <div class="form-field">
        <label for="name">Prénom et nom</label>
        <input type="text" id="name" name="name" value="${escapeHtml(user?.name || '')}" required maxlength="100" autocomplete="name">
      </div>
      <p class="adm-help">Adresse de connexion : <strong>${escapeHtml(user?.email || '')}</strong></p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('check')}Enregistrer</button></div>
    </form>
  </section>
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('lock')}Changer mon mot de passe</h2>
    <form method="POST">
      <input type="hidden" name="action" value="password">
      ${passwordField('current', 'Mot de passe actuel', { autocomplete: 'current-password' })}
      ${newPasswordFields()}
      <p class="adm-help">Vos autres appareils seront déconnectés.</p>
      <div class="adm-form-actions"><button type="submit" class="adm-btn adm-btn-primary">${icon('lock')}Changer le mot de passe</button></div>
    </form>
  </section>
  <section class="adm-surface">
    <h2 class="adm-h2">${icon('users')}Mes droits dans ce club</h2>
    <p class="adm-help" style="margin-top:8px;">Rôle : <strong>${escapeHtml(admin.roleLabel)}</strong>. Pour changer de rôle, adressez-vous à un responsable du club.</p>
    <ul class="adm-roles">${rights}</ul>
  </section>
</main>
${adminScripts('admin-nav', 'admin-login')}
</body></html>`,
    status
  );
}

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  await ensureSchema(env.DB);
  const changed = new URL(request.url).searchParams.get('motdepasse') === '1';
  return render(env, admin, changed ? { message: 'Mot de passe changé. Vos autres appareils ont été déconnectés.' } : {});
}

export async function onRequestPost({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage(), 401);
  await ensureSchema(env.DB);
  const form = await request.formData();
  const action = String(form.get('action') || '');

  if (action === 'name') {
    const name = cleanName(form.get('name'));
    if (!name) return render(env, admin, { error: 'Indiquez votre prénom et votre nom (2 caractères au moins).', status: 400 });
    await setName(env.DB, admin.userId, name);
    await logAudit(env.DB, admin.organizationId, { userId: admin.userId, action: 'compte.nom', target: admin.userId });
    return render(env, { ...admin, user: { ...admin.user, name } }, { message: 'Profil enregistré.' });
  }

  if (action === 'password') {
    const limit = await hitRateLimit(env.DB, `account-password:${admin.userId}:${await clientKey(request)}`, { limit: 5, windowSeconds: 15 * 60 }).catch(() => ({ allowed: true }));
    if (!limit.allowed) return render(env, admin, { error: 'Trop de tentatives. Réessayez dans 15 minutes.', status: 429 });
    const user = await getUser(env.DB, admin.userId);
    if (!(await verifyPassword(String(form.get('current') || ''), user?.password_hash))) return render(env, admin, { error: 'Mot de passe actuel incorrect.', status: 400 });
    const mismatch = confirmMismatch(form);
    if (mismatch) return render(env, admin, { error: mismatch, status: 400 });
    const password = String(form.get('password') || '');
    const problem = passwordProblem(password, { email: user.email, name: user.name });
    if (problem) return render(env, admin, { error: problem, status: 400 });
    await setPassword(env.DB, admin.userId, password);
    await revokeUserSessions(env, admin.userId);
    await logAudit(env.DB, admin.organizationId, { userId: admin.userId, action: 'compte.mot-de-passe', target: admin.userId });
    // Nouvelle session, puis redirection : la page suivante porte le jeton CSRF de la nouvelle session.
    const cookies = await createSession(env, admin.organizationId, admin.userId);
    return withCookies(new Response('', { status: 303, headers: { Location: '/admin/compte?motdepasse=1' } }), cookies);
  }

  return render(env, admin, { error: 'Action inconnue.', status: 400 });
}
