// Phase 4D.2B : configuration du site en base, BROUILLON → PUBLICATION → SITE PUBLIC. Le site public ne lit que la
// version publiée ; l'admin lit le brouillon ; publier valide puis recopie le brouillon en une seule écriture ; rien
// ne franchit la frontière d'une organisation. L'organisation B (« Atelier Exemple », tests/fixtures) n'existe QUE ici.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readSiteConfig, saveDraftSiteConfig, publishSiteConfig, loadPublishedSite, referenceSiteJson, clearPublishedSiteCache,
  SiteConfigValidationError, SiteConfigNotFoundError, ConfigConflictError,
} from '../functions/_shared/site-config.js';
import { onRequest, clearPageDataCache } from '../functions/_shared/page-data.js';
import { onRequestGet as articleFunction } from '../functions/actualites/[slug].js';
import { clearOrganizationCache } from '../functions/_shared/organization.js';
import { setNewsSourcesForTests } from '../functions/_shared/news.js';
import { DEMO_ORG_ID, MIGRATIONS } from '../functions/_shared/schema.js';
import { site as demoSite } from '../sites/club-demo/site.js';
import { exempleSite } from './fixtures/site-exemple.mjs';
import { fixture, seedInscription } from './helpers/inscriptions.mjs';

const A = DEMO_ORG_ID;
const B = exempleSite.organizationId;
const A_HOST = 'clubdemo.licyo.fr';
const B_HOST = 'atelier.example';
const clone = (value) => JSON.parse(JSON.stringify(value));

const STATIC = { '/': 'index.html', '/equipe': 'equipe.html', '/partenaires': 'partenaires.html' };
const ARTICLES = JSON.stringify({ articles: [{ slug: 'demo', title: 'Démo', date: '2026-09-01', category: 'club', excerpt: 'Résumé', body: 'Texte.' }] });
const ASSETS = {
  fetch: async (input) => {
    const { pathname } = new URL(input instanceof Request ? input.url : String(input));
    if (pathname === '/404.html') return new Response('page 404', { headers: { 'Content-Type': 'text/html' } });
    const file = STATIC[pathname];
    if (!file) return new Response('introuvable', { status: 404 });
    return new Response(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  },
};

async function setup({ withB = true } = {}) {
  setNewsSourcesForTests({ [A]: JSON.parse(ARTICLES) });
  clearPublishedSiteCache();
  clearPageDataCache();
  clearOrganizationCache();
  const env = { ...(await fixture()), ASSETS };
  if (withB) {
    await env.DB.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'atelier-exemple', 'Atelier Exemple')").bind(B).run();
    await env.DB.prepare('INSERT INTO organization_domains (domain, organization_id) VALUES (?, ?)').bind(B_HOST, B).run();
  }
  return env;
}
const row = (env, org) => env.DB.prepare('SELECT * FROM site_configs WHERE organization_id = ?').bind(org).first();
const page = async (env, host, path) => {
  const response = await onRequest({ request: new Request(`https://${host}${path}`), env });
  return { status: response.status, html: await response.text() };
};
const article = async (env, host) =>
  (await articleFunction({ request: new Request(`https://${host}/actualites/demo`), params: { slug: 'demo' }, env })).text();

// Brouillon de Sportville avec une accroche reconnaissable.
const demoWithTagline = (tagline) => {
  const config = clone(demoSite);
  config.brand.tagline = tagline;
  return config;
};

// --- Migration et amorçage --------------------------------------------------------------------------------------

test('migrations 11 et 12 : table site_configs et marqueur d’initialisation, rien d’autre touché', async () => {
  const env = await setup({ withB: false });
  await seedInscription(env.DB);
  const { v } = await env.DB.prepare('SELECT MAX(version) AS v FROM schema_migrations').first();
  assert.equal(v, MIGRATIONS.at(-1).version);
  assert.deepEqual(MIGRATIONS.filter((m) => m.version === 11 || m.version === 12).map((m) => m.name), ['site_configs', 'site_config_initialized']);
  assert.equal(await row(env, A), null, 'aucun remplissage par la migration elle-même');
  await readSiteConfig(env, A);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM inscriptions WHERE organization_id = ?').bind(A).first()).n, 1, 'inscriptions intactes');
});

