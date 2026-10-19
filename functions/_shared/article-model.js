// Modèle Article des Actualités CRM (phase 4E.1, contrat 4E v3.1 §18 à §21 et §24). Module PUR : ni D1, ni réseau.
//
// - validateArticle : validateur UNIQUE (CREATE, SAVE, aperçu, PUBLISH, import, audit, tests). Aucune autre voie
//   d'écriture. Sérialisation canonique de draft_json (clés dans l'ordre v1).
// - Identifiants générés EXCLUSIVEMENT côté serveur : newArticleId(), newImportBatchId() ; jamais repris d'une entrée.
// - Chaîne Markdown unique (aperçu, publication, audit) :
//     content → markdown-it (restreint) → jetons → convertisseur en liste blanche → AST → validation → moteur existant
//   Tout jeton hors liste blanche fait ÉCHOUER la conversion (rien n'est ignoré silencieusement).
// - legacyBodyToMarkdown : conversion normative des corps historiques (content/articles.json), dont le rendu reste
//   identique octet pour octet à celui de renderer/news.js.
import MarkdownIt from 'markdown-it';
import { safeHref } from '../../renderer/html.js';

// ---------------------------------------------------------------------------------------------------------------
// Erreurs

export class ArticleValidationError extends Error {
  constructor(errors) {
    const list = [].concat(errors);
    super(`Article invalide : ${list.join(' ; ')}`);
    this.name = 'ArticleValidationError';
    this.status = 422;
    this.errors = list;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Identifiants (§19) : préfixe de 4 caractères + 32 caractères hexadécimaux minuscules (UUID v4 sans tirets).

const ARTICLE_ID = /^art_[0-9a-f]{32}$/;
const IMPORT_BATCH_ID = /^imp_[0-9a-f]{32}$/;
export const newArticleId = () => `art_${crypto.randomUUID().replaceAll('-', '')}`;
export const newImportBatchId = () => `imp_${crypto.randomUUID().replaceAll('-', '')}`;
export const isArticleId = (value) => typeof value === 'string' && ARTICLE_ID.test(value);
export const isImportBatchId = (value) => typeof value === 'string' && IMPORT_BATCH_ID.test(value);

// ---------------------------------------------------------------------------------------------------------------
// Slug (même règle que la CHECK SQL) : 1 à 100 caractères, minuscules, chiffres, tirets simples internes.

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isArticleSlug = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 100 && SLUG.test(value);

// Slug proposé à la création, dérivé du titre (accents retirés). Chaîne vide si rien d'utilisable.
export function slugFromTitle(title) {
  const base = String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.slice(0, 100).replace(/-+$/g, '');
}

// ---------------------------------------------------------------------------------------------------------------
// Chaîne Markdown (§20)

// Configuration normative. linkify et typographer désactivés : les règles `linkify` et `smartquotes` (avis
// GHSA-38c4-r59v-3vqw et GHSA-6v5v-wf23-fmfq de markdown-it 14.1.0) ne s'exécutent jamais.
export const MARKDOWN_OPTIONS = Object.freeze({ html: false, linkify: false, typographer: false, maxNesting: 20 });
export const MARKDOWN_DISABLED_RULES = Object.freeze(['image', 'html_block', 'html_inline', 'fence', 'code', 'backticks', 'reference', 'autolink', 'lheading', 'hr', 'blockquote']);
const markdown = new MarkdownIt('commonmark', { ...MARKDOWN_OPTIONS }).disable([...MARKDOWN_DISABLED_RULES]);

export const MAX_AST_NODES = 5000;
const MAX_LINK_LENGTH = 2048;

export class MarkdownError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MarkdownError';
  }
}

// Lien admis : http:, https:, mailto:, ou chemin commençant par un seul « / ». Refusés : identifiants dans l'URL,
// javascript:, data:, vbscript:, plus de 2 048 caractères. Le lien doit aussi passer safeHref (rendu).
function checkLink(href) {
  if (typeof href !== 'string' || !href || href.length > MAX_LINK_LENGTH) throw new MarkdownError('lien refusé (vide ou trop long)');
  if (href.startsWith('/')) {
    if (href.startsWith('//')) throw new MarkdownError(`lien refusé : ${href}`);
  } else {
    let url;
    try {
      url = new URL(href);
    } catch {
      throw new MarkdownError(`lien refusé : ${href}`);
    }
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new MarkdownError(`protocole refusé : ${url.protocol}`);
    if (url.username || url.password) throw new MarkdownError('lien refusé : identifiants dans l’URL');
  }
  try {
    safeHref(href);
  } catch {
    throw new MarkdownError(`lien refusé : ${href}`);
  }
  return href;
}

