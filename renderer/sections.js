// Registre des sections : un type connu → un rendu autorisé (phase 4D.1, fragments supprimés en 4D.2A). Une
// section d'un type absent du registre est une erreur de validation : jamais ignorée en silence, jamais de HTML
// ou de gabarit venant de la configuration. Chaque section porte un identifiant stable (`id`) et, pour les
// développeurs, un commentaire facultatif (`comment`) écrit avant elle dans la page.
import { escapeAttr, escapeText, safeAbsoluteUrl, safeHref } from './html.js';
import { bindMarkers, renderInline } from './inline.js';
import { assetUrl } from './layout.js';
import { ILLUSTRATION_ICONS } from './icons.js';
import { allowKeys, checkBlock, indent, renderBlock } from './blocks.js';
import { checkRegistration, renderRegistration } from './registration.js';
import { checkPreregistration, renderPreregistration } from './preregistration.js';

const requireText = (value, what) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} : texte requis`);
};
const requireSegments = (value, what) => {
  if (!Array.isArray(value) || !value.length) throw new Error(`${what} : texte en segments requis`);
};

// En-tête de page : pastille, titre, chapeau.
const pageHeader = {
  validate(section) {
    allowKeys(section, 'page_header', ['type', 'id', 'eyebrow', 'title', 'lead'], ['comment', 'action']);
    requireText(section.eyebrow, 'page_header.eyebrow');
    requireText(section.title, 'page_header.title');
    requireSegments(section.lead, 'page_header.lead');
    if (section.action !== undefined) {
      // Accès direct à un endroit de la page (ex. le formulaire d'inscription), sous le chapeau.
      allowKeys(section.action, 'page_header.action', ['href', 'label']);
      requireText(section.action.label, 'page_header.action.label');
      safeHref(section.action.href);
    }
  },
  render(section, ctx) {
    const action = section.action
      ? `
      <a href="${escapeAttr(safeHref(section.action.href))}" class="btn btn-primary page-header-action">${ctx.text(section.action.label)}</a>`
      : '';
    return `  <div class="page-header">
    <div class="container">
      <span class="eyebrow">${ctx.text(section.eyebrow)}</span>
      <h1>${ctx.text(section.title)}</h1>
      <p>${renderInline(section.lead, ctx)}</p>${action}
    </div>
  </div>
