// Espace famille sans lien (2026-10-16) : la famille qui a perdu son lien, ou dont le PDF pointe ici, saisit l'adresse
// e-mail donnée à l'inscription et reçoit, À CETTE ADRESSE SEULEMENT, un lien neuf par inscription active (5 au plus).
// Réponse toujours identique, que l'adresse soit connue ou non (aucune énumération possible). Limites : 5 demandes par
// heure et par connexion, 1 envoi par heure et par fiche. Champ piège contre les robots ; signal de même origine exigé.
import { previewGuard } from './_shared/environment.js';
import { resolveOrganization } from './_shared/organization.js';
import { ensureInscriptionsTable } from './_shared/inscriptions-db.js';
import { RENEW_LIMIT } from './_shared/family-links.js';
import { sendFamilyLinkEmail } from './_shared/confirmation-email.js';
import { clientKey, hitRateLimit, hasSameOriginSignal } from './_shared/security.js';
import { familyShell } from './depot/[token].js';

const CLIENT_LIMIT = { limit: 5, windowSeconds: 3600 };
const EMAIL_RE = /^[^\s@<>"',;:()[\]\\]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;

const respond = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

function pageHtml({ sent = false, error = '' } = {}) {
  const content = sent
    ? `<p>Si cette adresse correspond à une inscription, un lien vers l'espace famille vient de lui être envoyé. Il peut mettre quelques minutes à arriver : pensez à regarder dans les indésirables.</p>
       <p><a href="/espace-famille">Essayer une autre adresse</a></p>`
    : `<p>Indiquez l'adresse e-mail donnée lors de l'inscription : vous y recevrez un lien personnel vers l'espace famille, valable 30 jours.</p>
      ${error ? `<p class="suivi-alert" role="alert">${error}</p>` : ''}
      <form method="POST" action="/espace-famille" class="suivi-renew">
        <label for="famille-email">Adresse e-mail</label>
        <input type="email" id="famille-email" name="email" required autocomplete="email" inputmode="email" maxlength="200">
        <div class="suivi-hp" aria-hidden="true"><label for="famille-site">Ne pas remplir</label><input type="text" id="famille-site" name="site_web" tabindex="-1" autocomplete="off"></div>
        <button type="submit" class="btn btn-primary">Recevoir mon lien</button>
      </form>
      <p class="suivi-renew-note">Adresse changée ou plus d'accès à votre messagerie ? Écrivez-nous à <a href="mailto:contact@clubdemo.licyo.fr">contact@clubdemo.licyo.fr</a>.</p>`;
  return familyShell('Espace famille', `
  <div class="page-header"><div class="container"><span class="eyebrow">Espace famille</span><h1>${sent ? 'Lien envoyé' : 'Accéder à mon espace famille'}</h1></div></div>
  <section class="bg-cream"><div class="container suivi-wrap"><div class="suivi-card suivi-expired">${content}</div></div></section>
`);
}

export async function onRequestGet({ request, env }) {
  const blocked = previewGuard(request, env);
  if (blocked) return blocked;
  return respond(pageHtml({ sent: new URL(request.url).searchParams.get('envoye') === '1' }));
}

export async function onRequestPost({ request, env, waitUntil }) {
  const blocked = previewGuard(request, env);
  if (blocked) return blocked;
  if (!hasSameOriginSignal(request)) return new Response('Requête refusée.', { status: 403 });
  let form;
  try {
    form = await request.formData();
  } catch {
    return respond(pageHtml({ error: 'Envoi invalide, réessayez.' }), 400);
  }
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return respond(pageHtml({ error: 'Adresse e-mail invalide.' }), 400);
  const sent = new Response('', { status: 303, headers: { Location: '/espace-famille?envoye=1', 'Cache-Control': 'no-store' } });
  if (String(form.get('site_web') || '')) return sent; // robot
  try {
    const { allowed } = await hitRateLimit(env.DB, `famlink:client:${await clientKey(request)}`, CLIENT_LIMIT);
    if (!allowed) return sent;
    const organization = await resolveOrganization(request, env);
    if (!organization) return sent;
    await ensureInscriptionsTable(env.DB);
    const { results } = await env.DB.prepare(
      'SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL AND (lower(trim(email)) = ? OR lower(trim(parent2_email)) = ?) ORDER BY id DESC LIMIT 5'
    )
      .bind(organization.id, email, email)
      .all();
    const siteUrl = new URL(request.url).origin;
    for (const row of results) {
      const { allowed: ficheOk } = await hitRateLimit(env.DB, `famlink:fiche:${row.id}`, RENEW_LIMIT);
      if (ficheOk) waitUntil(sendFamilyLinkEmail(env, row, siteUrl, 'famille').catch(() => {}));
    }
  } catch {
    // Même réponse dans tous les cas.
  }
  return sent;
}
