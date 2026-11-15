'use client';

import { useEffect, useRef, useState } from 'react';

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Turnstile indisponible'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** Clé publique posée par le serveur sur <html> ; absente = protection désactivée (comme le serveur sans secret). */
function siteKey(): string {
  return typeof document === 'undefined' ? '' : document.documentElement.dataset.turnstileSiteKey ?? '';
}

/**
 * Vérification anti-robot Cloudflare Turnstile, le plus souvent invisible pour un humain.
 * Transmet le jeton au formulaire ; jeton vidé quand il expire. Rien n'est affiché sans clé configurée.
 */
export function TurnstileField({ onToken, action }: { onToken: (token: string) => void; action?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  const [key, setKey] = useState('');
  useEffect(() => setKey(siteKey()), []);

  useEffect(() => {
    if (!key || !box.current) return;
    let id: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: key,
          action,
          language: 'fr',
          size: 'flexible',
          callback: (t: string) => callback.current(t),
          'expired-callback': () => callback.current(''),
          'error-callback': () => callback.current(''),
        });
      })
      .catch(() => callback.current(''));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [action, key]);

  if (!key) return null;
  return <div ref={box} className="min-h-[65px] w-full max-w-full" aria-label="Vérification anti-robot" />;
}
