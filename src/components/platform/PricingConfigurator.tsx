'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Check, ArrowUpRight } from 'lucide-react';
import {
  tierForMembers,
  priceLabel,
  type MembershipTier,
} from '@/lib/platform';
export function PricingConfigurator({ tiers }: { tiers: MembershipTier[] }) {
  const [count, setCount] = useState(150);
  const tier = tierForMembers(tiers, count);
  return (
    <div className="pricing-config">
      <div className="pricing-input">
        <span className="eyebrow">VOTRE ASSOCIATION, VOTRE RYTHME</span>
        <h2>
          Combien d’adhérents
          <br />
          vous font confiance ?
        </h2>
        <p>
          Indiquez l’effectif de votre saison. Les familles, bénévoles et
          comptes de gestion ne sont pas des adhérents supplémentaires.
        </p>
        <label htmlFor="member-count">Nombre d’adhérents</label>
        <div className="count-input">
          <input
            id="member-count"
            type="number"
            min={0}
            max={1000000}
            value={count}
            onChange={(e) =>
              setCount(
                Math.max(
                  0,
                  Math.min(1000000, Math.floor(Number(e.target.value) || 0)),
                ),
              )
            }
          />
          <span>adhérents</span>
        </div>
        <input
          type="range"
          aria-label="Ajuster le nombre d’adhérents"
          min={0}
          max={1000}
          step={10}
          value={Math.min(count, 1000)}
          onChange={(e) => setCount(Number(e.target.value))}
        />
        <div className="range-labels">
          <span>Petit collectif</span>
          <span>Grande communauté</span>
        </div>
      </div>
      <div className="pricing-result">
        <span className="eyebrow">VOTRE FORMULE</span>
        <h3>{tier?.name ?? 'Sur mesure'}</h3>
        <strong>{priceLabel(tier?.monthly_cents ?? null)}</strong>
        <p>
          {tier?.monthly_cents != null
            ? 'par mois · montant de l’abonnement'
            : 'La grille est en préparation. Aucune facturation sans tarif annoncé.'}
        </p>
        <ul>
          {[
            'Un site parmi les trois modèles',
            'Votre back-office de gestion',
            'Un espace pour les adhérents',
            'Les modules selon vos besoins',
            'Tous les sports, la même liberté',
          ].map((x) => (
            <li key={x}>
              <Check size={17} />
              {x}
            </li>
          ))}
        </ul>
        <Link className="pill-button" href={'/commencer?effectif=' + count}>
          Préparer mon club <ArrowUpRight size={18} />
        </Link>
      </div>
    </div>
  );
}
