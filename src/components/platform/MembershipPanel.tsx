'use client';
import { useState } from 'react';
import { updateDeclaredCount } from '@/actions/platform.actions';
import {
  tierForMembers,
  priceLabel,
  type MembershipTier,
} from '@/lib/platform';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { useAction } from '@/components/club-admin/useAction';
export function MembershipPanel({
  declared,
  actual,
  tiers,
}: {
  declared: number;
  actual: number;
  tiers: MembershipTier[];
}) {
  const [count, setCount] = useState(declared);
  const { pending, run } = useAction();
  const tier = tierForMembers(tiers, Math.max(count, actual));
  return (
    <form
      className="workspace-card"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => updateDeclaredCount(count));
      }}
    >
      <h2>Une offre à votre taille</h2>
      <p>
        {actual} adhérent(s) enregistré(s) cette saison. La tranche retenue
        prend le plus grand nombre entre votre déclaration et les inscriptions
        enregistrées.
      </p>
      <div className="mt-5 flex flex-wrap items-end gap-5">
        <Field id="declared-count" label="Votre effectif déclaré">
          <Input
            id="declared-count"
            type="number"
            min={actual}
            max={1000000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <div className="pb-3">
          <strong>
            {tier?.name ?? 'Sur mesure'} ·{' '}
            {priceLabel(tier?.monthly_cents ?? null)}
          </strong>
          <small className="mt-1 block text-muted-foreground">
            Aucun changement de prélèvement automatique.
          </small>
        </div>
        <Button type="submit" variant="outline" disabled={pending}>
          Actualiser mon effectif
        </Button>
      </div>
    </form>
  );
}
