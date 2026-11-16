// Lien d'invitation de groupe (/educateur/rejoindre/<lien>, 2026-11-13) : le club le partage dans un groupe (dirigeants,
// bénévoles…). Chacun y saisit prénom, nom et e-mail ; sa fiche est créée avec le rôle choisi par le club et son lien
// personnel part par e-mail : seul le propriétaire de l'adresse peut ensuite remplir la fiche. Voir _shared/educateurs.js.
// Signal de même origine exigé pour l'envoi (../_middleware.js). Une adresse déjà connue reçoit un nouveau lien au lieu
// d'une seconde fiche ; la page de confirmation est la même dans tous les cas (rien ne révèle qui est déjà inscrit).
import { familyShell } from '../../depot/[token].js';
import { htmlResponse } from '../[token].js';
import {
  resolveInvite,
  joinWithInvite,
  findActiveByEmail,
  getEducateur,
  cleanLine,
  isEmail,
  ROLES,
  RENEW_LIMIT,
} from '../../_shared/educateurs.js';
import { sendEducateurLinkEmail } from '../../_shared/confirmation-email.js';
import { clientKey, hitRateLimit } from '../../_shared/security.js';

const CLIENT_LIMIT = { limit: 5, windowSeconds: 3600 };

const escapeHtml = (str = '') =>
  String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const header = (title) => `<div class="page-header"><div class="container"><span class="eyebrow">Encadrement du club</span><h1>${escapeHtml(title)}</h1></div></div>`;
const shell = (title, card) =>
  familyShell(title, `
  ${header(title)}
  <section class="bg-cream"><div class="container suivi-wrap">${card}</div></section>
`);

export function joinPage(token, invite, { error = '', values = {} } = {}) {
  const t = escapeHtml(encodeURIComponent(token));
  const v = (k) => escapeHtml(values[k] || '');
  return shell('Rejoindre l’encadrement', `<div class="suivi-card educ-intro">
    <p class="educ-role">${escapeHtml(ROLES[invite.role] || ROLES.educateur)}</p>
    <p>Le club vous invite à créer votre fiche. Indiquez votre nom et votre adresse e-mail : vous recevrez un lien personnel pour compléter vos informations (identité, coordonnées, diplômes, photo) en quelques minutes.</p>
  </div>
  <div class="suivi-card">
    ${error ? `<p class="suivi-flash is-error" role="alert"><span>${escapeHtml(error)}</span></p>` : ''}
    <form method="POST" action="/educateur/rejoindre/${t}" class="educ-form educ-join">
      <div class="form-row">
        <div class="form-field"><label for="join-prenom">Prénom</label><input type="text" id="join-prenom" name="prenom" maxlength="100" required autocomplete="given-name" value="${v('prenom')}"></div>
        <div class="form-field"><label for="join-nom">Nom</label><input type="text" id="join-nom" name="nom" maxlength="100" required autocomplete="family-name" value="${v('nom')}"></div>
      </div>
      <div class="form-field"><label for="join-email">E-mail</label><input type="email" id="join-email" name="email" maxlength="200" required autocomplete="email" inputmode="email" value="${v('email')}"></div>
      <div class="suivi-hp" aria-hidden="true"><label for="join-site">Ne pas remplir</label><input type="text" id="join-site" name="site_web" tabindex="-1" autocomplete="off"></div>
      <button type="submit" class="btn btn-primary">Recevoir mon lien</button>
      <p class="suivi-help">Vos informations servent uniquement à gérer votre activité au club (voir la <a href="/confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>).</p>
    </form>
  </div>`);
}

export const joinSentPage = () =>
  shell('Regardez vos e-mails', `<div class="suivi-card suivi-expired">
    <p>C’est noté, merci ! Un e-mail vient de partir avec votre lien personnel pour compléter votre fiche. Il est valable 30 jours.</p>
    <p class="suivi-renew-note">Rien reçu d’ici quelques minutes ? Regardez dans les indésirables, ou écrivez-nous à <a href="mailto:contact@club-exemple.example">contact@club-exemple.example</a>.</p>
  </div>`);