`;
  },
};

const ACTION_STYLES = { primary: 'btn btn-primary', outline: 'btn btn-outline' };

// Bandeau d'accueil : contenu (titre, chapeau, actions, emblème, chiffres) configuré ; présentation = thème.
function heroPartner(p, ctx) {
  if (!p) return '';
  const img = `<img src="${escapeAttr(assetUrl(ctx, p.logo.src))}" alt="${escapeAttr(p.name)}" width="${p.logo.width}" height="${p.logo.height}">`;
  const logo = p.href ? `<a href="${escapeAttr(safeAbsoluteUrl(p.href))}" target="_blank" rel="noopener">${img}</a>` : img;
  return `
        <div class="hero-partner">
          <span>${escapeText(p.label)}</span>
          ${logo}
        </div>`;
}

function heroNotice(n) {
  if (!n) return '';
  return `
        <a href="${escapeAttr(safeHref(n.href))}" class="hero-notice"><span class="hero-notice-tag">${escapeText(n.tag)}</span><span>${escapeText(n.label)}</span><span aria-hidden="true">&rarr;</span></a>`;
}

const hero = {
  validate(section, { ctx }) {
    allowKeys(section, 'hero', ['type', 'id', 'eyebrow', 'title', 'lead', 'actions', 'emblem', 'stats'], ['comment', 'partner', 'notice']);
    requireText(section.eyebrow, 'hero.eyebrow');
    requireSegments(section.title, 'hero.title');
    requireSegments(section.lead, 'hero.lead');
    requireSegments(section.actions, 'hero.actions');
    for (const action of section.actions) {
      allowKeys(action, 'hero.action', ['href', 'label', 'style'], ['statusHook']);
      if (!ACTION_STYLES[action.style]) throw new Error(`hero.actions : style inconnu ${action.style}`);
      requireText(action.label, 'hero.actions.label');
      safeHref(action.href);
    }
    allowKeys(section.emblem, 'hero.emblem', ['src', 'alt', 'width', 'height'], ['fetchpriority']);
    requireText(section.emblem.alt, 'hero.emblem.alt');
    assetUrl(ctx, section.emblem.src);
    if (!Number.isInteger(section.emblem.width) || !Number.isInteger(section.emblem.height)) throw new Error('hero.emblem : dimensions entières');
    if (section.emblem.fetchpriority !== undefined && !['high', 'low', 'auto'].includes(section.emblem.fetchpriority)) throw new Error('hero.emblem.fetchpriority inconnu');
    if (section.partner !== undefined) {
      // Partenaire mis en avant sous les actions (logo clair, posé sur le fond sombre du bandeau).
      allowKeys(section.partner, 'hero.partner', ['label', 'name', 'logo'], ['href']);
      requireText(section.partner.label, 'hero.partner.label');
      requireText(section.partner.name, 'hero.partner.name');
      allowKeys(section.partner.logo, 'hero.partner.logo', ['src', 'width', 'height']);
      assetUrl(ctx, section.partner.logo.src);
      if (!Number.isInteger(section.partner.logo.width) || !Number.isInteger(section.partner.logo.height)) throw new Error('hero.partner.logo : dimensions entières');
      if (section.partner.href !== undefined) safeAbsoluteUrl(section.partner.href);
    }
    if (section.notice !== undefined) {
      // Annonce cliquable au-dessus du titre (nouveauté à ne pas manquer).
      allowKeys(section.notice, 'hero.notice', ['tag', 'label', 'href']);
      requireText(section.notice.tag, 'hero.notice.tag');
      requireText(section.notice.label, 'hero.notice.label');
      safeHref(section.notice.href);
    }
    requireSegments(section.stats, 'hero.stats');
    for (const stat of section.stats) {
      allowKeys(stat, 'hero.stat', ['value', 'label'], ['bind']);
      allowKeys(stat.value, 'hero.stat.value', ['content'], ['bind']);
      allowKeys(stat.label, 'hero.stat.label', ['content'], ['bind']);
      requireSegments(stat.value.content, 'hero.stats.value');
      requireSegments(stat.label.content, 'hero.stats.label');
    }
  },
  render(section, ctx) {
    const markers = (attrs) => bindMarkers(ctx, attrs);
    const actions = section.actions
      .map((a) => `          <a href="${escapeAttr(safeHref(a.href))}" class="${ACTION_STYLES[a.style]}${a.statusHook ? ' adhesion-cta' : ''}">${escapeText(a.label)}</a>`)
      .join('\n');
    const e = section.emblem;
    const stats = section.stats
      .map(
        (s) =>
          `        <div class="stat"${markers(s.bind)}><strong${markers(s.value.bind)}>${renderInline(s.value.content, ctx)}</strong><span${markers(s.label.bind)}>${renderInline(s.label.content, ctx)}</span></div>`
      )
      .join('\n');
    return `  <section class="hero">
    <div class="container">
      <div>${heroNotice(section.notice)}
        <span class="eyebrow">${escapeText(section.eyebrow)}</span>
        <h1>${renderInline(section.title, ctx)}</h1>
        <p class="lead">${renderInline(section.lead, ctx)}</p>
        <div class="hero-actions">
${actions}
        </div>${heroPartner(section.partner, ctx)}
      </div>
      <div class="hero-crest">
        <img src="${escapeAttr(assetUrl(ctx, e.src))}" alt="${escapeAttr(e.alt)}" width="${e.width}" height="${e.height}"${e.fetchpriority ? ` fetchpriority="${e.fetchpriority}"` : ''}>
      </div>
    </div>
    <div class="container">
      <div class="stats-strip">
${stats}
      </div>
    </div>
  </section>
