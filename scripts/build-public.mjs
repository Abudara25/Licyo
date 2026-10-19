// Construit le dossier réellement publié par Cloudflare Pages (phase 4B.2) : dist/.
//
// Jusqu'ici, Pages publiait la racine du dépôt telle quelle, et les fichiers internes (tests, scripts, Worker
// programmé, configuration d'outils…) n'étaient masqués qu'à l'exécution (functions/_shared/internal-paths.js).
// Désormais, seul ce qui figure dans l'ALLOWLIST ci-dessous est copié dans dist/ : un fichier interne n'existe
// tout simplement pas dans ce qui est publié. Les sources restent où elles sont ; les Functions (functions/)
// sont déployées par Pages depuis la racine du projet, jamais copiées dans dist/.
//
// Usage : node scripts/build-public.mjs [dossier de sortie]   (défaut : dist)
// Réglage Pages : commande de build `node scripts/build-public.mjs`, répertoire de sortie `dist`.
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNews } from './build-news.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// Fichiers de la racine publiés tels quels. Toute nouvelle page ou tout nouveau fichier public à la racine doit
// être ajouté ici (tests/public-output.test.mjs échoue sinon, pour forcer la décision).
export const PUBLIC_ROOT_FILES = [
  'index.html', 'equipe.html', 'entrainements.html', 'inscription.html', 'pre-inscription-u10.html', 'contact.html', 'actualites.html',
  'partenaires.html', 'mentions-legales.html', 'confidentialite.html', '404.html',
  'manifest.json', 'manifest-admin.json', 'robots.txt', 'sitemap.xml', 'llms.txt',
  '_headers', // en-têtes de sécurité (lus par Pages dans le dossier publié)
];

// Dossiers publiés en entier (contenu vérifié ci-dessous) :
// - assets/ : CSS, JS, polices, images (dont les médias ajoutés par Sveltia dans assets/images/actualites) ;
// - admin/ : Sveltia CMS (index.html, config.yml) ;
// - .well-known/ : security.txt.
// content/ (sources des actualités) n'est PAS publié : lu seulement par les Functions (functions/_shared/news.js).
export const PUBLIC_DIRECTORIES = ['assets', 'admin', '.well-known'];

// Jamais copiés, même à l'intérieur d'un dossier publié.
const FORBIDDEN_NAMES = new Set(['node_modules', '.git', '.DS_Store', 'Thumbs.db', 'desktop.ini']);
// Aucun fichier ou dossier caché à l'intérieur des dossiers publiés (.well-known lui-même est listé explicitement).
const isForbidden = (name) => FORBIDDEN_NAMES.has(name) || name.startsWith('.');

// Routage des Functions dans le dossier publié : AUCUNE exclusion, toute requête passe par le middleware racine puis
// par le routeur (functions/[[path]].js), assets compris. Une URL exclue était servie directement par le serveur
// statique, qui normalise le chemin (/assets/..%2fx, double encodage…) et répond, faute de fichier, par le 404.html
// statique de Sportville, quel que soit le domaine (fuite inter-organisation, audit 4D.2B). Les fichiers existants
// sont servis par env.ASSETS.fetch (mêmes en-têtes, ETag et cache) ; un fichier absent reçoit la 404 de l'organisation
// du domaine, ou une 404 neutre. Coût : une invocation de Function par requête (quota gratuit Pages : 100 000/jour).
export const ROUTES = {
  version: 1,
  include: ['/*'],
  exclude: [],
};

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (isForbidden(entry.name)) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Lien symbolique refusé dans un dossier publié : ${relative(ROOT, from)}`);
    if (entry.isDirectory()) await copyDirectory(from, to);
    else if (entry.isFile()) await cp(from, to);
  }
}

export async function buildPublic(outDir = join(ROOT, 'dist')) {
  // Actualités intégrées aux Functions : générées ici, AVANT que Pages ne regroupe functions/ (voir build-news.mjs).
  await buildNews();
  const out = resolve(outDir);
  // Garde-fou : le dossier de sortie est vidé avant la copie, il ne peut donc être ni la racine du dépôt ni l'un
  // de ses parents.
  if (out === ROOT || ROOT.startsWith(out + sep)) throw new Error(`Dossier de sortie refusé : ${out}`);
  // ... ni un dossier source (il serait vidé) ni un sous-dossier d'une source publiée (copie récursive sans fin).
  for (const source of [...PUBLIC_DIRECTORIES, 'functions', 'tests', 'scripts', 'workers', '.github', '.git']) {
    const path = join(ROOT, source);
    if (out === path || out.startsWith(path + sep) || path.startsWith(out + sep)) throw new Error(`Dossier de sortie refusé : ${out}`);
  }
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  for (const file of PUBLIC_ROOT_FILES) {
    const from = join(ROOT, file);
    if (!(await stat(from).catch(() => null))?.isFile()) throw new Error(`Fichier public manquant : ${file}`);
    await cp(from, join(out, file));
  }
  for (const dir of PUBLIC_DIRECTORIES) {
    const from = join(ROOT, dir);
    if (!(await stat(from).catch(() => null))?.isDirectory()) throw new Error(`Dossier public manquant : ${dir}`);
    await copyDirectory(from, join(out, dir));
  }
  await writeFile(join(out, '_routes.json'), JSON.stringify(ROUTES, null, 2) + '\n');
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = await buildPublic(process.argv[2] ? resolve(process.argv[2]) : undefined);
  console.log(`Dossier publié construit : ${relative(ROOT, out) || out}`);
}