export const joinExpiredPage = () =>
  shell('Ce lien n’est plus valable', `<div class="suivi-card suivi-expired">
    <p>Ce lien d’invitation a expiré ou n’a plus de place disponible. Demandez un nouveau lien à un responsable du club.</p>
  </div>`);

async function notFound(request, env) {
  const res = await env.ASSETS.fetch(new URL('/404.html', new URL(request.url).origin));
  return new Response(res.body, { status: 404, headers: res.headers });
}

async function loadInvite(request, env, token) {
  const { resolveOrganization } = await import('../../_shared/organization.js');
  const organization = await resolveOrganization(request, env);
  if (!organization) return { status: 'unknown', invite: null };
  return resolveInvite(env.DB, organization.id, token);
}

export async function onRequestGet({ request, env, params }) {
  const access = await loadInvite(request, env, params.token);
  if (access.status === 'unknown') return notFound(request, env);
  if (new URL(request.url).searchParams.get('envoye') === '1') return htmlResponse(joinSentPage());
  if (access.status !== 'ok') return htmlResponse(joinExpiredPage(), 410);
  return htmlResponse(joinPage(params.token, access.invite));
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const access = await loadInvite(request, env, params.token);
  if (access.status === 'unknown') return notFound(request, env);
  if (access.status !== 'ok') return htmlResponse(joinExpiredPage(), 410);
  const done = new Response('', { status: 303, headers: { Location: `/educateur/rejoindre/${encodeURIComponent(params.token)}?envoye=1`, 'Cache-Control': 'no-store' } });
  let form;
  try {
    form = await request.formData();
  } catch {
    return htmlResponse(joinPage(params.token, access.invite, { error: 'Envoi invalide, réessayez.' }), 400);
  }
  if (String(form.get('site_web') || '')) return done; // Champ piège rempli : robot, rien n'est fait.
  const prenom = cleanLine(String(form.get('prenom') || ''), 100);
  const nom = cleanLine(String(form.get('nom') || ''), 100);
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!prenom || !nom || !isEmail(email) || email.length > 200) {
    const values = { prenom: String(form.get('prenom') || ''), nom: String(form.get('nom') || ''), email: String(form.get('email') || '') };
    return htmlResponse(joinPage(params.token, access.invite, { error: 'Vérifiez votre prénom, votre nom et votre adresse e-mail.', values }), 400);
  }
  const { allowed } = await hitRateLimit(env.DB, `educjoin:client:${await clientKey(request)}`, CLIENT_LIMIT);
  if (!allowed) return htmlResponse(joinPage(params.token, access.invite, { error: 'Trop d’envois depuis cette connexion. Réessayez dans une heure.' }), 429);
  const siteUrl = new URL(request.url).origin;
  const organizationId = access.invite.organization_id;
  const existing = await findActiveByEmail(env.DB, organizationId, email);
  if (existing) {
    // Adresse déjà connue : un nouveau lien vers SA fiche (au plus un par heure), aucune seconde fiche, aucune place prise.
    const { allowed: ficheOk } = await hitRateLimit(env.DB, `educlink:fiche:${existing.id}`, RENEW_LIMIT);
    const row = ficheOk ? await getEducateur(env.DB, organizationId, existing.id) : null;
    if (row) waitUntil(sendEducateurLinkEmail(env, row, siteUrl, { origin: 'famille' }).catch(() => {}));
    return done;
  }
  const row = await joinWithInvite(env.DB, access.invite, { prenom, nom, email });
  if (!row) return htmlResponse(joinExpiredPage(), 410);
  waitUntil(sendEducateurLinkEmail(env, row, siteUrl, { origin: 'famille' }).catch(() => {}));
  return done;
}
