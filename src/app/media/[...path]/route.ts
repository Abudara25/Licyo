import { PUBLIC_BUCKET, mimeForPath, readFile } from '@/lib/storage';

/** Fichiers publics des vitrines (logos, photos), servis depuis R2 sur tous les hôtes. */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const object = await readFile(PUBLIC_BUCKET, path.join('/'));
  if (!object) return new Response('Introuvable', { status: 404 });
  return new Response(object.body, {
    headers: {
      'content-type': mimeForPath(object.key),
      // Le nom de fichier est un UUID jamais réutilisé : cache long sans risque.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      etag: object.httpEtag,
    },
  });
}
