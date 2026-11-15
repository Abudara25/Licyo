'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { disconnectHelloAsso, saveHelloAssoConnection, syncHelloAssoNow } from '@/actions/helloasso.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { useAction } from './useAction';

export type HelloAssoState = {
  organization: string;
  clientId: string;
  status: 'active' | 'error';
  lastSyncAt: string | null;
  lastError: string | null;
  lastNew: number | null;
} | null;

const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Connexion directe à HelloAsso : paiements ajoutés chaque nuit à l'import, sans fichier. */
export function HelloAssoConnection({ state, canWrite }: { state: HelloAssoState; canWrite: boolean }) {
  const [editing, setEditing] = useState(!state);
  const [organization, setOrganization] = useState(state?.organization ?? '');
  const [clientId, setClientId] = useState(state?.clientId ?? '');
  const [secret, setSecret] = useState('');
  const { pending, run } = useAction();

  return (
    <Card>
      <CardHeader
        title="Connexion HelloAsso"
        description="Les paiements HelloAsso de l’association arrivent ici chaque nuit, sans fichier à exporter. Ils restent à rattacher aux familles comme un import."
        action={state ? <Badge tone={state.status === 'active' ? 'success' : 'warning'}>{state.status === 'active' ? 'Connectée' : 'À vérifier'}</Badge> : null}
      />
      <CardBody className="grid gap-4">
        {state && !editing ? (
          <>
            <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <dt className="font-medium">Association</dt>
              <dd className="break-all">{state.organization}</dd>
              <dt className="font-medium">Dernière synchronisation</dt>
              <dd>
                {state.lastSyncAt ? dateTime.format(new Date(state.lastSyncAt)) : 'jamais'}
                {state.lastNew !== null && state.lastSyncAt ? ` - ${state.lastNew} nouveau${state.lastNew > 1 ? 'x' : ''} paiement${state.lastNew > 1 ? 's' : ''}` : ''}
              </dd>
            </dl>
            {state.lastError ? (
              <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
                {state.lastError}
              </p>
            ) : null}
            {canWrite ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={pending} onClick={() => run(() => syncHelloAssoNow())}>
                  <RefreshCw aria-hidden /> Synchroniser maintenant
                </Button>
                <Button variant="outline" disabled={pending} onClick={() => setEditing(true)}>
                  Modifier
                </Button>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => confirm('Supprimer la connexion HelloAsso ? Les paiements déjà importés restent.') && run(() => disconnectHelloAsso())}
                >
                  Déconnecter
                </Button>
              </div>
            ) : null}
          </>
        ) : canWrite ? (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => saveHelloAssoConnection({ organization, clientId, clientSecret: secret }),
                () => {
                  setSecret('');
                  setEditing(false);
                },
              );
            }}
          >
            <p className="text-sm text-muted-foreground">
              Dans l’espace d’administration HelloAsso de l’association, rubrique « Intégrations et API », créez ou copiez la clé API (identifiant et
              secret). Le secret est chiffré et n’est plus jamais affiché.
            </p>
            <Field id="ha-org" label="Adresse de la page HelloAsso de l’association" hint="Ex. https://www.helloasso.com/associations/mon-club, ou seulement mon-club.">
              <Input id="ha-org" value={organization} onChange={(e) => setOrganization(e.target.value)} autoComplete="off" required />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="ha-id" label="Identifiant API (Client ID)">
                <Input id="ha-id" value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck={false} required />
              </Field>
              <Field id="ha-secret" label="Secret API (Client Secret)" hint={state ? 'Laissez vide pour garder le secret enregistré.' : undefined}>
                <Input id="ha-secret" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" spellCheck={false} required={!state} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending}>
                Vérifier et enregistrer
              </Button>
              {state ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => setEditing(false)}>
                  Annuler
                </Button>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune connexion. Une personne qui gère la trésorerie peut la mettre en place.</p>
        )}
      </CardBody>
    </Card>
  );
}
