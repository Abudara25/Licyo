// Tests de bout en bout du prototype de console Platform (prototypes/platform-crm), SÉPARÉS de la suite visuelle du
// site : autre configuration, autre suffixe (*.e2e.mjs, jamais repris par `npm run visual` ni par la CI visuelle).
// Lancement : npm run platform:e2e (depuis la racine).
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PLATFORM_PREVIEW_PORT || 4311);

export default defineConfig({
  testDir: './platform-prototype',
  testMatch: '*.e2e.mjs',
  outputDir: '.platform-results',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    browserName: 'chromium',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  webServer: {
    command: 'node ../../scripts/serve-platform-prototype.mjs',
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    env: { PLATFORM_PREVIEW_PORT: String(PORT) },
  },
});
