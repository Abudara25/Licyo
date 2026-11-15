'use client';

import { useMemo, useState } from 'react';
import { ShieldAlert, SlidersHorizontal, Trash2, UserPlus } from 'lucide-react';
import { inviteStaff, removeStaff, updateStaffAccess } from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import type { StaffMember } from '@/types/database';
import {
  ALL_GRANTS,
  CLUB_ROLES,
  GRANT_INFO,
  PERSONAL_DATA_GRANTS,
  RECOMMENDED_MAX_PERSONAL_DATA_ACCESS,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SCOPED_PERMISSIONS,
  defaultGrants,
  effectiveGrants,
  grantWarnings,
  type ClubRole,
  type Grant,
  type Sensitivity,
} from '@/lib/permissions';
import { useAction } from './useAction';

const SENSITIVITY_TONE: Record<Sensitivity, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critique: 'danger',
  élevée: 'warning',
  modérée: 'info',
  faible: 'neutral',
};
const SENSITIVITY_ORDER: Sensitivity[] = ['critique', 'élevée', 'modérée', 'faible'];
const SENSITIVITY_TITLES: Record<Sensitivity, string> = {
  critique: 'Accès critique',
  élevée: 'Données personnelles des adhérents',
  modérée: 'Activité sportive',
  faible: 'Vie du club et site',
};

type Draft = { email: string; fullName: string; role: ClubRole; grants: Grant[]; categoryIds: string[] };

const touchesPersonalData = (grants: readonly Grant[]) => grants.some((g) => PERSONAL_DATA_GRANTS.includes(g));

/**
 * Équipe du club et droits de chacun. Le rôle pré-coche des droits ; l'administrateur ajuste librement, avec des
 * explications et des avertissements : chaque accès aux dossiers des adhérents est un risque pour leurs données.
 */
