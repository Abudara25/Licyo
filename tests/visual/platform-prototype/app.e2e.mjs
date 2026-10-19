// Prototype de console Platform : navigation, fiche et onglets, filtres, assistant, modales, palette, états simulés,
// responsive, et garanties de sécurité (aucun appel réseau métier, aucun stockage persistant).
import { test, expect } from '@playwright/test';

const PAGES = ['#/dashboard', '#/organisations', '#/organisations/org_4c1e0b7d93a2f6581e0c7da94b3f2e61', '#/onboarding', '#/onboarding/nouveau/1', '#/domaines', '#/plans', '#/sante', '#/support', '#/audit', '#/parametres'];
const ready = (page) => expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);

async function open(page, hash) {
  await page.goto(`/${hash}`);
  await ready(page);
}

test('aucune requête réseau hors fichiers statiques du prototype, aucune erreur, aucun stockage', async ({ page, baseURL }) => {
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), type: r.resourceType() }));
  page.on('websocket', (ws) => errors.push(`websocket ${ws.url()}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  for (const hash of PAGES) await open(page, hash);
  // Interactions qui pourraient déclencher un appel : filtres, assistant, modale, palette.
  await open(page, '#/organisations');
  await page.getByLabel('Rechercher une organisation').fill('padel');
  await page.keyboard.press('Control+K');
  await page.keyboard.press('Escape');
  const origin = new URL(baseURL).origin;
  for (const r of requests) {
    expect(r.url.startsWith(`${origin}/`) || r.url.startsWith('data:'), r.url).toBe(true);
    expect(r.method).toBe('GET');
    expect(['document', 'stylesheet', 'script', 'image', 'font'], `${r.type} ${r.url}`).toContain(r.type);
    expect(r.url, 'aucune API').not.toMatch(/\/api\/|\/admin\/|\/functions\//);
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length, cookie: document.cookie }))).toEqual({ local: 0, session: 0, cookie: '' });
});

test('la CSP du serveur interdit toute connexion (connect-src none)', async ({ page }) => {
  const response = await page.goto('/');
  expect(response.headers()['content-security-policy']).toContain("connect-src 'none'");
  await ready(page);
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('/api/track-event', { method: 'POST' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
});

test('navigation principale : chaque entrée ouvre sa page et devient active', async ({ page }) => {
  await open(page, '#/dashboard');
  for (const [label, heading] of [
    ['Organisations', 'Organisations'],
    ['Onboarding', 'Onboarding'],
    ['Domaines', 'Domaines'],
    ['Plans & fonctionnalités', 'Plans & fonctionnalités'],
    ['Santé & incidents', 'Santé & incidents'],
    ['Support', 'Support'],
    ['Audit', 'Audit'],
    ['Paramètres Platform', 'Paramètres Platform'],
    ['Dashboard', 'Bonjour Camille'],
  ]) {
    await page.locator('#sidebar').getByRole('link', { name: label, exact: false }).first().click();
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
  }
  await expect(page.locator('#sidebar [aria-current="page"]').first()).toContainText('Dashboard');
});

test('fiche organisation : ouverture depuis la liste, huit onglets, flèches du clavier', async ({ page }) => {
  await open(page, '#/organisations');
  await page.getByLabel('Rechercher une organisation').fill('Montmorency');
  await page.getByRole('link', { name: 'Tennis Club Montmorency' }).click();
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tennis Club Montmorency');
  const tabs = page.getByRole('tab');
  await expect(tabs).toHaveCount(8);
  for (const [name, text] of [['Configuration', 'Configuration de l’organisation'], ['Utilisateurs', 'Utilisateurs de l’organisation'], ['Modules', 'capacité ∧ droit ∧ drapeau ∧ configuration'], ['Domaines', 'Domaines de l’organisation'], ['Billing', 'Abonnement SaaS'], ['Activité', 'Organisation créée'], ['Audit', 'Journal d’audit de l’organisation'], ['Vue d’ensemble', 'Calcul du mode d’accès']]) {
    await page.getByRole('tab', { name }).click();
    await expect(page.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel')).toContainText(text);
  }
  await page.getByRole('tab', { name: 'Vue d’ensemble' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Configuration' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Configuration' })).toBeFocused();
  expect(page.url()).toContain('/configuration');
});
test('fiche organisation : contrat, facturation et accès dérivé restent trois états distincts', async ({ page }) => {
  await open(page, '#/organisations');
  await page.getByLabel('Rechercher une organisation').fill('Rugby');
  await page.getByRole('link', { name: 'Rugby Club Franconville' }).click();
  await ready(page);
  const states = page.getByRole('group', { name: 'Trois états distincts de l’organisation' });
  await expect(states.locator('.state')).toHaveCount(3);
  for (const [i, kicker, value] of [[0, 'TenantLifecycle', 'Actif'], [1, 'BillingState', 'Impayé'], [2, 'AccessMode', 'Lecture seule']]) {
    await expect(states.locator('.state').nth(i)).toContainText(kicker);
    await expect(states.locator('.state').nth(i)).toContainText(value);
  }
  const derivation = page.getByRole('list', { name: 'Contributions au mode d’accès' });
  await expect(derivation.getByRole('listitem')).toHaveCount(3);
  await expect(page.locator('.org-hero .signal')).toContainText('Impayé');
});

test('liste : vues rapides, organisations à surveiller repérables, lien depuis le dashboard', async ({ page }) => {
  await open(page, '#/organisations');
  const rows = page.locator('main tbody tr');
  await page.getByRole('button', { name: /^À surveiller/ }).click();
  await expect(rows).toHaveCount(5);
  await expect(page.locator('main tbody tr.row-danger')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^À surveiller/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Essais/ }).click();
  await expect(rows).toHaveCount(2);
  await open(page, '#/dashboard');
  await page.locator('.legend').getByRole('button', { name: /^Onboarding/ }).click();
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Organisations');
  await expect(rows).toHaveCount(2);
});

test('liste : recherche, filtres, état vide, tri, pagination', async ({ page }) => {
  await open(page, '#/organisations');
  const rows = page.locator('main tbody tr');
  await expect(rows).toHaveCount(8);
  await expect(page.getByText('Page 1 / 2')).toBeVisible();
  await page.getByLabel('Rechercher une organisation').fill('padel');
  await expect(rows).toHaveCount(2);
  await expect(page.getByLabel('Rechercher une organisation')).toBeFocused();
  await page.getByLabel('Rechercher une organisation').fill('');
  await page.getByLabel('Filtrer par cycle de vie').selectOption('TRIAL');
  await expect(rows).toHaveCount(2);
  await page.getByLabel('Filtrer par mode d’accès').selectOption('BLOCKED');
  await expect(page.getByText('Aucune organisation ne correspond')).toBeVisible();
  await page.getByRole('button', { name: 'Réinitialiser les filtres' }).click();
  await expect(rows).toHaveCount(8);
  await expect(rows.first()).toContainText('Athlé Pontoise'); // tri par défaut : nom A→Z
  await page.getByRole('button', { name: 'Organisation' }).click();
  await expect(rows.first()).toContainText('Volley Beauchamp');
  await page.getByRole('button', { name: 'Organisation' }).click();
  await expect(rows.first()).toContainText('Athlé Pontoise');
  await page.getByRole('button', { name: 'Page suivante' }).click();
  await expect(page.getByText('Page 2 / 2')).toBeVisible();
});

test('assistant d’onboarding : validation, 9 étapes, fin simulée sans création', async ({ page }) => {
  await open(page, '#/onboarding/nouveau/1');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Indiquez le nom de l’organisation')).toBeVisible();
  await page.getByLabel('Nom de l’organisation').fill('Tennis Club des Tilleuls');
  await expect(page.getByLabel('Identifiant court (slug)')).toHaveValue('tennis-club-des-tilleuls');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Sport / activité' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Choisissez l’activité principale.')).toBeVisible();
  await page.getByRole('button', { name: 'Tennis', exact: true }).click();
  for (const step of ['Identité visuelle', 'Domaine', 'Plan', 'Modules', 'Administrateur']) {
    await page.getByRole('button', { name: 'Continuer' }).click();
    await expect(page.getByRole('heading', { name: step, exact: true })).toBeVisible();
  }
  await page.getByLabel('Nom de l’administrateur').fill('Présidence démo');
  await page.getByLabel('E-mail').fill('pas-un-email');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByText('Adresse e-mail invalide.')).toBeVisible();
  await page.getByLabel('E-mail').fill('presidence@tilleuls.example');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('heading', { name: 'Vérification' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Tennis Club des Tilleuls');
  await page.getByRole('button', { name: 'Confirmer' }).click();
  await expect(page.getByRole('heading', { name: 'Création', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Simuler la création' }).click();
  await expect(page.getByRole('heading', { name: 'Organisation prête à être provisionnée' })).toBeVisible();
  await expect(page.getByText('Aucune ressource n’a été créée')).toBeVisible();
});

test('étape de l’assistant atteinte par l’URL sans les précédentes : retour à la première étape invalide', async ({ page }) => {
  await open(page, '#/onboarding/nouveau/7');
  await expect(page.getByRole('heading', { name: 'Organisation', exact: true })).toBeVisible();
  expect(page.url()).toMatch(/nouveau\/1$/);
});

test('modale sensible : saisie de confirmation, Échap, retour du focus, toast', async ({ page }) => {
  await open(page, '#/organisations/org_91b3e6d027f84ac5b1d93e0f62a7c4d8');
  const more = page.getByRole('button', { name: 'Autres actions' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Suspendre l’accès…' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Suspendre l’accès' });
  await expect(confirm).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await more.click();
  await page.getByRole('menuitem', { name: 'Suspendre l’accès…' }).click();
  await page.getByLabel(/Pour confirmer, saisissez/).fill('padel-95');
  await expect(confirm, 'motif encore vide').toBeDisabled();
  await dialog.getByLabel(/^Motif/).fill('   ');
  await expect(confirm, 'motif blanc').toBeDisabled();
  await dialog.getByLabel(/^Motif/).fill('Connexions suspectes signalées par le club');
  await page.getByLabel(/Pour confirmer, saisissez/).fill('padel-9');
  await expect(confirm, 'slug incorrect').toBeDisabled();
  await page.getByLabel(/Pour confirmer, saisissez/).fill('padel-95');
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByRole('status').getByText('Blocage simulé pour Padel 95')).toBeVisible();
});

test('recherche rapide (Ctrl+K) : ouvre une organisation au clavier', async ({ page }) => {
  await open(page, '#/dashboard');
  await page.keyboard.press('Control+K');
  await page.getByRole('combobox', { name: 'Rechercher' }).fill('judo');
  await page.keyboard.press('Enter');
  await ready(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Judo Argenteuil');
});

test('états simulés : chargement, vide, erreur puis réessai', async ({ page }) => {
  await open(page, '#/organisations');
  const pick = async (label) => {
    await page.getByRole('button', { name: 'Options de l’aperçu' }).click();
    await page.getByRole('menuitem', { name: label }).click();
  };
  await pick('État d’erreur');
  await expect(page.getByRole('alert')).toContainText('Impossible de charger ces données');
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.locator('main tbody tr')).toHaveCount(8);
  await pick('État vide');
  await expect(page.getByText('Aucune organisation', { exact: true })).toBeVisible();
  await pick('État de chargement');
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(1);
});

for (const [width, height] of [[360, 780], [768, 1024]]) {
  test(`responsive ${width} px : aucun défilement horizontal, gouttière, tiroir de navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const hash of PAGES) {
      await open(page, hash);
      const m = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, pad: parseFloat(getComputedStyle(document.querySelector('main')).paddingLeft), tables: [...document.querySelectorAll('main .table-wrap')].map((w) => w.scrollWidth - w.clientWidth) }));
      expect(m.scroll, `${hash} déborde`).toBeLessThanOrEqual(m.inner);
      // Les tableaux se replient (colonnes secondaires masquées ou cartes) ; seule la matrice des offres défile.
      if (hash !== '#/plans') expect(Math.max(0, ...m.tables), `${hash} : tableau qui défile`).toBe(0);
      expect(m.pad, `${hash} gouttière`).toBeGreaterThanOrEqual(16);
    }
    await open(page, '#/dashboard');
    await expect(page.locator('#sidebar')).not.toBeInViewport();
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await expect(page.locator('#sidebar')).toBeInViewport();
    await page.locator('#sidebar').getByRole('link', { name: 'Domaines' }).click();
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Domaines');
    await expect(page.locator('#sidebar')).not.toBeInViewport();
    if (width < 768) {
      await open(page, '#/organisations');
      const input = page.getByLabel('Rechercher une organisation');
      expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      const heights = await page.locator('main .btn:visible').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      expect(Math.min(...heights), 'cibles tactiles').toBeGreaterThanOrEqual(44);
    }
  });
}

