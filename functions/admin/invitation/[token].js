// Acceptation d'une invitation à l'espace admin d'un club (lien reçu par e-mail, valable 7 jours, à usage unique).
// Nouveau compte : la personne choisit son nom et son mot de passe. Compte existant (déjà dans un autre club) : elle
// confirme avec son mot de passe actuel. Le club est celui du domaine ; un jeton émis par un autre club ne vaut rien ici.
import { resolveOrganization } from '../../_shared/organization.js';
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { readToken, acceptInvitation, AccountError, roleLabel, logAudit } from '../../_shared/accounts.js';
import { createSession, withCookies, escapeHtml, icon } from '../../_shared/admin-auth.js';
import { clientKey, hitRateLimit } from '../../_shared/security.js';
import { html, cardPage, newPasswordFields, passwordField, textField, confirmMismatch } from '../../_shared/account-pages.js';

const INVALID = 'Ce lien d’invitation n’est plus valable (déjà utilisé, expiré ou retiré). Demandez une nouvelle invitation au responsable du club.';

function form(row, { error = '', name = '' } = {}) {
  const fields = row.password_hash
    ? `<p class="adm-help">Vous avez déjà un compte avec l’adresse <strong>${escapeHtml(row.email)}</strong>. Confirmez avec votre mot de passe habituel.</p>
       ${passwordField('password', 'Mot de passe', { autocomplete: 'current-password', autofocus: true })}`
    : `<p class="adm-help">Adresse de connexion : <strong>${escapeHtml(row.email)}</strong></p>
       ${textField('name', 'Prénom et nom', { value: name, autocomplete: 'name', autofocus: true })}
       ${newPasswordFields()}`;
  return cardPage({
    title: 'Rejoindre l’espace admin',
    intro: `Rôle proposé : <strong>${escapeHtml(roleLabel(row.role))}</strong>.`,
    error,
    content: `<form method="POST">${fields}<button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Rejoindre</button></form>`,
  });
}

async function context(request, env, params) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return { organization: null };
  await ensureSchema(env.DB);
  const row = await readToken(env.DB, organization.id, params.token, 'invite');
  return { organization, row };
}

export async function onRequestGet({ request, env, params }) {
  const { organization, row } = await context(request, env, params);
  if (!organization || !row) return html(cardPage({ title: 'Invitation', error: INVALID }), 410);
  return html(form(row));
}

export async function onRequestPost({ request, env, params }) {
  const { organization, row } = await context(request, env, params);
  if (!organization || !row) return html(cardPage({ title: 'Invitation', error: INVALID }), 410);
  const limit = await hitRateLimit(env.DB, `invite:${await clientKey(request)}`, { limit: 10, windowSeconds: 15 * 60 }).catch(() => ({ allowed: true }));
  if (!limit.allowed) return html(form(row, { error: 'Trop de tentatives. Réessayez dans 15 minutes.' }), 429);
  const data = await request.formData();
  const name = String(data.get('name') || '');
  if (!row.password_hash) {
    const mismatch = confirmMismatch(data);
    if (mismatch) return html(form(row, { error: mismatch, name }), 400);
  }
  let accepted;
  try {
    accepted = await acceptInvitation(env.DB, organization.id, params.token, { name, password: String(data.get('password') || '') });
  } catch (error) {
    if (error instanceof AccountError) {
      return error.code === 'token' ? html(cardPage({ title: 'Invitation', error: INVALID }), 410) : html(form(row, { error: error.message, name }), 400);
    }
    throw error;
  }
  await logAudit(env.DB, organization.id, { userId: accepted.userId, action: 'utilisateur.invitation-acceptee', target: accepted.userId });
  const cookies = await createSession(env, organization.id, accepted.userId);
  return withCookies(new Response('', { status: 303, headers: { Location: '/admin/dashboard' } }), cookies);
}