// Convertisseur des jetons « inline » en nœuds de l'AST v1 (liste blanche).
function inlineNodes(tokens, counter) {
  const root = { children: [], kind: 'root' };
  const stack = [root];
  const push = (node) => {
    if (++counter.n > MAX_AST_NODES) throw new MarkdownError(`contenu trop complexe (plus de ${MAX_AST_NODES} nœuds)`);
    const parent = stack[stack.length - 1];
    const last = parent.children[parent.children.length - 1];
    if (node.type === 'text' && last?.type === 'text') {
      last.value += node.value; // textes adjacents fusionnés (même rendu)
      counter.n--;
      return;
    }
    parent.children.push(node);
  };
  const open = (type, extra = {}) => {
    // maxNesting ne borne pas l'emphase (paires équilibrées après coup) : borne explicite, même valeur.
    if (stack.length > MARKDOWN_OPTIONS.maxNesting) throw new MarkdownError(`imbrication trop profonde (plus de ${MARKDOWN_OPTIONS.maxNesting} niveaux)`);
    const node = { type, ...extra, children: [] };
    push(node);
    stack.push(node);
  };
  const close = (type) => {
    const node = stack.pop();
    if (!node || node.type !== type) throw new MarkdownError(`structure inattendue (${type})`);
  };
  const inLink = () => stack.some((n) => n.type === 'link');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'text':
        if (t.content) push({ type: 'text', value: t.content });
        break;
      case 'softbreak':
        push({ type: 'soft' });
        break;
      case 'hardbreak':
        if (inLink()) throw new MarkdownError('saut de ligne forcé interdit dans un lien');
        push({ type: 'br' });
        break;
      case 'strong_open':
        open('strong');
        break;
      case 'strong_close':
        close('strong');
        break;
      case 'em_open':
        open('em');
        break;
      case 'em_close':
        close('em');
        break;
      case 'link_open': {
        if (inLink()) throw new MarkdownError('lien imbriqué interdit');
        const attrs = t.attrs || [];
        if (attrs.length !== 1 || attrs[0][0] !== 'href') throw new MarkdownError('lien : attribut non autorisé (titre de lien interdit)');
        // Règle `image` désactivée : « ![texte](url) » deviendrait « ! » suivi d'un lien. Refus explicite.
        const previous = tokens[i - 1];
        if (previous?.type === 'text' && previous.content.endsWith('!')) throw new MarkdownError('images Markdown interdites');
        open('link', { href: checkLink(attrs[0][1]) });
        break;
      }
      case 'link_close':
        close('link');
        break;
      default:
        throw new MarkdownError(`élément Markdown non autorisé : ${t.type}`);
    }
  }
  if (stack.length !== 1) throw new MarkdownError('structure inattendue (élément non fermé)');
  return root.children;
}

