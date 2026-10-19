// Pages, largeurs et stabilisation communes aux tests visuels.

export const PAGES = [
  { name: 'accueil', path: '/' },
  { name: 'equipe', path: '/equipe.html' },
  { name: 'entrainements', path: '/entrainements.html' },
  { name: 'inscription', path: '/inscription.html' },
  { name: 'contact', path: '/contact.html' },
  { name: 'actualites', path: '/actualites.html' },
  { name: 'partenaires', path: '/partenaires.html' },
  { name: 'article', path: '/actualites/article-demo-bienvenue' },
  { name: 'mentions-legales', path: '/mentions-legales.html' },
  { name: 'confidentialite', path: '/confidentialite.html' },
  { name: '404', path: '/404.html' },
];

export const VIEWPORTS = [
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1440', width: 1440, height: 900 },
];

// Rend la page déterministe SANS en changer l'apparence :
// - polices chargées, images décodées ;
// - défilement jusqu'en bas puis retour en haut : les blocs [data-reveal] apparaissent comme pour un
//   visiteur (IntersectionObserver), et les images en loading="lazy" se chargent ;
// - prefers-reduced-motion: reduce (config) ramène transitions et animations à ~0 ms, et
//   toHaveScreenshot({ animations: 'disabled' }) remet l'animation infinie du blason (float) à son état initial.
// Rien n'est masqué : aucune zone du site public n'est intrinsèquement non déterministe avec ces fixtures.
export async function stabilize(page) {
  await page.waitForLoadState('load');
  await page.evaluate(() => document.fonts.ready);
  // Listes déroulantes natives : texte redessiné une fois les polices prêtes (Chromium Linux pouvait garder
  // un premier rendu du texte, avec un anticrénelage différent d’un passage à l’autre). Aucun effet visuel final.
  await page.evaluate(() => {
    for (const select of document.querySelectorAll('select')) {
      select.style.display = 'none';
      void select.offsetHeight;
      select.style.display = '';
    }
  });
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    await new Promise((r) => setTimeout(r, 60));
    // Machine chargée : un bloc survolé trop vite peut ne pas avoir été signalé par l'observer.
    for (const el of document.querySelectorAll('[data-reveal]:not(.is-visible)')) {
      if (!el.getClientRects().length) continue;
      el.scrollIntoView({ block: 'center' });
      await new Promise((r) => setTimeout(r, 60));
    }
  });
  // Tous les blocs affichés doivent être révélés, sinon la capture dépendrait de la vitesse de la machine.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-reveal]')].every((el) => !el.getClientRects().length || el.classList.contains('is-visible'))
  );
  // ... et leur transition terminée : main.js pose un transition-delay en ligne (jusqu'à 240 ms), que
  // prefers-reduced-motion ne raccourcit pas (seule la durée l'est).
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[data-reveal].is-visible')].every((el) => getComputedStyle(el).opacity === '1' && getComputedStyle(el).transform === 'matrix(1, 0, 0, 1, 0, 0)')
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => [...document.images].every((img) => img.complete));
  await page.evaluate(() => Promise.all([...document.images].map((img) => (img.decode ? img.decode().catch(() => {}) : null))));
  // Deux images pour que les classes posées au défilement (is-visible, is-scrolled) soient peintes.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForFunction(() => !document.querySelector('.site-header')?.classList.contains('is-scrolled'));
  await page.waitForTimeout(50);
}

export async function openPage(page, path) {
  const response = await page.goto(path, { waitUntil: 'load' });
  await stabilize(page);
  return response;
}
