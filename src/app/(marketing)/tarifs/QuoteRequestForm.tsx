'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';

export function QuoteRequestForm() {
  const [v, setV] = useState({ plan: 'integral', club: '', ville: '', contact: '', email: '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="grid gap-4 rounded-2xl border bg-white p-4 sm:grid-cols-2 md:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        window.open(`/api/pdf/quote?${new URLSearchParams(v).toString()}`, '_blank', 'noopener');
      }}
    >
      <Field id="q-p" label="Offre" className="sm:col-span-2">
        <Select id="q-p" value={v.plan} onChange={set('plan')}>
          <option value="integral">Intégral</option><option value="vitrine">Vitrine</option>
        </Select>
      </Field>
      <Field id="q-c" label="Nom du club"><Input id="q-c" required minLength={2} value={v.club} onChange={set('club')} /></Field>
      <Field id="q-v" label="Ville"><Input id="q-v" required value={v.ville} onChange={set('ville')} /></Field>
      <Field id="q-n" label="Votre nom (facultatif)"><Input id="q-n" autoComplete="name" value={v.contact} onChange={set('contact')} /></Field>
      <Field id="q-e" label="E-mail (facultatif)"><Input id="q-e" type="email" autoComplete="email" value={v.email} onChange={set('email')} /></Field>
      <Button type="submit" size="lg" className="sm:col-span-2">Télécharger le devis</Button>
    </form>
  );
}
