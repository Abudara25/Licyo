// Actualités intégrées aux Functions par un module GÉNÉRÉ (scripts/build-news.mjs) : compatible avec le regroupement
// des Functions par Cloudflare Pages (wrangler 3, sans import JSON à attributs) comme avec Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildNews, newsModule, NEWS_MODULE } from '../scripts/build-news.mjs';

const source = () => JSON.parse(readFileSync('content/articles.json', 'utf8'));

test('module généré : identique à content/articles.json (source unique, éditée par le CMS)', async () => {
  await buildNews();
  const { default: generated } = await import(`${new URL(`file:///${NEWS_MODULE.replace(/\\/g, '/')}`).href}?t=${Date.now()}`);
  assert.deepEqual(generated, source());
  assert.match(readFileSync(NEWS_MODULE, 'utf8'), /^\/\/ GÉNÉRÉ par scripts\/build-news\.mjs/);
});

test('actualités servies par news.js : les articles de content/articles.json, dont les derniers publiés', async () => {
  const { articlesForOrganization } = await import('../functions/_shared/news.js');
  const slugs = articlesForOrganization('org_demo').map((a) => a.slug);
  assert.deepEqual(slugs, source().articles.map((a) => a.slug));
  for (const slug of ['regle-foot-u6-u7', 'regle-foot-u8-u9']) assert.ok(slugs.includes(slug), slug);
  assert.deepEqual(articlesForOrganization('org_autre'), [], 'jamais les articles de Sportville pour une autre organisation');
});

test('JSON illisible ou sans liste d’articles : génération refusée (échec du build, rien deviné)', () => {
  assert.throws(() => newsModule('{pas du json'));
  assert.throws(() => newsModule('[]'), /articles/);
  assert.throws(() => newsModule('{"articles": {}}'), /articles/);
  const code = newsModule(JSON.stringify({ articles: [{ slug: `a${String.fromCharCode(0x2028)}b`, title: '</script> "x"' }] }));
  assert.ok(code.startsWith('// GÉNÉRÉ'));
  const body = code.slice(code.indexOf('export default')).replace('export default', 'return');
  assert.equal(new Function(body)().articles[0].slug, `a${String.fromCharCode(0x2028)}b`, 'expression JavaScript valide');
});

test('functions/ : aucun import à attributs (with/assert), que wrangler 3 du build Pages ne sait pas regrouper', () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.m?js$/.test(name)) files.push(path);
    }
  };
  walk('functions');
  for (const file of files) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\bfrom\s+['"][^'"]+['"]\s+(?:with|assert)\s*\{/, file);
  }
});

test('module généré : ignoré par git, jamais versionné', () => {
  assert.match(readFileSync('.gitignore', 'utf8'), /^functions\/_generated\/$/m);
});
