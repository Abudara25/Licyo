'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Field, Input, Select } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { SITE_TEMPLATES } from '@/lib/platform';
import { SPORTS_PRESETS } from '@/config/sports-presets';
import { provisionClub } from '@/actions/platform.actions';
export function OnboardingForm({
  count,
  template,
}: {
  count: number;
  template: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState('');
  const [v, setV] = useState({
    name: '',
    slug: '',
    sport: 'football',
    customSport: '',
    city: '',
    postalCode: '',
    ownerName: '',
    memberCount: count,
    template,
  });
  const field =
    (k: string) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await provisionClub({
            ...v,
            sport: v.sport === 'autre' ? v.customSport : v.sport,
          });
          if (!r.ok) {
            setError(r.error);
            return;
          }
          router.push('/club-admin/modules');
          router.refresh();
        });
      }}
    >
      <div className="form-grid">
        <Field id="o-name" label="Nom de l’association">
          <Input
            id="o-name"
            required
            minLength={2}
            maxLength={120}
            value={v.name}
            onChange={field('name')}
          />
        </Field>
        <Field id="o-owner" label="Votre nom">
          <Input
            id="o-owner"
            required
            autoComplete="name"
            value={v.ownerName}
            onChange={field('ownerName')}
          />
        </Field>
        <Field id="o-sport" label="Votre sport">
          <Select id="o-sport" value={v.sport} onChange={field('sport')}>
            {Object.values(SPORTS_PRESETS).map((s) => (
              <option value={s.id} key={s.id}>
                {s.label}
              </option>
            ))}
            <option value="autre">Un autre sport / plusieurs sports</option>
          </Select>
        </Field>
        {v.sport === 'autre' ? (
          <Field id="o-custom" label="Nom de votre discipline">
            <Input
              id="o-custom"
              required
              maxLength={80}
              value={v.customSport}
              onChange={field('customSport')}
            />
          </Field>
        ) : null}
        <Field id="o-count" label="Effectif de la saison">
          <Input
            id="o-count"
            required
            type="number"
            min={0}
            max={1000000}
            value={v.memberCount}
            onChange={(e) =>
              setV({ ...v, memberCount: Number(e.target.value) })
            }
          />
        </Field>
        <Field id="o-city" label="Ville">
          <Input id="o-city" required value={v.city} onChange={field('city')} />
        </Field>
        <Field id="o-postal" label="Code postal">
          <Input
            id="o-postal"
            required
            inputMode="numeric"
            pattern="[0-9]{5}"
            value={v.postalCode}
            onChange={field('postalCode')}
          />
        </Field>
        <Field
          id="o-slug"
          label="Adresse de votre club"
          hint="Lettres minuscules, chiffres et tirets."
        >
          <Input
            id="o-slug"
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={50}
            value={v.slug}
            onChange={field('slug')}
          />
        </Field>
      </div>
      <h2 className="mt-8 font-semibold">Votre première impression</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Choisissez un modèle. Vous pourrez le changer depuis votre espace.
      </p>
      <div className="template-options">
        {SITE_TEMPLATES.map((t) => (
          <label className="template-option" key={t.id}>
            <input
              name="template"
              type="radio"
              value={t.id}
              checked={v.template === t.id}
              onChange={field('template')}
            />
            <span>
              <strong>{t.name}</strong>
              <small>{t.eyebrow}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="notice">
        Votre espace démarre en démonstration pendant 14 jours. Aucun paiement
        n’est prélevé à cette étape.
      </p>
      {error ? (
        <p role="alert" className="mb-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Création de votre espace…' : 'Créer mon espace club'}
      </Button>
    </form>
  );
}
