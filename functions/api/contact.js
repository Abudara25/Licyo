// Formulaire de contact du site (2026-10-09, remplace FormSubmit) : le message est envoyé depuis la boîte du club
// (même chemin que les autres e-mails : messagerie Infomaniak, Brevo en secours) vers l'adresse publique de
// l'organisation, avec « Reply-To » = le visiteur. Rien n'est enregistré en base hormis le journal des e-mails.
// GET = clé publique Turnstile (vide tant qu'elle n'est pas définie). POST = envoi : JSON (assets/js/contact.js) ou
// formulaire HTML classique sans JavaScript (redirection 303 vers /contact?envoi=ok|erreur).
// Organisation résolue par le domaine, jamais par le navigateur ; même origine exigée ; limites par connexion et par
// jour (le quota de la boîte Infomaniak, 200 e-mails par 24 h, est partagé avec les autres envois du club).
import { resolveOrganization, unknownOrganization } from '../_shared/organization.js';
import { clientKey, hasSameOriginSignal, hitRateLimit, verifyTurnstile } from '../_shared/security.js';
import { mailConfigured, sendContactMessage } from '../_shared/confirmation-email.js';

export const CONTACT_LIMITS = Object.freeze({
  visitor: { limit: 5, windowSeconds: 60 * 60 },
  organization: { limit: 40, windowSeconds: 24 * 60 * 60 },
});
const MAX = { nom: 100, email: 200, sujet: 100, message: 5000 };
// Même règle que l'adresse acceptée par l'envoi SMTP (smtp.js) : rien qui puisse casser l'en-tête Reply-To.
const EMAIL_RE = /^[^\s<>"(),;:\\]+@[^\s<>"(),;:\\]+\.[^\s<>"(),;:\\]+$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Une seule ligne, sans caractère de contrôle ; le message garde ses retours à la ligne.
const clean = (value, { multiline = false } = {}) => {
  if (typeof value !== 'string') return '';
  let text = value.replace(/\r\n?/g, '\n');
  text = multiline ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '') : text.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  return text.trim();
};

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? { body, form: false } : null;
  }
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const data = await request.formData();
    const body = {};
    for (const [key, value] of data.entries()) if (typeof value === 'string') body[key] = value;
    body.rgpd = data.has('rgpd');
    body.turnstileToken = body['cf-turnstile-response'] || '';
    return { body, form: true };
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return unknownOrganization();
  return json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' });
}

export async function onRequestPost({ request, env }) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > 32 * 1024) return json({ error: 'Message trop long' }, 413);
  if (!hasSameOriginSignal(request)) return json({ error: 'Requête refusée' }, 403);

  let parsed;
  try {
    parsed = await readBody(request);
  } catch {
    parsed = null;
  }
  if (!parsed) return json({ error: 'Requête invalide' }, 400);
  const { body, form } = parsed;
  const done = (status, payload) => {
    if (!form) return json(payload, status);
    const url = new URL('/contact', request.url);
    url.searchParams.set('envoi', status === 200 ? 'ok' : 'erreur');
    return new Response(null, { status: 303, headers: { Location: `${url.pathname}${url.search}#formulaire-contact`, 'Cache-Control': 'no-store' } });
  };

  const organization = await resolveOrganization(request, env).catch(() => null);
  if (!organization) return unknownOrganization();

  // Champ piège invisible : un robot qui le remplit reçoit une réponse normale, rien n'est envoyé.
  if (clean(body.site_web)) return done(200, { ok: true });

  const message = {
    nom: clean(body.nom),
    email: clean(body.email),
    sujet: clean(body.sujet) || 'Autre demande',
    message: clean(body.message, { multiline: true }),
  };
  for (const [field, max] of Object.entries(MAX)) {
    if (message[field].length > max) return done(400, { error: `Champ trop long : ${field}` });
  }
  if (!message.nom || !message.email || !message.message) return done(400, { error: 'Merci de remplir votre nom, votre e-mail et votre message.' });
  if (!EMAIL_RE.test(message.email)) return done(400, { error: 'Adresse e-mail invalide.' });
  if (body.rgpd !== true) return done(400, { error: 'Merci de cocher la case de consentement.' });

  try {
    const visitor = await hitRateLimit(env.DB, `contact:${organization.id}:${await clientKey(request)}`, CONTACT_LIMITS.visitor);
    if (!visitor.allowed) return done(429, { error: 'Trop de messages envoyés depuis cette connexion. Réessayez dans une heure, ou écrivez-nous directement.' });
    const daily = await hitRateLimit(env.DB, `contact-jour:${organization.id}`, CONTACT_LIMITS.organization);
    if (!daily.allowed) return done(429, { error: 'Le formulaire a reçu beaucoup de messages aujourd’hui. Écrivez-nous directement par e-mail.' });
  } catch {
    // Limite indisponible : on n'empêche pas un visiteur d'écrire au club.
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, request))) {
    return done(403, { error: 'La vérification anti-robot a échoué. Rechargez la page et réessayez.', turnstile: true });
  }
  if (!mailConfigured(env)) return done(503, { error: 'L’envoi est momentanément indisponible. Écrivez-nous directement par e-mail.' });

  const siteUrl = new URL(request.url).origin;
  let sent = false;
  try {
    sent = await sendContactMessage(env, message, { to: organization.email || '', siteUrl, organizationId: organization.id });
  } catch (error) {
    console.error(`Formulaire de contact : ${error?.name}`);
  }
  if (!sent) return done(502, { error: 'Le message n’a pas pu être envoyé. Réessayez, ou écrivez-nous directement par e-mail.' });
  return done(200, { ok: true });
}
