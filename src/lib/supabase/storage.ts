import 'server-only';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from './admin';

export const PUBLIC_BUCKET = 'club-public-assets';
export const PRIVATE_BUCKET = 'club-private-docs';
const MAX_BYTES = 5 * 1024 * 1024;

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

export class UploadError extends Error {}

/**
 * Dépose un fichier dans le dossier du club. Type vérifié par le contenu,
 * taille bornée, nom régénéré. Renvoie le chemin de stockage.
 */
export async function uploadClubFile(
  bucket: typeof PUBLIC_BUCKET | typeof PRIVATE_BUCKET,
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
  const path = `${clubId}/${folder}/${randomUUID()}.${detected.ext}`;
  const { error } = await createAdminClient()
    .storage.from(bucket)
    .upload(path, bytes, { contentType: detected.mime, upsert: false });
  if (error) throw new UploadError("Le fichier n'a pas pu être enregistré.");
  return path;
}

export function publicAssetUrl(path: string): string {
  return createAdminClient().storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** URL signée de courte durée pour consulter une pièce privée (après contrôle d'accès). */
export async function signedPrivateUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  const { data } = await createAdminClient().storage.from(PRIVATE_BUCKET).createSignedUrl(path, expiresInSeconds);
  return data?.signedUrl ?? null;
}

export async function deletePrivateFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await createAdminClient().storage.from(PRIVATE_BUCKET).remove(paths);
}
