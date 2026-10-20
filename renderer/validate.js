// Validation d'une configuration de site (SiteConfig) : échec fermé. Une configuration invalide lève une erreur
// qui liste tous les problèmes ; aucune page n'est alors produite.
//
// schemaVersion 2 (phase 4D.2A) : la section « fragment » (HTML versionné dans le code) et `trust` ont disparu,
// chaque section porte un identifiant stable, la configuration doit être un pur document JSON (objets simples,
// tableaux, chaînes, nombres, booléens) et respecter des bornes de taille. Une configuration v1 est refusée.
import { escapeText, safeAbsoluteUrl, safeAssetPath, safeHref } from './html.js';
import { SECTIONS } from './sections.js';
import { SOCIAL_ICONS } from './icons.js';
import { validateNews } from './news.js';
import { strings } from './i18n.js';
import { allowKeys } from './blocks.js';
import { isHexColor } from './palette.js';
import { renderInline } from './inline.js';

export const SCHEMA_VERSION = 2;

// Thèmes connus du moteur : seul dynamic_diagonal v1 existe (phase 4C). La feuille publique est celle générée
// par scripts/build-css.mjs.
export const THEMES = Object.freeze({ dynamic_diagonal: { versions: [1], stylesheet: 'assets/css/styles.css' } });

// Bornes d'une configuration (préparation d'une configuration SaaS non fiable, phase 4D.2B).
export const LIMITS = Object.freeze({ string: 6000, array: 200, depth: 24, nodes: 60000, chars: 1500000, pages: 50, sections: 40 });

const ROUTE = /^\/([a-z0-9-]+(\/[a-z0-9-]+)*)?$/;
const FILE = /^[a-z0-9-]+\.html$/;
const ID = /^[a-z0-9_-]+$/;
const SECTION_ID = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

const need = (condition, message) => {
  if (!condition) throw new Error(message);
};

// Document JSON pur et borné : pas de fonction, de classe, d'expression régulière, de date, de valeur non finie.
export function checkLimits(value) {
  let nodes = 0;
  let chars = 0;
  const walk = (v, path, depth) => {
    need(depth <= LIMITS.depth, `${path} : imbrication trop profonde`);
    need(++nodes <= LIMITS.nodes, 'configuration trop volumineuse (nombre de valeurs)');
    if ((typeof v === 'object' && v !== null) || typeof v === 'function') {
      for (const key of Object.getOwnPropertySymbols(v)) need(false, `${path} : propriété Symbol refusée (${String(key)})`);
    }
    if (typeof v === 'string') {
      need(v.length <= LIMITS.string, `${path} : texte trop long (${v.length} > ${LIMITS.string})`);
      chars += v.length;
      need(chars <= LIMITS.chars, 'configuration trop volumineuse (texte)');
      return;
    }
    if (typeof v === 'boolean') return;
    if (typeof v === 'number') return need(Number.isFinite(v), `${path} : nombre non fini`);
    if (Array.isArray(v)) {
      need(v.length <= LIMITS.array, `${path} : trop d'éléments (${v.length} > ${LIMITS.array})`);
      v.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    need(v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v)), `${path} : valeur non sérialisable en JSON (${v === null ? 'null' : typeof v})`);
    for (const [key, item] of Object.entries(v)) {
      need(item !== undefined, `${path}.${key} : valeur indéfinie`);
      walk(item, `${path}.${key}`, depth + 1);
    }
  };
  walk(value, 'site', 0);
}

// Contexte de validation : mêmes fonctions que le rendu, sans aucune donnée d'exécution.
const validationContext = (site) => ({ site, base: '', mode: 'markers', strict: false, text: escapeText, strings: strings(site.locale), assetVersions: {} });

