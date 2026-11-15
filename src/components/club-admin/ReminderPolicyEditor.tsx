'use client';

import { useState } from 'react';
import { saveReminderPolicy } from '@/actions/reminders.actions';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { MAX_STEPS, REMINDER_KIND_LABELS, type ReminderKind, type ReminderPolicy } from '@/lib/reminders';
import { useAction } from './useAction';

const KIND_HINTS: Record<ReminderKind, string> = {
  documents: 'Photo ou certificat médical manquant : la famille reçoit un lien pour les ajouter.',
  correction: 'Pièce refusée par le bureau et pas encore remplacée.',
  payment: 'Reste à payer, hors chèques déjà remis.',
};

/** Réglages des relances automatiques (désactivées tant que le club ne les active pas). */
export function ReminderPolicyEditor({ initial, canEdit }: { initial: ReminderPolicy; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [delays, setDelays] = useState<string[]>(() => initial.delaysDays.map(String));
  const [kinds, setKinds] = useState(initial.kinds);
  const { pending, run } = useAction();

  return (
    <Card>
      <CardHeader
        title="Relances automatiques"
        description="Chaque nuit, Licyo relance les familles dont le dossier est incomplet, au nom du club. Désactivées par défaut."
      />
      <CardBody className="grid gap-4">
        <label htmlFor="rp-on" className="flex min-h-11 cursor-pointer items-start gap-3">
          <input id="rp-on" type="checkbox" className="mt-0.5 size-5 shrink-0" checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium">Activer les relances automatiques</span>
            <span className="block text-muted-foreground">Une même relance n’est jamais envoyée deux fois ; au plus une par famille et par jour.</span>
          </span>
        </label>

        <fieldset className="grid gap-2" disabled={!canEdit}>
          <legend className="mb-1 text-sm font-medium">Quoi relancer</legend>
          {(Object.keys(REMINDER_KIND_LABELS) as ReminderKind[]).map((k) => (
            <label key={k} htmlFor={`rp-k-${k}`} className="flex min-h-11 cursor-pointer items-start gap-3">
              <input id={`rp-k-${k}`} type="checkbox" className="mt-0.5 size-5 shrink-0" checked={kinds[k]} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} />
              <span className="text-sm">
                <span className="font-medium">{REMINDER_KIND_LABELS[k]}</span>
                <span className="block text-muted-foreground">{KIND_HINTS[k]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset disabled={!canEdit}>
          <legend className="mb-1 text-sm font-medium">Quand (jours après l’inscription ou la demande de correction)</legend>
          <div className="grid grid-cols-3 gap-3 sm:max-w-md">
            {Array.from({ length: MAX_STEPS }, (_, i) => (
              <Field key={i} id={`rp-d-${i}`} label={`Relance ${i + 1}`}>
                <Input
                  id={`rp-d-${i}`}
                  inputMode="numeric"
                  maxLength={2}
                  value={delays[i] ?? ''}
                  onChange={(e) => {
                    const next = [...delays];
                    next[i] = e.target.value.replace(/\D/g, '');
                    setDelays(next);
                  }}
                />
              </Field>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Relances 2 et 3 facultatives : laissez vide pour n’en envoyer qu’une ou deux.</p>
        </fieldset>

        {canEdit ? (
          <Button
            className="w-full sm:w-auto"
            disabled={pending}
            onClick={() =>
              run(() =>
                saveReminderPolicy({
                  enabled,
                  kinds,
                  delaysDays: delays.map((d) => Number(d)).filter((n) => Number.isInteger(n) && n > 0),
                }),
              )
            }
          >
            Enregistrer les relances
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">Seules les personnes qui gèrent les réglages du club peuvent modifier les relances.</p>
        )}
      </CardBody>
    </Card>
  );
}