// Markdown → AST v1 (tableau de blocs). Lève MarkdownError au premier jeton hors liste blanche.
//   blocs : { type: 'p', children } | { type: 'h', level: 2|3, children } | { type: 'ul'|'ol', items: [children] }
//   en ligne : { type: 'text', value } | { type: 'soft' } | { type: 'br' } | { type: 'strong'|'em', children }
//              | { type: 'link', href, children }
export function markdownToAst(content) {
  if (typeof content !== 'string') throw new MarkdownError('contenu : texte attendu');
  let tokens;
  try {
    tokens = markdown.parse(content, {});
  } catch (error) {
    throw new MarkdownError(`contenu illisible (${error?.message || 'erreur'})`);
  }
  const counter = { n: 0 };
  const count = () => {
    if (++counter.n > MAX_AST_NODES) throw new MarkdownError(`contenu trop complexe (plus de ${MAX_AST_NODES} nœuds)`);
  };
  const blocks = [];
  let i = 0;
  const expect = (type) => {
    const t = tokens[i++];
    if (!t || t.type !== type) throw new MarkdownError(`structure non autorisée : ${t ? t.type : 'fin'} au lieu de ${type}`);
    return t;
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.type === 'paragraph_open') {
      i++;
      const inline = expect('inline');
      expect('paragraph_close');
      count();
      blocks.push({ type: 'p', children: inlineNodes(inline.children || [], counter) });
    } else if (t.type === 'heading_open') {
      if (t.tag === 'h1') throw new MarkdownError('titre de niveau 1 (#) interdit : utilisez ## ou ###');
      if (t.tag !== 'h2' && t.tag !== 'h3') throw new MarkdownError(`titre ${t.tag} interdit : utilisez ## ou ###`);
      i++;
      const inline = expect('inline');
      expect('heading_close');
      count();
      blocks.push({ type: 'h', level: t.tag === 'h2' ? 2 : 3, children: inlineNodes(inline.children || [], counter) });
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const ordered = t.type === 'ordered_list_open';
      if (ordered) {
        const start = t.attrGet('start');
        if (start !== null && Number(start) !== 1) throw new MarkdownError('liste numérotée : elle doit commencer à 1');
      }
      i++;
      count();
      const items = [];
      const closing = ordered ? 'ordered_list_close' : 'bullet_list_close';
      while (tokens[i] && tokens[i].type !== closing) {
        expect('list_item_open');
        if (tokens[i]?.type !== 'paragraph_open') {
          throw new MarkdownError(tokens[i]?.type?.endsWith('_list_open') ? 'listes imbriquées interdites' : 'élément de liste vide ou non autorisé');
        }
        i++;
        const inline = expect('inline');
        expect('paragraph_close');
        if (tokens[i]?.type !== 'list_item_close') {
          throw new MarkdownError(tokens[i]?.type?.endsWith('_list_open') ? 'listes imbriquées interdites' : 'un seul paragraphe par élément de liste');
        }
        i++;
        count();
        items.push(inlineNodes(inline.children || [], counter));
      }
      expect(closing);
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
    } else {
      throw new MarkdownError(`élément Markdown non autorisé : ${t.type}`);
    }
  }
  return blocks;
}

// ---------------------------------------------------------------------------------------------------------------
// Corps historiques (§21) : algorithme NORMATIF, recopié du contrat.

export const legacyParagraphs = (body) => String(body || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean); // = renderer/news.js
const ASCII_PUNCTUATION = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g; // tous les caractères échappables CommonMark
const FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/; // dont \r : refusé (échec fermé)
const EDGE = (c) => (c === ' ' ? '&#32;' : '&#9;');

export function legacyBodyToMarkdown(body) {
  if (typeof body !== 'string') throw new Error('legacyBodyToMarkdown : texte attendu');
  if (FORBIDDEN_CONTROLS.test(body)) throw new Error('legacyBodyToMarkdown : caractère de contrôle refusé');
  return legacyParagraphs(body)
    .map((paragraph) => paragraph.split('\n').map((line) => {
      const escaped = line.replace(ASCII_PUNCTUATION, '\\$&'); // 1. chaque ponctuation ASCII → littérale
      const lead = /^[ \t]*/.exec(escaped)[0];
      const trail = /[ \t]*$/.exec(escaped.slice(lead.length))[0];
      const core = escaped.slice(lead.length, escaped.length - trail.length);
      return [...lead].map(EDGE).join('') + core + [...trail].map(EDGE).join(''); // 2. espaces et tabulations en bord de ligne → entités
    }).join('\n')) // 3. retours à la ligne simples → softbreak → « \n »
    .join('\n\n'); // 4. paragraphes historiques → paragraphes Markdown
}

// ---------------------------------------------------------------------------------------------------------------
// Validateur Article (§18)

