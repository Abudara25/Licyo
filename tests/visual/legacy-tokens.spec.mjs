// Phase 4C : chaque token historique de styles.css (--maroon-*, --gold-*, --color-*, --shadow-*…) doit garder
// EXACTEMENT sa valeur calculée après l'extraction du thème. La valeur d'une propriété personnalisée n'est pas
// normalisée par le navigateur (« rgb(58 15 16 / .08) » et « rgba(58,15,16,.08) » diffèrent en texte mais pas en
// couleur) : chaque token est donc appliqué à un élément sonde, et c'est la valeur CALCULÉE de la propriété qui
// est comparée à la référence capturée avant la phase 4C (legacy-tokens.reference.json).
// Régénération (seulement avant une modification voulue) : UPDATE_STYLE_SNAPSHOT=1 npm run visual.
import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openPage } from './helpers.mjs';

const REFERENCE = fileURLToPath(new URL('./legacy-tokens.reference.json', import.meta.url));
const UPDATE = process.env.UPDATE_STYLE_SNAPSHOT === '1';

// Tokens historiques (noms présents dans styles.css avant la phase 4C, utilisés aussi par admin.css, suivi.css et
// des styles en ligne) : ils doivent tous rester définis, avec la même valeur calculée.
const LEGACY = [
  '--maroon-950', '--maroon-900', '--maroon-800', '--maroon-700', '--maroon-600',
  '--gold-600', '--gold-500', '--gold-400', '--gold-300', '--gold-100',
  '--red-600', '--red-500', '--cream-100', '--cream-200', '--ink-900', '--ink-700', '--white',
  '--color-bg', '--color-surface', '--color-text', '--color-text-muted', '--color-primary', '--color-primary-dark',
  '--color-accent', '--color-accent-dark', '--color-accent-text', '--color-danger',
  '--font-display', '--font-body', '--radius-sm', '--radius-md', '--radius-lg', '--container', '--header-h',
  '--shadow-sm', '--shadow-md', '--shadow-lg', '--ease',
];

const probeProperty = (name) =>
  name.startsWith('--shadow') ? 'box-shadow'
    : name.startsWith('--font') ? 'font-family'
      : name.startsWith('--radius') ? 'border-top-left-radius'
        : name === '--container' || name === '--header-h' ? 'max-width'
          : name === '--ease' ? 'transition-timing-function'
            : 'color';

test('tokens historiques : valeur calculée identique à la référence d’avant la phase 4C', async ({ page }) => {
  await openPage(page, '/');
  const values = await page.evaluate((entries) => {
    const out = {};
    for (const [name, property] of entries) {
      const probe = document.createElement('div');
      probe.style.setProperty(property, `var(${name})`);
      if (property === 'box-shadow') probe.style.setProperty('box-shadow', `var(${name})`);
      document.body.appendChild(probe);
      out[name] = { property, value: getComputedStyle(probe).getPropertyValue(property) };
      probe.remove();
    }
    return out;
  }, LEGACY.map((name) => [name, probeProperty(name)]));

  if (UPDATE) {
    await writeFile(REFERENCE, JSON.stringify(values, null, 2) + '\n');
    return;
  }
  const reference = JSON.parse(await readFile(REFERENCE, 'utf8'));
  for (const name of LEGACY) expect(values[name], name).toEqual(reference[name]);
  // Aucune valeur vide : un token disparu donnerait la valeur initiale de la propriété, pas une chaîne vide,
  // mais la comparaison ci-dessus le détecte de toute façon.
});
