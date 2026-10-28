'use client';

import { useState } from 'react';
import { CheckCircle2, Mail, Server, Sparkles } from 'lucide-react';
import { disconnectEmailAccount, saveSmtpSettings, sendTestEmail, selectEmailProvider } from '@/actions/club-admin.actions';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge, Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { cn } from '@/lib/utils/cn';
import type { EmailProvider } from '@/types/database';
import { useAction } from './useAction';

/**
 * Trois façons d'envoyer les e-mails du club :
 * plateforme (par défaut), Gmail du club (OAuth), ou serveur SMTP du club.
 */
export function EmailIntegrationSettings({
  provider,
  contactEmail,
  gmailAccount,
  hasSmtp,
  smtpUser,
  gmailStatus,
}: {
  provider: EmailProvider;
  contactEmail: string;
  gmailAccount: string | null;
  hasSmtp: boolean;
  smtpUser: string | null;
  gmailStatus?: string;
}) {
  const [smtp, setSmtp] = useState({ host: '', port: '465', user: smtpUser ?? '', pass: '' });
  const { pending, run } = useAction();
  const messages: Record<string, string> = {
    ok: 'Gmail connecté : les e-mails partent désormais de votre adresse.',
    erreur: 'La connexion à Gmail a échoué. Réessayez.',
    refuse: 'Seuls le président et le secrétaire peuvent connecter Gmail.',
    'sans-jeton': 'Google n\'a pas fourni d\'autorisation durable. Retirez l\'accès de Licyo dans votre compte Google puis réessayez.',
    indisponible: 'La connexion Gmail n\'est pas encore activée sur la plateforme.',
  };

  const Option = ({ value, icon: Icon, title, children }: { value: EmailProvider; icon: typeof Mail; title: string; children: React.ReactNode }) => (
    <div className={cn('rounded-xl border p-4', provider === value && 'border-emerald-500 bg-emerald-50')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold"><Icon className="size-5" aria-hidden /> {title}</p>
        {provider === value ? <Badge tone="success"><CheckCircle2 className="mr-1 size-3.5" aria-hidden />Utilisé</Badge> : null}
      </div>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );

  return (
    <Card>
      <CardHeader title="Envoi des e-mails" description="Confirmations d'inscription, liens de correction, convocations" action={<Button variant="outline" size="sm" disabled={pending} onClick={() => run(sendTestEmail)}>Envoyer un test</Button>} />
      <CardBody className="grid gap-3">
        {gmailStatus && messages[gmailStatus] ? (
          <p role="status" className={cn('rounded-lg p-3 text-sm', gmailStatus === 'ok' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900')}>{messages[gmailStatus]}</p>
        ) : null}

        <Option value="platform" icon={Sparkles} title="Serveur Licyo (par défaut)">
          <p className="text-muted-foreground">Aucun réglage. Les familles qui répondent écrivent à {contactEmail}.</p>
          {provider !== 'platform' ? <Button className="mt-2" size="sm" variant="outline" disabled={pending} onClick={() => run(() => selectEmailProvider('platform'))}>Utiliser</Button> : null}
        </Option>

        <Option value="gmail" icon={Mail} title="Votre adresse Gmail">
          {gmailAccount ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>Connecté : <strong>{gmailAccount}</strong></span>
              {provider !== 'gmail' ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => selectEmailProvider('gmail'))}>Utiliser</Button> : null}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => disconnectEmailAccount('gmail'))}>Déconnecter</Button>
            </div>
          ) : (
            <>
              <p className="text-muted-foreground">Les e-mails partent de l'adresse Gmail du club, et apparaissent dans ses « Messages envoyés ».</p>
              <a href="/api/email/google/start" className={buttonVariants({ size: 'sm', className: 'mt-2' })}>Connecter Gmail</a>
            </>
          )}
        </Option>

        <Option value="smtp" icon={Server} title="Serveur de messagerie du club (OVH, Infomaniak…)">
          {hasSmtp ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span>Configuré pour <strong>{smtpUser}</strong></span>
              {provider !== 'smtp' ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => selectEmailProvider('smtp'))}>Utiliser</Button> : null}
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => disconnectEmailAccount('smtp'))}>Supprimer</Button>
            </div>
          ) : null}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => saveSmtpSettings(smtp), () => setSmtp({ ...smtp, pass: '' })); }}>
            <Field id="smtp-h" label="Serveur SMTP" hint="Ex. ssl0.ovh.net"><Input id="smtp-h" required value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} autoComplete="off" /></Field>
            <Field id="smtp-p" label="Port">
              <Select id="smtp-p" value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })}>
                <option value="465">465 (SSL)</option><option value="587">587 (STARTTLS)</option>
              </Select>
            </Field>
            <Field id="smtp-u" label="Adresse e-mail"><Input id="smtp-u" type="email" required value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} autoComplete="off" /></Field>
            <Field id="smtp-w" label="Mot de passe" hint="Stocké chiffré, jamais réaffiché."><Input id="smtp-w" type="password" required value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} autoComplete="new-password" /></Field>
            <Button type="submit" variant="outline" className="sm:col-span-2" disabled={pending}>{hasSmtp ? 'Mettre à jour' : 'Enregistrer'}</Button>
          </form>
        </Option>
      </CardBody>
    </Card>
  );
}
