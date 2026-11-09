import { PRIVATE_BUCKET, mimeForPath, readFile, verifyPrivateToken } from '@/lib/storage';

/**
 * Pièce privée d'un dossier. Le jeton signé et de courte durée est délivré par
 * une action serveur après contrôle d'accès : il fait foi, sans autre session.
 */
export async function GET(request: Request) {
  const path = await verifyPrivateToken(new URL(request.url).searchParams.get('t'));
  if (!path) return new Response('Lien expiré ou invalide', { status: 403 });
  const object = await readFile(PRIVATE_BUCKET, path);
  if (!object) return new Response('Introuvable', { status: 404 });
  return new Response(object.body, {
    headers: {
      'content-type': mimeForPath(path),
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
