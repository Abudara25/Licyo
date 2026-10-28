'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

/**
 * Zone de signature au doigt ou à la souris. Renvoie un PNG en data URL
 * (lisible par les PDF), ou null tant que rien n'est tracé.
 */
export function TactileSignaturePad({ id, label, onChange }: { id: string; label: string; onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // Taille réelle en pixels de l'écran, pour un trait net sur mobile haute densité.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
    setHasInk(false);
    onChange(null);
  }, [onChange]);

  useEffect(() => {
    resize();
    // Volontairement pas de redimensionnement continu : il effacerait la signature.
  }, [resize]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = e.currentTarget.getContext('2d')!;
    const { x, y } = point(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d')!;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setHasInk(true);
    onChange(exportPng());
  };

  /** Export sur fond blanc, réduit à 600 px de large pour rester léger. */
  function exportPng(): string {
    const src = canvasRef.current!;
    const out = document.createElement('canvas');
    const scale = Math.min(1, 600 / src.width);
    out.width = Math.round(src.width * scale);
    out.height = Math.round(src.height * scale);
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-sm font-medium">{label}</span>
        <button type="button" onClick={resize} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm hover:bg-accent">
          <Eraser className="size-4" aria-hidden /> Effacer
        </button>
      </div>
      <canvas
        ref={canvasRef}
        id={id}
        role="img"
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="h-40 w-full touch-none rounded-lg border-2 border-dashed border-input bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
        {hasInk ? 'Signature enregistrée.' : 'Signez avec le doigt ou la souris dans le cadre.'}
      </p>
    </div>
  );
}
