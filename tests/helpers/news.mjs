// Outils communs des tests de la phase 4E.1 (Actualités CRM) : base D1 simulée (node:sqlite, vraies requêtes),
// organisation A (Sportville) et organisation B (« Atelier Exemple », tests/fixtures, jamais en production) avec
// un site publié, source legacy fictive.
import { createD1, createKV } from './d1.mjs';
import { ensureSchema, resetSchemaCacheForTests } from '../../functions/_shared/inscriptions-db.js';
import { clearPublishedSiteCache, saveDraftSiteConfig, publishSiteConfig } from '../../functions/_shared/site-config.js';
import { setNewsSourcesForTests } from '../../functions/_shared/news.js';
import { DEMO_ORG_ID } from '../../functions/_shared/schema.js';
import { exempleSite } from '../fixtures/site-exemple.mjs';

export const A = DEMO_ORG_ID;
export const B = exempleSite.organizationId;
export const ctxA = Object.freeze({ organizationId: A });
export const ctxB = Object.freeze({ organizationId: B });

// Source legacy fictive de A (même format que content/articles.json).
export const LEGACY = Object.freeze({
  articles: [
    {
      title: 'Premier article',
      date: '2026-09-01',
      category: 'club',
      slug: 'premier-article',
      excerpt: 'Résumé du premier article.',
      body: 'Paragraphe un.\n\nParagraphe deux\nsur deux lignes : - tiret, # dièse, *étoile*.',
      image: '/assets/images/actualites/photo club.jpg',
    },
    {
      title: 'Second article',
      date: '2026-09-02',
      category: 'benevolat',
      slug: 'second-article',
      excerpt: 'Résumé du second.',
      body: '- première ligne\n- seconde ligne\n\n1. numérotée',
      image: '',
    },
  ],
});

export const clone = (value) => JSON.parse(JSON.stringify(value));

export async function setupNews({ legacy = LEGACY, withB = true } = {}) {
  resetSchemaCacheForTests();
  clearPublishedSiteCache();
  setNewsSourcesForTests({ [A]: clone(legacy) });
  const env = { DB: createD1(), INSCRIPTION_STATUS: createKV() };
  await ensureSchema(env.DB);
  if (withB) {
    await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'atelier-exemple', 'Atelier Exemple')").bind(B).run();
    await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
    await publishSiteConfig(env, B, { expectedRevision: 1 });
  }
  return env;
}

// Brouillon valide (catégorie de A par défaut).
export const draft = (overrides = {}) => ({
  v: 1,
  title: 'Titre',
  excerpt: 'Résumé',
  content: 'Un paragraphe.',
  category: 'club',
  date: '2026-09-01',
  seoTitle: null,
  seoDescription: null,
  ...overrides,
});

export const rowOf = (env, id) => env.DB.prepare('SELECT * FROM articles WHERE id = ?').bind(id).first();
export const stateOf = (env, org) => env.DB.prepare('SELECT * FROM organization_news_state WHERE organization_id = ?').bind(org).first();
export const countArticles = async (env, org) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM articles${org ? ' WHERE organization_id = ?' : ''}`).bind(...(org ? [org] : [])).first()).n;
