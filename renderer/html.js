// Échappement contextuel et contrôle des URL du moteur de site (phase 4D.1).
// Toute valeur de configuration passe par l'une de ces fonctions avant d'entrer dans le HTML : texte, attribut,
// URL, chemin d'image ou JSON-LD. Aucune fonction du moteur n'insère une valeur brute.

// Texte : & < > échappés ; l'espace insécable s'écrit &nbsp; (forme utilisée par les pages historiques).
// Les apostrophes et guillemets restent tels quels : sans danger hors attribut.
export const escapeText = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');

// Attribut (toujours entre guillemets doubles dans le moteur) : & < > " échappés.
export const escapeAttr = (value) =>
  String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Échappement strict (texte et attribut, apostrophes et guillemets compris) : contenu venu d'un CMS ou d'un
// fichier éditable (actualités).
export const escapeStrict = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// JSON-LD compact (une ligne), même protection.
export const jsonLdCompact = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

// JSON-LD dans <script> : « < » échappé en <, un « </script> » dans une valeur ne peut pas fermer le bloc.
export const jsonLd = (value) => JSON.stringify(value, null, 2).replace(/</g, '\\u003c');

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const CONTROL_OR_SPACE = /[\u0000- \u007f-\u009f]/;

// URL de lien. Autorisés : chemin absolu du site (/…, jamais //…), ancre (#…), https:, http:, mailto:, tel:.
// Refusés : javascript:, data:, vbscript:, file:, chemins relatifs ambigus, caractères de contrôle, espaces,
// identifiants dans l'URL (https://utilisateur:motdepasse@…).
// Lève une erreur (échec fermé) : une configuration invalide ne produit jamais de page.
export function safeHref(url) {
  const value = String(url ?? '');
  if (!value || CONTROL_OR_SPACE.test(value) || value.includes('\\')) throw new Error(`URL refusée : ${JSON.stringify(value)}`);
  if (value.startsWith('#')) return value;
  if (value.startsWith('/')) {
    if (value.startsWith('//') || /(^|\/)\.\.?(\/|$)/.test(value)) throw new Error(`Chemin refusé : ${value}`);
    return value;
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'https' || scheme === 'http') {
    const parsed = parseUrl(value);
    if (!parsed?.hostname || parsed.username || parsed.password) throw new Error(`URL refusée : ${value}`);
    return value;
  }
  if (scheme === 'mailto' && /^mailto:[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/i.test(value)) return value;
  if (scheme === 'tel' && /^tel:\+?[0-9]{6,15}$/.test(value)) return value;
  throw new Error(`URL refusée : ${JSON.stringify(value)}`);
}

// Chemin d'asset public (image, icône, police, manifeste) : relatif au site, sous un dossier public connu,
// sans traversée, sans protocole, sans caractère spécial. Rendu relatif (« assets/… ») ou absolu (« /assets/… »)
// selon la page (base « » ou « / »).
const PUBLIC_ASSET = /^(assets\/(images|fonts)\/[A-Za-z0-9_.\/-]+|manifest(-admin)?\.json)$/;
export function safeAssetPath(path) {
  const value = String(path ?? '');
  if (!PUBLIC_ASSET.test(value) || /(^|\/)\.\.?(\/|$)/.test(value) || value.includes('//')) throw new Error(`Chemin d'asset refusé : ${JSON.stringify(value)}`);
  return value;
}

// URL absolue publique (canonical, og:url, og:image) : https uniquement, sans caractère de contrôle. L'espace est
// admis (images du CMS aux noms de fichiers réels) : la valeur est toujours écrite échappée, entre guillemets.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
export function safeAbsoluteUrl(url) {
  const value = String(url ?? '');
  if (CONTROL.test(value)) throw new Error(`URL refusée : ${JSON.stringify(value)}`);
  const parsed = parseUrl(value);
  // Identifiants dans l'URL (https://utilisateur:motdepasse@…) refusés.
  if (!parsed?.hostname || parsed.username || parsed.password) throw new Error(`URL refusée : ${JSON.stringify(value)}`);
  if (parsed.protocol !== 'https:') throw new Error(`URL absolue non https refusée : ${value}`);
  return value;
}
