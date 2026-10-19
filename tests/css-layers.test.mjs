// Phase 4C : séparation base / palette / thème de la feuille publique (sources dans styles/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCss, loadSite, resolveSlot } from '../scripts/build-css.mjs';

const read = (path) => readFileSync(path, 'utf8').split('\r').join('');
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const cssFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => join(dir, f));

const { site, theme, themeDir } = loadSite();
const BASE = cssFiles('styles/base');
const THEME = cssFiles(themeDir);
const THEME_RULES = THEME.filter((f) => !f.endsWith('tokens.css'));

const HEX = /#[0-9a-f]{3,8}\b/i;
const LEGACY = /var\(--(maroon|gold|red|cream|ink)-\d+\)|var\(--white\)/;
// rgba/rgb à canaux numériques : seuls le blanc et le noir génériques sont admis hors palette.
const NUMERIC_RGB = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
const GENERIC = new Set(['255,255,255', '0,0,0']);
// Syntaxe moderne rgb(r g b / a) : fait interpoler les dégradés en oklab (rendu différent, constaté en phase 4C).
const MODERN_RGB = /rgba?\([^,)]*\//;

function brandRgb(css) {
  return [...css.matchAll(NUMERIC_RGB)].map((m) => `${m[1]},${m[2]},${m[3]}`).filter((c) => !GENERIC.has(c));
}

test('feuille publique : assets/css/styles.css correspond exactement aux sources styles/', () => {
  assert.equal(read('assets/css/styles.css'), buildCss().css, 'lancer `npm run css`');
});

test('manifeste : chaque fragment de la base et du thème est assemblé une et une seule fois', () => {
  const slots = theme.order;
  assert.equal(new Set(slots).size, slots.length, 'emplacement en double');
  const used = slots.map((slot) => resolveSlot(slot, { site, themeDir })).filter(Boolean).map((p) => p.split('\\').join('/'));
  for (const file of [...BASE, ...THEME]) assert.ok(used.some((u) => u.endsWith(file.split('\\').join('/'))), `fragment non assemblé : ${file}`);
  assert.deepEqual({ id: theme.id, version: theme.version }, { id: 'dynamic_diagonal', version: 1 });
  assert.equal(site.palette, 'club-demo');
});

test('base : aucune identité de marque (ni hex, ni primitive --brand-*, ni ancien nom, ni rgba de marque)', () => {
  for (const file of BASE) {
    const css = withoutComments(read(file));
    assert.doesNotMatch(css, HEX, `${file} : couleur hexadécimale`);
    assert.doesNotMatch(css, /var\(--brand-/, `${file} : primitive de palette`);
    assert.doesNotMatch(css, LEGACY, `${file} : ancien nom de couleur`);
    assert.deepEqual(brandRgb(css), [], `${file} : rgba de marque`);
    assert.doesNotMatch(css, /font-family:\s*['"]?(Oswald|Inter)/i, `${file} : police de marque en dur`);
  }
});

test('thème : règles écrites uniquement avec des tokens (les primitives ne sont lues que par tokens.css)', () => {
  for (const file of THEME_RULES) {
    const css = withoutComments(read(file)).replace(/@font-face\s*{[^}]*}/g, '');
    assert.doesNotMatch(css, HEX, `${file} : couleur hexadécimale`);
    assert.doesNotMatch(css, /var\(--brand-/, `${file} : primitive de palette utilisée directement`);
    assert.doesNotMatch(css, LEGACY, `${file} : ancien nom de couleur`);
    assert.deepEqual(brandRgb(css), [], `${file} : rgba de marque`);
  }
});

test('transparences : toujours rgba(var(--x-rgb), a) en syntaxe historique, jamais rgb(r g b / a) ni color-mix', () => {
  for (const file of [...BASE, ...THEME, 'styles/palettes/club-demo.css', 'styles/legacy/aliases.css']) {
    const css = withoutComments(read(file));
    assert.doesNotMatch(css, MODERN_RGB, `${file} : syntaxe rgb moderne (interpolation oklab)`);
    assert.doesNotMatch(css, /color-mix\(/, `${file} : color-mix`);
  }
  const palette = withoutComments(read('styles/palettes/club-demo.css'));
  for (const [, channels] of palette.matchAll(/--brand-[a-z]+-\d+-rgb:\s*([^;]+);/g)) {
    assert.match(channels.trim(), /^\d{1,3}, \d{1,3}, \d{1,3}$/, `canaux séparés par des virgules : ${channels}`);
  }
});

test('palette DEMO : valeurs historiques exactes (jamais recalculées)', () => {
  const palette = read('styles/palettes/club-demo.css');
  const expected = {
    '--brand-primary-950': '#3a0f10', '--brand-primary-900': '#4f1414', '--brand-primary-800': '#6c1a1a', '--brand-primary-700': '#801818', '--brand-primary-600': '#952222',
    '--brand-accent-800': '#a55a18', '--brand-accent-600': '#d08830', '--brand-accent-500': '#f0a030', '--brand-accent-400': '#f4b658', '--brand-accent-300': '#f8d28e', '--brand-accent-100': '#fdf0da',
    '--brand-danger-600': '#c02828', '--brand-danger-500': '#d63a3a', '--brand-neutral-100': '#fbf7ee', '--brand-neutral-200': '#f3ecd8',
    '--brand-ink-900': '#201412', '--brand-ink-700': '#4a3a36', '--brand-white': '#ffffff',
  };
  for (const [name, value] of Object.entries(expected)) assert.match(palette, new RegExp(`${name}:\\s*${value};`), name);
});
