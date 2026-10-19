// Blocs de contenu des sections « content » (phase 4D.2A). Un bloc décrit du CONTENU (titres, textes en
// segments, éléments de liste, liens) et une variante choisie dans une liste fermée ; le balisage, les classes et
// les styles sont écrits ici, par le moteur, pour le thème dynamic_diagonal v1. Aucun bloc n'accepte de HTML, de
// classe, de style, d'identifiant d'élément ou de script venant de la configuration.
import { escapeAttr, safeAbsoluteUrl, safeHref } from './html.js';
import { bindMarkers, renderInline } from './inline.js';
import { assetUrl } from './layout.js';
import { INFO_ICONS, infoSvg } from './icons.js';

const T = (segments, ctx) => renderInline(segments, ctx);
const reveal = (on) => (on ? ' data-reveal' : '');
export const indent = (text, pad) =>
  text
    .split('\n')
    .map((line) => (line ? pad + line : line))
    .join('\n');

function need(condition, message) {
  if (!condition) throw new Error(message);
}
const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isSegments = (v) => Array.isArray(v) && v.length > 0;

// Clés autorisées d'un objet de configuration : toute clé inconnue est une erreur (échec fermé).
export function allowKeys(value, where, required, optional = []) {
  need(value && typeof value === 'object' && !Array.isArray(value), `${where} : objet attendu`);
  for (const key of required) need(value[key] !== undefined, `${where} : « ${key} » requis`);
  const known = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    need(typeof key === 'string' && known.has(key), `${where} : clé inconnue « ${String(key)} »`);
  }
}

// Événements de mesure d'audience reconnus (comptés par functions/api/track-event.js, voir confidentialite).
const TRACK_EVENTS = new Set(['phone_click']);
// Services de cartes dont les URL peuvent être intégrées ou liées.
const MAP_HOSTS = new Set(['www.google.com', 'maps.google.com', 'www.openstreetmap.org']);

export function safeMapUrl(url) {
  const value = safeAbsoluteUrl(url);
  need(MAP_HOSTS.has(new URL(value).hostname), `Service de carte non autorisé : ${value}`);
  return value;
}

const BUTTON_STYLES = { primary: 'btn btn-primary', dark: 'btn btn-dark' };
const BUTTON_PLACEMENTS = { inline: '', spaced: ' style="margin-top:12px;"', start: ' style="align-self:flex-start;"', centered: '' };

function button(b, ctx) {
  const a = `<a href="${escapeAttr(safeHref(b.href))}" class="${BUTTON_STYLES[b.style]}"${BUTTON_PLACEMENTS[b.placement || 'inline']}>${ctx.text(b.label)}</a>`;
  return b.placement === 'centered' ? `<div style="display:flex;justify-content:center;margin-top:8px;">\n  ${a}\n</div>` : a;
}

const TEXT_VARIANTS = {
  plain: '',
  muted: ' style="color:var(--color-text-muted);"',
  'muted-wide': ' style="color:var(--color-text-muted);max-width:760px;"',
  'centered-note': ' style="text-align:center;color:var(--color-text-muted);margin-top:24px;"',
};

const CARD_VARIANTS = ['default', 'soft', 'stat'];
const CALLOUT_VARIANTS = ['dark', 'dark-lead', 'accent', 'note'];
const IMAGE_RATIOS = {
  '16/9': ' style="max-width:640px;margin:0 auto 32px;aspect-ratio:16/9;"',
  '21/9': ' style="aspect-ratio:21/9;margin-bottom:28px;"',
};

function infoItem(item, list, ctx) {
  const icon = item.number !== undefined ? ctx.text(item.number) : infoSvg(item.icon);
  const title = `<h3${bindMarkers(ctx, item.titleBind)}>${T(item.title, ctx)}</h3>`;
  const text = `<p${bindMarkers(ctx, item.textBind)}>${T(item.text, ctx)}</p>`;
  const body = list.layout === 'compact' ? `  <div>${title}${text}</div>` : `  <div>\n    ${title}\n    ${text}\n  </div>`;
  return `<div class="info-item"${bindMarkers(ctx, item.bind)}>\n  <span class="icon">${icon}</span>\n${body}\n</div>`;
}

