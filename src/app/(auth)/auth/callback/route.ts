import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/** Retour des liens e-mail Supabase (connexion, invitation) : ouvre la session puis redirige. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get('next') ?? '/club-admin';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/club-admin';
  const supabase = await createClient();

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error('Lien incomplet') };

  if (error) return NextResponse.redirect(`${origin}/login?erreur=lien`);

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: roles } = await supabase.from('staff_members').select('role').eq('user_id', user.id);
    if (roles?.some((r) => r.role === 'super_admin') && safeNext === '/club-admin') return NextResponse.redirect(`${origin}/super-admin`);
  }
  return NextResponse.redirect(`${origin}${safeNext}`);
}
