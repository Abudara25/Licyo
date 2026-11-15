import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/db/admin';
import { unsubscribeTokenHash } from '@/lib/newsletter';
import { UnsubscribeButton } from './UnsubscribeButton';

export const metadata: Metadata = { title: 'Newsletter - désinscription', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ token: string }> };

/** Confirmation de désinscription (le lien seul ne désinscrit pas : un robot qui ouvre le lien ne suffit pas). */
export default async function UnsubscribePage({ params }: Props) {
  const { token } = await params;
  const valid = token.length > 10 && token.length <= 100;
  const { data: delivery } = valid
    ? await createAdminClient().from('newsletter_deliveries').select('club_id, email').eq('unsubscribe_token_hash', await unsubscribeTokenHash(token)).maybeSingle()
    : { data: null };
  const { data: club } = delivery ? await createAdminClient().from('clubs').select('name').eq('id', delivery.club_id).maybeSingle() : { data: null };

  return (
    <main className="mx-auto grid min-h-dvh max-w-lg content-center gap-4 px-4 py-10">
      {delivery && club ? (
        <>
          <h1 className="text-2xl font-bold">Ne plus recevoir la newsletter</h1>
          <p>
            Adresse : <strong className="break-all">{delivery.email}</strong>
            <br />
            Club : <strong>{club.name}</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Vous continuerez à recevoir les messages utiles à votre inscription (dossier, paiement, convocations).
          </p>
          <UnsubscribeButton token={token} />
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold">Lien non valable</h1>
          <p>Ce lien de désinscription est inconnu. Contactez directement le club pour ne plus recevoir sa newsletter.</p>
        </>
      )}
    </main>
  );
}
