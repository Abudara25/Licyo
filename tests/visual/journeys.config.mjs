import { defineConfig } from '@playwright/test';
const port = Number(process.env.JOURNEYS_PORT || 4174);
export default defineConfig({
  testDir: './journeys', testMatch: '*.e2e.mjs', outputDir: '.results/journeys',
  workers: 1, fullyParallel: false, retries: 0, reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${port}`, browserName: 'chromium', locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  webServer: { command: 'node journeys-server.mjs', url: `http://127.0.0.1:${port}/__test__/state`, reuseExistingServer: false, env: { JOURNEYS_PORT: String(port) } },
});
