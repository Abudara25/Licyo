// Assemble la feuille publique assets/css/styles.css à partir des sources styles/ (phase 4C).
//
//   styles/site.json                               thème, version et palette du site
//   styles/base/*.css                              couche commune (mise en page, reset, formulaires) : tokens
//                                                  sémantiques uniquement, aucune couleur de marque
//   styles/palettes/<palette>.css                  primitives d'identité (--brand-*) et canaux RGB
//   styles/legacy/aliases.css                      anciens noms (--maroon-*, --gold-*…), temporaires
//   styles/themes/<thème>/<version>/theme.json     manifeste : ordre exact des fragments dans la feuille
//   styles/themes/<thème>/<version>/*.css          fragments du thème (tokens sémantiques + règles visuelles)
//
// Le résultat est une seule feuille, au même chemin qu'avant (HTML inchangé, une seule requête), écrite
// fragment après fragment dans l'ordre du manifeste : la cascade est celle d'origine. Le fichier généré est
// versionné (servi tel quel en local, copié dans dist/ par scripts/build-public.mjs) ; `npm run check` échoue
// s'il ne correspond plus aux sources.
//
// Usage : node scripts/build-css.mjs          (écrit assets/css/styles.css)
//         node scripts/build-css.mjs --check  (vérifie sans écrire)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STYLES = join(ROOT, 'styles');
const read = (path) => readFileSync(path, 'utf8').split('\r').join('');

export function loadSite(stylesDir = STYLES) {
  const site = JSON.parse(read(join(stylesDir, 'site.json')));
  const themeDir = join(stylesDir, 'themes', site.theme, String(site.themeVersion));
  const theme = JSON.parse(read(join(themeDir, 'theme.json')));
  return { site, theme, themeDir };
}

// Chemin source de chaque emplacement du manifeste.
export function resolveSlot(slot, { site, themeDir }, stylesDir = STYLES) {
  if (slot === '{palette}') return join(stylesDir, 'palettes', `${site.palette}.css`);
  if (slot === '{legacy}') return site.legacyAliases ? join(stylesDir, 'legacy', 'aliases.css') : null;
  if (slot.startsWith('base/')) return join(stylesDir, slot);
  if (slot.startsWith('theme/')) return join(themeDir, slot.slice('theme/'.length));
  throw new Error(`Emplacement inconnu dans le manifeste : ${slot}`);
}

export function buildCss(stylesDir = STYLES) {
  const context = loadSite(stylesDir);
  const { site, theme } = context;
  const parts = [
    '/* ==========================================================================\n' +
      '   Fichier GÉNÉRÉ par scripts/build-css.mjs (npm run css) : ne pas modifier ici.\n' +
      `   Sources : styles/ — thème ${theme.id} v${theme.version}, palette ${site.palette}.\n` +
      '   ========================================================================== */\n\n',
  ];
  for (const slot of theme.order) {
    const file = resolveSlot(slot, context, stylesDir);
    if (file === null) continue;
    if (!existsSync(file)) throw new Error(`Fragment manquant : ${slot} (${file})`);
    parts.push(read(file));
  }
  return { css: parts.join(''), output: join(ROOT, site.output) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { css, output } = buildCss();
  if (process.argv.includes('--check')) {
    const current = existsSync(output) ? read(output) : '';
    if (current !== css) {
      console.error('assets/css/styles.css ne correspond plus aux sources styles/ : lancer `npm run css`.');
      process.exit(1);
    }
    console.log('assets/css/styles.css est à jour.');
  } else {
    writeFileSync(output, css);
    console.log(`Écrit : ${output.slice(ROOT.length + 1)} (${css.length} caractères)`);
  }
}
