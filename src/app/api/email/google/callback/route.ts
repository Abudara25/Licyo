import { NextResponse, type NextRequest } from 'next/server';
import { google } from 'googleapis';
import { getAuthContext } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyValue } from '@/lib/utils/impersonation';
import { encryptSecret } from '@/lib/utils/crypto';
import { appUrl } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * Retour de Google : le state signé désigne le club et l'utilisateur qui a
 * lancé la connexion ; on vérifie qu'il s'agit bien de la session courante.
 */
export async function GET(request: NextRequest) {
  const back = (status: string) => NextResponse.redirect(`${appUrl()}/club-admin/parametres?gmail=${status}`);
  const code = request.nextUrl.searchParams.get('code');
  const parts = await verifyValue(request.nextUrl.searchParams.get('state'), 2);
  if (!code || !parts) return back('erreur');
  const [clubId, userId] = parts;

  const auth = await getAuthContext();
  if (!auth || auth.userId !== userId) return back('erreur');
  const allowed = auth.isSuperAdmin || auth.memberships.some((m) => m.club_id === clubId && ['president', 'secretary'].includes(m.role));
  if (!allowed) return back('refuse');

  try {
    const oauth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, `${appUrl()}/api/email/google/callback`);
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) return back('sans-jeton');
    oauth.setCredentials(tokens);
    const { data: info } = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get();
    const admin = createAdminClient();
    await admin.from('club_mail_credentials').upsert({
      club_id: clubId,
      google_refresh_token_enc: encryptSecret(tokens.refresh_token),
      google_account_email: info.email ?? null,
      updated_at: new Date().toISOString(),
    });
    await admin.from('clubs').update({ email_provider: 'gmail', email_sender_address: info.email ?? null }).eq('id', clubId);
    return back('ok');
  } catch (error) {
    console.error('[gmail] connexion', error instanceof Error ? error.message : error);
    return back('erreur');
  }
}
