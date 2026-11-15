'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { erasePersonData } from '@/actions/personal-data.actions';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { useAction } from './useAction';

/** Demandes de la personne sur ses données : export (accès, portabilité) et effacement. Présidence seulement. */
export function PersonalDataPanel({ personId, name }: { personId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader
        title="Demandes sur ses données (RGPD)"
        description="Une personne, ou ses parents si elle est mineure, peut demander une copie de ses données ou leur effacement. Le club répond dans un délai d’un mois."
      />
      <CardBody className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          <a
            href={`/club-admin/adherents/${personId}/export`}
            download
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
          >
            <Download aria-hidden className="size-4" /> Exporter ses données
          </a>
          <Button variant="destructive" disabled={pending} onClick={() => setOpen(true)}>
            Effacer ses données
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          L’export contient toutes les saisons, dossiers, règlements, présences et e-mails envoyés (fichier JSON à transmettre à la personne).
        </p>
      </CardBody>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Effacer les données de ${name}`}
        description="Définitif. Pièces justificatives supprimées, inscriptions anonymisées, demandes de pré-inscription et historique d’envois effacés. Les montants réglés restent (obligations comptables), sans nom. Le dossier familial est gardé s’il concerne aussi un frère ou une sœur toujours au club."
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            let complete = false;
            run(
              async () => {
                const res = await erasePersonData(personId, confirmation);
                complete = Boolean(res.ok && res.data?.complete);
                return res;
              },
              () => {
                setOpen(false);
                setConfirmation('');
                // La fiche n'existe plus : retour à la liste (le message reste affiché).
                if (complete) window.location.assign('/club-admin/adherents');
              },
            );
          }}
        >
          <Field id="pd-confirm" label="Tapez EFFACER pour confirmer">
            <Input id="pd-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="destructive" size="lg" disabled={pending || confirmation !== 'EFFACER'}>
            Effacer définitivement
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
