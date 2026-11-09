import { NextResponse, type NextRequest } from 'next/server';
import { getAuthContext } from '@/lib/db/server';
import { createAdminClient } from '@/lib/db/admin';
import { verifyValue } from '@/lib/utils/impersonation';
import { encryptSecret } from '@/lib/utils/crypto';
import { exchangeCode, googleAccountEmail } from '@/lib/email/google';
import { appUrl } from '@/lib/env';

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
    const tokens = await exchangeCode(code, `${appUrl()}/api/email/google/callback`);
    if (!tokens.refresh_token) return back('sans-jeton');
    const email = await googleAccountEmail(tokens.access_token);
    const admin = createAdminClient();
    await admin.from('club_mail_credentials').upsert({
      club_id: clubId,
      google_refresh_token_enc: encryptSecret(tokens.refresh_token),
      google_account_email: email,
      updated_at: new Date().toISOString(),
    });
    await admin.from('clubs').update({ email_provider: 'gmail', email_sender_address: email }).eq('id', clubId);
    return back('ok');
  } catch (error) {
    console.error('[gmail] connexion', error instanceof Error ? error.message : error);
    return back('erreur');
  }
}
