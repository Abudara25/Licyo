// Bloque l'accès public à status.json (suivi interne, publié par erreur car le repo
// est déployé tel quel sans étape de build — voir aussi functions/CLAUDE.md.js).
export async function onRequestGet() {
  return new Response('Not Found', { status: 404 });
}
