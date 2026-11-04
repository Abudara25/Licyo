import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = '.qa';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const paths = [
  '/',
  '/tarifs',
  '/modeles',
  '/commencer',
  '/decouvrir/club',
  '/decouvrir/adherent',
  '/decouvrir/modules',
  '/decouvrir/pilotage',
  '/decouvrir/site?modele=club',
  '/decouvrir/site?modele=arena',
  '/decouvrir/site?modele=studio',
  '/decouvrir/site?modele=club&sport=muaythai',
];
const results = [];
for (const width of [360, 768, 1440]) {
  const page = await browser.newPage({
    viewport: { width, height: 900 },
    locale: 'fr-FR',
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const [i, path] of paths.entries()) {
    if (width === 1440 && i > 0) continue;
    console.log('Visite', width, path);
    errors.length = 0;
    const response = await page.goto('http://127.0.0.1:4174' + path, {
      waitUntil: 'networkidle',
      timeout: 120000,
    });
    if (response.status() !== 200) {
      console.log((await page.locator('body').innerText()).slice(0, 2000));
      await page.screenshot({ path: out + '/failure.png' });
      throw Error('HTTP ' + response.status() + ' ' + path);
    }
    await page.locator('h1').first().waitFor();
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        overflow: doc.scrollWidth - doc.clientWidth,
        gutters: [...document.querySelectorAll('.page-container')].map(
          (el) => ({
            left: parseFloat(getComputedStyle(el).paddingLeft),
            right: parseFloat(getComputedStyle(el).paddingRight),
          }),
        ),
        smallTargets: [...document.querySelectorAll('a,button')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width && r.height && r.height < 43;
          })
          .map((el) => ({
            text: el.textContent.trim().slice(0, 40),
            height: el.getBoundingClientRect().height,
          })),
        smallFields: [
          ...document.querySelectorAll(
            'input:not([type=checkbox]):not([type=radio]),select,textarea',
          ),
        ].filter(
          (el) =>
            el.getBoundingClientRect().width &&
            parseFloat(getComputedStyle(el).fontSize) < 16,
        ).length,
      };
    });
    const name = width + '-' + i;
    await page.screenshot({ path: out + '/' + name + '.png', fullPage: true });
    results.push({
      width,
      path,
      status: response.status(),
      ...metrics,
      errors: [...errors],
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  if (width === 360) {
    await page.goto('http://127.0.0.1:4174/tarifs', {
      waitUntil: 'networkidle',
    });
    await page.getByLabel('Nombre d’adhérents', { exact: true }).fill('301');
    if (
      !(await page.locator('.pricing-result h3').textContent()).includes('Élan')
    )
      throw Error('Mauvaise tranche tarifaire');
    await page.goto('http://127.0.0.1:4174/decouvrir/modules', {
      waitUntil: 'networkidle',
    });
    const checkbox = page.getByRole('checkbox').first();
    const before = await checkbox.isChecked();
    await checkbox.click();
    if ((await checkbox.isChecked()) === before)
      throw Error('Module non interactif');
    await page.getByRole('button', { name: 'Ouvrir le menu' }).click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
  }
  await page.close();
}
writeFileSync(out + '/report.json', JSON.stringify(results, null, 2));
await browser.close();
if (
  results.some(
    (r) =>
      r.status !== 200 ||
      r.overflow > 1 ||
      r.smallFields ||
      r.gutters.some((g) => g.left < 16 || g.right < 16) ||
      r.errors.length,
  )
)
  process.exitCode = 1;
