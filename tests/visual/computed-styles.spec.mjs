// Instantané des styles calculés (phase 4B). Complète les captures : une capture dit « quelque chose a
// changé », ce test dit quelle propriété de quel élément. Référence texte versionnée :
// tests/visual/computed-styles.snapshot.json (ou computed-styles.snapshot.<plateforme>.json s il existe) et
// tests/visual/tokens-inventory.json. Valeurs mesurées toujours écrites dans .results/ pour le diagnostic.
// Régénération (seulement avant une modification voulue) : UPDATE_STYLE_SNAPSHOT=1 npm run visual.
import { test, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openPage } from './helpers.mjs';

// Référence propre au système si elle existe (computed-styles.snapshot.linux.json en CI), sinon la référence
// commune : certaines mesures dépendent du rendu des polices.
const PLATFORM_SNAPSHOT = fileURLToPath(new URL(`./computed-styles.snapshot.${process.platform}.json`, import.meta.url));
const SNAPSHOT_FILE = existsSync(PLATFORM_SNAPSHOT) ? PLATFORM_SNAPSHOT : fileURLToPath(new URL('./computed-styles.snapshot.json', import.meta.url));
const ACTUAL_DIR = fileURLToPath(new URL('./.results/', import.meta.url));
const TOKENS_FILE = fileURLToPath(new URL('./tokens-inventory.json', import.meta.url));
const UPDATE = process.env.UPDATE_STYLE_SNAPSHOT === '1';

const PROPS = [
  'display', 'position', 'color', 'background-color', 'background-image', 'background-size', 'background-position',
  'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform', 'text-align',
  'width', 'max-width', 'height', 'min-height',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow',
  'grid-template-columns', 'gap', 'flex-direction', 'justify-content', 'align-items',
  'transform', 'opacity', 'filter', 'z-index', 'overflow',
];
const PSEUDO_PROPS = [
  'content', 'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'background-color', 'background-image', 'background-size', 'border-radius', 'transform', 'opacity', 'pointer-events', 'z-index',
];

// [sélecteur, pseudo-élément éventuel]. Le premier élément correspondant est mesuré.
const TARGETS = {
  '/': [
    ['body'], ['.container'], ['.skip-link'],
    ['.site-header'], ['.site-header', '::before'], ['.brand img'], ['.brand-name strong'], ['.brand-name span'],
    ['.main-nav li a'], ['.main-nav li a[aria-current="page"]'], ['.burger'], ['.header-actions .adhesion-cta'], ['.main-nav .nav-cta'],
    ['.hero'], ['.hero', '::before'], ['.hero', '::after'], ['.hero .container'], ['.hero h1'], ['.hero h1 em'], ['.hero p.lead'],
    ['.hero-crest img'], ['.hero-actions .btn-primary'], ['.hero-actions .btn:not(.btn-primary)'],
    ['.stats-strip'], ['.stat'], ['.eyebrow'], ['.eyebrow', '::before'],
    ['h2'], ['.card'], ['.card-media'], ['.card-media', '::before'], ['.card-media img'], ['.card-link', '::after'],
    ['.photo-section'], ['.photo-section', '::before'], ['.grid-2'], ['.grid-2 .grid-2'], ['.info-item'], ['.info-item .icon'], ['.info-item .icon svg'],
    ['.lightbox-media'], ['.lightbox-media', '::before'],
    ['.cta-banner'], ['.cta-banner h3'], ['.btn-dark'],
    ['.site-footer'], ['.footer-grid'], ['.site-footer ul a', '::after'],
  ],
  '/equipe.html': [['.page-header'], ['.page-header', '::before'], ['.page-header', '::after'], ['.page-header h1'], ['.page-header p'], ['.grid-2']],
  '/partenaires.html': [['.grid-3'], ['.grid-3 > *'], ['.cta-banner']],
  '/entrainements.html': [['.faq-item summary'], ['.faq-item summary', '::after'], ['.map-embed'], ['.map-placeholder'], ['.map-pin']],
  '/inscription.html': [
    ['.form-steps'], ['.form-row'], ['input[type="text"]'], ['input[type="email"]'], ['select'], ['label'],
    ['.insc-recap'], ['.form-parent2 > summary', '::before'], ['.form-check'], ['.btn-ghost'],
  ],
  '/actualites.html': [['.filters'], ['.filter-btn'], ['.news-grid'], ['.news-grid > *']],
};

