import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const photo = { name: 'image-fictive.png', mimeType: 'image/png', buffer: PNG };
let state;
test.beforeEach(async ({ request, context, baseURL }) => {
  state = await (await request.post('/__test__/reset')).json();
  const [name, value] = state.cookie.split('=');
  await context.addCookies([{ name, value, url: baseURL }]);
  // Les services externes restent hors recette : aucune donnée ne quitte la machine.
  await context.route('**/*', (route) => route.request().url().startsWith(baseURL) ? route.continue() : route.abort());
});

test('inscription → dépôts famille → vérification club → acompte → correction → solde', async ({ page, request }) => {
  const data = { enfantPrenom: 'Parcours', enfantNom: 'Exemple', naissance: '2021-03-03', categorie: 'U6', tailleMaillot: '6 ans', modePaiement: 'Carte bancaire', parentPrenom: 'Parent', parentNom: 'Exemple', email: 'parcours@example.invalid', telephone: '0600000000', villeNaissance: 'Ville fictive', paysNaissance: 'France', cpNaissance: '00000', autorisation: true, rgpd: true, droitImage: false };
  const response = await request.post('/api/inscriptions', { data });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { uploadToken } = await response.json();
  const id = (await (await request.get('/__test__/inscriptions')).json()).find((r) => r.enfant_prenom === 'Parcours').id;
  await page.goto(`/depot/${uploadToken}`);
  await expect(page.locator('.suivi-todo')).toContainText('Déposer le dossier signé');
  await page.locator('input[name="dossier"]').setInputFiles(photo);
  await page.locator('form').filter({ has: page.locator('input[name="dossier"]') }).getByRole('button', { name: /Envoyer|Déposer/ }).click();
  await expect(page.locator('.suivi-summary')).toContainText('En vérification');
  await page.locator('input[name="photo"]').setInputFiles(photo);
  await page.locator('form').filter({ has: page.locator('input[name="photo"]') }).getByRole('button', { name: /Envoyer|Ajouter/ }).click();
  await expect(page.locator('.suivi-todo')).not.toContainText('Ajouter une photo');
  await page.goto(`/admin/inscriptions/${id}#tab-dossier`);
  await page.getByRole('button', { name: 'Valider le dossier', exact: true }).click();
  await page.goto(`/admin/inscriptions/${id}#versement`);
  const payment = page.locator('form').filter({ has: page.locator('#versement-montant') });
  await page.locator('#versement-montant').fill('60');
  await payment.getByRole('button', { name: 'Enregistrer le versement' }).click();
  await expect(page.locator('.adm-main')).toContainText('reste 120');
  await page.goto(`/depot/${uploadToken}`);
  await expect(page.locator('.suivi-todo')).toContainText('Régler le solde de 120');
  await expect(page.locator('.suivi-summary')).not.toContainText('Tout est en ordre');
  const mails = await (await request.get('/__test__/mails')).json();
  expect(mails.some((m) => /Dossier complet/.test(m.subject) && /Il reste 120/.test(m.textContent))).toBeTruthy();
  await page.goto(`/admin/inscriptions/${id}#correction-versement`);
  const correction = page.locator('form').filter({ has: page.locator('input[name="action"][value="versement-correction"]') });
  await correction.locator('[name="recu"]').fill('50');
  page.once('dialog', (dialog) => dialog.accept());
  await correction.getByRole('button', { name: /Corriger|Enregistrer/ }).click();
  await expect(page.locator('.adm-main')).toContainText('Montants corrigés');
  await page.goto(`/depot/${uploadToken}`);
  await expect(page.locator('.suivi-todo')).toContainText('Régler le solde de 130');
  await page.goto(`/admin/inscriptions/${id}#versement`);
  await page.locator('#versement-montant').fill('130');
  await page.locator('form').filter({ has: page.locator('#versement-montant') }).getByRole('button', { name: 'Enregistrer le versement' }).click();
  await page.goto(`/depot/${uploadToken}`);
  await expect(page.locator('.suivi-summary')).toContainText('Rien à faire pour le moment');
  await expect(page.locator('.suivi-summary')).toContainText('le club s\'occupe de la licence');
});

