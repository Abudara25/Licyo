import 'server-only';
import { cloudflareEnv } from '@/lib/db/d1';
import { signValue, verifyValue } from '@/lib/utils/impersonation';

// Fichiers sur Cloudflare R2.
//   - PUBLIC_ASSETS : logos, photos de vitrine, servis par /media/<chemin> ;
//   - PRIVATE_DOCS  : pièces des dossiers (certificats, justificatifs), servies
//     uniquement par /api/files/private avec un jeton signé de courte durée,
//     délivré après contrôle d'accès.
// Chemins : <club_id>/<dossier>/<uuid>.<ext>, jamais dérivés d'un nom fourni.

export const PUBLIC_BUCKET = 'club-public-assets';
export const PRIVATE_BUCKET = 'club-private-docs';
type Bucket = typeof PUBLIC_BUCKET | typeof PRIVATE_BUCKET;
const MAX_BYTES = 5 * 1024 * 1024;
const PATH_RE = /^[0-9a-f-]{36}\/[a-z0-9_-]{1,40}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$/;

type Detected = { mime: string; ext: string };

/** Type réel déduit des premiers octets ; le nom et le type déclarés ne font pas foi. */
function sniff(bytes: Uint8Array): Detected | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (startsWith([0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith([0x89, 0x50, 0x4e, 0x47])) return { mime: 'image/png', ext: 'png' };
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) return { mime: 'image/webp', ext: 'webp' };
  if (startsWith([0x25, 0x50, 0x44, 0x46])) return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export function mimeForPath(path: string): string {
  if (path.endsWith('.jpg')) return 'image/jpeg';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}

export function isStoragePath(path: string): boolean {
  return PATH_RE.test(path);
}

function bucket(name: Bucket): R2Bucket {
  const env = cloudflareEnv();
  return name === PUBLIC_BUCKET ? env.PUBLIC_ASSETS : env.PRIVATE_DOCS;
}

export class UploadError extends Error {}

/**
 * Dépose un fichier dans le dossier du club. Type vérifié par le contenu,
 * taille bornée, nom régénéré. Renvoie le chemin de stockage.
 */
export async function uploadClubFile(
  bucketName: Bucket,
  clubId: string,
  folder: string,
  file: File,
  allowPdf = true,
): Promise<string> {
  if (file.size === 0) throw new UploadError('Fichier vide.');
  if (file.size > MAX_BYTES) throw new UploadError('Fichier trop lourd (5 Mo maximum).');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = sniff(bytes);
  if (!detected || (!allowPdf && detected.mime === 'application/pdf')) {
    throw new UploadError('Format non accepté : photo (JPEG, PNG, WebP) ou PDF.');
  }
  const path = `${clubId}/${folder}/${crypto.randomUUID()}.${detected.ext}`;
  if (!isStoragePath(path)) throw new UploadError('Chemin de fichier invalide.');
  try {
    await bucket(bucketName).put(path, bytes, { httpMetadata: { contentType: detected.mime } });
  } catch {
    throw new UploadError("Le fichier n'a pas pu être enregistré.");
  }
  return path;
}

/** URL relative : servie par le même Worker sur tous les hôtes (plateforme et clubs). */
export function publicAssetUrl(path: string): string {
  return `/media/${path}`;
}

/** Chemin de stockage à partir d'une URL publique produite par publicAssetUrl. */
export function publicPathFromUrl(url: string): string | null {
  const path = url.startsWith('/media/') ? url.slice('/media/'.length) : null;
  return path && isStoragePath(path) ? path : null;
}

function encodePath(path: string): string {
  return btoa(path).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodePath(value: string): string | null {
  try {
    return atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
}

/** URL signée de courte durée pour consulter une pièce privée (après contrôle d'accès). */
export async function signedPrivateUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  if (!isStoragePath(path)) return null;
  const token = await signValue(['file', encodePath(path)], expiresInSeconds);
  return `/api/files/private?t=${encodeURIComponent(token)}`;
}

/** Chemin privé autorisé par un jeton signé valide, sinon null. */
export async function verifyPrivateToken(token: string | null): Promise<string | null> {
  const parts = await verifyValue(token, 2);
  if (!parts || parts[0] !== 'file') return null;
  const path = decodePath(parts[1]);
  return path && isStoragePath(path) ? path : null;
}

export async function readFile(bucketName: Bucket, path: string): Promise<R2ObjectBody | null> {
  if (!isStoragePath(path)) return null;
  return bucket(bucketName).get(path);
}

export async function deletePrivateFiles(paths: string[]): Promise<void> {
  const valid = paths.filter(isStoragePath);
  if (valid.length) await bucket(PRIVATE_BUCKET).delete(valid);
}

export async function deletePublicFiles(paths: string[]): Promise<void> {
  const valid = paths.filter(isStoragePath);
  if (valid.length) await bucket(PUBLIC_BUCKET).delete(valid);
}