const VIEWPORTS = [360, 768, 1280];

async function collect(page, targets) {
  return page.evaluate(({ targets, PROPS, PSEUDO_PROPS }) => {
    const out = {};
    for (const [selector, pseudo] of targets) {
      const el = document.querySelector(selector);
      const key = selector + (pseudo || '');
      if (!el) { out[key] = null; continue; }
      const cs = getComputedStyle(el, pseudo || null);
      const values = {};
      for (const prop of pseudo ? PSEUDO_PROPS : PROPS) values[prop] = cs.getPropertyValue(prop);
      out[key] = values;
    }
    return out;
  }, { targets, PROPS, PSEUDO_PROPS });
}

async function tokenInventory(page) {
  return page.evaluate(() => {
    const tokens = {};
    const media = new Set();
    const keyframes = [];
    const fonts = [];
    for (const sheet of document.styleSheets) {
      if (!sheet.href || !sheet.href.includes('/assets/css/styles.css')) continue;
      const walk = (rules) => {
        for (const rule of rules) {
          if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
            for (const name of rule.style) if (name.startsWith('--')) tokens[name] = rule.style.getPropertyValue(name).trim();
          } else if (rule instanceof CSSMediaRule) {
            media.add(rule.conditionText);
            walk(rule.cssRules);
          } else if (rule instanceof CSSKeyframesRule) {
            keyframes.push(rule.name);
          } else if (rule instanceof CSSFontFaceRule) {
            fonts.push(`${rule.style.getPropertyValue('font-family')} ${rule.style.getPropertyValue('font-weight')}`);
          }
        }
      };
      walk(sheet.cssRules);
    }
    const rootStyle = getComputedStyle(document.documentElement);
    const resolved = Object.fromEntries(Object.keys(tokens).map((name) => [name, rootStyle.getPropertyValue(name).trim()]));
    return { declared: tokens, resolved, mediaQueries: [...media].sort(), keyframes, fontFaces: fonts };
  });
}

test('styles calculés et tokens du site public', async ({ browser }) => {
  test.setTimeout(120_000);
  const snapshot = {};
  let tokens = null;
  for (const width of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    for (const [path, targets] of Object.entries(TARGETS)) {
      await openPage(page, path);
      snapshot[`${width}px ${path}`] = await collect(page, targets);
      if (!tokens && path === '/') tokens = await tokenInventory(page);
    }
    await context.close();
  }

  // Un sélecteur absent de la page ne doit pas devenir une référence « null » silencieuse.
  for (const [key, targets] of Object.entries(snapshot)) {
    for (const [target, values] of Object.entries(targets)) expect(values, `${key} › ${target} introuvable`).not.toBeNull();
  }
  // Valeurs mesurées toujours écrites (artefact de CI en cas d'échec) : diagnostic sans relancer.
  await mkdir(ACTUAL_DIR, { recursive: true });
  await writeFile(`${ACTUAL_DIR}computed-styles.actual.${process.platform}.json`, JSON.stringify(snapshot, null, 2) + '\n');
  if (UPDATE) {
    await writeFile(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2) + '\n');
    await writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 2) + '\n');
    return;
  }
  const expectedSnapshot = JSON.parse(await readFile(SNAPSHOT_FILE, 'utf8'));
  const expectedTokens = JSON.parse(await readFile(TOKENS_FILE, 'utf8'));
  // Comparaison élément par élément : le message d'échec nomme l'élément et la largeur fautifs.
  for (const key of Object.keys(expectedSnapshot)) {
    for (const target of Object.keys(expectedSnapshot[key])) {
      expect(snapshot[key]?.[target], `${key} › ${target}`).toEqual(expectedSnapshot[key][target]);
    }
  }
  expect(Object.keys(snapshot).sort()).toEqual(Object.keys(expectedSnapshot).sort());
  expect(tokens).toEqual(expectedTokens);
});