export function StaffAccessPanel({
  staff,
  currentUserId,
  canManage,
  categories,
}: {
  staff: StaffMember[];
  currentUserId: string;
  canManage: boolean;
  categories: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const { pending, run } = useAction();
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const people = staff
    .filter((s) => s.club_id)
    .map((s) => ({ ...s, grants: effectiveGrants(s.role, s.permissions) }));
  const withPersonalData = people.filter((p) => touchesPersonalData(p.grants)).length;

  const openInvite = () =>
    setEditing({ id: null, draft: { email: '', fullName: '', role: 'coach', grants: defaultGrants('coach'), categoryIds: [] } });
  const openEdit = (p: (typeof people)[number]) =>
    setEditing({
      id: p.id,
      draft: { email: p.email, fullName: p.full_name, role: p.role as ClubRole, grants: p.grants, categoryIds: p.assigned_category_ids },
    });

  return (
    <Card>
      <CardHeader
        title="Équipe du club et droits"
        description="Chaque personne n’a que les droits que vous lui donnez."
        action={
          canManage ? (
            <Button size="sm" onClick={openInvite}>
              <UserPlus aria-hidden /> Inviter
            </Button>
          ) : undefined
        }
      />
      <CardBody className="grid gap-2 border-b text-sm">
        <p className="flex items-start gap-2">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
          <span>
            Vous êtes libre de donner les droits que vous voulez. Mais chaque personne qui accède aux dossiers voit des
            données personnelles, souvent de mineurs, et des informations de santé. En cas de fuite, le club en est
            responsable (RGPD). Donnez à chacun <strong>seulement ce dont il a besoin</strong>, et retirez l’accès des
            personnes qui quittent leur fonction.
          </span>
        </p>
        <p>
          <Badge tone={withPersonalData > RECOMMENDED_MAX_PERSONAL_DATA_ACCESS ? 'warning' : 'neutral'}>
            {withPersonalData} personne{withPersonalData > 1 ? 's' : ''} {withPersonalData > 1 ? 'ont' : 'a'} accès aux dossiers ou aux paiements
          </Badge>
          {withPersonalData > RECOMMENDED_MAX_PERSONAL_DATA_ACCESS ? (
            <span className="ml-2 text-amber-800">
              C’est beaucoup : au-delà de {RECOMMENDED_MAX_PERSONAL_DATA_ACCESS}, vérifiez que chacun en a vraiment besoin.
            </span>
          ) : null}
        </p>
      </CardBody>
      <ul className="divide-y">
        {people.map((p) => {
          const sensitive = p.grants.filter((g) => ['critique', 'élevée'].includes(GRANT_INFO[g].sensitivity));
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {p.full_name}
                  {p.user_id === currentUserId ? <span className="ml-1 text-sm font-normal text-muted-foreground">(vous)</span> : null}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {ROLE_LABELS[p.role]} - {p.grants.length} droit{p.grants.length > 1 ? 's' : ''}
                  {p.assigned_category_ids.length
                    ? ` - ${p.assigned_category_ids.map((id) => catName.get(id) ?? '?').join(', ')}`
                    : ''}
                </p>
                {sensitive.length ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {sensitive.map((g) => (
                      <Badge key={g} tone={SENSITIVITY_TONE[GRANT_INFO[g].sensitivity]}>
                        {GRANT_INFO[g].label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              {canManage ? (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => openEdit(p)} aria-label={`Modifier les droits de ${p.full_name}`}>
                    <SlidersHorizontal aria-hidden /> Droits
                  </Button>
                  {p.user_id !== currentUserId ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Retirer ${p.full_name}`}
                      onClick={() => confirm(`Retirer l'accès de ${p.full_name} ?`) && run(() => removeStaff(p.id))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {editing ? (
        <AccessDialog
          key={editing.id ?? 'new'}
          isNew={editing.id === null}
          isSelf={people.find((p) => p.id === editing.id)?.user_id === currentUserId}
          initial={editing.draft}
          categories={categories}
          othersWithPersonalData={people.filter((p) => p.id !== editing.id && touchesPersonalData(p.grants)).length}
          pending={pending}
          onClose={() => setEditing(null)}
          onSave={(d) =>
            run(
              () =>
                editing.id === null
                  ? inviteStaff({ email: d.email, fullName: d.fullName, role: d.role, permissions: d.grants, categoryIds: d.categoryIds })
                  : updateStaffAccess(editing.id, { role: d.role, permissions: d.grants, categoryIds: d.categoryIds }),
              () => setEditing(null),
            )
          }
        />
      ) : null}
    </Card>
  );
}

function AccessDialog({
  isNew,
  isSelf,
  initial,
  categories,
  othersWithPersonalData,
  pending,
  onClose,
  onSave,
}: {
  isNew: boolean;
  isSelf: boolean;
  initial: Draft;
  categories: { id: string; name: string }[];
  othersWithPersonalData: number;
  pending: boolean;
  onClose: () => void;
  onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const warnings = useMemo(() => grantWarnings(d.grants, d.categoryIds.length > 0), [d.grants, d.categoryIds]);
  const scopedChecked = d.grants.some((g) => (SCOPED_PERMISSIONS as readonly string[]).includes(g));
  const total = othersWithPersonalData + (touchesPersonalData(d.grants) ? 1 : 0);
  const toggle = (g: Grant, on: boolean) =>
    setD((x) => ({ ...x, grants: ALL_GRANTS.filter((k) => (k === g ? on : x.grants.includes(k))) }));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={isNew ? 'Inviter une personne du club' : `Droits de ${initial.fullName}`}
      description={isNew ? 'Un e-mail de connexion lui est envoyé.' : 'Les changements s’appliquent dès l’enregistrement.'}
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(d);
        }}
      >
        {isNew ? (
          <>
            <Field id="ac-n" label="Nom et prénom">
              <Input id="ac-n" required value={d.fullName} onChange={(e) => setD({ ...d, fullName: e.target.value })} />
            </Field>
            <Field id="ac-e" label="E-mail">
              <Input id="ac-e" type="email" required value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} />
            </Field>
          </>
        ) : null}
        <Field id="ac-r" label="Fonction dans le club" hint="Choisir une fonction pré-coche les droits habituels ; vous pouvez ensuite les ajuster.">
          <Select
            id="ac-r"
            value={d.role}
            onChange={(e) => {
              const role = e.target.value as ClubRole;
              setD({ ...d, role, grants: defaultGrants(role) });
            }}
          >
            {CLUB_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </Select>
        </Field>
        <p className="-mt-2 text-sm text-muted-foreground">{ROLE_DESCRIPTIONS[d.role]}</p>

        {SENSITIVITY_ORDER.map((level) => {
          const grants = ALL_GRANTS.filter((g) => GRANT_INFO[g].sensitivity === level);
          return (
            <fieldset key={level} className="rounded-xl border p-3">
              <legend className="px-1 text-sm font-semibold">
                <Badge tone={SENSITIVITY_TONE[level]}>{SENSITIVITY_TITLES[level]}</Badge>
              </legend>
              {grants.map((g) => {
                const locked = isSelf && g === 'club.admin';
                return (
                  <label key={g} htmlFor={`ac-g-${g}`} className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
                    <input
                      id={`ac-g-${g}`}
                      type="checkbox"
                      className="mt-0.5 size-5 shrink-0"
                      checked={d.grants.includes(g)}
                      disabled={locked}
                      onChange={(e) => toggle(g, e.target.checked)}
                    />
                    <span className="text-sm leading-snug">
                      <span className="font-medium">{GRANT_INFO[g].label}</span>
                      <span className="block text-muted-foreground">{GRANT_INFO[g].description}</span>
                      {locked ? <span className="block text-muted-foreground">Vous ne pouvez pas retirer vous-même ce droit.</span> : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}

        {scopedChecked && categories.length ? (
          <fieldset className="rounded-xl border p-3">
            <legend className="px-1 text-sm font-semibold">Catégories rattachées</legend>
            <p className="text-sm text-muted-foreground">Les droits « de ses catégories » ne valent que pour celles cochées ici.</p>
            {categories.map((c) => (
              <label key={c.id} htmlFor={`ac-c-${c.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <input
                  id={`ac-c-${c.id}`}
                  type="checkbox"
                  className="size-5"
                  checked={d.categoryIds.includes(c.id)}
                  onChange={(e) =>
                    setD({
                      ...d,
                      categoryIds: e.target.checked ? [...d.categoryIds, c.id] : d.categoryIds.filter((x) => x !== c.id),
                    })
                  }
                />
                {c.name}
              </label>
            ))}
          </fieldset>
        ) : null}

        {warnings.length || total > RECOMMENDED_MAX_PERSONAL_DATA_ACCESS ? (
          <div role="status" className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            {total > RECOMMENDED_MAX_PERSONAL_DATA_ACCESS ? (
              <p>
                Après cet enregistrement, <strong>{total} personnes</strong> auront accès aux dossiers ou aux paiements des
                adhérents. Plus elles sont nombreuses, plus le risque de fuite ou d’erreur augmente.
              </p>
            ) : null}
          </div>
        ) : null}

        <Button type="submit" size="lg" disabled={pending || d.grants.length === 0}>
          {isNew ? 'Envoyer l’invitation' : 'Enregistrer les droits'}
        </Button>
      </form>
    </Dialog>
  );
}
