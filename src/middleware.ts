import { NextResponse, type NextRequest } from 'next/server';

const RESERVED_SUBDOMAINS = new Set(['www', 'app', 'admin', 'api']);

function rootHost(): string {
  return (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'localhost:3000').toLowerCase();
}

/** Hôte de la plateforme (marketing, back-offices, API) plutôt que d'un club. */
function isPlatformHost(host: string): boolean {
  const root = rootHost();
  return host === root || host === `www.${root}` || host.startsWith('127.0.0.1') || host.startsWith('localhost');
}

export function middleware(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase();
  const { pathname, search } = request.nextUrl;

  // La session est vérifiée côté serveur à chaque requête (cookie opaque + D1) :
  // rien à rafraîchir ici.
  if (isPlatformHost(host)) return NextResponse.next();

  // API, fichiers et assets restent communs à tous les hôtes.
  if (pathname.startsWith('/api/') || pathname.startsWith('/_next/') || pathname.startsWith('/media/')) {
    return NextResponse.next();
  }

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
