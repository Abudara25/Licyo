// Bloque l'accès public à CLAUDE.md (fichier interne, publié par erreur car le repo
// est déployé tel quel sans étape de build — voir aussi functions/status.json.js).
export async function onRequestGet() {
  return new Response('Not Found', { status: 404 });
}
