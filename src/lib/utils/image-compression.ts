'use client';

const MAX_WIDTH = 1200;
const MAX_BYTES = 300 * 1024;

/**
 * Compresse une photo de smartphone en WebP (largeur ≤ 1200 px, < 300 Ko)
 * avant envoi. Baisse la qualité puis la taille jusqu'à passer sous le plafond.
 * Les PDF et fichiers non image sont renvoyés tels quels.
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  let width = Math.min(bitmap.width, MAX_WIDTH);
  let quality = 0.85;
  let blob: Blob | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const height = Math.round((bitmap.height * width) / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;
    ctx.drawImage(bitmap, 0, 0, width, height);
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    if (blob && blob.size <= MAX_BYTES) break;
    if (quality > 0.55) quality -= 0.1;
    else width = Math.round(width * 0.8);
  }
  bitmap.close();

  if (!blob) return file;
  const name = file.name.replace(/\.[^.]+$/, '') + '.webp';
  return new File([blob], name, { type: 'image/webp', lastModified: Date.now() });
}
