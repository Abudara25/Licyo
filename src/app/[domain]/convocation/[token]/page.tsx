import type { Metadata } from 'next';
import { loadClubOr404 } from '@/lib/tenant';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageTitle } from '@/components/vitrine/PageTitle';
import { ConvocationResponse } from '@/components/vitrine/PublicForms';

type Props = { params: Promise<{ domain: string; token: string }> };

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function ConvocationPage({ params }: Props) {
  const { domain, token } = await params;
  const { club } = await loadClubOr404(domain);
  const admin = createAdminClient();
  const { data: convocation } = /^[0-9a-f-]{36}$/i.test(token)
    ? await admin.from('event_convocations').select('*').eq('club_id', club.id).eq('response_token', token).maybeSingle()
    : { data: null };
  const [{ data: event }, { data: member }] = convocation
    ? await Promise.all([
        admin.from('events').select('title, event_date, location_text').eq('id', convocation.event_id).single(),
        admin.from('members').select('first_name').eq('id', convocation.member_id).single(),
      ])
    : [{ data: null }, { data: null }];

  return (
    <>
      <PageTitle title="Convocation" />
      <div className="page-container mt-8 max-w-xl">
        {convocation && event && member ? (
          <div className="rounded-2xl border bg-white p-5">
            <p className="text-lg"><strong>{member.first_name}</strong> est convoqué(e) :</p>
            <p className="mt-2 text-xl font-bold">{event.title}</p>
            <p className="text-muted-foreground">
              {new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(event.event_date))}
              {event.location_text ? ` - ${event.location_text}` : ''}
            </p>
            <div className="mt-5">
              <ConvocationResponse token={token} current={convocation.response_status} />
            </div>
          </div>
        ) : (
          <p className="rounded-xl bg-muted p-4">Convocation introuvable.</p>
        )}
      </div>
    </>
  );
}
