'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';

export function UnsubscribeButton({ token }: { token: string }) {
  const [done, setDone] = useState<null | boolean>(null);
  const [pending, start] = useTransition();
  if (done) {
    return (
      <p role="status" className="rounded-lg bg-emerald-50 p-3 text-emerald-950">
        C’est fait : vous ne recevrez plus la newsletter de ce club.
      </p>
    );
  }
  return (
    <>
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await fetch(`/api/newsletter/unsubscribe?t=${encodeURIComponent(token)}`, { method: 'POST', body: 'List-Unsubscribe=One-Click' });
            setDone(res.ok);
          })
        }
      >
        Confirmer la désinscription
      </Button>
      {done === false ? (
        <p role="alert" className="text-sm text-destructive">
          La désinscription n’a pas pu être enregistrée. Réessayez ou contactez le club.
        </p>
      ) : null}
    </>
  );
}
