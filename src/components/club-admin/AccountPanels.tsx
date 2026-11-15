'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  openBillingPortal,
  refreshStripeConnectStatus,
  setCustomDomain,
  startStripeConnect,
  startSubscriptionCheckout,
} from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { startMembershipCheckout } from '@/actions/platform.actions';
import { useAction } from './useAction';


function go(
  fn: () => Promise<{ ok: boolean; data?: { url: string }; error?: string }>,
) {
  return async () => {
    const res = await fn();
    if (res.ok && res.data?.url) window.location.href = res.data.url;
    return res;
  };
}

export function BillingPanel({
  plan,
  status,
  hasCustomer,
  connectAccount,
  connectOnboarded,
  siteUrl,
  customDomain,
  stripeReturn,
}: {
  plan: string;
  status: string;
  hasCustomer: boolean;
  connectAccount: boolean;
  connectOnboarded: boolean;
  siteUrl: string;
  customDomain: string | null;
  stripeReturn?: string;
}) {
  const { pending, run } = useAction();
  const [domain, setDomain] = useState(customDomain ?? '');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Abonnement"
          description="Abonnement selon votre nombre d’adhérents"
          action={
            <Badge
              tone={
                status === 'active'
                  ? 'success'
                  : status === 'demo'
                    ? 'info'
                    : 'warning'
              }
            >
              {status === 'active'
                ? 'Actif'
                : status === 'demo'
                  ? 'Démo'
                  : status}
            </Badge>
          }
        />
        <CardBody className="flex flex-wrap gap-2">
          {hasCustomer ? (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => run(go(openBillingPortal))}
            >
              Gérer l'abonnement et les factures
            </Button>
          ) : (
            <>
              <Button
                disabled={pending}
                onClick={() => run(go(startMembershipCheckout))}
              >
                Souscrire pour mon effectif
              </Button>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Paiement en ligne des cotisations"
          description="Compte Stripe du club : l'argent arrive directement sur son compte bancaire"
          action={
            connectOnboarded ? <Badge tone="success">Activé</Badge> : undefined
          }
        />
        <CardBody className="grid gap-2">
          {stripeReturn ? (
            <p className="text-sm text-muted-foreground">
              Retour de Stripe : vérifiez l'état ci-dessous.
            </p>
          ) : null}
          {connectOnboarded ? (
            <p className="text-sm">
              Les familles peuvent payer par carte. Activez « Paiement par carte
              » dans les modules si besoin.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending}
                onClick={() => run(go(startStripeConnect))}
              >
                {connectAccount
                  ? 'Reprendre la configuration Stripe'
                  : 'Activer le paiement par carte'}
              </Button>
              {connectAccount ? (
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(refreshStripeConnectStatus)}
                >
                  Vérifier l'état
                </Button>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Adresse du site" description={siteUrl} />
        <CardBody>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setCustomDomain(domain));
            }}
          >
            <Field
              id="dom"
              label="Nom de domaine du club (facultatif)"
              hint="Ex. www.monclub.fr - laissez vide pour utiliser l'adresse Licyo."
              className="min-w-0 flex-1"
            >
              <Input
                id="dom"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="www.monclub.fr"
                autoCapitalize="none"
              />
            </Field>
            <Button type="submit" variant="outline" disabled={pending}>
              Enregistrer
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
