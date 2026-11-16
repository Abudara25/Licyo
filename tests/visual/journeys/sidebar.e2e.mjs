import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request, context, baseURL }) => {
  const state = await (await request.post('/__test__/reset')).json();
  const [name, value] = state.cookie.split('=');
  await context.addCookies([{ name, value, url: baseURL }]);
  await context.route('**/*', (route) => route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});

test('la barre latérale conserve son défilement en changeant de page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/admin/a-traiter');
  const nav = page.locator('.adm-sidebar-nav');
  await nav.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const before = await nav.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await nav.getByRole('link', { name: 'Éducateurs', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/educateurs$/);
  await expect.poll(() => nav.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await page.reload();
  await expect.poll(() => nav.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
});

test('replier et déplier : préférence mémorisée, noms accessibles et retour à la bonne position', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto('/admin/a-traiter');
  const nav = page.locator('.adm-sidebar-nav');
  await nav.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const before = await nav.evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: 'Replier la barre latérale' }).click();
  const expand = page.getByRole('button', { name: 'Déplier la barre latérale' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  expect((await page.locator('.adm-sidebar').boundingBox()).width).toBe(76);
  const educators = nav.getByRole('link', { name: 'Éducateurs', exact: true });
  await educators.hover();
  await expect(page.locator('.adm-sidebar-tooltip')).toHaveText('Éducateurs');
  await page.screenshot({ path: testInfo.outputPath('barre-repliee-1280.png') });
  await educators.click();
  await expect(page).toHaveURL(/\/admin\/educateurs$/);
  expect((await page.locator('.adm-sidebar').boundingBox()).width).toBe(76);
  await page.reload();
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Replier la barre latérale' })).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => nav.evaluate((el) => el.scrollTop)).toBeCloseTo(before, 0);
  await page.screenshot({ path: testInfo.outputPath('barre-depliee-1280.png') });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator('.adm-sidebar')).not.toBeVisible();
  await expect(page.locator('.adm-sidebar-toggle')).not.toBeVisible();
  await expect(page.locator('.adm-tabbar')).toBeVisible();
});

test('stockage navigateur bloqué : le bouton et la navigation restent utilisables', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) Object.defineProperty(window, name, { get() { throw new Error('Stockage bloqué'); } });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/admin/a-traiter');
  await page.getByRole('button', { name: 'Replier la barre latérale' }).click();
  await expect(page.getByRole('button', { name: 'Déplier la barre latérale' })).toBeVisible();
  await page.locator('.adm-sidebar').getByRole('link', { name: 'Éducateurs', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/educateurs$/);
  expect(errors).toEqual([]);
});

test.describe('sans JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('la navigation reste dépliée et tous les liens sont utilisables', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/a-traiter');
    expect((await page.locator('.adm-sidebar').boundingBox()).width).toBe(240);
    await expect(page.locator('.adm-sidebar-toggle')).not.toBeVisible();
    await page.locator('.adm-sidebar').getByRole('link', { name: 'Éducateurs', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/educateurs$/);
  });
});
