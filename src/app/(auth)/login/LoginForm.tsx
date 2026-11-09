'use client';

import { useState } from 'react';
import { requestLoginLink } from '@/actions/auth.actions';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      const res = await requestLoginLink({ email: email.trim().toLowerCase(), next });
      if (res.ok) setState('sent');
      else {
        setMessage(res.error);
        setState('error');
      }
    } catch {
      setMessage('Envoi impossible pour le moment. Réessayez dans une minute.');
      setState('error');
    }
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
        <Input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      {state === 'error' ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={state === 'sending'}>
        {state === 'sending' ? 'Envoi…' : 'Recevoir le lien'}
      </Button>
    </form>
  );
}
