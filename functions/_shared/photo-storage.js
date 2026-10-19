// Photo de l'enfant : validation, stockage et lecture, partagés par le dépôt famille
// (functions/depot/[token]/photo.js) et la fiche admin (functions/admin/inscriptions/[id]/photo.js)
// pour appliquer les mêmes règles des deux côtés. Stockée dans le bucket R2 "DOSSIERS" (comme le
// dossier signé) sous photos/<upload_token> ; D1 ne garde que la référence (photo_key…).
import { readUpload } from './security.js';

export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp';

const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function photoError(file) {
  if (!file || typeof file === 'string' || !file.size) return 'Choisissez une photo avant d’envoyer.';
  if (file.size > MAX_SIZE) return 'La photo dépasse 10 Mo — réessayez avec une photo moins lourde.';
  if (!ALLOWED_TYPES.has(file.type)) return 'Format non accepté — envoyez une photo JPG, PNG ou WebP.';
  return null;
}

// Renvoie { error } si le contenu n'est pas une vraie image JPG, PNG ou WebP (le type annoncé par le
// navigateur n'est pas pris en compte).
export async function storePhoto(env, row, file, waitUntil) {
  const upload = await readUpload(file, { allowedTypes: ALLOWED_TYPES, maxSize: MAX_SIZE });
  if (upload.error) return { error: photoError(file) || 'Format non accepté — envoyez une photo JPG, PNG ou WebP.' };
  const key = `photos/${row.upload_token || `admin-${row.id}`}`;
  await env.DOSSIERS.put(key, upload.buffer, { httpMetadata: { contentType: upload.type } });
  await env.DB.prepare(
    "UPDATE inscriptions SET photo_key = ?, photo_content_type = ?, photo_uploaded_at = datetime('now') WHERE organization_id = ? AND id = ?"
  )
    .bind(key, upload.type, row.organization_id, row.id)
    .run();
  if (env.DOSSIERS_BACKUP && waitUntil) {
    waitUntil(env.DOSSIERS_BACKUP.put(key, upload.buffer, { httpMetadata: { contentType: upload.type } }).catch(() => {}));
  }
  return {};
}

// Photo d'un enfant : jamais conservée en cache (2026-10-16, audit de sécurité ; auparavant 24 h en cache privé).
export async function photoResponse(env, row) {
  if (!row?.photo_key || !env.DOSSIERS) return new Response('Aucune photo.', { status: 404 });
  const object = await env.DOSSIERS.get(row.photo_key);
  if (!object) return new Response('Photo introuvable.', { status: 404 });
  return new Response(object.body, {
    headers: {
      'Content-Type': row.photo_content_type || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
