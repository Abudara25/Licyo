// Assertions explicites (phase 4B) : décorations diagonales de Club Démo, comportements aux points de
// rupture, accessibilité de base. Les valeurs attendues sont les valeurs CALCULÉES par le navigateur : elles
// doivent rester identiques quand le CSS sera réécrit en tokens (phase 4C), quelle que soit l'écriture source.
import { test, expect } from '@playwright/test';
import { PAGES, openPage } from './helpers.mjs';

const pseudo = (page, selector, name, props) =>
  page.evaluate(
    ({ selector, name, props }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = getComputedStyle(el, name);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    { selector, name, props }
  );

// ---------------------------------------------------------------------------------------------
// Diagonales et halos (valeurs relevées à l'audit 4A)

const GOLD_STRIPES_5_40 = 'repeating-linear-gradient(45deg, rgba(240, 160, 48, 0.05) 0px, rgba(240, 160, 48, 0.05) 5px, rgba(0, 0, 0, 0) 5px, rgba(0, 0, 0, 0) 40px)';
const GOLD_STRIPES_2_40 = 'repeating-linear-gradient(45deg, rgba(240, 160, 48, 0.05) 0px, rgba(240, 160, 48, 0.05) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 40px)';
const WHITE_STRIPES_135 = 'repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0px, rgba(255, 255, 255, 0.04) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 26px)';
const MEDIA_STRIPES = 'repeating-linear-gradient(45deg, rgb(244, 182, 88) 0px, rgb(244, 182, 88) 2px, rgba(0, 0, 0, 0) 2px, rgba(0, 0, 0, 0) 26px)';
const MAROON_MEDIA = 'linear-gradient(135deg, rgb(128, 24, 24), rgb(79, 20, 20))';

test.describe('décorations Club Démo (1280px)', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('hero : dégradé, rayures diagonales et halo', async ({ page }) => {
    await openPage(page, '/');
    const hero = await pseudo(page, '.hero', null, ['background-image', 'overflow', 'padding-top', 'padding-bottom']);
    expect(hero).toEqual({
      'background-image': 'linear-gradient(155deg, rgb(128, 24, 24) 0%, rgb(79, 20, 20) 55%, rgb(58, 15, 16) 100%)',
      overflow: 'hidden',
      'padding-top': '90px',
      'padding-bottom': '110px',
    });
    expect(await pseudo(page, '.hero', '::before', ['content', 'position', 'top', 'left', 'background-image', 'pointer-events'])).toEqual({
      content: '""', position: 'absolute', top: '0px', left: '0px', 'background-image': GOLD_STRIPES_5_40, 'pointer-events': 'none',
    });
    expect(await pseudo(page, '.hero', '::after', ['content', 'position', 'right', 'width', 'height', 'background-image', 'pointer-events'])).toEqual({
      content: '""', position: 'absolute', right: '-128px', width: '620px', height: '620px',
      'background-image': 'radial-gradient(circle, rgba(240, 160, 48, 0.18), rgba(0, 0, 0, 0) 70%)', 'pointer-events': 'none',
    });
    // top: -20 % de la hauteur du hero (dépend de son contenu) : on vérifie le rapport, pas une valeur figée.
    const ratio = await page.evaluate(() => {
      const hero = document.querySelector('.hero');
      return parseFloat(getComputedStyle(hero, '::after').top) / hero.getBoundingClientRect().height;
    });
    expect(ratio).toBeCloseTo(-0.2, 3);
  });

  test('header : dégradé, halo or et rayures 135°', async ({ page }) => {
    await openPage(page, '/');
    expect(await pseudo(page, '.site-header', null, ['background-image', 'height', 'position', 'box-shadow'])).toEqual({
      'background-image': 'radial-gradient(circle at 12% -120%, rgba(240, 160, 48, 0.28), rgba(0, 0, 0, 0) 45%), linear-gradient(135deg, rgb(128, 24, 24), rgb(58, 15, 16))',
      height: '84px',
      position: 'sticky',
      'box-shadow': 'rgba(58, 15, 16, 0.18) 0px 6px 18px 0px',
    });
    expect((await pseudo(page, '.site-header', '::before', ['background-image']))['background-image']).toBe(WHITE_STRIPES_135);
    // Jamais de backdrop-filter / transform sur le header : il contient le menu mobile en position fixe.
    expect(await pseudo(page, '.site-header', null, ['backdrop-filter', 'transform', 'filter'])).toEqual({ 'backdrop-filter': 'none', transform: 'none', filter: 'none' });
  });

  test('en-tête de page : dégradé, rayures fines et halo', async ({ page }) => {
    await openPage(page, '/equipe.html');
    expect((await pseudo(page, '.page-header', null, ['background-image']))['background-image']).toBe('linear-gradient(155deg, rgb(128, 24, 24), rgb(58, 15, 16))');
    expect((await pseudo(page, '.page-header', '::before', ['background-image']))['background-image']).toBe(GOLD_STRIPES_2_40);
    expect(await pseudo(page, '.page-header', '::after', ['background-image', 'width', 'height'])).toEqual({
      'background-image': 'radial-gradient(circle, rgba(240, 160, 48, 0.16), rgba(0, 0, 0, 0) 70%)', width: '420px', height: '420px',
    });
  });

  test('médias de cartes et visionneuse : fond bordeaux rayé or à 10 %', async ({ page }) => {
    await openPage(page, '/');
    for (const selector of ['.card-media', '.lightbox-media']) {
      expect((await pseudo(page, selector, null, ['background-image']))['background-image'], selector).toBe(MAROON_MEDIA);
      expect(await pseudo(page, selector, '::before', ['background-image', 'opacity']), selector).toEqual({ 'background-image': MEDIA_STRIPES, opacity: '0.1' });
    }
  });

  test('bandeau d’appel : dégradé or (sans rayures)', async ({ page }) => {
    await openPage(page, '/');
    expect(await pseudo(page, '.cta-banner', null, ['background-image', 'border-radius', 'padding-top'])).toEqual({
      'background-image': 'linear-gradient(120deg, rgb(240, 160, 48), rgb(208, 136, 48))', 'border-radius': '22px', 'padding-top': '48px',
    });
  });

  test('blason flottant : animation float 6s', async ({ page, browser }) => {
    // Sous prefers-reduced-motion (config), la durée tombe à 0.001ms ; sans réduction, float 6s.
    await openPage(page, '/');
    expect((await pseudo(page, '.hero-crest img', null, ['animation-name']))['animation-name']).toBe('float');
    expect((await pseudo(page, '.hero-crest img', null, ['animation-duration']))['animation-duration']).toBe('1e-06s');
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    const motion = await context.newPage();
    await motion.goto('/');
    expect(await pseudo(motion, '.hero-crest img', null, ['animation-name', 'animation-duration', 'animation-iteration-count'])).toEqual({
      'animation-name': 'float', 'animation-duration': '6s', 'animation-iteration-count': 'infinite',
    });
    await context.close();
  });
});

