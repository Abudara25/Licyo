import { NextResponse, type NextRequest } from 'next/server';
import { consumeLoginToken, startSession } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/auth/tokens';
import { createAdminClient } from '@/lib/db/admin';

/** Retour des liens de connexion et d'invitation : ouvre la session puis redirige. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const safeNext = safeNextPath(searchParams.get('next'));
  const user = await consumeLoginToken(searchParams.get('token') ?? '');
  if (!user) return NextResponse.redirect(`${origin}/login?erreur=lien`);

  await startSession(user.id);
  const { data: roles } = await createAdminClient().from('staff_members').select('role').eq('user_id', user.id);
  if (roles?.some((r) => r.role === 'super_admin') && safeNext === '/club-admin') {
    return NextResponse.redirect(`${origin}/super-admin`);
  }
  return NextResponse.redirect(`${origin}${safeNext}`);
}
