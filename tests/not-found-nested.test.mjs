// Page 404 servie sous un sous-chemin (/audit/introuvable, /actualites/inexistant) : assets en chemins absolus
// (audit Codex 2026-11-13 : CSS et images étaient cherchés sous le sous-chemin).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSitePage } from '../renderer/render.js';
import { siteForOrganization } from '../sites/index.js';
import { DEMO_ORG_ID } from '../functions/_shared/schema.js';
import { ASSET_VERSIONS } from '../functions/_shared/asset-versions.js';

const RELATIVE = /(?:href|src)="(?!\/|#|https?:|mailto:|tel:)[^"]+"/g;

test('la 404 générée et rendue n’a aucun chemin relatif', () => {
  const site = siteForOrganization(DEMO_ORG_ID);
  const { status, html } = renderSitePage({ site, route: '/audit/introuvable', locale: site.locale, assetVersions: ASSET_VERSIONS });
  assert.equal(status, 404);
  assert.deepEqual(html.match(RELATIVE) || [], []);
  assert.match(html, /href="\/assets\/css\/styles\.css/);
  assert.deepEqual(readFileSync('404.html', 'utf8').match(RELATIVE) || [], []);
});

test('les pages à la racine gardent leurs chemins d’origine', () => {
  const site = siteForOrganization(DEMO_ORG_ID);
  const { html } = renderSitePage({ site, route: '/equipe', locale: site.locale, assetVersions: ASSET_VERSIONS });
  assert.match(html, /href="assets\/css\/styles\.css/);
});
