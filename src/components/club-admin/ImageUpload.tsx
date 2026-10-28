'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ImagePlus } from 'lucide-react';
import { uploadClubImage } from '@/actions/club-admin.actions';
import { compressImage } from '@/lib/utils/image-compression';

type Kind = 'logo' | 'hero' | 'signature' | 'post' | 'sponsor' | 'product';

/**
 * Envoi d'image publique. Logo et signature restent en PNG/JPEG d'origine
 * (les PDF ne lisent pas le WebP) ; les autres images sont compressées.
 */
export function ImageUpload({ kind, label, value, onUploaded }: { kind: Kind; label: string; value?: string | null; onUploaded?: (url: string) => void }) {
  const [url, setUrl] = useState(value ?? null);
  const [pending, start] = useTransition();
  const id = `img-${kind}`;

  async function onFile(file?: File) {
    if (!file) return;
    const keepOriginal = kind === 'logo' || kind === 'signature';
    const prepared = keepOriginal ? file : await compressImage(file);
    if (prepared.size > 5 * 1024 * 1024) return toast.error('Image trop lourde (5 Mo maximum).');
    const fd = new FormData();
    fd.set('kind', kind);
    fd.set('file', prepared);
    start(async () => {
      const res = await uploadClubImage(fd);
      if (res.ok && res.data) {
        setUrl(res.data.url);
        onUploaded?.(res.data.url);
        toast.success('Image enregistrée.');
      } else if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <label htmlFor={id} className="flex min-h-24 cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 hover:bg-muted">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="size-16 shrink-0 rounded-lg bg-white object-contain" />
        ) : (
          <ImagePlus className="size-8 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <span className="text-sm">{pending ? 'Envoi…' : url ? 'Remplacer l\'image' : 'Choisir une image'}<span className="block text-xs text-muted-foreground">{kind === 'logo' || kind === 'signature' ? 'PNG ou JPEG (utilisé dans les PDF)' : 'Photo, compressée automatiquement'}</span></span>
        <input id={id} type="file" accept={kind === 'logo' || kind === 'signature' ? 'image/png,image/jpeg' : 'image/*'} className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
    </div>
  );
}
