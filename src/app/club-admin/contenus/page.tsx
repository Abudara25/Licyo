import { requireClubContext, createClient, MANAGER_ROLES } from '@/lib/supabase/server';
import { PageHeader } from '@/components/club-admin/AdminShell';
import { ContentManager } from '@/components/club-admin/ContentManager';

export default async function ContentPage() {
  const { club } = await requireClubContext(MANAGER_ROLES);
  const supabase = await createClient();
  const [{ data: posts }, { data: sponsors }, { data: leads }, { data: products }] = await Promise.all([
    supabase.from('posts').select('*').eq('club_id', club.id).order('published_at', { ascending: false }),
    supabase.from('sponsors').select('*').eq('club_id', club.id).order('display_order'),
    supabase.from('sponsor_leads').select('*').eq('club_id', club.id).order('created_at', { ascending: false }).limit(100),
    supabase.from('club_products').select('*').eq('club_id', club.id).order('name'),
  ]);
  return (
    <>
      <PageHeader title="Site et contenus" description="Ce que voient les familles sur le site du club" />
      <ContentManager club={club} posts={posts ?? []} sponsors={sponsors ?? []} leads={leads ?? []} products={products ?? []} />
    </>
  );
}