export function validateSite(site) {
  const errors = [];
  const check = (fn, where) => {
    try {
      fn();
    } catch (error) {
      errors.push(`${where} : ${error.message}`);
    }
  };

  check(() => need(site && typeof site === 'object', 'configuration absente'), 'site');
  if (errors.length) throw new Error(`Configuration de site invalide :\n- ${errors.join('\n- ')}`);

  check(() => need(site.schemaVersion === SCHEMA_VERSION, `schemaVersion ${site.schemaVersion} inconnue (attendue : ${SCHEMA_VERSION})`), 'schemaVersion');
  check(() => checkLimits(site), 'limites');
  check(() => allowKeys(site, 'site', ['schemaVersion', 'id', 'locale', 'theme', 'brand', 'seo', 'contact', 'navigation', 'social', 'footer', 'notFoundPage', 'pages'], ['organizationId', 'news', 'starter']), 'site');
  // Profil du site de départ (sites/starter.js), conservé pour l'éditeur de l'admin : ignoré au rendu.
  if (site.starter !== undefined) check(() => need(site.starter && typeof site.starter === 'object' && !Array.isArray(site.starter) && Number.isInteger(site.starter.version), 'starter : profil attendu'), 'starter');
  check(() => need(typeof site.id === 'string' && ID.test(site.id), 'identifiant requis'), 'id');
  let localeOk = true;
  check(() => {
    localeOk = false;
    strings(site.locale);
    localeOk = true;
  }, 'locale');
  check(() => {
    allowKeys(site.theme, 'theme', ['id', 'version', 'stylesheet', 'palette', 'preloadFonts'], ['colors']);
    if (site.theme.colors !== undefined) {
      allowKeys(site.theme.colors, 'theme.colors', ['primary', 'accent']);
      need(isHexColor(site.theme.colors.primary) && isHexColor(site.theme.colors.accent), 'theme.colors : couleurs #rrggbb attendues');
    }
    const theme = THEMES[site.theme?.id];
    need(theme, `thème inconnu : ${site.theme?.id}`);
    need(theme.versions.includes(site.theme.version), `version de thème inconnue : ${site.theme.version}`);
    need(site.theme.stylesheet === theme.stylesheet, 'feuille de style du thème inattendue');
    need(typeof site.theme.palette === 'string' && ID.test(site.theme.palette), 'palette requise');
    for (const font of site.theme.preloadFonts || []) safeAssetPath(font);
  }, 'theme');
  check(() => {
    const b = site.brand;
    allowKeys(b, 'brand', ['name', 'shortName', 'tagline', 'logo', 'favicon', 'appleTouchIcon', 'manifest', 'themeColor']);
    allowKeys(b.logo, 'brand.logo', ['small', 'large', 'alt']);
    need(b?.name && b.shortName && b.tagline !== undefined, 'nom, nom court et accroche requis');
    for (const path of [b.logo.small, b.logo.large, b.favicon, b.appleTouchIcon, b.manifest]) safeAssetPath(path);
    need(b.logo.alt, 'texte alternatif du logo requis');
    need(/^#[0-9a-f]{6}$/i.test(b.themeColor), 'couleur de thème (#rrggbb) requise');
  }, 'brand');
  check(() => {
    const s = site.seo;
    allowKeys(s, 'seo', ['siteUrl', 'robots', 'ogLocale', 'twitterCard', 'ogImage']);
    allowKeys(s.ogImage, 'seo.ogImage', ['url', 'width', 'height']);
    safeAbsoluteUrl(s.siteUrl);
    need(!s.siteUrl.endsWith('/'), 'siteUrl sans « / » final');
    safeAbsoluteUrl(s.ogImage.url);
    need(s.robots && s.ogLocale && s.twitterCard, 'robots, ogLocale et twitterCard requis');
  }, 'seo');
  check(() => {
    allowKeys(site.contact, 'contact', ['location', 'email', 'phone']);
    allowKeys(site.contact.location, 'contact.location', ['short', 'href', 'name', 'address', 'embedUrl', 'mapsUrl', 'mapTitle']);
    allowKeys(site.contact.phone, 'contact.phone', ['display', 'tel']);
  }, 'contact');
  check(() => {
    allowKeys(site.navigation, 'navigation', ['items', 'cta']);
    need(Array.isArray(site.navigation?.items) && site.navigation.items.length, 'navigation requise');
    for (const item of site.navigation.items) {
      allowKeys(item, 'navigation.item', ['label', 'href']);
      need(item.label, 'libellé de navigation requis');
      safeHref(item.href);
    }
    allowKeys(site.navigation.cta, 'navigation.cta', ['label', 'href'], ['statusHook']);
    need(site.navigation.cta?.label, 'bouton principal requis');
    safeHref(site.navigation.cta.href);
  }, 'navigation');
  check(() => {
    for (const link of site.social || []) {
      allowKeys(link, 'social.item', ['network', 'href']);
      need(SOCIAL_ICONS[link.network], `réseau inconnu : ${link.network}`);
      safeHref(link.href);
    }
  }, 'social');
  if (site.news !== undefined) check(() => validateNews(site.news), 'news');
  check(() => {
    allowKeys(site.footer, 'footer', ['about', 'navigationTitle', 'practical', 'bottom']);
    allowKeys(site.footer.practical, 'footer.practical', ['title', 'items']);
    need(site.footer.about && site.footer.practical.items && Array.isArray(site.footer.bottom), 'footer incomplet');
    const ctx = validationContext(site);
    renderInline(site.footer.about, ctx);
    for (const line of site.footer.bottom) {
      allowKeys(line, 'footer.bottom.item', ['content'], ['minimal']);
      renderInline(line.content, ctx);
    }
  }, 'footer');

  const pages = Array.isArray(site.pages) ? site.pages : [];
  check(() => need(pages.length && pages.length <= LIMITS.pages, `1 à ${LIMITS.pages} pages requises`), 'pages');
  const seen = { id: new Set(), route: new Set(), file: new Set(), section: new Set() };
  // Pages validées même si d'autres erreurs existent (toutes les erreurs sont listées), sauf langue inconnue.
  if (localeOk) for (const page of pages) errors.push(...pageErrors(page, { site, seen }));
  check(() => need(pages.some((p) => p.id === site.notFoundPage), `page 404 introuvable : ${site.notFoundPage}`), 'notFoundPage');

  if (errors.length) throw new Error(`Configuration de site invalide :\n- ${errors.join('\n- ')}`);
  return site;
}

// Erreurs d'une page (configurée ou construite à l'exécution). `seen` détecte les identifiants de page et de
// section, routes et fichiers en double entre les pages d'un même site.
function pageErrors(page, { site, seen }) {
  const errors = [];
  const check = (fn, where) => {
    try {
      fn();
    } catch (error) {
      errors.push(`${where} : ${error.message}`);
    }
  };
  const where = `page ${page?.id}`;
  check(() => {
    need(page && typeof page === 'object', 'page absente');
    allowKeys(page, 'page', ['id', 'route', 'seo', 'sections'], ['file', 'head', 'scripts', 'lightbox', 'footer', 'mainLeadingBlankLine', 'escape']);
    need(ID.test(page.id || ''), 'identifiant requis');
    need(ROUTE.test(page.route || ''), `route invalide : ${page.route}`);
    if (page.file !== undefined) need(FILE.test(page.file), `fichier invalide : ${page.file}`);
    for (const [key, value] of [['id', page.id], ['route', page.route], ['file', page.file]]) {
      if (value === undefined || !seen) continue;
      need(!seen[key].has(value), `${key} en double : ${value}`);
      seen[key].add(value);
    }
    if (page.escape !== undefined) need(page.escape === 'strict', `échappement inconnu : ${page.escape}`);
    allowKeys(page.seo, 'page.seo', ['title'], ['description', 'canonical', 'ogTitle', 'ogDescription', 'ogType', 'ogImage', 'robots']);
    need(page.seo?.title, 'titre SEO requis');
    if (page.seo.canonical) need(page.seo.ogTitle && page.seo.ogDescription, 'titre et description Open Graph requis avec canonical');
    if (page.seo.ogType !== undefined) need(['website', 'article'].includes(page.seo.ogType), `og:type inconnu : ${page.seo.ogType}`);
    if (page.seo.ogImage !== undefined) {
      allowKeys(page.seo.ogImage, 'page.seo.ogImage', ['url'], ['width', 'height']);
      safeAbsoluteUrl(page.seo.ogImage.url);
    }
    need(['full', 'minimal'].includes(page.footer || 'full'), `footer inconnu : ${page.footer}`);
    if (page.mainLeadingBlankLine !== undefined) need(typeof page.mainLeadingBlankLine === 'boolean', 'mainLeadingBlankLine booléen');
    for (const script of page.scripts || []) need(/^assets\/js\/[a-z0-9-]+\.js$/.test(script), `script refusé : ${script}`);
    if (page.head !== undefined) allowKeys(page.head, 'page.head', [], ['preloadImages', 'jsonLd']);
    for (const image of page.head?.preloadImages || []) {
      allowKeys(image, 'page.head.preloadImage', ['href'], ['fetchpriority']);
      safeAssetPath(image.href);
    }
    for (const block of page.head?.jsonLd || []) {
      allowKeys(block, 'page.head.jsonLd', ['data'], ['binding', 'format']);
      need(block.data && typeof block.data === 'object', 'JSON-LD : objet requis');
      if (block.format !== undefined) need(block.format === 'compact', `format JSON-LD inconnu : ${block.format}`);
    }
    need(Array.isArray(page.sections) && page.sections.length && page.sections.length <= LIMITS.sections, `1 à ${LIMITS.sections} sections requises`);
  }, where);
  const vctx = validationContext(site);
  for (const [index, section] of (Array.isArray(page?.sections) ? page.sections : []).entries()) {
    check(() => {
      const type = SECTIONS[section?.type];
      need(type, `type de section inconnu : ${section?.type}`);
      need(typeof section.id === 'string' && SECTION_ID.test(section.id), `identifiant de section invalide : ${section.id} (ex. « home.hero »)`);
      if (seen) {
        need(!seen.section.has(section.id), `identifiant de section en double : ${section.id}`);
        seen.section.add(section.id);
      }
      if (section.comment !== undefined) need(typeof section.comment === 'string' && /^[\p{L}\p{N} ,.'/()·:&-]+$/u.test(section.comment) && !section.comment.includes('--') && !section.comment.endsWith('-'), 'commentaire invalide');
      type.validate(section, { site, ctx: vctx });
      // Rendu à blanc : tout ce que le rendu refuserait (segment, liaison, URL) est une erreur de validation.
      type.render(section, vctx);
    }, `${where}, section ${section?.id ?? index}`);
  }
  return errors;
}

// Page construite à l'exécution (hors configuration) : mêmes règles qu'une page configurée.
export function validatePage(page, { site } = {}) {
  const errors = [];
  try {
    checkLimits(page);
  } catch (error) {
    errors.push(`limites : ${error.message}`);
  }
  errors.push(...pageErrors(page, { site }));
  if (errors.length) throw new Error(`Page invalide :\n- ${errors.join('\n- ')}`);
  return page;
}