// ---------------------------------------------------------------------------------------------
// Points de rupture : de part et d'autre de chaque seuil

const columns = (page, selector) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : null;
  }, selector);
const isDisplayed = (page, selector) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && getComputedStyle(el).display !== 'none'; }, selector);

async function at(browser, width, path, fn) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await openPage(page, path);
  try {
    await fn(page);
  } finally {
    await context.close();
  }
}

test.describe('points de rupture', () => {
  test('1101 / 1100 / 881 / 880 : navigation', async ({ browser }) => {
    await at(browser, 1101, '/', async (page) => {
      expect(await isDisplayed(page, '.brand-name span')).toBe(true);
      expect(await isDisplayed(page, '.burger')).toBe(false);
    });
    for (const width of [1100, 881]) {
      await at(browser, width, '/', async (page) => {
        expect(await isDisplayed(page, '.brand-name span'), `${width}`).toBe(false);
        expect(await isDisplayed(page, '.burger'), `${width}`).toBe(false);
        expect(await isDisplayed(page, '.header-actions .adhesion-cta'), `${width}`).toBe(true);
        // Le nom du club tient sur une ligne (sinon il passait sur 3 lignes à cette largeur).
        const lines = await page.evaluate(() => Math.round(document.querySelector('.brand-name strong').getBoundingClientRect().height / parseFloat(getComputedStyle(document.querySelector('.brand-name strong')).lineHeight)));
        expect(lines, `${width}`).toBe(1);
      });
    }
    await at(browser, 880, '/', async (page) => {
      expect(await isDisplayed(page, '.burger')).toBe(true);
      expect(await isDisplayed(page, '.header-actions .adhesion-cta')).toBe(false);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.main-nav')).position)).toBe('fixed');
    });
  });

  test('901 / 900 : hero et grilles à 3 colonnes', async ({ browser }) => {
    await at(browser, 901, '/', async (page) => {
      expect(await columns(page, '.hero .container')).toBe(2);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.hero .container')).textAlign)).toBe('start');
    });
    await at(browser, 900, '/', async (page) => {
      expect(await columns(page, '.hero .container')).toBe(1);
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.hero .container')).textAlign)).toBe('center');
      expect(await page.evaluate(() => getComputedStyle(document.querySelector('.hero-crest')).order)).toBe('-1');
    });
    await at(browser, 901, '/partenaires.html', async (page) => expect(await columns(page, '.grid-3')).toBe(3));
    await at(browser, 900, '/partenaires.html', async (page) => expect(await columns(page, '.grid-3')).toBe(2));
  });

  test('761 / 760 : grilles à 2 colonnes', async ({ browser }) => {
    await at(browser, 761, '/', async (page) => expect(await columns(page, '.grid-2')).toBe(2));
    await at(browser, 760, '/', async (page) => expect(await columns(page, '.grid-2')).toBe(1));
  });

  test('701 / 700 : bandeau de chiffres', async ({ browser }) => {
    await at(browser, 701, '/', async (page) => expect(await columns(page, '.stats-strip')).toBe(4));
    await at(browser, 700, '/', async (page) => expect(await columns(page, '.stats-strip')).toBe(2));
  });

  test('621 / 620 : grilles à 3 colonnes et lignes de formulaire', async ({ browser }) => {
    await at(browser, 621, '/partenaires.html', async (page) => expect(await columns(page, '.grid-3')).toBe(2));
    await at(browser, 620, '/partenaires.html', async (page) => expect(await columns(page, '.grid-3')).toBe(1));
    await at(browser, 621, '/inscription.html', async (page) => expect(await columns(page, '.form-row')).toBe(2));
    await at(browser, 620, '/inscription.html', async (page) => expect(await columns(page, '.form-row')).toBe(1));
  });

  test('561 / 560 : pied de page', async ({ browser }) => {
    await at(browser, 561, '/', async (page) => expect(await columns(page, '.footer-grid')).toBe(2));
    await at(browser, 560, '/', async (page) => expect(await columns(page, '.footer-grid')).toBe(1));
  });

  test('421 / 420 : étapes du formulaire', async ({ browser }) => {
    const direction = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.form-steps li')).flexDirection);
    await at(browser, 421, '/inscription.html', async (page) => expect(await direction(page)).toBe('row'));
    await at(browser, 420, '/inscription.html', async (page) => expect(await direction(page)).toBe('column'));
  });

  for (const width of [360, 768]) {
    test(`${width}px : aucune page ne déborde et la gouttière latérale est présente`, async ({ browser }) => {
      for (const { path } of PAGES) {
        await at(browser, width, path, async (page) => {
          const { scrollWidth, innerWidth, gutter } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth: window.innerWidth,
            gutter: getComputedStyle(document.querySelector('main .container') || document.querySelector('.container')).paddingLeft,
          }));
          expect(scrollWidth, `${path} déborde`).toBeLessThanOrEqual(innerWidth);
          expect(gutter, path).toBe('24px');
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Accessibilité de base (non-régression, pas de refonte)

test.describe('accessibilité de base', () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test('lien d’évitement : premier focus clavier, visible, cible existante', async ({ page }) => {
    for (const { path } of PAGES) {
      await openPage(page, path);
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const el = document.activeElement;
        const target = el?.getAttribute('href');
        return { cls: el?.className, target, exists: !!(target && document.querySelector(target)), left: el && getComputedStyle(el).left };
      });
      expect(state.cls, path).toContain('skip-link');
      expect(state.target, path).toBe('#main');
      expect(state.exists, path).toBe(true);
      expect(state.left, path).toBe('12px');
    }
  });

  test('menu mobile : aria-expanded, contenu inerte, Échap referme', async ({ page }) => {
    await openPage(page, '/');
    const burger = page.locator('.burger');
    await burger.click();
    await expect(burger).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => document.getElementById('main').inert)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(burger).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.getElementById('main').inert)).toBe(false);
  });

  test('focus visible : contour or sur les liens et boutons', async ({ page }) => {
    await openPage(page, '/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`; });
    expect(outline).toBe('solid 2px rgb(240, 160, 48)');
  });

  test('champs de formulaire à 16px au moins (pas de zoom Safari iOS)', async ({ page }) => {
    for (const path of ['/inscription.html', '/contact.html']) {
      await openPage(page, path);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea')]
          // Champs affichés seulement (le piège à robots "_honey" du formulaire de contact est masqué).
          .filter((el) => getComputedStyle(el).display !== 'none' && parseFloat(getComputedStyle(el).fontSize) < 16)
          .map((el) => el.name || el.id)
      );
      expect(small, path).toEqual([]);
    }
  });

  test('cibles tactiles principales ≥ 44px', async ({ page }) => {
    await openPage(page, '/');
    const sizes = await page.evaluate(() => {
      const box = (s) => { const r = document.querySelector(s).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };
      return { burger: box('.burger'), heroCta: box('.hero-actions .btn') };
    });
    expect(sizes.burger).toEqual([44, 44]);
    expect(sizes.heroCta[1]).toBeGreaterThanOrEqual(44);
    await page.locator('.burger').click();
    const navHeights = await page.evaluate(() => [...document.querySelectorAll('.main-nav li a')].map((a) => Math.round(a.getBoundingClientRect().height)));
    expect(Math.min(...navHeights)).toBeGreaterThanOrEqual(44);
  });

  test('images : toutes ont un attribut alt', async ({ page }) => {
    for (const { path } of PAGES) {
      await openPage(page, path);
      const missing = await page.evaluate(() => [...document.images].filter((img) => !img.hasAttribute('alt')).map((img) => img.src));
      expect(missing, path).toEqual([]);
    }
  });

  test('prefers-reduced-motion : transitions et animations neutralisées', async ({ page }) => {
    await openPage(page, '/');
    const durations = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.card'));
      return { transition: cs.transitionDuration, scroll: getComputedStyle(document.documentElement).scrollBehavior };
    });
    expect(durations.transition.split(', ').every((d) => d === '1e-06s')).toBe(true);
    expect(durations.scroll).toBe('auto');
  });
});