export const DRAFT_KEYS = Object.freeze(['v', 'title', 'excerpt', 'content', 'category', 'date', 'seoTitle', 'seoDescription', 'legacyImage']);
export const MAX_CONTENT_BYTES = 100_000;
export const MAX_JSON_BYTES = 204_800;
const LEGACY_IMAGE = /^\/assets\/images\/actualites\/[A-Za-z0-9][A-Za-z0-9 ._-]{0,150}\.(jpg|jpeg|png|webp)$/;
const CATEGORY = /^[a-z0-9-]{1,40}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LINE_CONTROLS = /[\u0000-\u001F\u007F]/;
const utf8Bytes = (value) => new TextEncoder().encode(value).length;
const chars = (value) => [...value].length; // longueur en caractères, comme length() de SQLite

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function isCalendarDate(value) {
  const m = typeof value === 'string' ? DATE.exec(value) : null;
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * validateArticle(input, { mode: 'draft' | 'publish', categories, slug, existing, legacyImport })
 *   input        : brouillon soumis (clés de DRAFT_KEYS uniquement ; absentes = valeur vide)
 *   categories   : clés des catégories PUBLIÉES de l'organisation (tableau)
 *   slug         : slug demandé (validé à part : il n'est jamais dans draft_json)
 *   existing     : { draft, slug, firstPublishedAt } de la ligne lue (SAVE, PUBLISH) ; null pour CREATE
 *   legacyImport : réservé à l'import legacy (seul chemin qui pose legacyImage)
 * → { draft, json, slug, projections } | ArticleValidationError(errors[])
 */
export function validateArticle(input, { mode = 'draft', categories = [], slug, existing = null, legacyImport = false } = {}) {
  const errors = [];
  const publish = mode === 'publish';
  if (mode !== 'draft' && mode !== 'publish') throw new Error(`validateArticle : mode inconnu ${mode}`);
  if (!isPlainObject(input)) throw new ArticleValidationError(['brouillon : objet attendu']);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !DRAFT_KEYS.includes(key)) errors.push(`clé inconnue « ${String(key)} »`);
  }

  const text = (key, { min, max, trim = true, controls = LINE_CONTROLS }) => {
    const raw = input[key] === undefined ? '' : input[key];
    if (typeof raw !== 'string') {
      errors.push(`${key} : texte attendu`);
      return '';
    }
    let value = raw.normalize('NFC');
    if (trim) value = value.trim();
    if (controls.test(value)) errors.push(`${key} : caractère de contrôle refusé`);
    const n = chars(value);
    if (n < min || n > max) errors.push(`${key} : ${min} à ${max} caractères`);
    return value;
  };
  const nullableText = (key, max) => {
    const raw = input[key] ?? null;
    if (raw === null) return null;
    if (typeof raw !== 'string') {
      errors.push(`${key} : texte ou null attendu`);
      return null;
    }
    const value = raw.normalize('NFC').trim();
    if (LINE_CONTROLS.test(value)) errors.push(`${key} : caractère de contrôle refusé`);
    const n = chars(value);
    if (n < 1 || n > max) errors.push(`${key} : null ou 1 à ${max} caractères`);
    return value;
  };

  if (input.v !== undefined && input.v !== 1) errors.push('v : 1 attendu');
  const title = text('title', { min: publish ? 1 : 0, max: 200 });
  const excerpt = text('excerpt', { min: publish ? 1 : 0, max: 500 });

  // content : conservé tel quel (bords compris), NFC ; retour à la ligne et tabulation admis.
  let content = input.content === undefined ? '' : input.content;
  if (typeof content !== 'string') {
    errors.push('content : texte attendu');
    content = '';
  } else {
    content = content.normalize('NFC');
    if (FORBIDDEN_CONTROLS.test(content)) errors.push('content : caractère de contrôle refusé');
    if (utf8Bytes(content) > MAX_CONTENT_BYTES) errors.push(`content : au plus ${MAX_CONTENT_BYTES} octets`);
    if (publish) {
      if (!content.trim()) errors.push('content : requis pour publier');
      else if (!errors.some((e) => e.startsWith('content'))) {
        try {
          if (!markdownToAst(content).length) errors.push('content : requis pour publier');
        } catch (error) {
          errors.push(`content : ${error.message}`);
        }
      }
    }
  }

  const categoryKeys = new Set(Array.isArray(categories) ? categories : []);
  let category = input.category ?? null;
  if (category !== null && (typeof category !== 'string' || !CATEGORY.test(category) || !categoryKeys.has(category))) {
    errors.push('category : catégorie publiée de l’organisation attendue');
    category = null;
  }
  if (publish && category === null && !errors.some((e) => e.startsWith('category'))) errors.push('category : requise pour publier');

  let date = input.date ?? null;
  if (date !== null && !isCalendarDate(date)) {
    errors.push('date : AAAA-MM-JJ, date du calendrier');
    date = null;
  }
  if (publish && date === null && !errors.some((e) => e.startsWith('date'))) errors.push('date : requise pour publier');

  const seoTitle = nullableText('seoTitle', 120);
  const seoDescription = nullableText('seoDescription', 300);

  // legacyImage : posé UNIQUEMENT par l'import ; en SAVE/PUBLISH, repris du brouillon lu (jamais de l'entrée).
  let legacyImage = null;
  const submitted = input.legacyImage === undefined ? undefined : input.legacyImage;
  if (legacyImport) {
    legacyImage = submitted ?? null;
  } else {
    const kept = existing?.draft?.legacyImage ?? null;
    if (submitted !== undefined && submitted !== kept) errors.push('legacyImage : non modifiable (posé par l’import uniquement)');
    legacyImage = kept;
  }
  if (legacyImage !== null && (typeof legacyImage !== 'string' || !LEGACY_IMAGE.test(legacyImage) || legacyImage.includes('..'))) {
    errors.push('legacyImage : chemin d’image historique invalide');
  }

  // Slug : validé à part ; figé dès la première publication.
  if (!isArticleSlug(slug)) errors.push('slug : 1 à 100 caractères, minuscules, chiffres et tirets simples');
  if (existing?.firstPublishedAt && slug !== existing.slug) errors.push('slug : figé après la première publication');

  if (errors.length) throw new ArticleValidationError(errors);

  const draft = { v: 1, title, excerpt, content, category, date, seoTitle, seoDescription, legacyImage };
  const json = JSON.stringify(draft);
  if (utf8Bytes(json) > MAX_JSON_BYTES) throw new ArticleValidationError([`brouillon : au plus ${MAX_JSON_BYTES} octets`]);
  return { draft, json, slug, projections: { title, excerpt, category, date } };
}