function card(item, list, ctx) {
  if (list.variant === 'soft') {
    return `<div class="card" style="background:rgba(255,255,255,.06);box-shadow:none;color:var(--cream-100);">
  <div class="card-body">
    <h3 style="color:var(--gold-400);font-size:1.05rem;">${T(item.title, ctx)}</h3>
    <p style="color:rgba(251,247,238,.8);">${T(item.text, ctx)}</p>
  </div>
</div>`;
  }
  if (list.variant === 'stat') {
    return `<div class="card">
  <div class="card-body" style="text-align:center;">
    <h3 style="font-size:2rem;margin-bottom:0;">${T(item.title, ctx)}</h3>
    <p>${T(item.text, ctx)}</p>
  </div>
</div>`;
  }
  const badge = item.badge ? `    <span class="card-date"${bindMarkers(ctx, item.badge.bind)}>${T(item.badge.content, ctx)}</span>\n` : '';
  return `<div class="card"${reveal(list.reveal === 'items')}${bindMarkers(ctx, item.bind)}>
  <div class="card-body">
${badge}    <h3${bindMarkers(ctx, item.titleBind)}>${T(item.title, ctx)}</h3>
    <p>${T(item.text, ctx)}</p>
  </div>
</div>`;
}

export const BLOCKS = {
  // Titre de section : pastille, titre, sous-titre ; en tête centrée ou alignée, ou sans conteneur (colonne).
  heading: {
    check(b, check) {
      allowKeys(b, 'heading', [], ['type', 'layout', 'reveal', 'bind', 'eyebrow', 'title', 'titleBind', 'sub', 'subBind', 'children']);
      need(['center', 'start', 'none'].includes(b.layout || 'center'), `heading : disposition inconnue ${b.layout}`);
      need(b.eyebrow !== undefined || b.title !== undefined || b.sub !== undefined, 'heading : contenu requis');
      if (b.eyebrow !== undefined) need(isText(b.eyebrow), 'heading.eyebrow : texte');
      if (b.title !== undefined) need(isSegments(b.title), 'heading.title : segments');
      if (b.sub !== undefined) need(isSegments(b.sub), 'heading.sub : segments');
      need(b.layout !== 'none' || (!b.children && !b.bind && !b.reveal), 'heading sans conteneur : ni enfants, ni liaison, ni apparition');
      for (const child of b.children || []) check(child, ['button', 'link']);
    },
    render(b, ctx) {
      const lines = [];
      if (b.eyebrow !== undefined) lines.push(`<span class="eyebrow">${ctx.text(b.eyebrow)}</span>`);
      if (b.title) lines.push(`<h2 class="section-title"${bindMarkers(ctx, b.titleBind)}>${T(b.title, ctx)}</h2>`);
      if (b.sub) lines.push(`<p class="section-sub"${bindMarkers(ctx, b.subBind)}>${T(b.sub, ctx)}</p>`);
      for (const child of b.children || []) lines.push(renderBlock(child, ctx));
      if (b.layout === 'none') return lines.join('\n');
      const cls = b.layout === 'start' ? 'section-head' : 'section-head center';
      return `<div class="${cls}"${reveal(b.reveal)}${bindMarkers(ctx, b.bind)}>\n${indent(lines.join('\n'), '  ')}\n</div>`;
    },
  },

  // Paragraphe de texte courant, dans une variante de présentation connue.
  text: {
    check(b) {
      allowKeys(b, 'text', ['content'], ['type', 'variant', 'reveal']);
      need(isSegments(b.content), 'text.content : segments');
      need(TEXT_VARIANTS[b.variant || 'plain'] !== undefined, `text : variante inconnue ${b.variant}`);
    },
    render: (b, ctx) => `<p${TEXT_VARIANTS[b.variant || 'plain']}${reveal(b.reveal)}>${T(b.content, ctx)}</p>`,
  },

  // Bouton d'action (lien).
  button: {
    check(b) {
      allowKeys(b, 'button', ['href', 'label', 'style'], ['type', 'placement']);
      need(BUTTON_STYLES[b.style], `button : style inconnu ${b.style}`);
      need(BUTTON_PLACEMENTS[b.placement || 'inline'] !== undefined, `button : placement inconnu ${b.placement}`);
      need(isText(b.label), 'button.label : texte');
      safeHref(b.href);
    },
    render: button,
  },

  // Lien discret (« Voir… »).
  link: {
    check(b) {
      allowKeys(b, 'link', ['href', 'label'], ['type']);
      need(isText(b.label), 'link.label : texte');
      safeHref(b.href);
    },
    render: (b, ctx) => `<a href="${escapeAttr(safeHref(b.href))}" class="card-link">${ctx.text(b.label)}</a>`,
  },

  // Groupe de blocs affiché d'un seul tenant (colonne).
  group: {
    check(b, check) {
      allowKeys(b, 'group', ['children'], ['type']);
      need(isSegments(b.children), 'group.children : blocs requis');
      for (const child of b.children) check(child);
    },
    render: (b, ctx) => `<div data-reveal>\n${indent(b.children.map((c) => renderBlock(c, ctx)).join('\n'), '  ')}\n</div>`,
  },

  // Encadré centré contenant d'autres blocs (liste d'informations et action).
  panel: {
    check(b, check) {
      allowKeys(b, 'panel', ['children'], ['type']);
      need(isSegments(b.children), 'panel.children : blocs requis');
      for (const child of b.children) check(child, ['info_list', 'button', 'text']);
    },
    render: (b, ctx) =>
      `<div class="card" data-reveal style="max-width:640px;margin-inline:auto;">\n  <div class="card-body" style="gap:20px;">\n${indent(b.children.map((c) => renderBlock(c, ctx)).join('\n'), '    ')}\n  </div>\n</div>`,
  },

  // Grille de cartes (titre, texte, pastille facultative).
  cards: {
    check(b) {
      allowKeys(b, 'cards', ['items'], ['type', 'columns', 'variant', 'reveal']);
      need([2, 3].includes(b.columns || 2), `cards : colonnes 2 ou 3`);
      need(CARD_VARIANTS.includes(b.variant || 'default'), `cards : variante inconnue ${b.variant}`);
      need(['grid', 'items', 'none'].includes(b.reveal || 'none'), `cards : apparition inconnue ${b.reveal}`);
      need(isSegments(b.items), 'cards.items : éléments requis');
      for (const item of b.items) {
        allowKeys(item, 'cards.item', ['title', 'text'], ['bind', 'titleBind', 'badge']);
        need(isSegments(item.title) && isSegments(item.text), 'cards.item : titre et texte en segments');
        if (item.badge) {
          allowKeys(item.badge, 'cards.item.badge', ['content'], ['bind']);
          need((b.variant || 'default') === 'default', 'cards : pastille réservée à la variante par défaut');
        }
        if ((b.variant || 'default') !== 'default') need(!item.bind && !item.titleBind, 'cards : liaisons réservées à la variante par défaut');
      }
    },
    render(b, ctx) {
      const style = b.variant === 'stat' ? ' style="margin-top:36px;"' : '';
      const items = b.items.map((item) => indent(card(item, b, ctx), '  ')).join('\n');
      return `<div class="grid grid-${b.columns || 2}"${style}${reveal(b.reveal === 'grid')}>\n${items}\n</div>`;
    },
  },

  // Liste d'informations : icône (liste fermée) ou numéro, titre, texte.
  info_list: {
    check(b) {
      allowKeys(b, 'info_list', ['items'], ['type', 'layout', 'width', 'reveal']);
      need(['stacked', 'compact'].includes(b.layout || 'stacked'), `info_list : disposition inconnue ${b.layout}`);
      need(['default', 'narrow'].includes(b.width || 'default'), `info_list : largeur inconnue ${b.width}`);
      need(isSegments(b.items), 'info_list.items : éléments requis');
      for (const item of b.items) {
        allowKeys(item, 'info_list.item', ['title', 'text'], ['icon', 'number', 'bind', 'titleBind', 'textBind']);
        need((item.icon === undefined) !== (item.number === undefined), 'info_list.item : icône OU numéro');
        if (item.icon !== undefined) need(INFO_ICONS[item.icon], `info_list : icône inconnue ${item.icon}`);
        if (item.number !== undefined) need(/^[0-9]{1,2}$/.test(item.number), 'info_list : numéro de 1 ou 2 chiffres');
        need(isSegments(item.title) && isSegments(item.text), 'info_list.item : titre et texte en segments');
      }
    },
    render(b, ctx) {
      const style = b.width === 'narrow' ? ' style="max-width:640px;margin-inline:auto;"' : '';
      return `<div class="info-list"${style}${reveal(b.reveal)}>\n${b.items.map((item) => indent(infoItem(item, b, ctx), '  ')).join('\n')}\n</div>`;
    },
  },

  // Encadré de mise en avant.
  callout: {
    check(b) {
      allowKeys(b, 'callout', ['variant', 'content'], ['type', 'eyebrow']);
      need(CALLOUT_VARIANTS.includes(b.variant), `callout : variante inconnue ${b.variant}`);
      need(isSegments(b.content), 'callout.content : segments');
      need(b.variant.startsWith('dark') ? isText(b.eyebrow) : b.eyebrow === undefined, 'callout : pastille requise (sombre) ou interdite (autres)');
    },
    render(b, ctx) {
      const content = T(b.content, ctx);
      if (b.variant === 'note') {
        return `<div style="margin-top:24px;max-width:640px;margin-inline:auto;background:var(--gold-100);border-radius:var(--radius-sm);padding:16px 18px;font-size:.92rem;color:var(--color-text-muted);line-height:1.6;" data-reveal>\n  ${content}\n</div>`;
      }
      if (b.variant === 'accent') {
        return `<div class="card" style="margin-top:28px;border-left:4px solid var(--gold-500);box-shadow:none;" data-reveal>\n  <div class="card-body">\n    <p style="margin-bottom:0;">${content}</p>\n  </div>\n</div>`;
      }
      const lead = b.variant === 'dark-lead';
      return `<div class="card" style="margin-top:${lead ? 32 : 28}px;background:linear-gradient(160deg,var(--maroon-800),var(--maroon-950));box-shadow:none;" data-reveal>
  <div class="card-body">
    <span class="eyebrow" style="background:rgba(240,160,48,.14);border-color:transparent;color:var(--gold-400);">${ctx.text(b.eyebrow)}</span>
    <p style="color:var(--cream-100);${lead ? 'font-size:1.05rem;' : ''}margin-bottom:0;">${content}</p>
  </div>
</div>`;
    },
  },

  // Photo d'illustration (fichier du site), au format choisi dans une liste fermée.
  image: {
    check(b, _check, ctx) {
      allowKeys(b, 'image', ['src', 'alt', 'width', 'height', 'ratio'], ['type']);
      need(IMAGE_RATIOS[b.ratio], `image : format inconnu ${b.ratio}`);
      need(typeof b.alt === 'string', 'image.alt : texte');
      need(Number.isInteger(b.width) && Number.isInteger(b.height) && b.width > 0 && b.height > 0 && b.width <= 10000 && b.height <= 10000, 'image : dimensions entières');
      assetUrl(ctx, b.src);
    },
    render: (b, ctx) =>
      `<div class="photo-frame"${IMAGE_RATIOS[b.ratio]} data-reveal>\n  <img src="${escapeAttr(assetUrl(ctx, b.src))}" alt="${escapeAttr(b.alt)}" width="${b.width}" height="${b.height}" loading="lazy">\n</div>`,
  },

  // Logos des partenaires (fichiers du site, version claire pour fond sombre), rôle et lien facultatif.
  partners: {
    check(b, _check, ctx) {
      allowKeys(b, 'partners', ['items'], ['type']);
      need(isSegments(b.items) && b.items.length <= 12, 'partners.items : 1 à 12 partenaires');
      for (const item of b.items) {
        allowKeys(item, 'partners.item', ['name', 'role', 'logo'], ['href']);
        need(isText(item.name) && isText(item.role), 'partners.item : nom et rôle');
        allowKeys(item.logo, 'partners.item.logo', ['src', 'width', 'height']);
        need(Number.isInteger(item.logo.width) && Number.isInteger(item.logo.height) && item.logo.width > 0 && item.logo.height > 0 && item.logo.width <= 4000 && item.logo.height <= 4000, 'partners.item.logo : dimensions entières');
        assetUrl(ctx, item.logo.src);
        if (item.href !== undefined) safeAbsoluteUrl(item.href);
      }
    },
    render(b, ctx) {
      const items = b.items.map((item) => {
        const inner = `<span class="partner-logo"><img src="${escapeAttr(assetUrl(ctx, item.logo.src))}" alt="${escapeAttr(item.name)}" width="${item.logo.width}" height="${item.logo.height}" loading="lazy"></span>\n    <span class="partner-role">${ctx.text(item.role)}</span>`;
        const body = item.href
          ? `<a href="${escapeAttr(safeAbsoluteUrl(item.href))}" target="_blank" rel="noopener">\n    ${inner}\n    </a>`
          : `<div>\n    ${inner}\n    </div>`;
        return `  <li class="partner-card">\n    ${body}\n  </li>`;
      });
      return `<ul class="partner-logos" data-reveal>\n${items.join('\n')}\n</ul>`;
    },
  },

  // Bandeau d'appel à l'action : titre, texte, une ou plusieurs actions.
  cta_banner: {
    check(b) {
      allowKeys(b, 'cta_banner', ['title', 'text', 'actions'], ['type', 'compact']);
      need(b.compact === undefined || typeof b.compact === 'boolean', 'cta_banner.compact : booléen');
      need(isText(b.title) && isSegments(b.text), 'cta_banner : titre et texte');
      need(isSegments(b.actions) && b.actions.length <= 4, 'cta_banner.actions : 1 à 4 actions');
      for (const action of b.actions) {
        allowKeys(action, 'cta_banner.action', ['href', 'label'], ['track']);
        need(isText(action.label), 'cta_banner.action.label : texte');
        safeHref(action.href);
        if (action.track !== undefined) need(TRACK_EVENTS.has(action.track), `cta_banner : événement inconnu ${action.track}`);
      }
    },
    render(b, ctx) {
      const links = b.actions.map(
        (a) => `<a href="${escapeAttr(safeHref(a.href))}" class="btn btn-dark"${a.track ? ` data-track-event="${a.track}"` : ''}>${ctx.text(a.label)}</a>`
      );
      const actions = links.length === 1 ? `  ${links[0]}` : `  <div style="display:flex;gap:12px;flex-wrap:wrap;">\n${links.map((l) => `    ${l}`).join('\n')}\n  </div>`;
      return `<div class="cta-banner${b.compact ? ' cta-banner--compact' : ''}" data-reveal>\n  <div>\n    <h3>${ctx.text(b.title)}</h3>\n    <p>${T(b.text, ctx)}</p>\n  </div>\n${actions}\n</div>`;
    },
  },

  // Questions fréquentes.
  faq: {
    check(b) {
      allowKeys(b, 'faq', ['items'], ['type']);
      need(isSegments(b.items), 'faq.items : questions requises');
      for (const item of b.items) {
        allowKeys(item, 'faq.item', ['question', 'answer'], ['bind', 'answerBind']);
        need(isText(item.question) && isSegments(item.answer), 'faq.item : question et réponse');
      }
    },
    render: (b, ctx) =>
      `<div class="faq-list" data-reveal>\n${b.items
        .map((item) => `  <details class="faq-item"${bindMarkers(ctx, item.bind)}>\n    <summary>${ctx.text(item.question)}</summary>\n    <p${bindMarkers(ctx, item.answerBind)}>${T(item.answer, ctx)}</p>\n  </details>`)
        .join('\n')}\n</div>`,
  },

  // Carte du lieu principal (site.contact.location), chargée seulement au clic (assets/js/main.js).
  map: {
    check(b, _check, ctx) {
      allowKeys(b, 'map', ['labels'], ['type', 'variant']);
      need(['wide', 'inline'].includes(b.variant || 'inline'), `map : variante inconnue ${b.variant}`);
      allowKeys(b.labels, 'map.labels', ['show', 'open', 'note']);
      for (const key of ['show', 'open', 'note']) need(isText(b.labels[key]), `map.labels.${key} : texte`);
      const l = ctx.site.contact?.location;
      allowKeys(l, 'contact.location', ['short', 'href', 'name', 'address', 'embedUrl', 'mapsUrl', 'mapTitle']);
      safeMapUrl(l.embedUrl);
      safeMapUrl(l.mapsUrl);
    },
    render(b, ctx) {
      const l = ctx.site.contact.location;
      const m = (attrs) => bindMarkers(ctx, attrs);
      const wide = b.variant === 'wide';
      return `<div class="map-embed${wide ? ' map-embed--wide' : ''}"${m([['data-org-if', 'location.address'], ['data-org-attr', 'data-map-src:location.embedUrl;data-map-title:location.mapTitle']])} data-map-src="${escapeAttr(safeMapUrl(l.embedUrl))}" data-map-title="${escapeAttr(l.mapTitle)}"${wide ? ' data-reveal' : ' style="margin-top:24px;"'}>
  <div class="map-placeholder">
    <span class="map-pin" aria-hidden="true">${infoSvg('pin')}</span>
    <strong${m([['data-org', 'location.name']])}>${ctx.text(l.name)}</strong>
    <span class="map-address"${m([['data-org', 'location.address']])}>${ctx.text(l.address)}</span>
    <button type="button" class="btn btn-dark btn-sm map-embed-btn">${ctx.text(b.labels.show)}</button>
    <a class="map-link"${m([['data-org-attr', 'href:location.mapsUrl']])} href="${escapeAttr(safeMapUrl(l.mapsUrl))}" target="_blank" rel="noopener noreferrer">${ctx.text(b.labels.open)}</a>
    <p class="map-note">${ctx.text(b.labels.note)}</p>
  </div>
</div>`;
    },
  },

  // Emplacement des actualités, rempli par assets/js/actualites.js (identifiants fixés par le moteur).
  news_feed: {
    check(b, _check, ctx) {
      allowKeys(b, 'news_feed', ['variant', 'empty'], ['type', 'limit', 'more', 'filters']);
      if (b.variant === 'teaser') {
        allowKeys(b.empty, 'news_feed.empty', ['text', 'link']);
        need(isSegments(b.empty.text), 'news_feed.empty.text : segments');
        BLOCKS.link.check(b.empty.link);
        BLOCKS.link.check(b.more);
        need(Number.isInteger(b.limit) && b.limit > 0 && b.limit <= 12, 'news_feed.limit : 1 à 12');
        need(b.filters === undefined, 'news_feed : filtres réservés à la variante complète');
      } else {
        need(b.variant === 'full', `news_feed : variante inconnue ${b.variant}`);
        allowKeys(b.empty, 'news_feed.empty', ['eyebrow', 'title', 'text']);
        need(isText(b.empty.eyebrow) && isSegments(b.empty.title) && isSegments(b.empty.text), 'news_feed.empty : pastille, titre, texte');
        need(isSegments(b.filters) && b.filters[0].key === 'all', 'news_feed.filters : « all » en premier');
        for (const f of b.filters) {
          allowKeys(f, 'news_feed.filter', ['key', 'label']);
          need(f.key === 'all' || ctx.site.news?.categories?.[f.key], `news_feed : catégorie inconnue ${f.key}`);
          need(isText(f.label), 'news_feed.filter.label : texte');
        }
        need(b.limit === undefined && b.more === undefined, 'news_feed : limite et lien réservés à l’aperçu');
      }
    },
    render(b, ctx) {
      if (b.variant === 'teaser') {
        return `<div class="section-head center" id="actualites-empty" hidden>
  <p class="section-sub">${T(b.empty.text, ctx)}</p>
  ${BLOCKS.link.render(b.empty.link, ctx)}
</div>

<div class="news-grid" id="actualites-grid" data-limit="${b.limit}" hidden></div>
<p style="text-align:center;margin-top:32px;" id="actualites-more" hidden>${BLOCKS.link.render(b.more, ctx)}</p>`;
      }
      const filters = b.filters
        .map((f, i) => `  <button class="filter-btn${i === 0 ? ' is-active' : ''}" data-filter="${escapeAttr(f.key)}">${ctx.text(f.label)}</button>`)
        .join('\n');
      return `<div class="section-head center" data-reveal id="actualites-empty" hidden>
  <span class="eyebrow">${ctx.text(b.empty.eyebrow)}</span>
  <h2 class="section-title">${T(b.empty.title, ctx)}</h2>
  <p class="section-sub">${T(b.empty.text, ctx)}</p>
</div>

<div class="filters" id="actualites-filters" hidden>
${filters}
</div>

<div class="news-grid" id="actualites-grid" hidden></div>`;
    },
  },

  // Fiche d'une personne : pastille, initiale, nom, rôle, points clés.
  profile_card: {
    check(b) {
      allowKeys(b, 'profile_card', ['eyebrow', 'initial', 'name', 'role', 'points'], ['type']);
      need(isText(b.eyebrow) && isText(b.name) && isText(b.role), 'profile_card : pastille, nom et rôle');
      need(typeof b.initial === 'string' && /^\S{1,2}$/u.test(b.initial), 'profile_card.initial : 1 ou 2 caractères');
      need(isSegments(b.points) && b.points.every(isText), 'profile_card.points : textes');
    },
    render: (b, ctx) => `<div class="card" data-reveal>
  <div class="card-body">
    <span class="eyebrow" style="margin-bottom:4px;">${ctx.text(b.eyebrow)}</span>
    <div style="display:flex;align-items:center;gap:16px;margin:6px 0 4px;">
      <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--gold-400),var(--gold-600));display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:1.1rem;color:var(--maroon-950);flex-shrink:0;">${ctx.text(b.initial)}</div>
      <div>
        <h3 style="margin-bottom:2px;font-size:1.05rem;">${ctx.text(b.name)}</h3>
        <span class="role">${ctx.text(b.role)}</span>
      </div>
    </div>
    <ul style="display:flex;flex-direction:column;gap:10px;margin-top:14px;">
${b.points.map((p) => `      <li style="display:flex;gap:10px;align-items:flex-start;color:var(--color-text-muted);font-size:.92rem;"><span style="width:6px;height:6px;border-radius:50%;background:var(--gold-500);margin-top:7px;flex-shrink:0;"></span>${ctx.text(p)}</li>`).join('\n')}
    </ul>
  </div>
</div>`,
  },

  // Texte long découpé en articles (pages légales) : pastille, titre, paragraphes.
  articles: {
    check(b) {
      allowKeys(b, 'articles', ['items'], ['type']);
      need(isSegments(b.items), 'articles.items : articles requis');
      for (const item of b.items) {
        allowKeys(item, 'articles.item', ['eyebrow', 'title', 'paragraphs']);
        need(isText(item.eyebrow) && isText(item.title), 'articles.item : pastille et titre');
        need(isSegments(item.paragraphs) && item.paragraphs.every(isSegments), 'articles.item.paragraphs : paragraphes en segments');
      }
    },
    render: (b, ctx) =>
      b.items
        .map((item, i) => {
          const style = i < b.items.length - 1 ? ' style="margin-bottom:32px;"' : '';
          const paragraphs = item.paragraphs.map((p) => `  <p>${T(p, ctx)}</p>`).join('\n');
          return `<div data-reveal${style}>\n  <span class="eyebrow">${ctx.text(item.eyebrow)}</span>\n  <h2 class="section-title" style="font-size:1.4rem;">${ctx.text(item.title)}</h2>\n${paragraphs}\n</div>`;
        })
        .join('\n\n'),
  },

  // Formulaire de contact envoyé à functions/api/contact.js (depuis le 2026-10-09, FormSubmit auparavant), qui l'adresse
  // depuis la boîte du site à son adresse publique : champs, noms et destination fixés par le moteur ; seuls les
  // libellés viennent de la configuration. Sans JavaScript, envoi classique puis retour sur la page (?envoi=ok|erreur) ;
  // avec assets/js/contact.js, envoi sans quitter la page. « subjectLine » (ancien objet FormSubmit) n'est plus utilisé.
  contact_form: {
    check(b, _check, ctx) {
      allowKeys(b, 'contact_form', ['name', 'email', 'subject', 'message', 'consent', 'submit'], ['type', 'subjectLine', 'sent']);
      for (const key of ['name', 'email', 'message']) {
        allowKeys(b[key], `contact_form.${key}`, ['label', 'placeholder']);
        need(isText(b[key].label) && isText(b[key].placeholder), `contact_form.${key} : libellé et exemple`);
      }
      allowKeys(b.subject, 'contact_form.subject', ['label', 'options']);
      need(isText(b.subject.label) && isSegments(b.subject.options) && b.subject.options.every(isText), 'contact_form.subject : libellé et choix');
      need(isText(b.submit) && isSegments(b.consent), 'contact_form : bouton, consentement');
      need(b.subjectLine === undefined || isText(b.subjectLine), 'contact_form.subjectLine : texte');
      if (b.sent !== undefined) {
        allowKeys(b.sent, 'contact_form.sent', ['title', 'text']);
        need(isText(b.sent.title) && isText(b.sent.text), 'contact_form.sent : titre et texte');
      }
      safeHref(`mailto:${ctx.site.contact.email}`);
    },
    render: (b, ctx) => `<form id="formulaire-contact" action="/api/contact" method="POST" data-track-event="contact_form_submit">
  <p id="contact-error" class="form-alert" role="alert" hidden></p>
  <input type="text" name="site_web" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">
  <div class="form-row">
    <div class="form-field">
      <label for="contact-nom">${ctx.text(b.name.label)}</label>
      <input type="text" id="contact-nom" name="nom" placeholder="${escapeAttr(b.name.placeholder)}" maxlength="100" autocomplete="name" required>
    </div>
    <div class="form-field">
      <label for="contact-email">${ctx.text(b.email.label)}</label>
      <input type="email" id="contact-email" name="email" placeholder="${escapeAttr(b.email.placeholder)}" maxlength="200" autocomplete="email" required>
    </div>
  </div>
  <div class="form-field">
    <label for="sujet">${ctx.text(b.subject.label)}</label>
    <select id="sujet" name="sujet">
${b.subject.options.map((o) => `      <option>${ctx.text(o)}</option>`).join('\n')}
    </select>
  </div>
  <div class="form-field">
    <label for="message">${ctx.text(b.message.label)}</label>
    <textarea id="message" name="message" rows="4" placeholder="${escapeAttr(b.message.placeholder)}" maxlength="5000" required></textarea>
  </div>
  <div class="form-field">
    <label style="display:flex;align-items:flex-start;gap:10px;font-weight:400;font-size:.92rem;">
      <input type="checkbox" id="contact-rgpd" name="rgpd" required style="margin-top:3px;">
      <span>${T(b.consent, ctx)}</span>
    </label>
  </div>
  <div id="contact-turnstile"></div>
  <button type="submit" class="btn btn-primary btn-block">${ctx.text(b.submit)}</button>
</form>
<div id="contact-sent" class="form-result" role="status" tabindex="-1" hidden>
  <h3>${ctx.text(b.sent?.title ?? ctx.strings.contactSentTitle)}</h3>
  <p>${ctx.text(b.sent?.text ?? ctx.strings.contactSentText)}</p>
</div>`,
  },
};

export function renderBlock(block, ctx) {
  const type = BLOCKS[block?.type];
  if (!type) throw new Error(`Type de bloc inconnu : ${block?.type}`);
  return type.render(block, ctx);
}

// Vérifie un bloc et ses enfants (types permis dans le contexte, clés, variantes, URL, assets).
export function checkBlock(block, ctx, allowed) {
  need(block && typeof block === 'object', 'bloc : objet attendu');
  const type = BLOCKS[block.type];
  need(type, `type de bloc inconnu : ${block.type}`);
  if (allowed) need(allowed.includes(block.type), `bloc ${block.type} non permis ici`);
  type.check(block, (child, childAllowed) => checkBlock(child, ctx, childAllowed), ctx);
}
