// Icônes au trait (24×24, épaisseur 1,8), dessinées pour le prototype.
// Représentation STRUCTURELLE : chaque icône est une liste de formes [élément, attributs], jamais du balisage.
// Éléments et attributs appartiennent à des listes fermées, les valeurs sont validées au chargement du module, et le
// rendu passe uniquement par `html` (échappement). Aucune donnée d'exécution ne peut devenir un nom d'élément, un nom
// d'attribut, du balisage ou un gestionnaire d'événement : l'appelant ne choisit qu'un nom d'icône du catalogue.
import { html } from '../lib/html.js';

const ICONS = {
  dashboard: [['rect', {x:3.5,y:3.5,width:7,height:8,rx:1.5}], ['rect', {x:13.5,y:3.5,width:7,height:5,rx:1.5}], ['rect', {x:13.5,y:11.5,width:7,height:9,rx:1.5}], ['rect', {x:3.5,y:14.5,width:7,height:6,rx:1.5}]],
  building: [['path', {d:'M4 20.5V6.5l8-3 8 3v14'}], ['path', {d:'M2.5 20.5h19'}], ['path', {d:'M9 20.5v-4h6v4'}], ['path', {d:'M8.5 9h1M14.5 9h1M8.5 12.5h1M14.5 12.5h1'}]],
  rocket: [['path', {d:'M12 15.5 8.5 12c.8-4.6 3.6-7.9 9-8.5-.6 5.4-3.9 8.2-8.5 9'}], ['path', {d:'M8.5 12 6 11.5 4 13.5l3.5 1M12 15.5l.5 2.5-2 2-1-3.5'}], ['circle', {cx:15,cy:9,r:1.4}]],
  globe: [['circle', {cx:12,cy:12,r:8.5}], ['path', {d:'M3.5 12h17M12 3.5c2.4 2.6 3.5 5.4 3.5 8.5s-1.1 5.9-3.5 8.5c-2.4-2.6-3.5-5.4-3.5-8.5s1.1-5.9 3.5-8.5Z'}]],
  layers: [['path', {d:'m12 3.5 8.5 4.5-8.5 4.5L3.5 8z'}], ['path', {d:'m3.5 12.5 8.5 4.5 8.5-4.5'}], ['path', {d:'m3.5 16.5 8.5 4.5 8.5-4.5',opacity:0.55}]],
  pulse: [['path', {d:'M3 12h4l2.5-6 4 12 2.5-6H21'}]],
  lifebuoy: [['circle', {cx:12,cy:12,r:8.5}], ['circle', {cx:12,cy:12,r:3.5}], ['path', {d:'m6 6 3.5 3.5M14.5 14.5 18 18M18 6l-3.5 3.5M9.5 14.5 6 18'}]],
  scroll: [['path', {d:'M7 3.5h10.5v14a3 3 0 0 1-3 3H6.5a3 3 0 0 1-3-3v-1h11v1'}], ['path', {d:'M7 3.5a2 2 0 0 0-2 2V16.5M10 8h5M10 11.5h5'}]],
  settings: [['circle', {cx:12,cy:12,r:3}], ['path', {d:'M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V20.5a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3.5a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3.5a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1Z'}]],
  search: [['circle', {cx:11,cy:11,r:6.5}], ['path', {d:'m20.5 20.5-4.8-4.8'}]],
  bell: [['path', {d:'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z'}], ['path', {d:'M10 21h4'}]],
  plus: [['path', {d:'M12 5v14M5 12h14'}]],
  chevronRight: [['path', {d:'m9.5 6 6 6-6 6'}]],
  chevronLeft: [['path', {d:'m14.5 6-6 6 6 6'}]],
  chevronDown: [['path', {d:'m6 9.5 6 6 6-6'}]],
  sort: [['path', {d:'m8 9 4-4 4 4M8 15l4 4 4-4'}]],
  menu: [['path', {d:'M4 7h16M4 12h16M4 17h16'}]],
  x: [['path', {d:'M6 6l12 12M18 6 6 18'}]],
  check: [['path', {d:'m5 12.5 4.5 4.5L19 7.5'}]],
  alert: [['path', {d:'M12 4 2.8 19.5h18.4z'}], ['path', {d:'M12 10v4.5M12 17.3v.2'}]],
  info: [['circle', {cx:12,cy:12,r:8.5}], ['path', {d:'M12 11v5.5M12 7.7v.2'}]],
  users: [['circle', {cx:9,cy:8,r:3.5}], ['path', {d:'M2.5 20a6.5 6.5 0 0 1 13 0'}], ['path', {d:'M16 4.8a3.5 3.5 0 0 1 0 6.4M18 13.5a6.5 6.5 0 0 1 3.5 6.5'}]],
  user: [['circle', {cx:12,cy:8,r:4}], ['path', {d:'M4.5 20.5a7.5 7.5 0 0 1 15 0'}]],
  database: [['ellipse', {cx:12,cy:6,rx:7.5,ry:2.8}], ['path', {d:'M4.5 6v12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8V6M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8'}]],
  server: [['rect', {x:3.5,y:4,width:17,height:7,rx:2}], ['rect', {x:3.5,y:13,width:17,height:7,rx:2}], ['path', {d:'M7.5 7.5h.1M7.5 16.5h.1'}]],
  mail: [['rect', {x:3,y:5,width:18,height:14,rx:2.5}], ['path', {d:'m3.5 7 8.5 6 8.5-6'}]],
  disk: [['path', {d:'M4 14.5 6.5 5h11l2.5 9.5v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'}], ['path', {d:'M4 14.5h16M16.5 17.5h.1'}]],
  zap: [['path', {d:'M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z'}]],
  lock: [['rect', {x:4.5,y:10.5,width:15,height:10,rx:2}], ['path', {d:'M8 10.5V7.5a4 4 0 0 1 8 0v3'}]],
  shield: [['path', {d:'M12 3 4.5 6v5.5c0 4.6 3.1 8.1 7.5 9.5 4.4-1.4 7.5-4.9 7.5-9.5V6z'}], ['path', {d:'m8.8 12 2.3 2.3 4.2-4.3'}]],
  copy: [['rect', {x:8.5,y:8.5,width:12,height:12,rx:2}], ['path', {d:'M15.5 8.5v-3a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3'}]],
  external: [['path', {d:'M14 4h6v6M20 4l-9 9M18 14v4.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2H10'}]],
  more: [['circle', {cx:5.5,cy:12,r:1.8,fill:'currentColor'}], ['circle', {cx:12,cy:12,r:1.8,fill:'currentColor'}], ['circle', {cx:18.5,cy:12,r:1.8,fill:'currentColor'}]],
  filter: [['path', {d:'M3.5 5h17l-6.5 8v6l-4 1.5V13z'}]],
  refresh: [['path', {d:'M20 11a8 8 0 0 0-14.4-4.3L4 8.5M4 13a8 8 0 0 0 14.4 4.3L20 15.5'}], ['path', {d:'M4 4v4.5h4.5M20 20v-4.5h-4.5'}]],
  calendar: [['rect', {x:3.5,y:5,width:17,height:15.5,rx:2.5}], ['path', {d:'M3.5 10h17M8 3v4M16 3v4'}]],
  card: [['rect', {x:2.5,y:5,width:19,height:14,rx:2.5}], ['path', {d:'M2.5 10h19M6.5 15h4'}]],
  file: [['path', {d:'M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z'}], ['path', {d:'M14 3.5v5h5M8.5 13h7M8.5 16.5h5'}]],
  news: [['rect', {x:3.5,y:4.5,width:17,height:15,rx:2}], ['path', {d:'M7 8.5h10M7 12h6M7 15.5h6M15.5 12h1.5v3.5h-1.5z'}]],
  download: [['path', {d:'M12 4v11M7 10.5l5 5 5-5M4.5 20h15'}]],
  trendUp: [['path', {d:'m3.5 16.5 6-6 4 4 7-7'}], ['path', {d:'M15 7.5h5.5V13'}]],
  sparkles: [['path', {d:'M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6-5.7-1.8L10.2 9z'}], ['path', {d:'M19 3.5v3M17.5 5h3'}]],
  key: [['circle', {cx:8,cy:15,r:4.5}], ['path', {d:'m11.5 11.5 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l1.8 1.8'}]],
  eye: [['path', {d:'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z'}], ['circle', {cx:12,cy:12,r:3}]],
  logout: [['path', {d:'M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16.5 14.5 12 10 7.5M14.5 12H3.5'}]],
  help: [['circle', {cx:12,cy:12,r:8.5}], ['path', {d:'M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7M12 17.2v.2'}]],
  pause: [['rect', {x:6,y:5,width:4,height:14,rx:1}], ['rect', {x:14,y:5,width:4,height:14,rx:1}]],
  flag: [['path', {d:'M5 21V4.5M5 4.5h11l-2 4 2 4H5'}]],
  palette: [['path', {d:'M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.6-.8 1.6-1.6 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.6-1.6h2.3a4 4 0 0 0 4-4c0-4.1-3.8-7.2-8.5-7.2Z'}], ['circle', {cx:7.5,cy:12,r:1}], ['circle', {cx:9.5,cy:7.8,r:1}], ['circle', {cx:14.5,cy:7.8,r:1}]],
  arrowRight: [['path', {d:'M5 12h14M13 6l6 6-6 6'}]],
  clock: [['circle', {cx:12,cy:12,r:8.5}], ['path', {d:'M12 7.5V12l3 2'}]],
  trophy: [['path', {d:'M7.5 4.5h9V9a4.5 4.5 0 0 1-9 0zM7.5 6.5H4.5a3 3 0 0 0 3 4M16.5 6.5h3a3 3 0 0 1-3 4M12 13.5v3.5M8.5 20.5h7M9.5 17h5v3.5h-5z'}]],
};

