// Choix d'un nouveau mot de passe depuis le lien reçu par e-mail (1 heure, usage unique, club du domaine). Toutes les
// sessions du compte (tous clubs, tous appareils) sont ensuite fermées : la personne se reconnecte.
import { resolveOrganization } from '../../_shared/organization.js';
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { readToken, resetPassword, AccountError, logAudit } from '../../_shared/accounts.js';
import { revokeUserSessions, loginPage, icon, escapeHtml } from '../../_shared/admin-auth.js';
import { clientKey, hitRateLimit } from '../../_shared/security.js';
import { html, cardPage, newPasswordFields, confirmMismatch } from '../../_shared/account-pages.js';

const INVALID = 'Ce lien n’est plus valable (il expire au bout d’une heure et ne sert qu’une fois). <a href="/admin/mot-de-passe-oublie">Faire une nouvelle demande</a>.';

const form = (row, error = '') =>
  cardPage({
    title: 'Nouveau mot de passe',
    intro: `Compte : <strong>${escapeHtml(row.email)}</strong>`,
    error,
    content: `<form method="POST">${newPasswordFields()}<button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('lock')}Enregistrer</button></form>`,
  });

const invalidPage = () => html(cardPage({ title: 'Nouveau mot de passe', content: `<p class="adm-flash adm-flash-error" role="alert">${icon('alert')}<span>${INVALID}</span></p>` }), 410);

async function context(request, env, params) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return {};
  await ensureSchema(env.DB);
  return { organization, row: await readToken(env.DB, organization.id, params.token, 'reset') };
}

export async function onRequestGet({ request, env, params }) {
  const { row } = await context(request, env, params);
  return row ? html(form(row)) : invalidPage();
}

export async function onRequestPost({ request, env, params }) {
  const { organization, row } = await context(request, env, params);
  if (!row) return invalidPage();
  const limit = await hitRateLimit(env.DB, `reset-token:${await clientKey(request)}`, { limit: 10, windowSeconds: 15 * 60 }).catch(() => ({ allowed: true }));
  if (!limit.allowed) return html(form(row, 'Trop de tentatives. Réessayez dans 15 minutes.'), 429);
  const data = await request.formData();
  const mismatch = confirmMismatch(data);
  if (mismatch) return html(form(row, mismatch), 400);
  let done;
  try {
    done = await resetPassword(env.DB, organization.id, params.token, String(data.get('password') || ''));
  } catch (error) {
    if (error instanceof AccountError) return error.code === 'token' ? invalidPage() : html(form(row, error.message), 400);
    throw error;
  }
  await revokeUserSessions(env, done.userId);
  await logAudit(env.DB, organization.id, { userId: done.userId, action: 'compte.mot-de-passe-reinitialise', target: done.userId });
  return html(loginPage({ email: done.email, notice: 'Mot de passe enregistré. Connectez-vous avec votre nouveau mot de passe.' }));
}