test('premier accès : la configuration de référence devient brouillon ET version publiée (déterministe, idempotent)', async () => {
  const env = await setup({ withB: false });
  const first = await readSiteConfig(env, A);
  assert.deepEqual(first.config, clone(demoSite));
  assert.equal(first.origin, 'reference');
  assert.equal(first.draftRevision, 1);
  assert.equal(first.publishedRevision, 1);
  assert.equal(first.hasUnpublishedChanges, false);
  const stored = await row(env, A);
  assert.equal(stored.draft_json, referenceSiteJson(A));
  assert.equal(stored.published_json, referenceSiteJson(A));
  await readSiteConfig(env, A);
  await loadPublishedSite(env, A);
  assert.deepEqual(await row(env, A), stored, 'second accès : rien ne change');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM site_configs').first()).n, 1);
});

test('référence du code : suivie tant que la ligne n’a jamais été modifiée, plus jamais ensuite', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  // Ligne créée par une version précédente du code (référence différente).
  const old = JSON.stringify(demoWithTagline('Ancienne accroche'));
  await env.DB.prepare('UPDATE site_configs SET draft_json = ?, published_json = ? WHERE organization_id = ?').bind(old, old, A).run();
  clearPublishedSiteCache();
  const aligned = await readSiteConfig(env, A, { stage: 'published' });
  assert.equal(aligned.config.brand.tagline, demoSite.brand.tagline, 'alignée sur la référence actuelle');
  assert.equal(aligned.publishedRevision, 2);

  const { draftRevision } = await saveDraftSiteConfig(env, A, demoWithTagline('Modifiée'), { expectedRevision: 2 });
  await publishSiteConfig(env, A, { expectedRevision: draftRevision });
  clearPublishedSiteCache();
  const edited = await readSiteConfig(env, A, { stage: 'published' });
  assert.equal(edited.origin, 'edited');
  assert.equal(edited.config.brand.tagline, 'Modifiée', 'une configuration modifiée n’est jamais écrasée par le code');
});

// Table perdue / altérée : voir tests/site-config-schema.test.mjs (échec fermé, jamais recréée ni réamorcée).

test('contraintes de la table : JSON invalide et révision nulle refusés par la base', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  await assert.rejects(env.DB.prepare("UPDATE site_configs SET draft_json = '{pas du json' WHERE organization_id = ?").bind(A).run());
  await assert.rejects(env.DB.prepare('UPDATE site_configs SET published_json = NULL WHERE organization_id = ?').bind(A).run(), 'publiée sans révision');
  await assert.rejects(env.DB.prepare('UPDATE site_configs SET draft_revision = 0 WHERE organization_id = ?').bind(A).run());
});

// --- Cycle de vie ------------------------------------------------------------------------------------------------

test('brouillon enregistré : la version publiée ne bouge pas ; admin = brouillon, public = publiée', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  const before = await row(env, A);
  const saved = await saveDraftSiteConfig(env, A, demoWithTagline('Brouillon'), { expectedRevision: 1 });
  assert.equal(saved.draftRevision, 2);
  assert.equal(saved.hasUnpublishedChanges, true);
  assert.equal(saved.origin, 'edited');

  const after = await row(env, A);
  assert.equal(after.published_json, before.published_json);
  assert.equal(after.published_revision, before.published_revision);
  assert.equal(after.published_at, before.published_at);

  assert.equal((await readSiteConfig(env, A)).config.brand.tagline, 'Brouillon', 'admin : brouillon par défaut');
  assert.equal((await readSiteConfig(env, A, { stage: 'published' })).config.brand.tagline, demoSite.brand.tagline);
  assert.equal((await loadPublishedSite(env, A)).config.brand.tagline, demoSite.brand.tagline, 'public : version publiée');
  assert.doesNotMatch((await page(env, A_HOST, '/equipe')).html, /Brouillon/, 'page publique inchangée');
  assert.doesNotMatch(await article(env, A_HOST), /Brouillon/, 'actualité inchangée');
});

test('publication : recopie exacte du brouillon validé, brouillon conservé, visible aussitôt côté public', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  await loadPublishedSite(env, A); // cache public rempli avant la publication
  await saveDraftSiteConfig(env, A, demoWithTagline('Publiée'), { expectedRevision: 1 });
  const published = await publishSiteConfig(env, A, { expectedRevision: 2 });
  assert.equal(published.publishedRevision, 2);
  assert.equal(published.hasUnpublishedChanges, false);
  const stored = await row(env, A);
  assert.equal(stored.published_json, stored.draft_json);
  assert.equal(JSON.parse(stored.draft_json).brand.tagline, 'Publiée', 'brouillon conservé');

  assert.equal((await loadPublishedSite(env, A)).config.brand.tagline, 'Publiée', 'cache invalidé après l’écriture');
  const equipe = await page(env, A_HOST, '/equipe');
  assert.equal(equipe.status, 200);
  assert.match(equipe.html, /Publiée/, 'page rendue depuis la version publiée');
  assert.match(equipe.html, /data-org=/, 'données publiques toujours injectées dans le rendu publié');
  assert.match(await article(env, A_HOST), /Publiée/, 'actualité rendue depuis la version publiée');
});

