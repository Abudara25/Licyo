import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';
import { PLANS } from '@/lib/stripe/client';
import { formatEuros } from '@/lib/pricing';
import { QuoteRequestForm } from './QuoteRequestForm';

export const metadata: Metadata = {
  title: 'Tarifs',
  description: 'Deux offres simples pour les clubs sportifs : Vitrine et Intégral. Devis PDF immédiat.',
};

export default function PricingPage() {
  return (
    <div className="page-container py-12 md:py-16">
      <h1 className="text-3xl font-extrabold md:text-5xl">Des tarifs clairs, pensés pour les associations</h1>
      <p className="mt-3 max-w-2xl text-lg text-muted-foreground">Sans frais d'installation. Les paiements des familles arrivent directement sur le compte du club.</p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        {(Object.entries(PLANS) as [keyof typeof PLANS, (typeof PLANS)[keyof typeof PLANS]][]).map(([id, plan]) => (
          <section key={id} aria-labelledby={`plan-${id}`} className={`flex flex-col rounded-2xl border bg-white p-6 ${id === 'integral' ? 'border-blue-600 shadow-lg' : ''}`}>
            {id === 'integral' ? <p className="mb-2 self-start rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-900">Le plus choisi</p> : null}
            <h2 id={`plan-${id}`} className="text-2xl font-bold">{plan.name}</h2>
            <p className="mt-2"><span className="text-4xl font-extrabold tabular-nums">{formatEuros(plan.monthly)}</span> <span className="text-muted-foreground">HT / mois</span></p>
            <ul className="mt-6 grid gap-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />{f}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section aria-labelledby="devis" className="mt-14 max-w-2xl">
        <h2 id="devis" className="text-2xl font-bold">Obtenir un devis PDF</h2>
        <p className="mt-1 mb-4 text-muted-foreground">Pour le bureau ou le conseil d'administration : le devis se génère immédiatement.</p>
        <QuoteRequestForm />
      </section>
    </div>
  );
}
