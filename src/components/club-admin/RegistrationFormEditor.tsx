'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { saveRegistrationForm } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import {
  FIELD_GROUP_LABELS,
  MAX_CUSTOM_QUESTIONS,
  type CatalogField,
  type CustomQuestion,
  type FieldAudience,
  type FieldGroup,
  type FieldMode,
  type FieldSetting,
} from '@/config/registration-fields';
import { useAction } from './useAction';

const MODE_LABELS: Record<FieldMode, string> = { off: 'Masqué', optional: 'Facultatif', required: 'Obligatoire' };
const AUDIENCE_LABELS: Record<FieldAudience, string> = { all: 'Tous', minor: 'Mineurs', adult: 'Majeurs' };
const TYPE_LABELS: Record<CustomQuestion['type'], string> = {
  text: 'Réponse courte',
  textarea: 'Réponse longue',
  select: 'Liste de choix',
  checkbox: 'Case à cocher',
};

type Row = { field: Omit<CatalogField, 'options'>; setting: FieldSetting };
type CustomDraft = CustomQuestion & { optionsText: string };

const newId = () => `c_${Math.random().toString(36).slice(2, 10)}`;

/**
 * Le club choisit les informations demandées à l'inscription : champs du catalogue (selon son sport) et questions
 * libres. Les champs de base (identité, catégorie, responsable, urgence, signature) sont toujours demandés.
 */
export function RegistrationFormEditor({ rows, custom }: { rows: Row[]; custom: CustomQuestion[] }) {
  const [settings, setSettings] = useState<Record<string, FieldSetting>>(() =>
    Object.fromEntries(rows.map((r) => [r.field.key, r.setting])),
  );
  const [questions, setQuestions] = useState<CustomDraft[]>(() =>
    custom.map((q) => ({ ...q, optionsText: (q.options ?? []).join('\n') })),
  );
  const { pending, run } = useAction();

  const groups = [...new Set(rows.map((r) => r.field.group))] as FieldGroup[];
  const setField = (key: string, patch: Partial<FieldSetting>) => setSettings((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  const setQuestion = (id: string, patch: Partial<CustomDraft>) =>
    setQuestions((list) => list.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  function save() {
    run(() =>
      saveRegistrationForm({
        fields: settings,
        custom: questions.map(({ optionsText, ...q }) => ({
          ...q,
          options: q.type === 'select' ? optionsText.split('\n').map((o) => o.trim()).filter(Boolean) : undefined,
        })),
      }),
    );
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader
          title="Toujours demandé"
          description="Identité, date de naissance, catégorie, responsable légal ou coordonnées de l’adulte, contact d’urgence, questionnaire de santé ou certificat, droit à l’image, signature."
        />
      </Card>

      {groups.map((group) => (
        <Card key={group}>
          <CardHeader title={FIELD_GROUP_LABELS[group]} />
          <ul className="divide-y">
            {rows
              .filter((r) => r.field.group === group)
              .map(({ field }) => {
                const s = settings[field.key];
                const id = `rf-${field.key}`;
                return (
                  <li key={field.key} className="grid grid-cols-2 gap-x-3 gap-y-2 p-4 md:grid-cols-[1fr_11rem_10rem] md:items-center">
                    <div className="col-span-2 min-w-0 md:col-span-1">
                      <p className="font-medium">{field.label}</p>
                      {field.hint ? <p className="text-sm text-muted-foreground">{field.hint}</p> : null}
                    </div>
                    <Select
                      aria-label={`${field.label} : demande`}
                      id={`${id}-mode`}
                      value={s.mode}
                      onChange={(e) => setField(field.key, { mode: e.target.value as FieldMode })}
                    >
                      {(Object.keys(MODE_LABELS) as FieldMode[]).map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABELS[m]}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label={`${field.label} : public`}
                      id={`${id}-aud`}
                      value={s.audience}
                      disabled={s.mode === 'off'}
                      onChange={(e) => setField(field.key, { audience: e.target.value as FieldAudience })}
                    >
                      {(Object.keys(AUDIENCE_LABELS) as FieldAudience[]).map((a) => (
                        <option key={a} value={a}>
                          {AUDIENCE_LABELS[a]}
                        </option>
                      ))}
                    </Select>
                  </li>
                );
              })}
          </ul>
        </Card>
      ))}

      <Card>
        <CardHeader
          title="Questions du club"
          description={`Ajoutez vos propres questions (${MAX_CUSTOM_QUESTIONS} au maximum).`}
          action={
            questions.length < MAX_CUSTOM_QUESTIONS ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setQuestions((list) => [
                    ...list,
                    { id: newId(), label: '', type: 'text', mode: 'optional', audience: 'all', optionsText: '' },
                  ])
                }
              >
                <Plus aria-hidden /> Ajouter
              </Button>
            ) : undefined
          }
        />
        {questions.length === 0 ? (
          <CardBody>
            <p className="text-sm text-muted-foreground">Aucune question ajoutée.</p>
          </CardBody>
        ) : (
          <ul className="divide-y">
            {questions.map((q, i) => (
              <li key={q.id} className="grid gap-3 p-4 sm:grid-cols-2">
                <Field id={`${q.id}-l`} label={`Question ${i + 1}`} className="sm:col-span-2">
                  <Input id={`${q.id}-l`} value={q.label} maxLength={160} onChange={(e) => setQuestion(q.id, { label: e.target.value })} />
                </Field>
                <Field id={`${q.id}-t`} label="Type de réponse">
                  <Select id={`${q.id}-t`} value={q.type} onChange={(e) => setQuestion(q.id, { type: e.target.value as CustomQuestion['type'] })}>
                    {(Object.keys(TYPE_LABELS) as CustomQuestion['type'][]).map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field id={`${q.id}-m`} label="Demande">
                  <Select id={`${q.id}-m`} value={q.mode} onChange={(e) => setQuestion(q.id, { mode: e.target.value as CustomQuestion['mode'] })}>
                    <option value="optional">Facultatif</option>
                    <option value="required">Obligatoire</option>
                  </Select>
                </Field>
                <Field id={`${q.id}-a`} label="Public">
                  <Select id={`${q.id}-a`} value={q.audience} onChange={(e) => setQuestion(q.id, { audience: e.target.value as FieldAudience })}>
                    {(Object.keys(AUDIENCE_LABELS) as FieldAudience[]).map((a) => (
                      <option key={a} value={a}>
                        {AUDIENCE_LABELS[a]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {q.type === 'select' ? (
                  <Field id={`${q.id}-o`} label="Choix proposés (un par ligne)" className="sm:col-span-2">
                    <Textarea id={`${q.id}-o`} value={q.optionsText} onChange={(e) => setQuestion(q.id, { optionsText: e.target.value })} />
                  </Field>
                ) : null}
                <div className="sm:col-span-2">
                  <Button variant="ghost" className="text-destructive" onClick={() => setQuestions((list) => list.filter((x) => x.id !== q.id))}>
                    <Trash2 aria-hidden /> Retirer la question
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button size="lg" className="w-full sm:w-auto" onClick={save} disabled={pending}>
          Enregistrer le formulaire
        </Button>
      </div>
    </div>
  );
}
