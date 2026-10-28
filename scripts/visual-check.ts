// Captures 360 px et 768 px + contrôles (débordement horizontal, gouttière,
// cibles tactiles, taille des champs). Usage :
// node --experimental-strip-types scripts/visual-check.ts <dossier-sortie> [loginUrl] [pages…]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Un lien de connexion neuf par contexte (ils sont à usage unique).
const freshLogin = (email: string) =>
  execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/login-link.ts', email, '/club-admin'], { encoding: 'utf8' }).trim();

const [outDir, loginUrl, ...pages] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const width of [360, 768]) {
  const context = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 1, locale: 'fr-FR' });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => consoleErrors.push(e.message.slice(0, 160)));
  if (loginUrl && loginUrl !== '-') await page.goto(loginUrl.includes('@') ? freshLogin(loginUrl) : loginUrl, { waitUntil: 'networkidle', timeout: 180_000 });
  for (const url of pages) {
    consoleErrors.length = 0;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 180_000 });
    await page.waitForTimeout(400);
    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const issues: string[] = [];
      if (overflow > 1) issues.push(`débordement horizontal ${overflow}px`);
      // Texte visible collé au bord (gouttière < 12 px).
      for (const el of Array.from(document.querySelectorAll('h1,h2,h3,p,label,li,a,button'))) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || r.bottom < 0) continue;
        if (el.closest('[aria-hidden="true"],.sr-only,header,footer,nav,[role="dialog"]')) continue;
        if (el.textContent?.trim() && (r.left < 12 || doc.clientWidth - r.right < 12) && r.width < doc.clientWidth - 2) {
          issues.push(`gouttière: <${el.tagName.toLowerCase()}> "${el.textContent.trim().slice(0, 30)}" x=${Math.round(r.left)}`);
        }
      }
      for (const el of Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=color]):not(.sr-only):not([type=hidden]),select,textarea'))) {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const r = el.getBoundingClientRect();
        if (r.width && fs < 16) issues.push(`champ à ${fs}px (${(el as HTMLInputElement).id || el.tagName})`);
      }
      for (const el of Array.from(document.querySelectorAll('button,a[href],[role=tab]'))) {
        const r = el.getBoundingClientRect();
        if (!r.width || el.closest('.sr-only,footer,p,dd,li li') || getComputedStyle(el).position === 'absolute') continue;
        if (r.height < 36 && el.textContent?.trim()) issues.push(`cible ${Math.round(r.height)}px: "${el.textContent.trim().slice(0, 25)}"`);
      }
      return [...new Set(issues)].slice(0, 12);
    });
    const name = `${width}-${url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 60)}.png`;
    await page.screenshot({ path: `${outDir}/${name}`, fullPage: true });
    console.log(`${width}px ${url}\n  ${report.length ? report.join('\n  ') : 'OK'}`);
  }
  await context.close();
}
await browser.close();
