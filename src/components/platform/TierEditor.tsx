'use client';
import { useState } from 'react';
import { Field, Input, Checkbox } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { saveMembershipTiers } from '@/actions/platform.actions';
import { useAction } from '@/components/club-admin/useAction';
import type { MembershipTier } from '@/lib/platform';
export function TierEditor({ tiers }: { tiers: MembershipTier[] }) {
  const [rows, setRows] = useState(tiers);
  const { pending, run } = useAction();
  const patch = (id: string, value: Partial<MembershipTier>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...value } : r)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveMembershipTiers(rows));
      }}
    >
      <p className="notice">
        Les montants vides ne sont pas publiés et ne peuvent pas être facturés.
        Une référence Stripe est vérifiée avant activation du paiement.
      </p>
      <div className="tier-grid">
        {rows.map((t) => (
          <section className="workspace-card" key={t.id}>
            <h2>{t.name}</h2>
            <div className="tier-row mt-5">
              <Field id={t.id + 'name'} label="Nom de la formule">
                <Input
                  id={t.id + 'name'}
                  value={t.name}
                  onChange={(e) => patch(t.id, { name: e.target.value })}
                />
              </Field>
              <Field id={t.id + 'min'} label="À partir de">
                <Input
                  id={t.id + 'min'}
                  type="number"
                  min={0}
                  required
                  value={t.min_members}
                  onChange={(e) =>
                    patch(t.id, { min_members: Number(e.target.value) })
                  }
                />
              </Field>
              <Field
                id={t.id + 'max'}
                label="Jusqu’à"
                hint="Vide = sans plafond"
              >
                <Input
                  id={t.id + 'max'}
                  type="number"
                  min={t.min_members}
                  value={t.max_members ?? ''}
                  onChange={(e) =>
                    patch(t.id, {
                      max_members:
                        e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field
                id={t.id + 'price'}
                label="Prix mensuel en euros"
                hint="Vide = tarif à définir"
              >
                <Input
                  id={t.id + 'price'}
                  type="number"
                  min={0}
                  step="0.01"
                  value={t.monthly_cents === null ? '' : t.monthly_cents / 100}
                  onChange={(e) =>
                    patch(t.id, {
                      monthly_cents:
                        e.target.value === ''
                          ? null
                          : Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </Field>
              <Field id={t.id + 'stripe'} label="Référence du prix Stripe">
                <Input
                  id={t.id + 'stripe'}
                  value={t.stripe_price_id ?? ''}
                  onChange={(e) =>
                    patch(t.id, { stripe_price_id: e.target.value || null })
                  }
                />
              </Field>
              <Checkbox
                id={t.id + 'active'}
                label="Tranche active"
                checked={t.is_active}
                onChange={(x) => patch(t.id, { is_active: x })}
              />
            </div>
          </section>
        ))}
      </div>
      <Button className="mt-6" type="submit" size="lg" disabled={pending}>
        Enregistrer la grille
      </Button>
    </form>
  );
}
