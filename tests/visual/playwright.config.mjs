// Tests visuels du site public (phase 4B, filet de sécurité avant l'extraction du moteur de site).
// Hors de `npm test` : ils demandent un navigateur. Lancement : `npm run visual` (comparaison) ou
// `npm run visual:baseline` (régénère la référence, seulement avant une modification voulue du rendu).
// Configuration placée ici (et non à la racine) avec son propre package.json : voir tests/visual/README.md.
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.VISUAL_PORT || 4173);

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  outputDir: '.results',
  // Références stockées hors du dépôt (captures binaires, dépendantes de la plateforme) : voir README.
  snapshotPathTemplate: '.baseline/{platform}/{arg}{ext}',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '.report', open: 'never' }]],
  expect: {
    // Tolérance nulle : toute différence de pixel est signalée (pas de marge qui masquerait une régression).
    toHaveScreenshot: { threshold: 0, maxDiffPixels: 0, animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    // Linux (CI) : Chromium y alterne anticrénelage sous-pixel et en niveaux de gris sur le texte des <select> natifs
    // selon l’état de composition (987 pixels d’écart entre deux passages identiques, phase 4B.1). Texte en niveaux
    // de gris et glyphes sur pixels entiers imposés sous Linux seulement : la référence Windows, stable, n’est pas touchée.
    launchOptions: { args: process.platform === 'linux' ? ['--disable-lcd-text', '--disable-font-subpixel-positioning'] : [] },
  },
  webServer: {
    command: 'node ../../scripts/build-news.mjs && node server.mjs', // actualités générées (voir scripts/build-news.mjs)
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: false,
    env: { VISUAL_PORT: String(PORT) },
  },
});