// §24 : chaîne canonique = exactement la valeur stockée dans draft_json.
export const canonicalDraftJson = (draft, options) => validateArticle(draft, options).json;

// §24 : article historique (content/articles.json) → brouillon v1 validé en mode publication.
const LEGACY_KEYS = new Set(['title', 'date', 'category', 'slug', 'excerpt', 'body', 'image']);
export function mapLegacyArticle(article, { categories = [] } = {}) {
  if (!isPlainObject(article)) throw new ArticleValidationError(['article historique : objet attendu']);
  const unknown = Object.keys(article).filter((k) => !LEGACY_KEYS.has(k));
  if (unknown.length) throw new ArticleValidationError([`article historique : clé inconnue ${unknown.join(', ')}`]);
  let content;
  try {
    content = legacyBodyToMarkdown(article.body);
  } catch (error) {
    throw new ArticleValidationError([`body : ${error.message}`]);
  }
  const draft = {
    v: 1,
    title: article.title,
    excerpt: article.excerpt,
    content,
    category: article.category,
    date: article.date,
    seoTitle: null,
    seoDescription: null,
    legacyImage: article.image || null,
  };
  return validateArticle(draft, { mode: 'publish', categories, slug: article.slug, legacyImport: true });
}

// ---------------------------------------------------------------------------------------------------------------
// DTO public (§18), construit EXPLICITEMENT : jamais d'identifiant, de révision, de brouillon, ni de champ legacy/import.
// article : { slug, title, excerpt, category, date, image } (source json ou d1, déjà normalisé par l'appelant).
export function publicArticleDto(site, article) {
  const news = site?.news;
  if (!news?.route || !news.categories) throw new Error('publicArticleDto : site.news requis');
  const category = news.categories[article.category] ? article.category : news.defaultCategory;
  return {
    slug: article.slug,
    title: article.title,
    excerpt: article.excerpt,
    category,
    categoryLabel: news.categories[category].label,
    date: article.date,
    url: `${news.route}/${article.slug}`,
    image: article.image || null,
  };
}
