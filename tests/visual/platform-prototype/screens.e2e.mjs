// Captures du prototype pour la revue visuelle (non comparées à une référence : ce sont des livrables).
// Dossier : tests/visual/.platform-screens/ (ignoré par git).
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';

// Chemin absolu : les captures vont toujours dans tests/visual/.platform-screens, quel que soit le dossier courant.
const OUT = fileURLToPath(new URL('../.platform-screens/', import.meta.url));

// Avant chaque capture, le pointeur quitte la page : aucun état de survol ne s'y fige.
const test = base.extend({
  page: async ({ page }, use) => {
    const shot = page.screenshot.bind(page);
    page.screenshot = async (options) => {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(150);
      return shot(options);
    };
    await use(page);
  },
});

const SCREENS = [
  ['01-dashboard', '#/dashboard'],
  ['02-organisations', '#/organisations'],
  ['03-fiche-organisation', '#/organisations/org_4c1e0b7d93a2f6581e0c7da94b3f2e61'],
  ['03b-fiche-modules', '#/organisations/org_3f9a1c07e2b84d6f9a0c55e1d2b7c4a8/modules'],
  ['03c-fiche-impaye', '#/organisations/org_f38a0d6c1e9b42a7d5f0c8e3b16a9d72'],
  ['04-onboarding', '#/onboarding'],
  ['04b-assistant', '#/onboarding/nouveau/1'],
  ['05-domaines', '#/domaines'],
  ['06-sante', '#/sante'],
  ['07-plans', '#/plans'],
  ['08-support', '#/support'],
  ['09-audit', '#/audit'],
  ['10-parametres', '#/parametres'],
];
const WIDTHS = [
  ['1440', 1440, 900],
  ['768', 768, 1024],
  ['360', 360, 780],
];

for (const [w, width, height] of WIDTHS) {
  for (const [name, hash] of SCREENS) {
    test(`capture ${name} @${w}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${hash}`);
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      await page.screenshot({ path: `${OUT}${w}/${name}.png`, fullPage: true });
      if (width < 1024) await page.screenshot({ path: `${OUT}${w}/${name}-ecran.png` });
    });
  }
}

// Parcours : vue « À surveiller » de la liste, puis vérification et écran final de l'assistant (rien n'est créé).
async function fillWizard(page) {
  await page.goto('/#/onboarding/nouveau/1');
  await page.getByLabel('Nom de l’organisation').fill('Tennis Club des Tilleuls');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Tennis', exact: true }).click();
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Nom de l’administrateur').fill('Présidence démo');
  await page.getByLabel('E-mail').fill('presidence@tilleuls.example');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Vérification' })).toBeVisible();
}

for (const [w, width, height] of WIDTHS) {
  test(`capture parcours @${w}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/#/organisations');
    await page.getByRole('button', { name: /^À surveiller/ }).click();
    await page.screenshot({ path: `${OUT}${w}/02b-organisations-a-surveiller.png`, fullPage: true });
    await fillWizard(page);
    await page.screenshot({ path: `${OUT}${w}/04c-assistant-verification.png`, fullPage: true });
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await page.screenshot({ path: `${OUT}${w}/04d-assistant-creation.png`, fullPage: true });
    await page.getByRole('button', { name: 'Simuler la création' }).click();
    await expect(page.getByRole('heading', { name: 'Organisation prête à être provisionnée' })).toBeVisible();
    await page.screenshot({ path: `${OUT}${w}/04e-assistant-fin.png`, fullPage: true });
  });
}
