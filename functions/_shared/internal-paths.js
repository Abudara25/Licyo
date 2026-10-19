// Fichiers internes du dépôt jamais servis par le site public (phase 4B.1, après audit).
//
// Cloudflare Pages publie la racine du dépôt telle quelle. Une Function placée sur le chemin canonique
// (functions/tests/_middleware.js…) ne suffit pas : le routage des Functions compare le chemin ENCODÉ,
// alors que le serveur de fichiers statiques le DÉCODE. `/%2egithub/…`, `/package%2ejson` ou
// `/tests%2fhelpers%2fd1.mjs` échappaient donc à la Function et servaient le fichier.
//
// Politique centrale, appliquée par le middleware racine (functions/_middleware.js) AVANT toute résolution
// de fichier statique. Le chemin est examiné sous toutes ses formes : brut, puis décodé une, deux… fois
// (4 niveaux au plus, pour le double encodage `%252e`), chaque forme normalisée (antislash → slash,
// slashs multiples fusionnés, `.` et `..` résolus sans jamais remonter au-dessus de la racine,
// minuscules, slash final ignoré). Le chemin est interne si UNE de ces formes l'est. Échec de décodage
// (`%zz`, séquence UTF-8 invalide), octet nul, ou encodage encore présent après 4 niveaux : refus (404),
// sans détail.

const MAX_DECODE_LEVELS = 4;

// Premier segment interdit (dossiers de développement). Tout segment qui commence par un point est aussi
// interdit (.github, .git, .gitignore, .gitattributes, .vscode, .wrangler, .claude…), sauf .well-known.
// content/ : sources des actualités, lues seulement par les Functions (_shared/news.js), jamais publiées.
// prototypes/ : maquettes locales (ex. console Platform), servies seulement par leur serveur local ;
// jamais sur un domaine de club.
const INTERNAL_DIRECTORIES = new Set(['tests', 'scripts', 'workers', 'functions', 'node_modules', 'styles', 'renderer', 'sites', 'content', 'prototypes', 'docs']);
const INTERNAL_ROOT_FILES = new Set(['package.json', 'package-lock.json', 'claude.md', 'agents.md', 'readme.md', 'status.json', 'desktop.ini', '_routes.json']);
const PUBLIC_DOT_ROOT = '.well-known';

// "/a//b/./c/../d/" → ["a", "b", "d"] (minuscules). Jamais au-dessus de la racine.
function segments(path) {
  const out = [];
  for (const part of path.replace(/\\/g, '/').toLowerCase().split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out;
}

// Segments bruts (sans résolution de ".."), pour les règles qui doivent voir le chemin tel qu'écrit.
const rawSegments = (path) =>
  path.replace(/\\/g, '/').toLowerCase().split('/').filter((part) => part !== '' && part !== '.');

// Segment caché interdit, sauf .well-known en premier segment.
const hiddenSegment = (parts) => parts.some((part, index) => part.startsWith('.') && !(index === 0 && part === PUBLIC_DOT_ROOT));

function isInternalForm(path) {
  // Traversée : une URL légitime ne contient jamais de segment ".." (le navigateur les résout avant l'envoi) ;
  // sous n'importe quelle forme décodée, c'est un refus (phase 4B.2), quel que soit le fichier visé.
  const raw = rawSegments(path);
  if (raw.includes('..') || hiddenSegment(raw)) return true;
  const parts = segments(path);
  if (!parts.length) return false;
  if (INTERNAL_DIRECTORIES.has(parts[0])) return true;
  if (parts.length === 1 && INTERNAL_ROOT_FILES.has(parts[0])) return true;
  return hiddenSegment(parts) || parts.includes('node_modules');
}

// Motif de refus, ou null si le chemin peut être servi. `rawPathname` : chemin tel que reçu (encodé).
export function internalPathReason(rawPathname) {
  let current = String(rawPathname ?? '');
  for (let level = 0; level <= MAX_DECODE_LEVELS; level++) {
    if (current.includes('\0')) return 'octet nul';
    if (isInternalForm(current)) return level === 0 ? 'chemin interne' : `chemin interne (encodé, niveau ${level})`;
    if (!current.includes('%')) return null;
    if (level === MAX_DECODE_LEVELS) return 'encodage trop profond';
    let decoded;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return 'encodage invalide';
    }
    if (decoded === current) return null;
    current = decoded;
  }
  return 'encodage trop profond';
}

// Chemin brut d'une requête : request.url garde l'encodage (%2f, %2e hors segments « . » déjà résolus
// par l'analyseur d'URL). Une URL illisible est refusée.
export function rawPathname(request) {
  try {
    return new URL(request.url).pathname;
  } catch {
    return null;
  }
}

const notFound = () =>
  new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

// Middleware racine : refuse tout chemin interne, quelle que soit son écriture, avant les Functions et
// avant le serveur de fichiers statiques.
export function internalPathsMiddleware({ request, next }) {
  const path = rawPathname(request);
  if (path === null || internalPathReason(path)) return notFound();
  return next();
}
