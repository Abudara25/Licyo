import { test, expect } from '@playwright/test';
import { openPage } from './helpers.mjs';

for (const width of [360, 768]) {
  test(`inscription à ${width}px : formulaire proche et prestations accessibles`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openPage(page, '/inscription.html');
    const details = page.locator('.insc-recap-details');
    await expect(details).not.toHaveAttribute('open', '');
    await expect(page.locator('.insc-recap-price')).toBeVisible();
    expect((await page.locator('#enfant-prenom').boundingBox()).y).toBeLessThan(900);
    const summary = details.locator('summary');
    expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await summary.click();
    await expect(details.locator('li').first()).toBeVisible();
    await summary.click();
    await expect(details.locator('li').first()).not.toBeVisible();
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(details.locator('li').first()).toBeVisible();
  });
}

test('accueil mobile : une actualité, liste complète accessible et conservée sur tablette', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  await openPage(page, '/');
  await expect(page.locator('#actualites-grid > :visible')).toHaveCount(1);
  await expect(page.locator('#actualites-more a')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator('#actualites-grid > :visible')).toHaveCount(3);
  await page.setViewportSize({ width: 360, height: 900 });
  await openPage(page, '/actualites.html');
  await expect(page.locator('#actualites-grid > :visible')).toHaveCount(3);
});

test('sans JavaScript : les prestations restent lisibles', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 900 } });
  const page = await context.newPage();
  await page.goto('/inscription.html');
  await expect(page.locator('.insc-recap-details li').first()).toBeVisible();
  await context.close();
});
