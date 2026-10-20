// Identité du club dans les e-mails (2026-10-20). Les gabarits d'e-mails (confirmation-email.js) ont été écrits pour un
// seul club : nom, lieu, créneau, couleurs et adresse du club de démo y sont en dur. Plutôt que de réécrire chaque
// gabarit, ces valeurs de RÉFÉRENCE sont remplacées au point d'envoi unique (brevoSend) par celles du club qui envoie,
// comme le vocabulaire du sport (sport-profile.js). Le club de démo n'est jamais modifié.
//
// Sources : organisation (nom, e-mail public), premier domaine, version publiée du site (lieu, couleurs, ville) et
// données publiques en base (créneaux). Tout échec de lecture donne des valeurs neutres, jamais celles du démo.
import { DEMO_ORG_ID } from './schema.js';
import { loadPublishedSite } from './site-config.js';
import { loadPublicContext, scheduleSummary } from './page-data.js';
import { paletteVariables } from '../../renderer/palette.js';

const CACHE_TTL_MS = 60_000;
const cache = new Map();
export const clearEmailIdentityCache = () => cache.clear();

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

export async function clubIdentity(env, organizationId) {
  if (!organizationId || organizationId === DEMO_ORG_ID) return null;
  const hit = cache.get(organizationId);
  if (hit && hit.expires > Date.now() && hit.db === env.DB) return hit.value;
  const organization = await env.DB.prepare('SELECT id, name, email FROM organizations WHERE id = ?').bind(organizationId).first().catch(() => null);
  if (!organization) return null;
  const domainRow = await env.DB.prepare('SELECT domain FROM organization_domains WHERE organization_id = ? ORDER BY created_at, domain LIMIT 1').bind(organizationId).first().catch(() => null);
  const published = await loadPublishedSite(env, organizationId).catch(() => null);
  const site = published?.config || null;
  const context = await loadPublicContext(env, organization).catch(() => ({ data: null }));
  const { sentence, location } = scheduleSummary(context.data);
  const venueName = location?.name || site?.contact?.location?.name || '';
  const venueAddress = location?.address || site?.contact?.location?.address || '';
  const value = {
    name: organization.name,
    email: EMAIL_RE.test(organization.email || '') ? organization.email : '',
    domain: domainRow?.domain || '',
    siteUrl: domainRow?.domain ? `https://${domainRow.domain}` : site?.seo?.siteUrl || '',
    city: site?.starter?.city || '',
    venueName,
    venue: [venueName, venueAddress].filter(Boolean).join(', '),
    mapsUrl: location?.maps_url || site?.contact?.location?.mapsUrl || '',
    schedule: sentence,
    colors: site?.theme?.colors || null,
    social: Object.fromEntries((site?.social || []).map((s) => [s.network, s.href])),
  };
  cache.set(organizationId, { value, expires: Date.now() + CACHE_TTL_MS, db: env.DB });
  return value;
}

// Couleurs de référence des gabarits (confirmation-email.js) → nuances de la palette du club.
const COLOR_MAP = [
  ['#3a0f10', '--brand-primary-950'],
  ['#4f1414', '--brand-primary-900'],
  ['#f0a030', '--brand-accent-500'],
  ['#f4b658', '--brand-accent-400'],
  ['#f8d28e', '--brand-accent-300'],
  ['#fdf0da', '--brand-accent-100'],
  ['#fbf7ee', '--brand-neutral-100'],
  ['#f3ecd8', '--brand-neutral-200'],
];

const DEMO_MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=Stade+municipal+1+rue+du+Stade+00000+Sportville';
const DEMO_EMAIL = 'contact@clubdemo.licyo.fr';

// Paires [référence, remplacement] dans l'ordre (des expressions longues aux courtes). `html` : valeurs échappées.
function pairs(id, html) {
  const v = (s) => (html ? escapeHtml(s) : s);
  const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const list = [
    ['Club Démo · Stade municipal, 1 rue du Stade, Sportville, Club de démonstration', v(id.venue ? `${id.name} · ${id.venue}` : id.name)],
    ['Stade municipal, 1 rue du Stade, Sportville', v(id.venue || 'le lieu habituel des séances')],
    [DEMO_MAPS_URL, v(id.mapsUrl || `${id.siteUrl}/contact`)],
    ['Le jeudi, de 17h à 18h', v(id.schedule ? capital(id.schedule) : 'Selon le planning du club')],
    ['le jeudi de 17h à 18h', v(id.schedule || 'selon le planning du club')],
    ["Tenue adaptée à la météo, stabilisés ou crampons moulés, gourde d'eau", v("Tenue adaptée à la météo et gourde d'eau")],
    ['/entrainements.html', '/contact'],
    ['/entrainements', '/contact'],
    ['/assets/images/email/logo.png', '/assets/images/club/email-logo.png'],
  ];
  if (id.email) list.push([DEMO_EMAIL, v(id.email)]);
  else {
    list.push([`mailto:${DEMO_EMAIL}`, v(`${id.siteUrl}/contact`)]);
    list.push([DEMO_EMAIL, 'le club']);
  }
  // Réseaux du club (site publié) ; à défaut, le site du club.
  list.push(['https://www.instagram.com/clubdemo', v(id.social?.instagram || id.siteUrl)], ['https://www.facebook.com/clubdemo', v(id.social?.facebook || id.siteUrl)]);
  list.push(
    ['https://clubdemo.licyo.fr', v(id.siteUrl)],
    ['clubdemo.licyo.fr', v(id.domain)],
    ['Club de démonstration', v(id.city)],
    ['Club Démo', v(id.name)],
    ['Stade municipal', v(id.venueName || 'le lieu des séances')],
    ['Sportville', v(id.city)]
  );
  if (html && id.colors) {
    const vars = paletteVariables(id.colors);
    if (vars) for (const [hex, name] of COLOR_MAP) list.push([hex, vars[name]]);
  }
  return list;
}

const replaceAll = (text, list) => (typeof text === 'string' ? list.reduce((out, [from, to]) => out.split(from).join(to), text) : text);

// E-mail à envoyer avec l'identité du club. `mailFrom` : adresse d'expédition de la plateforme (MAIL_FROM), le club
// étant en réponse (Reply-To) ; sans elle, l'expéditeur des gabarits est conservé.
export function applyClubIdentity(body, id, { mailFrom = '' } = {}) {
  if (!id) return body;
  const htmlPairs = pairs(id, true);
  const textPairs = pairs(id, false);
  const next = {
    ...body,
    subject: replaceAll(body.subject, textPairs),
    htmlContent: replaceAll(body.htmlContent, htmlPairs),
    textContent: replaceAll(body.textContent, textPairs),
  };
  if (body.sender) {
    next.sender = { ...body.sender, name: replaceAll(body.sender.name, textPairs) };
    if (mailFrom) next.sender.email = mailFrom;
  }
  if (!body.replyTo && id.email && body.sender?.email !== id.email) next.replyTo = { email: id.email, name: id.name };
  return next;
}
