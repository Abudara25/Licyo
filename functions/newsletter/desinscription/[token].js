// Désinscription de la newsletter (2026-11-13, _shared/newsletter.js). Lien en bas de chaque newsletter et en-tête
// List-Unsubscribe.
// - GET : page de confirmation avec un bouton (un robot qui ouvre les liens d'un e-mail ne désinscrit personne).
// - POST : désinscription. Accepté sans contrôle d'origine, car Gmail et Outlook envoient la désinscription en un clic
//   (RFC 8058, corps « List-Unsubscribe=One-Click ») depuis leurs serveurs ; le jeton signé suffit et l'action est
//   sans risque. La réinscription (« Je me suis trompé ») exige en revanche un envoi depuis le site.
// Seules les newsletters cessent : les e-mails liés à l'inscription continuent.
import { familyShell } from '../../depot/[token].js';
import { resolveOrganization } from '../../_shared/organization.js';
import { hasSameOriginSignal } from '../../_shared/security.js';
import { newsletterSigner, isUnsubscribed, unsubscribe, resubscribe } from '../../_shared/newsletter.js';

const page = (title, body, status = 200) =>
  new Response(
    familyShell(
      title,
      `
  <div class="page-header"><div class="container"><span class="eyebrow">Newsletter du club</span><h1>${title}</h1></div></div>
  <section class="bg-cream"><div class="container suivi-wrap"><div class="suivi-card">${body}</div></div></section>
`
    ),
    { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } }
  );

const KEEP = '<p class="suivi-help">Vous continuerez à recevoir les e-mails liés à l’inscription de votre enfant (dossier, paiement, informations pratiques).</p>';

const form = (token, action, label, primary = true) =>
  `<form method="POST" action="/newsletter/desinscription/${encodeURIComponent(token)}">
      <input type="hidden" name="action" value="${action}">
      <button type="submit" class="btn ${primary ? 'btn-primary' : 'btn-dark'}">${label}</button>
    </form>`;

const confirmPage = (token) =>
  page(
    'Se désinscrire de la newsletter',
    `<p>Vous ne souhaitez plus recevoir la newsletter du Club Exemple ? Confirmez ci-dessous.</p>
    ${KEEP}
    ${form(token, 'unsubscribe', 'Me désinscrire')}`
  );

const donePage = (token) =>
  page(
    'Désinscription confirmée',
    `<p>C’est noté : vous ne recevrez plus la newsletter du club.</p>
    ${KEEP}
    <p class="suivi-help">Vous vous êtes trompé ?</p>
    ${form(token, 'resubscribe', 'Me réinscrire', false)}`
  );

const resubscribedPage = () =>
  page('Réinscription confirmée', '<p>C’est noté : vous recevrez de nouveau la newsletter du club. Merci !</p><p><a href="/">Retour au site</a></p>');

const invalidPage = () =>
  page('Lien non valable', '<p>Ce lien de désinscription n’est pas valable. Pour ne plus recevoir la newsletter, répondez simplement à l’e-mail reçu ou écrivez-nous à <a href="mailto:contact@club-exemple.example">contact@club-exemple.example</a>.</p>', 404);

async function context(request, env, token) {
  const organization = await resolveOrganization(request, env);
  if (!organization) return null;
  const signer = await newsletterSigner(env.DB, organization.id);
  const hash = await signer.verify(token);
  return hash ? { organizationId: organization.id, hash } : null;
}

export async function onRequestGet({ request, env, params }) {
  const ctx = await context(request, env, params.token);
  if (!ctx) return invalidPage();
  if (await isUnsubscribed(env.DB, ctx.organizationId, ctx.hash)) return donePage(params.token);
  return confirmPage(params.token);
}

export async function onRequestPost({ request, env, params }) {
  const ctx = await context(request, env, params.token);
  if (!ctx) return invalidPage();
  const body = await request.text().catch(() => '');
  const fields = new URLSearchParams(body.slice(0, 2000));
  if (fields.get('action') === 'resubscribe') {
    if (!hasSameOriginSignal(request)) return new Response('Requête refusée.', { status: 403 });
    await resubscribe(env.DB, ctx.organizationId, ctx.hash);
    return resubscribedPage();
  }
  // Bouton de la page ou désinscription en un clic de la messagerie (List-Unsubscribe=One-Click).
  await unsubscribe(env.DB, ctx.organizationId, ctx.hash);
  return donePage(params.token);
}
