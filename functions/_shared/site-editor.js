// Éditeur de site de l'admin (/admin/site, 2026-10-20) : logique pure de modification du BROUILLON de la configuration
// du site (site-config.js), sans HTML.
//
// Deux cas :
//   - site de départ (sites/starter.js, clé `starter` dans la configuration) : le club modifie un profil simple
//     (nom, textes, coordonnées, couleurs) et TOUTES les pages sont reconstruites depuis ce profil ;
//   - configuration écrite à la main (club de démo) : seuls des champs sûrs sont modifiables (couleurs, accroche,
//     titres et descriptions des pages, titre et introduction du bandeau de chaque page). Un texte non modifié garde
//     ses liaisons aux données vivantes (data-org-*) ; un texte modifié devient du texte simple.
import { buildStarterSite, normalizeProfile, STARTER_FIELDS } from '../../sites/starter.js';
import { isHexColor, paletteThemeColor } from '../../renderer/palette.js';
import { saveDraftSiteConfig, publishSiteConfig, readSiteConfig } from './site-config.js';
import { clearOrganizationCache } from './organization.js';

export { STARTER_FIELDS };

// Texte simple d'un texte « en segments » (renderer/inline.js) : pour l'afficher dans un champ de formulaire.
export function segmentsText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(segmentsText).join('');
  if (typeof value !== 'object') return '';
  if (value.br) return ' ';
  for (const key of ['em', 'strong', 'nowrap']) {
    if (value[key] !== undefined) return segmentsText(Array.isArray(value[key]) ? value[key] : value[key].children);
  }
  for (const key of ['link', 'bind', 'hook']) if (value[key]) return segmentsText(value[key].children);
  return '';
}

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Bandeau (hero ou en-tête) d'une page : la première section de ce type.
const bannerOf = (page) => (page.sections || []).find((s) => s.type === 'hero' || s.type === 'page_header');

// Valeurs affichées par le formulaire d'une configuration écrite à la main.
export function customFields(config) {
  return {
    colors: config.theme?.colors || null,
    tagline: config.brand?.tagline || '',
    pages: (config.pages || [])
      .filter((p) => p.id !== config.notFoundPage)
      .map((page) => {
        const banner = bannerOf(page);
        return {
          id: page.id,
          route: page.route,
          seoTitle: page.seo?.title || '',
          seoDescription: page.seo?.description || '',
          bannerTitle: banner ? segmentsText(banner.title) : null,
          bannerLead: banner ? segmentsText(banner.lead) : null,
        };
      }),
  };
}

export class SiteEditError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SiteEditError';
  }
}

function readColors(form, current) {
  const primary = String(form.get('primary') || '').toLowerCase();
  const accent = String(form.get('accent') || '').toLowerCase();
  if (!primary && !accent) return current;
  if (!isHexColor(primary) || !isHexColor(accent)) throw new SiteEditError('Couleurs : choisissez deux couleurs valides.');
  return { primary, accent };
}

// Nouvelle configuration (copie) d'après le formulaire. `form` : FormData (ou objet avec get()).
export function applyEdits(config, form, { organizationId, slug, siteUrl }) {
  if (config?.starter) {
    const input = {};
    for (const key of Object.keys(STARTER_FIELDS)) input[key] = form.get(key) ?? config.starter[key];
    input.colors = readColors(form, config.starter.colors);
    for (const key of ['name', 'sportLabel', 'city']) if (!clean(input[key], 100)) throw new SiteEditError(`${STARTER_FIELDS[key].label} : champ requis.`);
    return buildStarterSite({ organizationId, slug: config.id || slug, siteUrl: config.seo?.siteUrl || siteUrl, profile: normalizeProfile(input) });
  }
  const next = structuredClone(config);
  const colors = readColors(form, next.theme?.colors);
  if (colors) {
    next.theme.colors = colors;
    next.brand.themeColor = paletteThemeColor(colors) || next.brand.themeColor;
  }
  const tagline = form.get('tagline');
  if (tagline !== null && clean(tagline, 80) !== next.brand.tagline) next.brand.tagline = clean(tagline, 80) || next.brand.tagline;
  for (const page of next.pages || []) {
    if (page.id === next.notFoundPage) continue;
    const field = (name) => form.get(`${name}:${page.id}`);
    const title = field('seoTitle');
    if (title !== null && clean(title, 120) && clean(title, 120) !== page.seo.title) {
      page.seo.title = clean(title, 120);
      if (page.seo.ogTitle !== undefined) page.seo.ogTitle = page.seo.title;
    }
    const description = field('seoDescription');
    if (description !== null && clean(description, 300) !== (page.seo.description || '')) {
      if (clean(description, 300)) {
        page.seo.description = clean(description, 300);
        if (page.seo.ogDescription !== undefined) page.seo.ogDescription = page.seo.description;
      }
    }
    const banner = bannerOf(page);
    if (!banner) continue;
    const bannerTitle = field('bannerTitle');
    if (bannerTitle !== null && clean(bannerTitle, 120) && clean(bannerTitle, 120) !== segmentsText(banner.title)) {
      banner.title = banner.type === 'hero' ? [clean(bannerTitle, 120)] : clean(bannerTitle, 120);
    }
    const bannerLead = field('bannerLead');
    if (bannerLead !== null && clean(bannerLead, 400) && clean(bannerLead, 400) !== segmentsText(banner.lead)) {
      banner.lead = [clean(bannerLead, 400)];
    }
  }
  return next;
}

// Coordonnées publiques du profil recopiées dans l'organisation : ce sont elles que le site affiche (page-data.js) et
// que le formulaire de contact utilise. Champ vide = valeur effacée.
export async function syncOrganizationContact(env, organizationId, profile) {
  const email = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(profile.email || '') ? profile.email : null;
  const phone = String(profile.phone || '').replace(/[^\d+ .]/g, '').trim() || null;
  await env.DB.prepare("UPDATE organizations SET email = ?, phone = ?, name = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(email, phone, profile.name, organizationId)
    .run();
  clearOrganizationCache();
}

// Crée le site de départ d'un nouveau club et le publie (console plateforme). Rien n'est fait si le club a déjà une
// configuration (jamais d'écrasement).
export async function createStarterSite(env, { organizationId, slug, domain, profile }) {
  if (await readSiteConfig(env, organizationId)) return false;
  const normalized = normalizeProfile(profile);
  const config = buildStarterSite({ organizationId, slug, siteUrl: `https://${domain}`, profile: normalized });
  await syncOrganizationContact(env, organizationId, normalized);
  const saved = await saveDraftSiteConfig(env, organizationId, config, { expectedRevision: 0 });
  await publishSiteConfig(env, organizationId, { expectedRevision: saved.draftRevision });
  return true;
}
