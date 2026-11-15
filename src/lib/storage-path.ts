// Chemins des fichiers R2 : <club_id>/<dossier>/<uuid>.<ext>, jamais dérivés d'un nom fourni par l'utilisateur.
// Dossiers admis : un nom simple (gallery, logo, hero…) ou « members/<saison> » pour les pièces des adhérents.
// Module pur, testé dans tests/storage-path.test.ts.

const PATH_RE = /^[0-9a-f-]{36}\/(?:[a-z0-9_-]{1,40}|members\/\d{4}-\d{4})\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

export function isStoragePath(path: string): boolean {
  return PATH_RE.test(path);
}
