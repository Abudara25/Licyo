import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api']);

function rootHost(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000').toLowerCase();
}

/** Hôte de la plateforme (marketing, back-offices, API) plutôt que d'un club. */
function isPlatformHost(host: string): boolean {
  const root = rootHost();
  return host === root || host === `www.${root}` || host.startsWith('127.0.0.1');
}

/** Rafraîchit la session Supabase (cookies) pour les espaces authentifiés. */
async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export async function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  const { pathname, search } = request.nextUrl;

  if (isPlatformHost(host)) {
    if (pathname.startsWith('/club-admin') || pathname.startsWith('/super-admin') || pathname.startsWith('/login') || pathname.startsWith('/auth')) {
      return refreshSession(request);
    }
    return NextResponse.next();
  }

  // Les API et assets restent communs à tous les hôtes.
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/')) return NextResponse.next();

  const root = rootHost();
  if (host.endsWith(`.${root}`)) {
    const sub = host.slice(0, -(root.length + 1));
    if (RESERVED_SUBDOMAINS.has(sub)) return NextResponse.redirect(new URL(`${pathname}${search}`, `${request.nextUrl.protocol}//${root}`));
  }

  // Sous-domaine ou domaine personnalisé : on réécrit vers /[domain]/…
  // Le chemin n'est pas modifiable par l'utilisateur pour viser un autre club : l'hôte fait foi.
  const rewritten = request.nextUrl.clone();
  rewritten.pathname = `/${encodeURIComponent(host)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.rewrite(rewritten);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
