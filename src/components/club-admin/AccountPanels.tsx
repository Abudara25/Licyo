'use client';

import { useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import {
  inviteStaff,
  openBillingPortal,
  purgeOldSeasons,
  refreshStripeConnectStatus,
  removeStaff,
  setCustomDomain,
  startStripeConnect,
  startSubscriptionCheckout,
} from '@/actions/club-admin.actions';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { Dialog } from '@/components/ui/dialog';
import type { StaffMember } from '@/types/database';
import { useAction } from './useAction';

const ROLE_LABELS = { president: 'Président(e)', secretary: 'Secrétaire', treasurer: 'Trésorier(e)', coach: 'Éducateur / coach', super_admin: 'Administrateur Licyo' } as const;

function go(fn: () => Promise<{ ok: boolean; data?: { url: string }; error?: string }>) {
  return async () => {
    const res = await fn();
    if (res.ok && res.data?.url) window.location.href = res.data.url;
    return res;
  };
}

export function BillingPanel({ plan, status, hasCustomer, connectAccount, connectOnboarded, siteUrl, customDomain, stripeReturn }: {
  plan: string;
  status: string;
  hasCustomer: boolean;
  connectAccount: boolean;
  connectOnboarded: boolean;
  siteUrl: string;
  customDomain: string | null;
  stripeReturn?: string;
}) {
  const { pending, run } = useAction();
  const [domain, setDomain] = useState(customDomain ?? '');
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Abonnement" description={`Offre ${plan === 'integral' ? 'Intégral' : 'Vitrine'}`} action={<Badge tone={status === 'active' ? 'success' : status === 'demo' ? 'info' : 'warning'}>{status === 'active' ? 'Actif' : status === 'demo' ? 'Démo' : status}</Badge>} />
        <CardBody className="flex flex-wrap gap-2">
          {hasCustomer ? (
            <Button variant="outline" disabled={pending} onClick={() => run(go(openBillingPortal))}>Gérer l'abonnement et les factures</Button>
          ) : (
            <>
              <Button disabled={pending} onClick={() => run(go(() => startSubscriptionCheckout('integral')))}>S'abonner à Intégral</Button>
              <Button variant="outline" disabled={pending} onClick={() => run(go(() => startSubscriptionCheckout('vitrine')))}>S'abonner à Vitrine</Button>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Paiement en ligne des cotisations" description="Compte Stripe du club : l'argent arrive directement sur son compte bancaire" action={connectOnboarded ? <Badge tone="success">Activé</Badge> : undefined} />
        <CardBody className="grid gap-2">
          {stripeReturn ? <p className="text-sm text-muted-foreground">Retour de Stripe : vérifiez l'état ci-dessous.</p> : null}
          {connectOnboarded ? (
            <p className="text-sm">Les familles peuvent payer par carte. Activez « Paiement par carte » dans les modules si besoin.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={() => run(go(startStripeConnect))}>{connectAccount ? 'Reprendre la configuration Stripe' : 'Activer le paiement par carte'}</Button>
              {connectAccount ? <Button variant="outline" disabled={pending} onClick={() => run(refreshStripeConnectStatus)}>Vérifier l'état</Button> : null}
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader title="Adresse du site" description={siteUrl} />
        <CardBody>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); run(() => setCustomDomain(domain)); }}>
            <Field id="dom" label="Nom de domaine du club (facultatif)" hint="Ex. www.monclub.fr - laissez vide pour utiliser l'adresse Licyo." className="min-w-0 flex-1">
              <Input id="dom" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="www.monclub.fr" autoCapitalize="none" />
            </Field>
            <Button type="submit" variant="outline" disabled={pending}>Enregistrer</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

export function StaffPanel({ staff, currentUserId, canManage, categories }: { staff: StaffMember[]; currentUserId: string; canManage: boolean; categories: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ email: '', fullName: '', role: 'coach', categoryIds: [] as string[] });
  const { pending, run } = useAction();
  return (
    <Card>
      <CardHeader title="Équipe du club" description="Accès au back-office" action={canManage ? <Button size="sm" onClick={() => setOpen(true)}><UserPlus aria-hidden /> Inviter</Button> : undefined} />
      <ul className="divide-y">
        {staff.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{s.full_name}</p>
              <p className="truncate text-sm text-muted-foreground">{s.email} - {ROLE_LABELS[s.role]}</p>
            </div>
            {canManage && s.user_id !== currentUserId ? (
              <Button size="icon" variant="ghost" aria-label={`Retirer ${s.full_name}`} onClick={() => confirm(`Retirer l'accès de ${s.full_name} ?`) && run(() => removeStaff(s.id))}><Trash2 aria-hidden /></Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog open={open} onOpenChange={setOpen} title="Inviter un membre du bureau" description="Un e-mail de connexion lui est envoyé.">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => inviteStaff(v), () => { setOpen(false); setV({ email: '', fullName: '', role: 'coach', categoryIds: [] }); }); }}>
          <Field id="iv-n" label="Nom et prénom"><Input id="iv-n" required value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} /></Field>
          <Field id="iv-e" label="E-mail"><Input id="iv-e" type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
          <Field id="iv-r" label="Rôle">
            <Select id="iv-r" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
              {(['president', 'secretary', 'treasurer', 'coach'] as const).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          {v.role === 'coach' && categories.length ? (
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Groupes encadrés (feuille d'appel)</legend>
              {categories.map((c) => (
                <label key={c.id} className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5" checked={v.categoryIds.includes(c.id)} onChange={(e) => setV({ ...v, categoryIds: e.target.checked ? [...v.categoryIds, c.id] : v.categoryIds.filter((x) => x !== c.id) })} />
                  {c.name}
                </label>
              ))}
            </fieldset>
          ) : null}
          <Button type="submit" size="lg" disabled={pending}>Envoyer l'invitation</Button>
        </form>
      </Dialog>
    </Card>
  );
}

export function RgpdPanel({ canManage, keepFrom }: { canManage: boolean; keepFrom: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const { pending, run } = useAction();
  return (
    <Card className="border-red-200">
      <CardHeader title="Données personnelles (RGPD)" description={`Supprime les dossiers, adhérents et pièces des saisons antérieures à ${keepFrom}.`} />
      <CardBody>
        <Button variant="destructive" disabled={!canManage} onClick={() => setOpen(true)}>Purger les anciennes saisons</Button>
        {!canManage ? <p className="mt-2 text-xs text-muted-foreground">Réservé au président.</p> : null}
      </CardBody>
      <Dialog open={open} onOpenChange={setOpen} title="Purger les anciennes saisons" description="Suppression définitive : fiches, dossiers, règlements et pièces justificatives.">
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); run(() => purgeOldSeasons(confirmation), () => { setOpen(false); setConfirmation(''); }); }}>
          <Field id="rg" label="Tapez SUPPRIMER pour confirmer"><Input id="rg" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /></Field>
          <Button type="submit" variant="destructive" size="lg" disabled={pending || confirmation !== 'SUPPRIMER'}>Supprimer définitivement</Button>
        </form>
      </Dialog>
    </Card>
  );
}
