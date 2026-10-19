// Page d'une actualité, construite à partir de la configuration du site (site.news) et d'un article du CMS
// (phase 4D.1). Fonction PURE : l'appelant a déjà lu l'article et résolu le site. Le contenu de l'article vient
// d'un fichier éditable (CMS) : la page est rendue en échappement strict.
import { ILLUSTRATION_ICONS } from './icons.js';
import { allowKeys } from './blocks.js';

const SLUG = /^[a-z0-9-]+$/;
const ROUTE = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const INDEX_PATH = /^\/[a-z0-9-]+(\.html)?$/;

export function validateNews(news) {
  const need = (condition, message) => {
    if (!condition) throw new Error(`news : ${message}`);
  };
  need(news && typeof news === 'object', 'configuration absente');
  allowKeys(news, 'news', ['route', 'breadcrumbIndexPath', 'homeLabel', 'indexLabel', 'backLabel', 'defaultCategory', 'categories', 'scripts']);
  need(ROUTE.test(news.route || ''), `route invalide : ${news.route}`);
  need(INDEX_PATH.test(news.breadcrumbIndexPath || ''), `chemin d'index invalide : ${news.breadcrumbIndexPath}`);
  for (const key of ['homeLabel', 'indexLabel', 'backLabel']) need(typeof news[key] === 'string' && news[key].trim(), `${key} requis`);
  need(news.categories && typeof news.categories === 'object' && Object.keys(news.categories).length, 'catégories requises');
  for (const [key, category] of Object.entries(news.categories)) {
    need(SLUG.test(key), `clé de catégorie invalide : ${key}`);
    allowKeys(category, `news.categories.${key}`, ['label', 'icon']);
    need(typeof category.label === 'string' && category.label.trim(), `libellé requis (${key})`);
    need(ILLUSTRATION_ICONS[category.icon], `icône inconnue (${key}) : ${category.icon}`);
  }
  need(news.categories[news.defaultCategory], `catégorie par défaut inconnue : ${news.defaultCategory}`);
  for (const script of news.scripts || []) need(/^assets\/js\/[a-z0-9-]+\.js$/.test(script), `script refusé : ${script}`);
}

// Date « AAAA-MM-JJ » en toutes lettres, en UTC (minuit UTC ne doit pas glisser d'un jour selon le fuseau).
export function formatNewsDate(iso, locale) {
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  } catch {
    return String(iso ?? '');
  }
}

// Paragraphes du corps : séparés par une ligne vide (pas de Markdown).
const paragraphsOf = (body) =>
  String(body || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

/**
 * @param {object} site     configuration du site (avec site.news)
 * @param {object} article  { slug, title, date, category, excerpt, body, image }
 * @param {object} options  { blocks } : corps en AST v1 (article publié en base, phase 4E) à la place de `body` ;
 *                          fourni par l'appelant, jamais lu dans les données de l'article
 * @returns {object}        page prête pour renderPage()
 */
export function newsArticlePage(site, article, { blocks } = {}) {
  const news = site.news;
  validateNews(news);
  if (!SLUG.test(article?.slug || '')) throw new Error(`Slug d'article invalide : ${JSON.stringify(article?.slug)}`);
  const category = news.categories[article.category] || news.categories[news.defaultCategory];
  const siteUrl = site.seo.siteUrl;
  const route = `${news.route}/${article.slug}`;
  const canonical = `${siteUrl}${route}`;
  const image = article.image ? `${siteUrl}${article.image}` : site.seo.ogImage.url;
  const title = String(article.title ?? '');
  const excerpt = String(article.excerpt || '');
  return {
    id: 'article',
    route,
    escape: 'strict',
    seo: {
      title: `${title} — ${site.brand.name}`,
      description: excerpt,
      canonical: true,
      ogType: 'article',
      ogTitle: `${title} — ${site.brand.name}`,
      ogDescription: excerpt,
      ogImage: { url: image },
    },
    head: {
      jsonLd: [
        {
          format: 'compact',
          data: {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: news.homeLabel, item: `${siteUrl}/` },
              { '@type': 'ListItem', position: 2, name: news.indexLabel, item: `${siteUrl}${news.breadcrumbIndexPath}` },
              { '@type': 'ListItem', position: 3, name: title, item: canonical },
            ],
          },
        },
        {
          format: 'compact',
          data: {
            '@context': 'https://schema.org',
            '@type': 'NewsArticle',
            headline: title,
            datePublished: article.date,
            description: excerpt,
            image,
            url: canonical,
            publisher: {
              '@type': 'Organization',
              name: site.brand.name,
              logo: { '@type': 'ImageObject', url: `${siteUrl}/${site.brand.logo.small}` },
            },
          },
        },
      ],
    },
    scripts: news.scripts || [],
    mainLeadingBlankLine: false,
    sections: [
      { type: 'page_header', id: 'article.header', eyebrow: category.label, title, lead: [formatNewsDate(article.date, site.locale)] },
      {
        type: 'article_body',
        id: 'article.body',
        category,
        ...(article.image ? { image: article.image } : {}),
        ...(blocks !== undefined ? { blocks } : { paragraphs: paragraphsOf(article.body) }),
        excerpt,
        back: { href: news.route, label: news.backLabel },
      },
    ],
  };
}
