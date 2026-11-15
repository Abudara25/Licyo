'use client';

import { useState, useTransition } from 'react';
import { signParentalAuthorization } from '@/actions/parental-authorization.actions';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { TurnstileField } from '@/components/ui/turnstile';
import { TactileSignaturePad } from '@/components/vitrine/TactileSignaturePad';
import { SIGNER_QUALITIES, renderAuthorization, type SignerQuality } from '@/config/parental-authorization';

export function AuthorizationSignForm({
  clubSlug,
  token,
  template,
  child,
  context,
}: {
  clubSlug: string;
  token: string;
  template: string;
  child: { name: string; firstName: string; birthDate: string };
  context: { clubName: string; sport: string; season: string };
}) {
  const [signerName, setSignerName] = useState('');
  const [quality, setQuality] = useState<SignerQuality | ''>('');
  const [accepted, setAccepted] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-950">
        {done}
      </p>
    );
  }

  const submit = () => {
    const problem =
      signerName.trim().length < 3
        ? 'Indiquez le nom du responsable légal.'
        : !quality
          ? 'Indiquez votre qualité (mère, père ou tuteur).'
          : !accepted
            ? 'Vous devez accepter l’autorisation parentale.'
            : !signature
              ? 'La signature est obligatoire.'
              : null;
    setError(problem);
    if (problem) return;
    start(async () => {
      const res = await signParentalAuthorization({ clubSlug, token, signerName, signerQuality: quality, accepted, signatureDataUrl: signature, turnstileToken });
      if (res.ok) setDone(res.message ?? 'Autorisation signée.');
      else setError(res.error);
    });
  };

  return (
    <form
      className="grid gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <p>
        Le club <strong>{context.clubName}</strong> vous demande l’autorisation parentale de <strong>{child.firstName}</strong> pour la saison{' '}
        {context.season}.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="as-name" label="Nom et prénom du responsable légal">
          <Input id="as-name" autoComplete="name" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
        </Field>
        <Field id="as-quality" label="Vous êtes">
          <Select id="as-quality" value={quality} onChange={(e) => setQuality(e.target.value as SignerQuality | '')}>
            <option value="">Choisir…</option>
            {(Object.keys(SIGNER_QUALITIES) as SignerQuality[]).map((q) => (
              <option key={q} value={q}>
                {SIGNER_QUALITIES[q].charAt(0).toUpperCase() + SIGNER_QUALITIES[q].slice(1)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="whitespace-pre-line rounded-lg border bg-white p-4 text-sm leading-6">
        {renderAuthorization(template, {
          signerName,
          signerQuality: quality || 'tuteur',
          childName: child.name,
          birthDate: child.birthDate,
          ...context,
        })}
      </div>
      <Checkbox id="as-accept" checked={accepted} onChange={setAccepted} label="J’ai lu et j’accepte cette autorisation parentale." />
      <TactileSignaturePad id="as-sig" label="Signature du responsable légal" onChange={setSignature} />
      <TurnstileField action="autorisation" onToken={setTurnstileToken} />
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Envoi…' : 'Signer l’autorisation'}
      </Button>
    </form>
  );
}