// Listes fermées : uniquement ce que les icônes actuelles utilisent.
const ELEMENTS = new Set(['path', 'circle', 'ellipse', 'rect']);
const NUMERIC = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'opacity']);
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,600}$/;
const FILLS = new Set(['currentColor', 'none']);

function validShape(shape) {
  if (!Array.isArray(shape) || shape.length !== 2 || !ELEMENTS.has(shape[0])) return false;
  const attrs = shape[1];
  if (!attrs || typeof attrs !== 'object' || Object.getPrototypeOf(attrs) !== Object.prototype) return false;
  return Object.entries(attrs).every(([name, value]) => {
    if (NUMERIC.has(name)) return typeof value === 'number' && Number.isFinite(value);
    if (name === 'd') return typeof value === 'string' && PATH_DATA.test(value);
    if (name === 'fill') return FILLS.has(value);
    return false;
  });
}

// Contrôle au chargement : un tracé invalide ajouté au catalogue fait échouer le module (et les tests).
for (const [name, shapes] of Object.entries(ICONS)) {
  if (!Array.isArray(shapes) || !shapes.length || !shapes.every(validShape)) throw new Error(`icône invalide : ${name}`);
  shapes.forEach((s) => Object.freeze(s[1]) && Object.freeze(s));
  Object.freeze(shapes);
}
Object.freeze(ICONS);

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

const shape = ([element, attrs]) => html`<${element}${Object.entries(attrs).map(([name, value]) => html` ${name}="${value}"`)}/>`;

// Nom hors catalogue : icône d'information. Taille : entier de 1 à 64, sinon 18.
export const icon = (name, size = 18) => {
  const shapes = typeof name === 'string' && Object.hasOwn(ICONS, name) ? ICONS[name] : ICONS.info;
  const px = Number.isInteger(size) && size > 0 && size <= 64 ? size : 18;
  return html`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes.map(shape)}</svg>`;
};
