import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getClubContext } from '@/lib/supabase/server';
import { signValue } from '@/lib/utils/impersonation';
import { appUrl } from '@/lib/env';

export const runtime = 'nodejs';

/** Bouton « Connecter Gmail » : redirige vers Google avec un state signé (club + utilisateur). */
export async function GET() {
  const ctx = await getClubContext();
  if (!ctx || !['president', 'secretary', 'super_admin'].includes(ctx.role)) {
    return NextResponse.redirect(`${appUrl()}/club-admin/parametres?gmail=refuse`);
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(`${appUrl()}/club-admin/parametres?gmail=indisponible`);
  }
  const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${appUrl()}/api/email/google/callback`);
  const state = await signValue([ctx.club.id, ctx.auth.userId], 600);
  const url = oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // garantit un refresh token même si le compte a déjà autorisé l'application
    scope: ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'],
    state,
  });
  return NextResponse.redirect(url);
}
