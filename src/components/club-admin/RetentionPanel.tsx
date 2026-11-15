'use client';

import { useState } from 'react';
import { applyRetentionNow, saveRetentionPolicy } from '@/actions/retention.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { RETENTION_BOUNDS, addMonths, seasonEnd, type RetentionCounts, type RetentionPolicy } from '@/lib/retention';
import { useAction } from './useAction';

export type RetentionRun = { id: string; ranAt: string; trigger: 'auto' | 'manual'; detail: Record<string, number> };

// Dates de fin de saison calculées en UTC (31 août) : affichées en UTC pour ne pas glisser au lendemain.
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });
const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Paris' });
const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function after(season: string, months: number): string {
  const end = seasonEnd(season);
  return end ? date.format(addMonths(end, months)) : '-';
}

const FIELDS = [
  { key: 'documentsMonths', label: 'Pièces justificatives', unit: 'mois', hint: 'Photo, certificat médical, pièce d’identité, autres pièces : après la fin de la saison (31 août).' },
  { key: 'membersYears', label: 'Fiches des adhérents', unit: 'ans', hint: 'Noms, coordonnées, signature : anonymisés après la fin de la saison. Les montants réglés restent.' },
  { key: 'preregistrationsMonths', label: 'Pré-inscriptions', unit: 'mois', hint: 'Demandes closes (inscrites, refusées, expirées) ou d’une saison terminée.' },
] as const;

/** Conservation RGPD du club : durées, aperçu de ce qui serait traité, application chaque nuit ou immédiate. */
export function RetentionPanel({
  initial,
  preview,
  runs,
  lastEndedSeason,
}: {
  initial: RetentionPolicy;
  preview: RetentionCounts;
  runs: RetentionRun[];
  lastEndedSeason: string;
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [values, setValues] = useState({
    documentsMonths: String(initial.documentsMonths),
    membersYears: String(initial.membersYears),
    preregistrationsMonths: String(initial.preregistrationsMonths),
  });
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const { pending, run } = useAction();
  const num = (k: keyof typeof values) => Number(values[k]);
  const dirty =
    enabled !== initial.enabled || (Object.keys(values) as (keyof typeof values)[]).some((k) => num(k) !== initial[k]);
  const total = preview.pieces + preview.adherents + preview.familles + preview.preinscriptions + preview.operations;

  return (
    <Card>
      <CardHeader
        title="Conservation des données (RGPD)"
        description="Le club est responsable des données de ses adhérents, dont des mineurs : il ne les garde pas plus longtemps que nécessaire."
      />
      <CardBody className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {FIELDS.map((f) => (
            <Field key={f.key} id={`rt-${f.key}`} label={`${f.label} (${f.unit})`} hint={f.hint}>
              <Input
                id={`rt-${f.key}`}
                inputMode="numeric"
                maxLength={2}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value.replace(/\D/g, '') })}
                aria-describedby={`rt-${f.key}-range`}
              />
              <span id={`rt-${f.key}-range`} className="sr-only">
                Entre {RETENTION_BOUNDS[f.key][0]} et {RETENTION_BOUNDS[f.key][1]} {f.unit}.
              </span>
            </Field>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          Exemple, saison {lastEndedSeason} : pièces supprimées le {after(lastEndedSeason, num('documentsMonths'))}, fiches anonymisées le{' '}
          {after(lastEndedSeason, num('membersYears') * 12)}.
        </p>

        <label htmlFor="rt-on" className="flex min-h-11 cursor-pointer items-start gap-3">
          <input id="rt-on" type="checkbox" className="mt-0.5 size-5 shrink-0" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span className="text-sm">
            <span className="font-medium">Appliquer automatiquement chaque nuit</span>
            <span className="block text-muted-foreground">
              Les fichiers sont supprimés du stockage puis leur absence est vérifiée. Les suppressions et anonymisations sont définitives.
            </span>
          </span>
        </label>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm" aria-live="polite">
          <p className="font-medium">{dirty ? 'Avec les durées enregistrées, aujourd’hui :' : 'Aujourd’hui, ces durées concernent :'}</p>
          {total === 0 ? (
            <p className="text-muted-foreground">Rien à supprimer ni à anonymiser.</p>
          ) : (
            <ul className="mt-1 grid gap-0.5">
              {preview.pieces ? <li>{plural(preview.pieces, 'pièce justificative à supprimer', 'pièces justificatives à supprimer')}</li> : null}
              {preview.adherents ? <li>{plural(preview.adherents, 'fiche d’adhérent à anonymiser', 'fiches d’adhérent à anonymiser')}</li> : null}
              {preview.familles ? <li>{plural(preview.familles, 'dossier familial à anonymiser', 'dossiers familiaux à anonymiser')}</li> : null}
              {preview.preinscriptions ? <li>{plural(preview.preinscriptions, 'demande de pré-inscription à supprimer', 'demandes de pré-inscription à supprimer')}</li> : null}
              {preview.operations ? <li>{plural(preview.operations, 'opération importée à anonymiser', 'opérations importées à anonymiser')}</li> : null}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={pending || !dirty}
            onClick={() =>
              run(() =>
                saveRetentionPolicy({
                  enabled,
                  documentsMonths: num('documentsMonths'),
                  membersYears: num('membersYears'),
                  preregistrationsMonths: num('preregistrationsMonths'),
                }),
              )
            }
          >
            Enregistrer les durées
          </Button>
          <Button variant="destructive" disabled={pending || dirty || total === 0} onClick={() => setOpen(true)}>
            Appliquer maintenant
          </Button>
        </div>
        {dirty ? <p className="text-xs text-muted-foreground">Enregistrez d’abord pour voir l’effet des nouvelles durées et pouvoir les appliquer.</p> : null}

        <p className="text-sm">
          <a href="/club-admin/registre-rgpd" className="inline-flex min-h-11 items-center font-medium underline">
            Voir le registre des traitements du club
          </a>{' '}
          <span className="text-muted-foreground">(pré-rempli à partir de vos réglages, à imprimer).</span>
        </p>

        {runs.length ? (
          <div className="grid gap-1">
            <p className="text-sm font-medium">Derniers passages</p>
            <ul className="divide-y rounded-lg border text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 p-2">
                  <span>{dateTime.format(new Date(r.ranAt))}</span>
                  <Badge tone={r.trigger === 'auto' ? 'info' : 'neutral'}>{r.trigger === 'auto' ? 'Automatique' : 'Manuel'}</Badge>
                  <span className="text-muted-foreground">
                    {r.detail.pieces ?? 0} pièce(s), {r.detail.adherents ?? 0} adhérent(s), {r.detail.familles ?? 0} dossier(s)
                    {r.detail.echecsFichiers ? `, ${r.detail.echecsFichiers} fichier(s) à retenter` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardBody>

      <Dialog open={open} onOpenChange={setOpen} title="Appliquer la conservation maintenant" description="Suppressions et anonymisations définitives, selon le récapitulatif affiché.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => applyRetentionNow(confirmation),
              () => {
                setOpen(false);
                setConfirmation('');
              },
            );
          }}
        >
          <Field id="rt-confirm" label="Tapez SUPPRIMER pour confirmer">
            <Input id="rt-confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" variant="destructive" size="lg" disabled={pending || confirmation !== 'SUPPRIMER'}>
            Appliquer définitivement
          </Button>
        </form>
      </Dialog>
    </Card>
  );
}
