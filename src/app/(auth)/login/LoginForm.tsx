'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const { error } = await createClient().auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      // Seuls les comptes invités par un club ou par Licyo peuvent se connecter.
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    // Même message que l'adresse existe ou non : on ne révèle pas qui a un compte.
    setState(error && error.status !== 400 && error.status !== 422 ? 'error' : 'sent');
  }

  if (state === 'sent') {
    return (
      <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        Si un compte existe pour {email}, un lien de connexion vient d'être envoyé. Pensez à vérifier les indésirables.
      </p>
    );
  }
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3">
      <Field id="login-email" label="Adresse e-mail">
        <Input id="login-email" type="email" required autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {state === 'error' ? <p role="alert" className="text-sm text-destructive">Envoi impossible pour le moment. Réessayez dans une minute.</p> : null}
      <Button type="submit" size="lg" disabled={state === 'sending'}>{state === 'sending' ? 'Envoi…' : 'Recevoir le lien'}</Button>
    </form>
  );
}
