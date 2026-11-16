// Aides d'écriture des textes « en segments » (renderer/inline.js). Ce sont de simples constructeurs : ils
// produisent des objets de données (sérialisables en JSON), jamais du HTML, et ne sont pas conservés dans la
// configuration elle-même.

// Valeur publique vivante (functions/_shared/page-data.js) avec sa valeur de secours.
export const org = (key, fallback, tag = 'span') => ({ bind: { tag, attrs: [['data-org', key]], children: [fallback] } });
// Élément affiché seulement si la donnée publique existe.
export const orgIf = (key, ...children) => ({ bind: { tag: 'span', attrs: [['data-org-if', key]], children } });
// Liste ou phrase calculée à partir des données publiques (valeur de secours en segments).
export const orgList = (key, ...children) => ({ bind: { tag: 'span', attrs: [['data-org-list', key]], children } });
// Liaison libre (attributs data-org-* explicites).
export const bind = (tag, attrs, ...children) => ({ bind: { tag, attrs, children } });

export const link = (href, ...children) => ({ link: { href, children } });
export const linkVariant = (variant, href, ...children) => ({ link: { href, variant, children } });
export const strong = (...children) => ({ strong: children });
export const accent = (...children) => ({ strong: { variant: 'accent', children } });
export const em = (...children) => ({ em: children });
export const nowrap = (...children) => ({ nowrap: children });
export const br = { br: true };
export const hook = (attr, children, attrs) => ({ hook: attrs ? { attr, bind: attrs, children } : { attr, children } });