test('version publiée identique à la référence : le fichier statique est servi tel quel', async () => {
  const env = await setup({ withB: false });
  const direct = readFileSync('partenaires.html', 'utf8').replaceAll('\r\n', '\n');
  assert.equal((await page(env, A_HOST, '/partenaires')).html, direct);
});

test('brouillon invalide : publication refusée, version publiée intacte (rien d’écrit)', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  const invalid = clone(demoSite);
  invalid.pages[0].sections[0].type = 'inconnu';
  await saveDraftSiteConfig(env, A, invalid, { expectedRevision: 1 });
  const before = await row(env, A);
  await assert.rejects(publishSiteConfig(env, A), (error) => error instanceof SiteConfigValidationError && error.errors.length > 0);
  assert.deepEqual(await row(env, A), before);
  assert.equal((await loadPublishedSite(env, A)).json, referenceSiteJson(A));
});

test('écriture de la publication en échec : version publiée intacte, cache public non invalidé', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  await saveDraftSiteConfig(env, A, demoWithTagline('Jamais publiée'), { expectedRevision: 1 });
  const cached = await loadPublishedSite(env, A);
  const before = await row(env, A);
  const failing = {
    ...env,
    DB: {
      ...env.DB,
      prepare: (sql) => {
        if (/SET published_json = draft_json/.test(sql)) return { bind: () => ({ run: async () => { throw new Error('D1 : écriture impossible'); } }) };
        return env.DB.prepare(sql);
      },
    },
  };
  await assert.rejects(publishSiteConfig(failing, A), /écriture impossible/);
  assert.deepEqual(await row(env, A), before);
  assert.equal(await loadPublishedSite(env, A), cached);
});

test('brouillon modifié entre la validation et l’écriture : rien n’est publié (conflit)', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  await saveDraftSiteConfig(env, A, demoWithTagline('Validée'), { expectedRevision: 1 });
  const before = await row(env, A);
  const racing = {
    ...env,
    DB: {
      ...env.DB,
      prepare: (sql) => {
        const statement = env.DB.prepare(sql);
        if (!/SET published_json = draft_json/.test(sql)) return statement;
        return {
          bind: (...args) => ({
            run: async () => {
              // Un autre administrateur enregistre un brouillon (invalide) juste avant l'écriture.
              await env.DB.prepare("UPDATE site_configs SET draft_json = '{}', draft_revision = draft_revision + 1 WHERE organization_id = ?").bind(A).run();
              return statement.bind(...args).run();
            },
          }),
        };
      },
    },
  };
  await assert.rejects(publishSiteConfig(racing, A), ConfigConflictError);
  const after = await row(env, A);
  assert.equal(after.published_json, before.published_json);
  assert.equal(after.published_revision, before.published_revision);
});

test('révision attendue périmée : brouillon ni écrasé ni publié', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  await saveDraftSiteConfig(env, A, demoWithTagline('Premier'), { expectedRevision: 1 });
  await assert.rejects(saveDraftSiteConfig(env, A, demoWithTagline('Second'), { expectedRevision: 1 }), ConfigConflictError);
  assert.equal((await readSiteConfig(env, A)).config.brand.tagline, 'Premier');
  await assert.rejects(publishSiteConfig(env, A, { expectedRevision: 1 }), ConfigConflictError);
  assert.equal((await row(env, A)).published_revision, 1);
  await assert.rejects(saveDraftSiteConfig(env, A, demoWithTagline('x')), /révision attendue requise/);
});

test('brouillon non JSON ou hors bornes : refusé avant toute écriture', async () => {
  const env = await setup({ withB: false });
  await readSiteConfig(env, A);
  const before = await row(env, A);
  const withFunction = demoWithTagline('x');
  withFunction.brand.name = () => 'x';
  await assert.rejects(saveDraftSiteConfig(env, A, withFunction, { expectedRevision: 1 }), SiteConfigValidationError);
  const tooLong = demoWithTagline('x'.repeat(7000));
  await assert.rejects(saveDraftSiteConfig(env, A, tooLong, { expectedRevision: 1 }), SiteConfigValidationError);
  await assert.rejects(saveDraftSiteConfig(env, A, null, { expectedRevision: 1 }), SiteConfigValidationError);
  assert.deepEqual(await row(env, A), before);
});

