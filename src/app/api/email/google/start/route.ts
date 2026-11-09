import { NextResponse } from 'next/server';
import { getClubContext } from '@/lib/db/server';
import { signValue } from '@/lib/utils/impersonation';
import { googleAuthUrl } from '@/lib/email/google';
import { appUrl } from '@/lib/env';

/** Bouton « Connecter Gmail » : redirige vers Google avec un state signé (club + utilisateur). */
export async function GET() {
  const ctx = await getClubContext();
  if (!ctx || !['president', 'secretary', 'super_admin'].includes(ctx.role)) {
    return NextResponse.redirect(`${appUrl()}/club-admin/parametres?gmail=refuse`);
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(`${appUrl()}/club-admin/parametres?gmail=indisponible`);
  }
  const state = await signValue([ctx.club.id, ctx.auth.userId], 600);
  return NextResponse.redirect(googleAuthUrl(`${appUrl()}/api/email/google/callback`, state));
}