`;
  },
};

const BACKGROUNDS = { surface: 'bg-surface', cream: 'bg-cream', maroon: 'bg-maroon', photo: 'photo-section' };

// Section de contenu : fond (liste fermée), disposition en pile ou en deux colonnes, blocs structurés.
const content = {
  validate(section, { ctx }) {
    allowKeys(section, 'content', ['type', 'id', 'background'], ['comment', 'tight', 'image', 'width', 'textAlign', 'layout', 'align', 'blocks', 'columns']);
    if (!BACKGROUNDS[section.background]) throw new Error(`content : fond inconnu ${section.background}`);
    if (section.tight !== undefined && typeof section.tight !== 'boolean') throw new Error('content.tight : booléen');
    if ((section.background === 'photo') !== (section.image !== undefined)) throw new Error('content : image de fond requise pour (et réservée à) un fond photo');
    if (section.image !== undefined) assetUrl(ctx, section.image);
    if (!['default', 'narrow'].includes(section.width || 'default')) throw new Error(`content : largeur inconnue ${section.width}`);
    if (!['start', 'center'].includes(section.textAlign || 'start')) throw new Error(`content : alignement inconnu ${section.textAlign}`);
    if (!['stack', 'split'].includes(section.layout || 'stack')) throw new Error(`content : disposition inconnue ${section.layout}`);
    const split = section.layout === 'split';
    if (split) {
      if (!['start', 'center'].includes(section.align)) throw new Error('content : alignement des colonnes requis (start ou center)');
      if (!Array.isArray(section.columns) || section.columns.length !== 2 || section.blocks !== undefined) throw new Error('content : deux colonnes requises');
      if (section.width !== undefined || section.textAlign !== undefined) throw new Error('content : largeur et alignement réservés à la pile');
    } else {
      if (!Array.isArray(section.blocks) || !section.blocks.length || section.columns !== undefined || section.align !== undefined) throw new Error('content : blocs requis');
      if (section.width === 'narrow' && section.textAlign === 'center') throw new Error('content : largeur étroite ou texte centré, pas les deux');
    }
    for (const block of split ? section.columns : section.blocks) checkBlock(block, ctx);
  },
  render(section, ctx) {
    const split = section.layout === 'split';
    const cls = `${BACKGROUNDS[section.background]}${section.tight ? ' section-tight' : ''}`;
    const style = section.image ? ` style="background-image:url('${escapeAttr(assetUrl(ctx, section.image))}');"` : '';
    let container = 'container';
    let containerStyle = '';
    if (split) {
      container = 'container grid grid-2';
      containerStyle = ` style="align-items:${section.align};"`;
    } else if (section.width === 'narrow') containerStyle = ' style="max-width:760px;"';
    else if (section.textAlign === 'center') containerStyle = ' style="text-align:center;"';
    const body = (split ? section.columns : section.blocks).map((block) => indent(renderBlock(block, ctx), '      ')).join('\n');
    return `  <section class="${cls}"${style}>\n    <div class="${container}"${containerStyle}>\n${body}\n    </div>\n  </section>\n`;
  },
};

// Formulaire d'inscription (module Inscriptions), voir registration.js.
const registration = {
  validate: (section) => checkRegistration(section),
  render: renderRegistration,
};

// Formulaire de pré-inscription (liste d'intérêt d'un groupe pas encore ouvert), voir preregistration.js.
const preregistration = {
  validate: (section) => checkPreregistration(section),
  render: renderPreregistration,
};

// Image d'article : fichier du site sous /assets/images/ (téléversé par le CMS), sans traversée ni caractère
// de contrôle ou de balisage. Les espaces sont admis (noms de fichiers réels).
const ARTICLE_IMAGE = /^\/assets\/images\/[^\u0000-\u001f<>"'`\\]+$/;

