// Actualités d'une organisation (liste et détail), toujours rattachées à l'organisation résolue CÔTÉ SERVEUR (domaine
// de la requête). Un article n'est cherché par son slug QUE parmi les articles de son organisation.
//
// Les fichiers d'actualités NE SONT PAS publiés (content/ est un dossier interne, hors de dist/ et refusé par
// internal-paths.js sous toutes ses écritures) : ils sont intégrés au code des Functions à la publication, par le
// module functions/_generated/articles.js que scripts/build-news.mjs génère depuis content/articles.json (build Pages,
// tests), et lus uniquement ici. Pas d'import JSON direct : wrangler 3 (build Pages) ne comprend pas `with { type }`. Le CMS (Sveltia, admin/config.yml) modifie toujours
// content/articles.json dans le dépôt : chaque modification redéploie le site, donc ce module.
// L'attribution d'un fichier à une organisation est faite par le code, jamais par une configuration modifiable ni
// par le navigateur.
import demoArticles from '../_generated/articles.js';
import { DEMO_ORG_ID } from './schema.js';

const SOURCES = Object.freeze({ [DEMO_ORG_ID]: demoArticles });
let sources = SOURCES;

export class NewsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NewsUnavailableError';
  }
}

// Accès UNIQUE à la source legacy (contrat 4E §23) : copie profonde des articles historiques de l'organisation,
// jamais la référence du module. Organisation absente de SOURCES (autre organisation, inconnue, identifiant
// malformé) : []. Fichier présent mais invalide : NewsUnavailableError (l'appelant répond 503, sans rien deviner).
// Utilisé par la lecture publique en source `json`, l'import, l'audit, la validation et la bascule (digest).
// Aucun autre module n'importe functions/_generated/articles.js (tests/news-4e1.test.mjs le vérifie).
export function legacyArticlesForOrganization(organizationId) {
  if (typeof organizationId !== 'string' || !Object.prototype.hasOwnProperty.call(sources, organizationId)) return [];
  const data = sources[organizationId];
  if (!data || typeof data !== 'object' || !Array.isArray(data.articles)) throw new NewsUnavailableError('Actualités : fichier invalide');
  return structuredClone(data.articles);
}

// Articles publics de l'organisation (source `json`) : tableau (vide si elle n'en a pas), entrées sans slug écartées.
export function articlesForOrganization(organizationId) {
  return legacyArticlesForOrganization(organizationId).filter((a) => a && typeof a === 'object' && typeof a.slug === 'string');
}

export function findArticle(organizationId, slug) {
  return articlesForOrganization(organizationId).find((a) => a.slug === slug) || null;
}

// Tests et serveur des tests visuels uniquement : actualités fictives par organisation ({ organisationId: { articles } }).
// null : sources réelles.
export function setNewsSourcesForTests(map) {
  sources = map ? Object.freeze({ ...map }) : SOURCES;
}
