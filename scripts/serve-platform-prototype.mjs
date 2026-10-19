// Serveur LOCAL du prototype de console Platform (prototypes/platform-crm) : fichiers statiques seulement.
// Isolé du site public et de /admin : jamais publié (hors de l'allowlist de scripts/build-public.mjs, dossier refusé
// par functions/_shared/internal-paths.js), écoute uniquement 127.0.0.1.
// La CSP interdit toute connexion réseau depuis la page (connect-src 'none') : le prototype ne peut appeler aucune API.
//
// Usage : npm run platform:preview   →   http://127.0.0.1:4310/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../prototypes/platform-crm');
const PORT = Number(process.env.PLATFORM_PREVIEW_PORT || 4310);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const headers = (type) => ({
  'Content-Type': type,
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
});

export function resolveFile(urlPath) {
  let path;
  try {
    path = decodeURIComponent(new URL(urlPath, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (path.includes('\0')) return null;
  const file = normalize(join(ROOT, path === '/' ? 'index.html' : path));
  if (file !== ROOT && !file.startsWith(ROOT + sep)) return null; // aucune sortie du dossier du prototype
  return TYPES[extname(file)] ? file : null;
}

export function startServer(port = PORT) {
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, headers('text/plain; charset=utf-8')).end('Méthode non autorisée');
      return;
    }
    const file = resolveFile(req.url);
    if (!file) {
      res.writeHead(404, headers('text/plain; charset=utf-8')).end('Introuvable');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, headers(TYPES[extname(file)])).end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, headers('text/plain; charset=utf-8')).end('Introuvable');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
  console.log(`Console Platform (aperçu, données fictives) : http://127.0.0.1:${PORT}/`);
}
