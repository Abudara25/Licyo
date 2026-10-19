// Premier accès à l'espace admin d'un club qui n'a encore AUCUN membre actif : création du premier « Responsable du
// club ». Protégé par le secret de plateforme SETUP_SECRET (variable Cloudflare, jamais commitée), que l'éditeur
// transmet au club lors de la mise en service. Une fois un responsable créé, la page ne sert plus (les autres accès se
// font par invitation depuis /admin/utilisateurs). En attendant la console plateforme (phase 6 de la feuille de route).
import { resolveOrganization } from '../_shared/organization.js';
import { ensureSchema } from '../_shared/inscriptions-db.js';
import { createFirstOwner, countActiveMembers, AccountError, logAudit } from '../_shared/accounts.js';
import { createSession, withCookies, icon, escapeHtml } from '../_shared/admin-auth.js';
import { clientKey, hitRateLimit, timingSafeEqual } from '../_shared/security.js';
import { html, cardPage, newPasswordFields, passwordField, textField, confirmMismatch } from '../_shared/account-pages.js';

const DONE = 'Ce club a déjà un responsable. Connectez-vous avec votre compte, ou demandez une invitation à un responsable du club.';

const page = ({ error = '', name = '', email = '', clubName = '' } = {}) =>
  cardPage({
    title: 'Premier accès',
    intro: `Création du compte du premier responsable${clubName ? ` du <strong>${escapeHtml(clubName)}</strong>` : ''}. Le code de mise en service vous a été transmis par l’éditeur de la plateforme.`,
    error,
    content: `<form method="POST">
      ${passwordField('setup', 'Code de mise en service', { autocomplete: 'off', autofocus: true })}
      ${textField('name', 'Prénom et nom', { value: name, autocomplete: 'name' })}
      ${textField('email', 'Adresse e-mail', { type: 'email', value: email, autocomplete: 'username' })}
      ${newPasswordFields()}
      <button type="submit" class="adm-btn adm-btn-primary adm-btn-block">${icon('check')}Créer mon compte</button>
    </form>`,
  });

async function organizationFor(request, env) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (organization) await ensureSchema(env.DB);
  return organization;
}

export async function onRequestGet({ request, env }) {
  const organization = await organizationFor(request, env);
  if (!organization) return html(cardPage({ title: 'Premier accès', error: 'Espace introuvable pour ce site.' }), 404);
  if ((await countActiveMembers(env.DB, organization.id)) > 0) return html(cardPage({ title: 'Premier accès', error: DONE }), 409);
  if (!env.SETUP_SECRET) return html(cardPage({ title: 'Premier accès', error: 'La mise en service n’est pas activée sur ce site (variable SETUP_SECRET absente).' }), 503);
  return html(page({ clubName: organization.name }));
}

export async function onRequestPost({ request, env }) {
  const organization = await organizationFor(request, env);
  if (!organization) return html(cardPage({ title: 'Premier accès', error: 'Espace introuvable pour ce site.' }), 404);
  if (!env.SETUP_SECRET) return html(cardPage({ title: 'Premier accès', error: 'La mise en service n’est pas activée sur ce site.' }), 503);
  const limit = await hitRateLimit(env.DB, `setup:${await clientKey(request)}`, { limit: 5, windowSeconds: 3600 }).catch(() => ({ allowed: true }));
  const form = await request.formData();
  const name = String(form.get('name') || '').slice(0, 100);
  const email = String(form.get('email') || '').slice(0, 200);
  const again = (error, status = 400) => html(page({ error, name, email, clubName: organization.name }), status);
  if (!limit.allowed) return again('Trop de tentatives. Réessayez dans une heure.', 429);
  if (!timingSafeEqual(String(form.get('setup') || ''), env.SETUP_SECRET)) return again('Code de mise en service incorrect.', 403);
  const mismatch = confirmMismatch(form);
  if (mismatch) return again(mismatch);
  let created;
  try {
    created = await createFirstOwner(env.DB, organization.id, { email, name, password: String(form.get('password') || '') });
  } catch (error) {
    if (error instanceof AccountError) return error.code === 'exists' ? html(cardPage({ title: 'Premier accès', error: DONE }), 409) : again(error.message);
    throw error;
  }
  await logAudit(env.DB, organization.id, { userId: created.userId, action: 'utilisateur.premier-responsable', target: created.userId });
  const cookies = await createSession(env, organization.id, created.userId);
  return withCookies(new Response('', { status: 303, headers: { Location: '/admin/dashboard' } }), cookies);
}