test('éducateur : ajout → e-mail personnel → formulaire de qualifications → photo → fiche admin', async ({ page, request }) => {
  await page.goto('/admin/educateurs');
  await page.getByText('Ajouter un éducateur', { exact: true }).click();
  await page.locator('#educ-new-prenom').fill('Nouveau');
  await page.locator('#educ-new-nom').fill('Exemple');
  await page.locator('#educ-new-email').fill('nouveau@example.invalid');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.locator('.adm-main')).toContainText('lien envoyé par e-mail');
  const mails = await (await request.get('/__test__/mails')).json();
  const mail = mails.find((m) => m.to.some((p) => p.email === 'nouveau@example.invalid'));
  expect(mail).toBeTruthy();
  const token = mail.textContent.match(/\/educateur\/(e[A-Za-z0-9_-]{43})/)[1];
  await page.goto(`/educateur/${token}`);
  await page.locator('[name="civilite"][value="Madame"]').check();
  const fields = { naissance: '1990-01-01', nationalite: 'Française', paysNaissance: 'France', cpNaissance: '00000', villeNaissance: 'Ville fictive', telephone: '0600000000', adresse: 'Adresse fictive', codePostal: '00000', ville: 'Ville fictive', urgenceNom: 'Contact Exemple', urgenceTelephone: '0600000001', diplomesAutre: 'Formation fictive, organisme fictif, en cours' };
  for (const [name, value] of Object.entries(fields)) await page.locator(`[name="${name}"]`).fill(value);
  await page.locator('[name="diplomes"][value="cfi_u6u9"]').check();
  await page.locator('[name="diplomes"][value="psc"]').check();
  await page.locator('[name="tailleTenue"]').selectOption('M');
  await page.locator('[name="rgpd"]').check();
  await page.locator('[name="attestation"]').check();
  await page.locator('.educ-form').getByRole('button', { name: /Envoyer|Enregistrer/ }).click();
  await expect(page.locator('.educ-steps')).toContainText('Envoyées');
  await page.locator('[name="photo"]').setInputFiles(photo);
  await page.locator('.educ-photo-form').getByRole('button', { name: 'Envoyer la photo', exact: true }).click();
  await expect(page.locator('.educ-intro')).toContainText('Votre fiche est complète');
  await page.goto('/admin/educateurs');
  await page.getByRole('link', { name: 'Nouveau Exemple', exact: true }).click();
  await expect(page.locator('.adm-main')).toContainText('CFI U6-U9 certifié');
  await expect(page.locator('.adm-main')).toContainText('Diplômes déclarés');
  await expect(page.locator('.adm-main')).toContainText('ne vaut pas vérification');
});

test('protections : écriture admin sans CSRF refusée et dépôt famille depuis une autre origine refusé', async ({ request, baseURL }) => {
  const headers = { Cookie: state.cookie, Origin: baseURL };
  const admin = await request.post(`/admin/inscriptions/${state.pending}`, { headers, form: { action: 'versement', montant: '60', du: '180' } });
  expect(admin.status()).toBe(403);
  const family = await request.post(`/depot/${state.pendingToken}`, { headers: { Origin: 'https://autre.example.invalid' }, multipart: { dossier: photo } });
  expect(family.status()).toBe(403);
});

test('navigation CRM : barre latérale, recherche directe et menu mobile accessible', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin/a-traiter');
  await expect(page.locator('.adm-sidebar')).toBeVisible();
  await expect(page.locator('.adm-tabbar')).not.toBeVisible();
  expect((await page.locator('.adm-topnav').boundingBox()).x).toBe(240);
  await page.locator('.adm-sidebar').getByRole('link', { name: 'Éducateurs', exact: true }).click();
  await expect(page.locator('.adm-sidebar a[aria-current="page"]')).toHaveText('Éducateurs');
  await page.locator('#adm-global-query').fill('Enfant');
  await page.locator('.adm-global-search').getByRole('button', { name: 'Rechercher' }).click();
  await expect(page).toHaveURL(/\/admin\/recherche\?q=Enfant/);
  await expect(page.locator('.adm-main')).toContainText('Enfant Exemple');
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator('.adm-sidebar')).not.toBeVisible();
  await expect(page.locator('.adm-tabbar')).toBeVisible();
  const more = page.locator('.adm-tabbar .adm-more > summary');
  await more.click();
  const menu = page.locator('.adm-more-menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const headerBox = await page.locator('.adm-topnav').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height + 8);
  expect(box.y + box.height).toBeLessThan(640);
  await page.screenshot({ path: testInfo.outputPath('menu-360.png') });
  await menu.getByRole('link', { name: 'Déconnexion', exact: true }).scrollIntoViewIfNeeded();
  await expect(menu.getByRole('link', { name: 'Déconnexion', exact: true })).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(more).toBeFocused();
  await page.setViewportSize({ width: 768, height: 1024 });
  await more.click();
  await page.screenshot({ path: testInfo.outputPath('menu-768.png') });
});

