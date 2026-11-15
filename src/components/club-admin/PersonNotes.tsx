'use client';

import { useState } from 'react';
import { updatePersonNotes } from '@/actions/people.actions';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form';
import { useAction } from './useAction';

/** Notes internes du bureau sur la personne (jamais visibles par la famille). */
export function PersonNotes({ personId, initial, canEdit }: { personId: string; initial: string; canEdit: boolean }) {
  const [notes, setNotes] = useState(initial);
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader
        title="Notes internes"
        description="Visibles par le bureau uniquement. N’y inscrivez que l’utile au suivi : pas d’information médicale ni de jugement (RGPD)."
      />
      <CardBody className="grid gap-3">
        <label htmlFor="person-notes" className="sr-only">
          Notes internes
        </label>
        <Textarea id="person-notes" maxLength={2000} value={notes} disabled={!canEdit} onChange={(e) => setNotes(e.target.value)} />
        {canEdit ? (
          <Button className="w-full sm:w-auto" disabled={pending} onClick={() => run(() => updatePersonNotes(personId, notes))}>
            Enregistrer les notes
          </Button>
        ) : null}
      </CardBody>
    </Card>
  );
}
