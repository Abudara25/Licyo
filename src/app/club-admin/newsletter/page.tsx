import { createClient, requireClubContext } from '@/lib/db/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { NewsletterComposer, NewsletterHistory, type NewsletterItem } from '@/components/club-admin/NewsletterComposer';
import { parseAudience } from '@/lib/newsletter';

type Props = { searchParams: Promise<{ brouillon?: string }> };

/** Newsletter aux familles : rédaction, public, envoi immédiat ou programmé, historique. */
export default async function NewsletterPage({ searchParams }: Props) {
  const { club } = await requireClubContext('communication.manage');
  const { brouillon } = await searchParams;
  const db = await createClient();
  const [{ data: rows }, { data: categories }, { count: unsubscribed }] = await Promise.all([
    db.from('newsletters').select('*').eq('club_id', club.id).order('created_at', { ascending: false }).limit(50),
    db.from('categories').select('id, name').eq('club_id', club.id).order('display_order'),
    db.from('newsletter_unsubscribes').select('email', { count: 'exact', head: true }).eq('club_id', club.id),
  ]);
  const items: NewsletterItem[] = (rows ?? []).map((n) => ({
    id: n.id,
    subject: n.subject,
    body: n.body,
    audience: parseAudience(n.audience),
    status: n.status,
    sendAt: n.send_at,
    recipientCount: n.recipient_count,
    sentCount: n.sent_count,
    failedCount: n.failed_count,
    createdAt: n.created_at,
  }));
  const draft = brouillon ? (items.find((i) => i.id === brouillon && i.status === 'draft') ?? null) : null;

  return (
    <>
      <PageHeader
        title="Newsletter"
        description={`Informez les familles du club. ${unsubscribed ?? 0} adresse${(unsubscribed ?? 0) > 1 ? 's' : ''} désinscrite${(unsubscribed ?? 0) > 1 ? 's' : ''}, toujours exclue${(unsubscribed ?? 0) > 1 ? 's' : ''}.`}
      />
      <div className="grid gap-6">
        <NewsletterComposer key={draft?.id ?? 'nouveau'} categories={categories ?? []} initial={draft} />
        <NewsletterHistory items={items} />
      </div>
    </>
  );
}
