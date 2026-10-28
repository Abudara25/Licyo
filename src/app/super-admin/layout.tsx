import type { Metadata } from 'next';
import { requireSuperAdmin } from '@/lib/supabase/server';
import { signOut } from '@/actions/club-admin.actions';
import { SuperAdminNav } from '@/components/super-admin/SuperAdminNav';

export const metadata: Metadata = { title: 'Pilotage', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireSuperAdmin();
  return (
    <SuperAdminNav email={auth.email} signOutAction={signOut}>
      {children}
    </SuperAdminNav>
  );
}
