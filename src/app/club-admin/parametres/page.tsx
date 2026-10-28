import { requireClubContext, createClient, MANAGER_ROLES } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { clubSiteUrl } from '@/lib/env';
import { previousSeason } from '@/lib/season';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ClubSettingsForm } from '@/components/club-admin/ClubSettingsForm';
import { EmailIntegrationSettings } from '@/components/club-admin/EmailIntegrationSettings';
import { BillingPanel, RgpdPanel, StaffPanel } from '@/components/club-admin/AccountPanels';

type Props = { searchParams: Promise<{ gmail?: string; stripe?: string }> };

export default async function SettingsPage({ searchParams }: Props) {
  const { gmail, stripe } = await searchParams;
  const ctx = await requireClubContext(MANAGER_ROLES);
  const { club } = ctx;
  const supabase = await createClient();
  const [{ data: staff }, { data: categories }, { data: creds }] = await Promise.all([
    supabase.from('staff_members').select('*').eq('club_id', club.id).order('full_name'),
    supabase.from('categories').select('id, name').eq('club_id', club.id).order('display_order'),
    // Seuls des indicateurs non sensibles sortent de cette table (jamais les secrets).
    createAdminClient().from('club_mail_credentials').select('google_account_email, smtp_settings_enc').eq('club_id', club.id).maybeSingle(),
  ]);
  const isPresident = ctx.role === 'president' || ctx.role === 'super_admin';

  return (
    <>
      <PageHeader title="Paramètres" description={club.name} />
      <div className="grid gap-6">
        <ClubSettingsForm club={club} />
        <EmailIntegrationSettings
          provider={club.email_provider}
          contactEmail={club.contact_email}
          gmailAccount={creds?.google_account_email ?? null}
          hasSmtp={Boolean(creds?.smtp_settings_enc)}
          smtpUser={club.email_provider === 'smtp' ? club.email_sender_address : creds?.smtp_settings_enc ? club.email_sender_address : null}
          gmailStatus={gmail}
        />
        <BillingPanel
          plan={club.subscription_plan}
          status={club.status}
          hasCustomer={Boolean(club.stripe_customer_id)}
          connectAccount={Boolean(club.stripe_connect_account_id)}
          connectOnboarded={club.stripe_connect_onboarded}
          siteUrl={clubSiteUrl(club)}
          customDomain={club.custom_domain}
          stripeReturn={stripe}
        />
        <StaffPanel staff={staff ?? []} currentUserId={ctx.auth.userId} canManage={isPresident} categories={categories ?? []} />
        <RgpdPanel canManage={isPresident} keepFrom={previousSeason(club.current_season)} />
      </div>
    </>
  );
}
