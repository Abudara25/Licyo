'use client';

import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { appliesTo, type ResolvedField } from '@/config/registration-fields';

export type ExtraDraft = Record<string, string | boolean>;

/** Premier champ obligatoire non rempli pour cette personne (contrôle de confort ; le serveur fait foi). */
export function missingRequiredExtra(fields: readonly ResolvedField[], values: ExtraDraft, isMinor: boolean): ResolvedField | null {
  for (const f of fields) {
    if (f.mode !== 'required' || !appliesTo(f, isMinor)) continue;
    const v = values[f.key];
    if (f.type === 'checkbox' ? v !== true : typeof v !== 'string' || !v.trim()) return f;
  }
  return null;
}

/** Réponses envoyées au serveur : seulement les champs qui concernent cette personne. */
export function extraPayload(fields: readonly ResolvedField[], values: ExtraDraft, isMinor: boolean): ExtraDraft {
  const out: ExtraDraft = {};
  for (const f of fields) {
    if (!appliesTo(f, isMinor)) continue;
    const v = values[f.key];
    if (f.type === 'checkbox') out[f.key] = v === true;
    else if (typeof v === 'string' && v.trim()) out[f.key] = v.trim();
  }
  return out;
}

/** Champs activés par le club pour une personne (mineur ou majeur). Rien n'est affiché si aucun champ ne la concerne. */
export function ClubExtraFields({
  idPrefix,
  fields,
  values,
  isMinor,
  onChange,
}: {
  idPrefix: string;
  fields: readonly ResolvedField[];
  values: ExtraDraft;
  isMinor: boolean;
  onChange: (key: string, value: string | boolean) => void;
}) {
  const visible = fields.filter((f) => appliesTo(f, isMinor));
  if (visible.length === 0) return null;
  const inputs = visible.filter((f) => f.type !== 'checkbox');
  const checks = visible.filter((f) => f.type === 'checkbox');
  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-sm font-semibold">Informations demandées par le club</p>
      {inputs.length ? (
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {inputs.map((f) => {
            const id = `${idPrefix}-x-${f.key}`;
            const label = f.mode === 'required' ? `${f.label} *` : `${f.label} (facultatif)`;
            const value = typeof values[f.key] === 'string' ? (values[f.key] as string) : '';
            const wide = f.type === 'textarea' || f.label.length > 40;
            return (
              <Field key={f.key} id={id} label={label} hint={f.hint} className={wide ? 'sm:col-span-2' : undefined}>
                {f.type === 'select' ? (
                  <Select id={id} value={value} onChange={(e) => onChange(f.key, e.target.value)}>
                    <option value="">Choisir…</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </Select>
                ) : f.type === 'textarea' ? (
                  <Textarea id={id} value={value} maxLength={f.maxLength} onChange={(e) => onChange(f.key, e.target.value)} />
                ) : (
                  <Input
                    id={id}
                    value={value}
                    maxLength={f.type === 'number' ? 6 : f.maxLength}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    onChange={(e) => onChange(f.key, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>
      ) : null}
      {checks.length ? (
        <div className="mt-2 grid gap-1">
          {checks.map((f) => (
            <Checkbox
              key={f.key}
              id={`${idPrefix}-x-${f.key}`}
              checked={values[f.key] === true}
              onChange={(v) => onChange(f.key, v)}
              label={f.mode === 'required' ? `${f.label} *` : f.label}
              description={f.hint}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
