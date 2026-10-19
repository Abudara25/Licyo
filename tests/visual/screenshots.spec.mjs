// Référence visuelle du site public Club Démo (phase 4B). Tolérance nulle (playwright.config.mjs).
import { test, expect } from '@playwright/test';
import { PAGES, VIEWPORTS, openPage } from './helpers.mjs';

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name}px`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const { name, path } of PAGES) {
      test(`page ${name}`, async ({ page }) => {
        const response = await openPage(page, path);
        expect(response.status()).toBe(200);
        await expect(page).toHaveScreenshot(`page-${name}-${viewport.name}.png`, { fullPage: true });
      });
    }

    test('header initial', async ({ page }) => {
      await openPage(page, '/');
      await expect(page.locator('.site-header')).toHaveScreenshot(`header-initial-${viewport.name}.png`);
    });

    test('header après défilement', async ({ page }) => {
      await openPage(page, '/');
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect(page.locator('.site-header')).toHaveClass(/is-scrolled/);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await expect(page).toHaveScreenshot(`header-scrolled-${viewport.name}.png`);
    });

    if (viewport.width <= 880) {
      test('menu mobile fermé puis ouvert', async ({ page }) => {
        await openPage(page, '/');
        const burger = page.locator('.burger');
        await expect(burger).toBeVisible();
        await expect(burger).toHaveAttribute('aria-expanded', 'false');
        await expect(page).toHaveScreenshot(`menu-mobile-ferme-${viewport.name}.png`);
        await burger.click();
        await expect(page.locator('.main-nav')).toHaveClass(/is-open/);
        await expect(burger).toHaveAttribute('aria-expanded', 'true');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        await expect(page).toHaveScreenshot(`menu-mobile-ouvert-${viewport.name}.png`);
      });
    }
  });
}
