import 'server-only';
import { getClubContext } from '@/lib/db/server';
import { moduleEnabled } from '@/lib/platform';
import { redirect } from 'next/navigation';
export async function requireModule(id: string) {
  const ctx = await getClubContext();
  if (!ctx) redirect('/login');
  if (!moduleEnabled(ctx.club.enabled_modules, id))
    redirect('/club-admin?erreur=module');
  return ctx;
}