test('bureau 1440 px : pas de bouton de menu, sidebar visible, valeurs d’indicateurs alignées', async ({ page }) => {
  await open(page, '#/dashboard');
  await expect(page.getByRole('button', { name: 'Ouvrir la navigation' })).toBeHidden();
  await expect(page.locator('#sidebar')).toBeInViewport();
  const tops = await page.locator('.summary .big').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(tops.length, 'trois cartes de synthèse').toBe(3);
  expect(new Set(tops).size, 'valeurs sur une même ligne').toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Tableau : les en-têtes restent alignés sur les cellules et le tableau occupe toute la carte.
  await open(page, '#/organisations');
  const layout = await page.evaluate(() => {
    const t = document.querySelector('main table');
    const lefts = (sel) => [...t.querySelectorAll(sel)].map((c) => Math.round(c.getBoundingClientRect().left));
    return { display: getComputedStyle(t).display, th: lefts('thead th'), td: lefts('tbody tr:first-child td'), full: Math.round(t.getBoundingClientRect().width) === Math.round(t.closest('.card').getBoundingClientRect().width) - 2 };
  });
  expect(layout.display).toBe('table');
  expect(layout.th).toEqual(layout.td);
  expect(layout.full, 'tableau sur toute la largeur de la carte').toBe(true);
  for (const hash of PAGES) {
    await open(page, hash);
    const over = await page.evaluate(() => Math.max(0, ...[...document.querySelectorAll('main .table-wrap')].map((w) => w.scrollWidth - w.clientWidth)));
    expect(over, `${hash} : tableau qui défile à 1440 px`).toBe(0);
  }
});

