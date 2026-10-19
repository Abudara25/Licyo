// Gabarits communs d'une page publique : <head> (SEO global + SEO de page), header et navigation, footer
// (complet ou réduit), visionneuse, scripts. Le balisage et les classes sont ceux du thème dynamic_diagonal v1 ;
// tout le contenu vient de la configuration du site, échappé selon son contexte.
import { escapeAttr, escapeText, jsonLd, jsonLdCompact, safeAbsoluteUrl, safeAssetPath, safeHref } from './html.js';
import { bindAttrs, renderInline } from './inline.js';
import { SOCIAL_ICONS } from './icons.js';

const CODE_ASSET = /^assets\/(css|js)\/[A-Za-z0-9_.-]+\.(css|js)$/;

// Chemin d'un asset public selon la base de la page (« » pour les pages à la racine, « / » pour les autres).
export const assetUrl = (ctx, path) => `${ctx.base}${safeAssetPath(path)}`;

// Feuille de style ou script avec son empreinte (?v=), fournie par l'appelant (le moteur ne lit aucun fichier).
export function versionedAsset(ctx, path) {
  if (!CODE_ASSET.test(path)) throw new Error(`Asset de code refusé : ${path}`);
  const version = ctx.assetVersions[path];
  if (!version || !/^[0-9a-f]{6,64}$/.test(version)) throw new Error(`Empreinte manquante pour ${path}`);
  return `${ctx.base}${path}?v=${version}`;
}

const pageUrl = (site, route) => safeAbsoluteUrl(`${site.seo.siteUrl}${route}`);

export function renderHead(ctx) {
  const { site, page } = ctx;
  const seo = page.seo;
  // Échappement strict (ctx.strict) pour une page dont le contenu vient d'un fichier éditable (actualités).
  const text = ctx.text;
  const attrValue = ctx.strict ? ctx.text : escapeAttr;
  const lines = ['<meta charset="UTF-8">', '<meta name="viewport" content="width=device-width, initial-scale=1.0">', `<title>${text(seo.title)}</title>`];
  if (seo.description !== undefined) lines.push(`<meta name="description" content="${attrValue(seo.description)}">`);
  lines.push(`<meta name="robots" content="${escapeAttr(seo.robots || site.seo.robots)}">`);
  if (seo.canonical) {
    const url = pageUrl(site, page.route);
    lines.push(`<link rel="canonical" href="${escapeAttr(url)}">`);
    // Image Open Graph : celle de la page (dimensions facultatives) ou celle du site.
    const image = seo.ogImage || site.seo.ogImage;
    lines.push(
      `<meta property="og:type" content="${escapeAttr(seo.ogType || 'website')}">`,
      `<meta property="og:title" content="${attrValue(seo.ogTitle)}">`,
      `<meta property="og:description" content="${attrValue(seo.ogDescription)}">`,
      `<meta property="og:image" content="${escapeAttr(safeAbsoluteUrl(image.url))}">`,
      ...(image.width ? [`<meta property="og:image:width" content="${escapeAttr(image.width)}">`, `<meta property="og:image:height" content="${escapeAttr(image.height)}">`] : []),
      `<meta property="og:locale" content="${escapeAttr(site.seo.ogLocale)}">`,
      `<meta property="og:url" content="${escapeAttr(url)}">`,
      `<meta name="twitter:card" content="${escapeAttr(site.seo.twitterCard)}">`,
      `<meta name="twitter:image" content="${escapeAttr(safeAbsoluteUrl(image.url))}">`
    );
  }
  const brand = site.brand;
  lines.push(
    `<link rel="icon" href="${escapeAttr(assetUrl(ctx, brand.favicon))}">`,
    `<link rel="manifest" href="${escapeAttr(assetUrl(ctx, brand.manifest))}">`,
    `<link rel="apple-touch-icon" href="${escapeAttr(assetUrl(ctx, brand.appleTouchIcon))}">`,
    `<meta name="theme-color" content="${escapeAttr(brand.themeColor)}">`,
    '<meta name="mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-capable" content="yes">',
    `<meta name="apple-mobile-web-app-title" content="${escapeAttr(brand.name)}">`
  );
  for (const font of site.theme.preloadFonts) lines.push(`<link rel="preload" href="${escapeAttr(assetUrl(ctx, font))}" as="font" type="font/woff2" crossorigin>`);
  for (const image of page.head?.preloadImages || []) {
    lines.push(`<link rel="preload" href="${escapeAttr(assetUrl(ctx, image.href))}" as="image"${image.fetchpriority ? ` fetchpriority="${escapeAttr(image.fetchpriority)}"` : ''}>`);
  }
  lines.push(`<link rel="stylesheet" href="${escapeAttr(versionedAsset(ctx, site.theme.stylesheet))}">`);
  for (const block of page.head?.jsonLd || []) {
    const binding = block.binding && ctx.mode === 'markers' ? bindAttrs([['data-org-jsonld', block.binding]]) : '';
    lines.push(
      block.format === 'compact'
        ? `<script type="application/ld+json"${binding}>${jsonLdCompact(block.data)}</script>`
        : `<script type="application/ld+json"${binding}>\n${jsonLd(block.data)}\n</script>`
    );
  }
  return `<head>\n${lines.join('\n')}\n</head>`;
}

function navLinks(site, indent) {
  return site.navigation.items.map((item) => `${indent}<li><a href="${escapeAttr(safeHref(item.href))}">${escapeText(item.label)}</a></li>`).join('\n');
}

