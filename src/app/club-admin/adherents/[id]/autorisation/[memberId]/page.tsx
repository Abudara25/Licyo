import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireClubContext } from '@/lib/db/server';
import { requireModule } from '@/lib/module-access';
import { SIGNER_QUALITIES, parseSignedAuthorization } from '@/config/parental-authorization';
import { PrintButton } from './PrintButton';

type Props = { params: Promise<{ id: string; memberId: string }> };

const dateTime = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });

/** Preuve de l'autorisation parentale : texte exact signé, signataire, date, signature. Imprimable. */
export default async function AuthorizationPage({ params }: Props) {
  await requireModule('inscriptions');
  const { club } = await requireClubContext('members.read');
  const { id, memberId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(memberId)) notFound();
  const { data: m } = await (await createClient())
    .from('members')
    .select('id, person_id, season, first_name, last_name, parental_authorization, signature_data_url')
    .eq('id', memberId)
    .eq('club_id', club.id)
    .eq('person_id', id)
    .maybeSingle();
  const a = m ? parseSignedAuthorization(m.parental_authorization) : null;
  if (!m || !a) notFound();

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      {/* À l'impression : seule la feuille d'autorisation sort (navigation et boutons masqués). */}
      <style>{'@media print { .app-topbar, .app-sidebar, .app-nav, [data-print-hide] { display: none !important; } main { padding: 0 !important; } article { border: 0 !important; } }'}</style>
      <div data-print-hide className="flex flex-wrap gap-2">
        <Link href={`/club-admin/adherents/${id}`} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-medium">
          Retour à la fiche
        </Link>
        <PrintButton />
      </div>
      <article className="grid gap-5 rounded-xl border bg-white p-5 text-sm leading-6 sm:p-8">
        <div className="grid gap-1">
          <p className="text-muted-foreground">{club.name} - saison {m.season}</p>
          <h1 className="text-xl font-bold">
            Autorisation parentale - {m.first_name} {m.last_name}
          </h1>
        </div>
        <p className="whitespace-pre-line">{a.text}</p>
        <dl className="grid gap-1 border-t pt-4 sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="font-medium">Signée par</dt>
          <dd>
            {a.signerName} ({SIGNER_QUALITIES[a.signerQuality]})
          </dd>
          <dt className="font-medium">Le</dt>
          <dd>{dateTime.format(new Date(a.signedAt))}, en ligne, lors de l’inscription</dd>
          {a.templateHash ? (
            <>
              <dt className="font-medium">Empreinte du modèle</dt>
              <dd className="break-all font-mono text-xs text-muted-foreground">{a.templateHash}</dd>
            </>
          ) : null}
        </dl>
        {m.signature_data_url?.startsWith('data:image/png;base64,') ? (
          <figure className="grid gap-1">
            <figcaption className="font-medium">Signature</figcaption>
            {/* eslint-disable-next-line @next/next/no-img-element -- image en ligne (data URL), pas d'optimisation possible */}
            <img src={m.signature_data_url} alt={`Signature de ${a.signerName}`} className="h-28 w-auto max-w-full rounded border bg-white object-contain" />
          </figure>
        ) : null}
      </article>
    </div>
  );
}
