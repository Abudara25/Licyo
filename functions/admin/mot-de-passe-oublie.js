// Mot de passe oublié : la personne saisit son adresse ; si elle a un compte avec un accès actif à CE club, un lien
// de réinitialisation (1 heure, usage unique) lui est envoyé. Réponse identique dans tous les cas : la page ne révèle
// jamais si une adresse est connue. Limites : 5 demandes par heure et par connexion, 3 par heure et par adresse.
import { resolveOrganization } from '../_shared/organization.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { requestPasswordReset, normalizeEmail, logAudit } from '../_shared/accounts.js';
import { sendAdminPasswordReset } from '../_shared/confirmation-email.js';
import { clientKey, hitRateLimit, sha256Hex, hasSameOriginSignal } from '../_shared/security.js';
import { icon } from '../_shared/admin-auth.js';
import { html, cardPage, textField } from '../_shared/account-pages.js';

const SENT = 'Si cette adresse correspond à un compte de l’espace admin du club, un lien pour choisir un nouveau mot de passe vient de lui être envoyé. Il est valable 1 heure. Pensez à regarder les courriers indésirables.';

const page = ({ error = '', ok = '', email = '' } = {}) =>
  cardPage({
    title: 'Mot de passe oublié',
    intro: 'Saisissez l’adresse e-mail de votre compte : nous vous enverrons un lien pour choisir un nouveau mot de passe.',
    error,
    ok,
    content: ok
      ? ''
      : `<form method="POST">${textField('email', 'Adresse e-mail', { type: 'email', value: email, autocomplete: 'username', autofocus: true })}
         <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('mail')}Recevoir le lien</button></form>`,
  });

export async function onRequestGet() {
  return html(page());
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!hasSameOriginSignal(request)) return html(page({ error: 'Requête refusée : elle ne provient pas de ce site.' }), 403);
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return html(page({ error: 'Espace introuvable pour ce site.' }), 404);
  const form = await request.formData();
  const email = normalizeEmail(form.get('email'));
  if (!email) return html(page({ error: 'Adresse e-mail invalide.', email: String(form.get('email') || '').slice(0, 200) }), 400);

  const byClient = await hitRateLimit(env.DB, `reset:${await clientKey(request)}`, { limit: 5, windowSeconds: 3600 }).catch(() => ({ allowed: true }));
  const byEmail = await hitRateLimit(env.DB, `reset-email:${organization.id}:${await sha256Hex(email)}`, { limit: 3, windowSeconds: 3600 }).catch(() => ({ allowed: true }));
  if (!byClient.allowed) return html(page({ error: 'Trop de demandes. Réessayez dans une heure.' }), 429);
  if (!byEmail.allowed) return html(page({ ok: SENT }));

  await ensureSchema(env.DB);
  const reset = await requestPasswordReset(env.DB, organization.id, email);
  if (reset) {
    const siteUrl = new URL(request.url).origin;
    const sending = sendAdminPasswordReset(env, { to: reset.user.email, clubName: organization.name, link: `${siteUrl}/admin/reinitialiser/${reset.token}`, siteUrl, organizationId: organization.id });
    if (typeof waitUntil === 'function') waitUntil(sending.catch(() => {}));
    else await sending.catch(() => {});
    await logAudit(env.DB, organization.id, { userId: reset.user.id, action: 'compte.reinitialisation-demandee', target: reset.user.id });
  }
  return html(page({ ok: SENT }));
}