// Corps d'article en AST v1 (phase 4E.1, contrat 4E §20), produit par functions/_shared/article-model.js depuis le
// Markdown. Liste blanche contrôlée ici aussi (défense en profondeur) puis convertie en texte « en segments » : le
// rendu passe par renderInline (texte échappé, segment link et safeHref existants). Un paragraphe fait uniquement de
// texte et de retours simples se rend exactement <p>${texte}</p>, comme `paragraphs`.
const AST_BLOCKS = new Set(['p', 'h', 'ul', 'ol']);
function astSegments(nodes, where, inLink = false) {
  if (!Array.isArray(nodes)) throw new Error(`${where} : liste de nœuds attendue`);
  return nodes.map((node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) throw new Error(`${where} : nœud invalide`);
    switch (node.type) {
      case 'text':
        allowKeys(node, `${where}.text`, ['type', 'value']);
        if (typeof node.value !== 'string') throw new Error(`${where} : texte attendu`);
        return node.value;
      case 'soft':
        allowKeys(node, `${where}.soft`, ['type']);
        return '\n';
      case 'br':
        allowKeys(node, `${where}.br`, ['type']);
        if (inLink) throw new Error(`${where} : saut de ligne interdit dans un lien`);
        return { br: true };
      case 'strong':
      case 'em':
        allowKeys(node, `${where}.${node.type}`, ['type', 'children']);
        return { [node.type]: astSegments(node.children, where, inLink) };
      case 'link':
        allowKeys(node, `${where}.link`, ['type', 'href', 'children']);
        if (inLink) throw new Error(`${where} : lien imbriqué interdit`);
        safeHref(node.href);
        return { link: { href: node.href, children: astSegments(node.children, where, true) } };
      default:
        throw new Error(`${where} : nœud inconnu ${JSON.stringify(node.type)}`);
    }
  });
}
function checkAstBlocks(blocks) {
  if (!Array.isArray(blocks)) throw new Error('article_body.blocks : tableau de blocs');
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !AST_BLOCKS.has(block.type)) throw new Error(`article_body.blocks : bloc inconnu ${JSON.stringify(block?.type)}`);
    if (block.type === 'ul' || block.type === 'ol') {
      allowKeys(block, `article_body.${block.type}`, ['type', 'items']);
      if (!Array.isArray(block.items) || !block.items.length) throw new Error(`article_body.${block.type} : éléments requis`);
      block.items.forEach((item) => astSegments(item, `article_body.${block.type}`));
      continue;
    }
    if (block.type === 'h') {
      allowKeys(block, 'article_body.h', ['type', 'level', 'children']);
      if (block.level !== 2 && block.level !== 3) throw new Error('article_body.h : niveau 2 ou 3');
    } else allowKeys(block, 'article_body.p', ['type', 'children']);
    astSegments(block.children, `article_body.${block.type}`);
  }
}
function renderAstBlock(block, ctx) {
  const inline = (nodes) => renderInline(astSegments(nodes, 'article_body'), ctx);
  if (block.type === 'p') return `<p>${inline(block.children)}</p>`;
  if (block.type === 'h') return `<h${block.level}>${inline(block.children)}</h${block.level}>`;
  return `<${block.type}>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${block.type}>`;
}

// Corps d'une actualité : illustration (image ou icône de catégorie), paragraphes (ou blocs AST), lien de retour.
const articleBody = {
  validate(section) {
    // Corps : `paragraphs` (texte historique) OU `blocks` (AST v1, phase 4E.1), jamais les deux.
    const body = section && section.blocks !== undefined ? 'blocks' : 'paragraphs';
    allowKeys(section, 'article_body', ['type', 'id', 'category', body, 'excerpt', 'back'], ['comment', 'image']);
    allowKeys(section.category, 'article_body.category', ['label', 'icon']);
    allowKeys(section.back, 'article_body.back', ['href', 'label']);
    requireText(section.category?.label, 'article_body.category.label');
    if (!ILLUSTRATION_ICONS[section.category.icon]) throw new Error(`article_body : icône inconnue ${section.category.icon}`);
    if (section.image !== undefined && (!ARTICLE_IMAGE.test(section.image) || section.image.includes('/..') || section.image.includes('//'))) {
      throw new Error(`article_body : image refusée ${JSON.stringify(section.image)}`);
    }
    if (body === 'blocks') checkAstBlocks(section.blocks);
    else if (!Array.isArray(section.paragraphs) || section.paragraphs.some((p) => typeof p !== 'string')) throw new Error('article_body.paragraphs : tableau de textes');
    requireText(section.back?.label, 'article_body.back.label');
    safeHref(section.back.href);
  },
  render(section, ctx) {
    const media = section.image
      ? `<img class="card-media-bg" src="${ctx.text(section.image)}" alt="" aria-hidden="true"><img src="${ctx.text(section.image)}" alt="">`
      : `<svg class="icon-illustration" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ILLUSTRATION_ICONS[section.category.icon]}</svg>`;
    const parts = section.blocks !== undefined
      ? section.blocks.map((block) => renderAstBlock(block, ctx))
      : section.paragraphs.map((p) => `<p>${ctx.text(p)}</p>`);
    const body = parts.length ? parts.join('\n            ') : `<p>${ctx.text(section.excerpt || '')}</p>`;
    return `  <section class="bg-surface">
    <div class="container" style="max-width:760px;">
      <div class="card" style="margin-bottom:32px;">
        <div class="card-media${section.image ? ' card-media--article' : ''}">${media}<span class="tag">${ctx.text(section.category.label)}</span></div>
      </div>
      <div style="font-size:1.05rem;line-height:1.75;color:var(--color-text);">
        ${body}
      </div>
      <p style="margin-top:32px;"><a href="${escapeAttr(safeHref(section.back.href))}" class="card-link">${ctx.text(section.back.label)}</a></p>
    </div>
  </section>
`;
  },
};

export const SECTIONS = Object.freeze({ page_header: pageHeader, hero, content, registration, preregistration, article_body: articleBody });