// Bouton principal de la navigation. `statusHook` : classe lue par assets/js/main.js pour refléter la
// fermeture des inscriptions (comportement générique « ouvert / fermé »).
function ctaClass(cta, base) {
  return `${base}${cta.statusHook ? ' adhesion-cta' : ''}`;
}

export function renderHeader(ctx) {
  const { site } = ctx;
  const { brand, navigation } = site;
  const cta = navigation.cta;
  const ctaHtml = (classes) => `<a href="${escapeAttr(safeHref(cta.href))}" class="${ctaClass(cta, classes)}">${escapeText(cta.label)}</a>`;
  return `<header class="site-header">
  <div class="container">
    <a href="/" class="brand">
      <img src="${escapeAttr(assetUrl(ctx, brand.logo.small))}" alt="${escapeAttr(brand.logo.alt)}" width="48" height="48">
      <span class="brand-name"><strong>${escapeText(brand.name)}</strong><span>${escapeText(brand.tagline)}</span></span>
    </a>
    <nav class="main-nav" id="main-nav" aria-label="${escapeAttr(ctx.strings.mainNav)}">
      <ul>
${navLinks(site, '        ')}
      </ul>
      ${ctaHtml('btn btn-primary btn-sm nav-cta')}
    </nav>
    <div class="header-actions">
      ${ctaHtml('btn btn-primary btn-sm')}
      <button class="burger" aria-label="${escapeAttr(ctx.strings.openMenu)}" aria-expanded="false" aria-controls="main-nav">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</header>`;
}

function footerBottom(ctx, variant) {
  const lines = ctx.site.footer.bottom.filter((line) => variant === 'full' || line.minimal);
  return `    <div class="footer-bottom">
${lines.map((line) => `      <p>${renderInline(line.content, ctx)}</p>`).join('\n')}
    </div>`;
}

// Coordonnées publiques du site (site.contact) → liens du footer, avec les clés standard du contrat de données
// publiques (functions/_shared/page-data.js) : la valeur écrite est la valeur de secours, remplacée à l'exécution
// par celle de l'organisation en base.
export function contactItems(site, keys) {
  const c = site.contact;
  const build = {
    location: () => ({ bind: [['data-org-if', 'location.short']], link: { href: c.location.href, bind: [['data-org', 'location.short']], children: [c.location.short] } }),
    email: () => ({
      bind: [['data-org-if', 'org.email']],
      link: { href: `mailto:${c.email}`, bind: [['data-org', 'org.email'], ['data-org-attr', 'href:org.mailto']], children: [c.email] },
    }),
    phone: () => ({
      bind: [['data-org-if', 'org.phone']],
      link: { href: `tel:${c.phone.tel}`, bind: [['data-org', 'org.phone'], ['data-org-attr', 'href:org.tel']], children: [c.phone.display] },
    }),
  };
  return keys.map((key) => {
    if (!build[key]) throw new Error(`Coordonnée inconnue : ${key}`);
    return build[key]();
  });
}

export function renderFooter(ctx, variant = 'full') {
  const { site } = ctx;
  if (variant === 'minimal') {
    return `<footer class="site-footer">
  <div class="container">
${footerBottom(ctx, 'minimal')}
  </div>
</footer>`;
  }
  if (variant !== 'full') throw new Error(`Variante de footer inconnue : ${variant}`);
  const { footer, brand } = site;
  const social = site.social
    .map((link) => {
      const icon = SOCIAL_ICONS[link.network];
      if (!icon) throw new Error(`Réseau social inconnu : ${link.network}`);
      return `          <a href="${escapeAttr(safeHref(link.href))}" aria-label="${escapeAttr(icon.label)}" target="_blank" rel="noopener">${icon.svg}</a>`;
    })
    .join('\n');
  const practical = contactItems(site, footer.practical.items)
    .map((item) => `          <li${ctx.mode === 'markers' ? bindAttrs(item.bind) : (bindAttrs(item.bind), '')}>${renderInline([{ link: item.link }], ctx)}</li>`)
    .join('\n');
  return `<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <div class="footer-brand">
          <img src="${escapeAttr(assetUrl(ctx, brand.logo.small))}" alt="">
          <strong>${escapeText(brand.name)}</strong>
        </div>
        <p>${renderInline(footer.about, ctx)}</p>
        <div class="social-row">
${social}
        </div>
      </div>
      <div>
        <h3>${escapeText(footer.navigationTitle)}</h3>
        <ul>
${navLinks(site, '          ')}
        </ul>
      </div>
      <div>
        <h3>${escapeText(footer.practical.title)}</h3>
        <ul>
${practical}
        </ul>
      </div>
    </div>
${footerBottom(ctx, 'full')}
  </div>
</footer>`;
}

// Visionneuse d'article (assets/js/main.js) : balisage fixe, sans contenu de configuration.
export function renderLightbox(ctx) {
  return `<div class="lightbox" id="article-lightbox" aria-hidden="true">
  <div class="lightbox-backdrop" data-lightbox-close></div>
  <div class="lightbox-panel" role="dialog" aria-modal="true">
    <button class="lightbox-close" aria-label="${escapeAttr(ctx.strings.close)}" data-lightbox-close>&times;</button>
    <div class="lightbox-media"></div>
    <div class="lightbox-body">
      <span class="card-date lightbox-date"></span>
      <h3 class="lightbox-title"></h3>
      <p class="lightbox-text"></p>
    </div>
  </div>
</div>`;
}

export function renderScripts(ctx) {
  return (ctx.page.scripts || []).map((path) => `<script src="${escapeAttr(versionedAsset(ctx, path))}"></script>`).join('\n');
}
