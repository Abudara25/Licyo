'use client';

import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/form';
import {
  AUTHORIZATION_TEXT_MAX,
  AUTHORIZATION_VARIABLES,
  DEFAULT_AUTHORIZATION_TEXT,
  renderAuthorization,
  type ParentalAuthorizationConfig,
} from '@/config/parental-authorization';

/** Réglage de l'autorisation parentale en ligne : activation, texte du club, aperçu avec un exemple. */
export function ParentalAuthorizationEditor({
  value,
  onChange,
  example,
}: {
  value: ParentalAuthorizationConfig;
  onChange: (v: ParentalAuthorizationConfig) => void;
  example: { clubName: string; sport: string; season: string };
}) {
  const preview = renderAuthorization(value.text, {
    signerName: 'Marie EXEMPLE',
    signerQuality: 'mere',
    childName: 'Léo EXEMPLE',
    birthDate: '2015-04-12',
    ...example,
  });
  return (
    <Card>
      <CardHeader
        title="Autorisation parentale (mineurs)"
        description="Le responsable légal lit l’autorisation de chaque enfant, indique son nom et sa qualité, accepte et signe en ligne. Une copie exacte de ce qui a été signé est gardée au dossier."
      />
      <CardBody className="grid gap-4">
        <label htmlFor="pa-on" className="flex min-h-11 cursor-pointer items-start gap-3">
          <input id="pa-on" type="checkbox" className="mt-0.5 size-5 shrink-0" checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
          <span className="text-sm">
            <span className="font-medium">Demander l’autorisation parentale signée en ligne</span>
            <span className="block text-muted-foreground">Pour chaque adhérent mineur, à la fin de l’inscription.</span>
          </span>
        </label>
        {value.enabled ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="grid content-start gap-2">
              <Field id="pa-text" label="Texte de l’autorisation" hint={`${value.text.length} / ${AUTHORIZATION_TEXT_MAX} caractères. Une ligne vide sépare les paragraphes.`}>
                <Textarea id="pa-text" className="min-h-64" maxLength={AUTHORIZATION_TEXT_MAX} value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} />
              </Field>
              <details className="text-sm">
                <summary className="flex min-h-11 cursor-pointer items-center font-medium">Variables remplacées automatiquement</summary>
                <ul className="grid gap-1 pb-2">
                  {Object.entries(AUTHORIZATION_VARIABLES).map(([k, label]) => (
                    <li key={k}>
                      <code className="rounded bg-muted px-1">{k}</code> : {label}
                    </li>
                  ))}
                </ul>
              </details>
              {value.text !== DEFAULT_AUTHORIZATION_TEXT ? (
                <Button variant="outline" className="justify-self-start" onClick={() => onChange({ ...value, text: DEFAULT_AUTHORIZATION_TEXT })}>
                  Revenir au texte proposé
                </Button>
              ) : null}
            </div>
            <div className="grid content-start gap-2">
              <p className="text-sm font-medium">Aperçu (exemple)</p>
              <div className="whitespace-pre-line rounded-xl border bg-white p-4 text-sm leading-6">{preview}</div>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
