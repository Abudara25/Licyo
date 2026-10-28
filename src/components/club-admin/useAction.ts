'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';

type Result = { ok: boolean; error?: string; message?: string };

/** Lance une Server Action avec retour visuel ; renvoie vrai si elle a réussi. */
export function useAction() {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, onSuccess?: () => void) =>
    start(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          if (res.message) toast.success(res.message);
          onSuccess?.();
        } else toast.error(res.error ?? 'Erreur.');
      } catch {
        toast.error('Connexion impossible. Réessayez.');
      }
    });
  return { pending, run };
}