// --- Isolation entre organisations ------------------------------------------------------------------------------

test('organisation sans configuration : aucun site, jamais celui d’une autre', async () => {
  const env = await setup();
  assert.equal(await readSiteConfig(env, B), null);
  assert.equal(await loadPublishedSite(env, B), null);
  await assert.rejects(publishSiteConfig(env, B), SiteConfigNotFoundError);
  assert.equal(await row(env, B), null);
});

test('isolation des lectures : A ne lit jamais le brouillon ni la version publiée de B (et inversement)', async () => {
  const env = await setup();
  await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
  const draftB = await readSiteConfig(env, B);
  assert.equal(draftB.config.brand.name, 'Atelier Exemple');
  assert.equal(draftB.publishedRevision, null, 'première configuration de B : non publiée');
  assert.equal(await loadPublishedSite(env, B), null, 'le public de B ne voit pas son brouillon');

  const a = await readSiteConfig(env, A);
  assert.equal(a.config.organizationId, A);
  assert.doesNotMatch(JSON.stringify(a.config), /Atelier Exemple/);
  assert.doesNotMatch(JSON.stringify((await readSiteConfig(env, B)).config), /Club Démo/);
});

test('isolation des écritures : la configuration d’une organisation ne s’enregistre pas chez une autre', async () => {
  const env = await setup();
  await readSiteConfig(env, A);
  const before = await row(env, A);
  await assert.rejects(saveDraftSiteConfig(env, A, clone(exempleSite), { expectedRevision: 1 }), /n’appartient pas/);
  await assert.rejects(saveDraftSiteConfig(env, B, clone(demoSite), { expectedRevision: 0 }), /n’appartient pas/);
  const noOwner = clone(exempleSite);
  delete noOwner.organizationId;
  await assert.rejects(saveDraftSiteConfig(env, B, noOwner, { expectedRevision: 0 }), /n’appartient pas/);
  assert.deepEqual(await row(env, A), before);
  assert.equal(await row(env, B), null);
});

test('isolation de la publication : publier A ne publie jamais le brouillon de B', async () => {
  const env = await setup();
  await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
  const bBefore = await row(env, B);
  await saveDraftSiteConfig(env, A, demoWithTagline('A publiée'), { expectedRevision: 1 });
  await publishSiteConfig(env, A);
  assert.deepEqual(await row(env, B), bBefore, 'ligne de B intacte');
  assert.equal(await loadPublishedSite(env, B), null);

  await publishSiteConfig(env, B);
  assert.equal((await loadPublishedSite(env, B)).config.brand.name, 'Atelier Exemple');
  assert.equal((await loadPublishedSite(env, A)).config.brand.tagline, 'A publiée', 'A intacte après la publication de B');
});

test('ligne altérée (configuration d’une autre organisation) : ni publiée, ni servie', async () => {
  const env = await setup();
  const foreign = JSON.stringify(demoSite);
  await env.DB.prepare("INSERT INTO site_configs (organization_id, origin, draft_json, draft_revision, published_json, published_revision, published_at) VALUES (?, 'edited', ?, 1, ?, 1, datetime('now'))")
    .bind(B, foreign, foreign)
    .run();
  assert.equal(await loadPublishedSite(env, B), null, 'version publiée d’une autre organisation jamais servie');
  await assert.rejects(publishSiteConfig(env, B), /n’appartient pas/);
  const { html } = await page(env, B_HOST, '/');
  assert.doesNotMatch(html, /Atelier Exemple/);
});

test('site public de B : version publiée de B uniquement, jamais celle de A ni son propre brouillon', async () => {
  const env = await setup();
  await saveDraftSiteConfig(env, B, clone(exempleSite), { expectedRevision: 0 });
  await publishSiteConfig(env, B);
  const edited = clone(exempleSite);
  edited.brand.tagline = 'Brouillon de B';
  await saveDraftSiteConfig(env, B, edited, { expectedRevision: 1 });

  const home = await page(env, B_HOST, '/');
  assert.equal(home.status, 200);
  assert.match(home.html, /Atelier Exemple/);
  assert.doesNotMatch(home.html, /Club Démo|Brouillon de B/);

  const demo = await page(env, A_HOST, '/');
  assert.doesNotMatch(demo.html, /Atelier Exemple/, 'le site de A ne montre jamais la configuration de B');
});
