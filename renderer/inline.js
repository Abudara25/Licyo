// Texte « en segments » : seul format de texte enrichi accepté par la configuration d'un site (phase 4D.1).
// Pas de HTML libre : un segment est soit du texte (échappé), soit un nœud d'un type connu.
//
//   "texte"                                   texte échappé
//   { br: true }                              saut de ligne
//   { em: [segments] }                        emphase
//   { strong: [segments] }                    importance ; { strong: { variant: "accent", children } } : couleur
//                                             d'accent du thème
//   { nowrap: [segments] }                    groupe de mots insécable
//   { link: { href, variant?, bind?, children: [segments] } }
//        variant : absent | "inherit-underline" | "new-tab" | "card" | "external" | "external-nofollow" (attributs fixés
//        par le moteur)
//   { hook: { attr, bind?, children: [segments] } }   point d'accroche d'un script public (liste fermée)
//   { bind: { tag: "span"|"strong", variant?, attrs: [[nom, valeur], …], children: [segments] } }
//        liaison de données publiques : en mode « markers », l'élément porte les attributs data-org-* que
//        functions/_shared/page-data.js remplit à l'exécution (children = valeur de secours) ; en mode « static »,
//        les attributs data-org-* ne sont pas écrits, et une enveloppe span/strong qui n'aurait plus aucun
//        attribut est omise (seule différence de DOM entre les modes : liens, crochets, blocs et listes gardent
//        exactement la même structure, phase 4D.2A).
import { escapeAttr, escapeText, safeHref } from './html.js';

const LINK_VARIANTS = {
  'inherit-underline': ' style="color:inherit;text-decoration:underline;"',
  'new-tab': ' target="_blank"',
  card: ' class="card-link"',
  external: ' target="_blank" rel="noopener"',
  'external-nofollow': ' target="_blank" rel="nofollow noopener"',
};
const BIND_TAGS = new Set(['span', 'strong']);
const BIND_ATTR = /^data-org(-if|-list|-attr|-cards|-jsonld)?$/;
const BIND_VALUE = /^[A-Za-z0-9_.:;,-]+$/;
// Points d'accroche lus par les scripts publics (assets/js/inscription.js : saison et montants affichés).
const SCRIPT_HOOKS = new Set(['data-saison-text', 'data-prix-block', 'data-prix-text', 'data-prix-passsport-text', 'data-prix-tiers-text']);
// Couleur d'accent du thème dynamic_diagonal v1 (balisage historique conservé à l'identique).
const ACCENT = ' style="color:var(--maroon-950);"';

function allowNodeKeys(value, type, required, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Segment ${type} invalide`);
  const known = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !known.has(key)) throw new Error(`Segment ${type} : clé inconnue « ${String(key)} »`);
  }
  for (const key of required) if (value[key] === undefined) throw new Error(`Segment ${type} : « ${key} » requis`);
}

export function bindAttrs(attrs = []) {
  if (!Array.isArray(attrs)) throw new Error('Liaisons : tableau attendu');
  return attrs
    .map((pair) => {
      const [name, value] = Array.isArray(pair) ? pair : [];
      if (!BIND_ATTR.test(name || '') || !BIND_VALUE.test(String(value))) throw new Error(`Liaison refusée : ${name}="${value}"`);
      return ` ${name}="${escapeAttr(value)}"`;
    })
    .join('');
}

// Attributs de liaison : validés dans les deux modes, écrits seulement en mode « markers ».
export const bindMarkers = (ctx, attrs) => (ctx.mode === 'markers' ? bindAttrs(attrs) : (bindAttrs(attrs), ''));

export function renderInline(segments, ctx) {
  if (!Array.isArray(segments)) throw new Error('Texte en segments attendu (tableau)');
  return segments.map((segment) => renderSegment(segment, ctx)).join('');
}

function renderSegment(segment, ctx) {
  if (typeof segment === 'string') return (ctx.text || escapeText)(segment);
  if (!segment || typeof segment !== 'object' || Array.isArray(segment)) throw new Error(`Segment invalide : ${JSON.stringify(segment)}`);
  const keys = Reflect.ownKeys(segment);
  if (keys.length !== 1) throw new Error(`Segment invalide (une seule clé attendue) : ${keys.join(', ')}`);
  const [type] = keys;
  if (typeof type !== 'string') throw new Error(`Type de segment invalide : ${String(type)}`);
  const node = segment[type];
  switch (type) {
    case 'br':
      if (node !== true) throw new Error('Segment br invalide');
      return '<br>';
    case 'em':
      return `<em>${renderInline(node, ctx)}</em>`;
    case 'strong': {
      if (Array.isArray(node)) return `<strong>${renderInline(node, ctx)}</strong>`;
      allowNodeKeys(node, 'strong', ['variant', 'children']);
      if (node?.variant !== 'accent') throw new Error(`Variante de strong inconnue : ${node?.variant}`);
      return `<strong${ACCENT}>${renderInline(node.children, ctx)}</strong>`;
    }
    case 'nowrap':
      return `<span style="white-space:nowrap;">${renderInline(node, ctx)}</span>`;
    case 'link': {
      allowNodeKeys(node, 'link', ['href', 'children'], ['variant', 'bind']);
      const variant = node?.variant ? LINK_VARIANTS[node.variant] : '';
      if (variant === undefined) throw new Error(`Variante de lien inconnue : ${node.variant}`);
      const bind = bindMarkers(ctx, node.bind);
      return `<a href="${escapeAttr(safeHref(node.href))}"${bind}${variant}>${renderInline(node.children, ctx)}</a>`;
    }
    case 'hook': {
      // Point d'accroche d'un script public (assets/js/*.js), écrit dans les deux modes : le script remplace le
      // texte côté navigateur. Seuls les attributs connus des scripts sont acceptés.
      allowNodeKeys(node, 'hook', ['attr', 'children'], ['bind']);
      if (!SCRIPT_HOOKS.has(node.attr)) throw new Error(`Point d'accroche inconnu : ${node.attr}`);
      return `<span ${node.attr}${bindMarkers(ctx, node.bind)}>${renderInline(node.children, ctx)}</span>`;
    }
    case 'bind': {
      allowNodeKeys(node, 'bind', ['tag', 'attrs', 'children'], ['variant']);
      if (!BIND_TAGS.has(node.tag)) throw new Error(`Balise de liaison refusée : ${node.tag}`);
      if (node.variant !== undefined && !(node.variant === 'accent' && node.tag === 'strong')) throw new Error(`Variante de liaison inconnue : ${node.variant}`);
      const attrs = bindMarkers(ctx, node.attrs);
      const inner = renderInline(node.children, ctx);
      // Mode « static » : une enveloppe qui ne porterait plus aucun attribut est omise (texte seul). La garder
      // découpe le texte en plusieurs segments inline et décale le lissage de quelques glyphes (mesuré en 4D.2A
      // sur le footer des actualités) ; c'est la seule différence de DOM entre les deux modes.
      if (ctx.mode !== 'markers' && !node.variant) return inner;
      return `<${node.tag}${node.variant ? ACCENT : ''}${attrs}>${inner}</${node.tag}>`;
    }
    default:
      throw new Error(`Type de segment inconnu : ${type}`);
  }
}