test('habillage CRM : filtres, actions secondaires et connexion sur mobile et tablette', async ({ page, context }, testInfo) => {
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/inscriptions');
    await page.locator('.adm-filters > summary').click();
    await expect(page.locator('.adm-filters-panel')).toBeVisible();
    const filters = await page.locator('.adm-filters-panel').boundingBox();
    expect(filters.x).toBeGreaterThanOrEqual(16);
    expect(filters.x + filters.width).toBeLessThanOrEqual(width - 16);
    await page.screenshot({ path: testInfo.outputPath(`filtres-${width}.png`), fullPage: true });
    await page.locator('.adm-filters-panel').getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(page.locator('.adm-irows')).toBeVisible();
    await page.goto(`/admin/inscriptions/${state.partial}`);
    await page.locator('.adm-more-actions > summary').click();
    await expect(page.locator('.adm-more-actions-menu')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`actions-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(page.locator('.adm-more-actions-menu')).not.toBeVisible();
  }
  await context.clearCookies();
  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin/inscriptions');
    await expect(page.locator('.adm-login')).toBeVisible();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      images: [null, '::before', '::after'].map(p => getComputedStyle(document.body, p).backgroundImage),
    }));
    expect(layout.overflow).toBe(0);
    expect(layout.images.every(value => !value.includes('gradient'))).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`connexion-${width}.png`) });
  }
});

for (const width of [360, 768, 1024, 1440]) test(`recette visuelle admin et famille à ${width}px`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width, height: 900 });
  const paths = {
    categories: '/admin/categories', parametres: '/admin/parametres', preinscriptions: '/admin/preinscriptions', reinscription: '/admin/reinscription', email: '/admin/email', evenements: '/admin/events',
    tableau_de_bord: '/admin/dashboard', travail: '/admin/a-traiter', inscriptions: '/admin/inscriptions', adherents: '/admin/adherents',
    paiement: `/admin/inscriptions/${state.partial}#tab-paiement`, licence: `/admin/inscriptions/${state.partial}#tab-licence`, famille: `/admin/inscriptions/${state.partial}#tab-famille`,
    educateurs: '/admin/educateurs', educateur_admin: `/admin/educateurs/${state.completeEducator}`, educateur_form: `/educateur/${state.educatorToken}`,
    espace_famille: `/depot/${state.partialToken}`, transfert: `/depot/${state.transferredToken}`, acces_famille: '/espace-famille',
  };
  const metrics = [];
  for (const [name, path] of Object.entries(paths)) {
    // Recharger aussi lorsque deux captures ne diffèrent que par l'onglet (ancre).
    await page.goto('about:blank');
    const response = await page.goto(path);
    expect(response.status(), path).toBe(200);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => window.scrollTo(0, 0));
    const result = await page.evaluate(() => {
      const visible = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[aria-hidden="true"]');
      const main = document.querySelector('main .container, main.adm-wrap');
      return { overflowElements: [...document.querySelectorAll('body *')].filter(visible).filter(e => e.getBoundingClientRect().right > innerWidth + .5).map(e => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right })).slice(0, 12), overflow: document.documentElement.scrollWidth - innerWidth, gutter: main ? parseFloat(getComputedStyle(main).paddingLeft) : 0,
        fields: [...document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea')].filter(visible).filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => ({ id: e.id, font: getComputedStyle(e).fontSize })),
        decorations: location.pathname.startsWith('/admin/') ? [...document.querySelectorAll('.adm-hero, .adm-topnav, .adm-login-body')].flatMap(e => [null, '::before', '::after'].map(p => getComputedStyle(e, p).backgroundImage)).filter(value => value.includes('gradient')) : [],
        smallButtons: [...document.querySelectorAll('button, .adm-btn, .btn, .adm-tabbar a, .adm-sidebar a')].filter(visible).filter((e) => e.getBoundingClientRect().height < 44).map((e) => ({ text: e.textContent.trim(), height: e.getBoundingClientRect().height })),
      };
    });
    metrics.push({ name, ...result });
    await writeFile(testInfo.outputPath('metrics.json'), JSON.stringify(metrics, null, 2));
    await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), fullPage: true });
    expect(result.overflow, path).toBeLessThanOrEqual(0);
    expect(result.gutter, path).toBeGreaterThanOrEqual(16);
    expect(result.decorations, path).toEqual([]);
    expect(result.fields, path).toEqual([]);
    expect(result.smallButtons, path).toEqual([]);
  }
  await writeFile(testInfo.outputPath('metrics.json'), JSON.stringify(metrics, null, 2));
});