// Contrôles interactifs visibles dont la cible fait moins de 44 × 44 px. Les liens insérés dans un texte (nom
// d'organisation dans une phrase, lien d'un journal) en sont exclus, comme le permet le critère WCAG 2.5.8.
const INTERACTIVE = [
  'button', 'a.btn', '[role="menuitem"]', '[role="option"]', '[role="switch"]', '[role="tab"]', '.nav-link', '.head-link', '.crumbs a',
  '.id-copy', '.rb-edit', '.step > a', '.legend-item', '.brand', 'input:not([type="hidden"])', 'select', 'textarea',
].join(', ');
const smallTargets = (page) =>
  page.evaluate((selector) => {
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!r.width || !r.height || s.visibility === 'hidden' || el.closest('[hidden], [aria-hidden="true"]')) continue;
      if (r.right <= 0 || r.left >= innerWidth) continue; // tiroir fermé, hors écran
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0] || '-'} « ${(el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)} » ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, INTERACTIVE);

for (const [width, height] of [[360, 780], [768, 1024]]) {
  test(`cibles tactiles ${width} px : tout contrôle interactif visible mesure au moins 44 × 44 px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const hashes = [...PAGES, '#/organisations/org_4c1e0b7d93a2f6581e0c7da94b3f2e61/modules', '#/organisations/org_4c1e0b7d93a2f6581e0c7da94b3f2e61/facturation', '#/onboarding/nouveau/3'];
    const failures = [];
    for (const hash of hashes) {
      await open(page, hash);
      for (const f of await smallTargets(page)) failures.push(`${hash} ${f}`);
    }
    // Tiroir de navigation ouvert et menu déroulant ouvert.
    await open(page, '#/dashboard');
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    for (const f of await smallTargets(page)) failures.push(`tiroir ${f}`);
    await page.keyboard.press('Escape');
    await open(page, '#/organisations/org_4c1e0b7d93a2f6581e0c7da94b3f2e61');
    await page.getByRole('button', { name: 'Autres actions' }).click();
    await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished))); // mesure après l'animation d'ouverture
    for (const f of await smallTargets(page)) failures.push(`menu ${f}`);
    // Palette de recherche rapide (Ctrl+K) : chaque résultat est une cible.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.evaluate(() => Promise.all(document.getAnimations().map((x) => x.finished)));
    expect(await page.getByRole('option').count()).toBeGreaterThan(3);
    for (const f of await smallTargets(page)) failures.push(`palette ${f}`);
    expect([...new Set(failures)]).toEqual([]);
  });

  test(`mise en page ${width} px : la barre du haut démarre en haut, même sur une page courte`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const hash of ['#/onboarding', '#/parametres', '#/organisations/org_inconnue']) {
      await open(page, hash);
      const m = await page.evaluate(() => ({ topbar: document.querySelector('.topbar').getBoundingClientRect().top, main: document.querySelector('main').getBoundingClientRect().top, bar: document.querySelector('.topbar').getBoundingClientRect().bottom }));
      expect(m.topbar, `${hash} : barre du haut`).toBe(0);
      expect(Math.round(m.main), `${hash} : contenu juste sous la barre`).toBe(Math.round(m.bar));
    }
  });
}
