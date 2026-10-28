import Link from 'next/link';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-white/90 backdrop-blur">
        <div className="page-container flex min-h-16 items-center justify-between gap-3">
          <Link href="/" className="flex min-h-11 items-center text-xl font-extrabold">Licyo</Link>
          <nav aria-label="Navigation principale" className="flex items-center gap-1 text-sm font-medium">
            <Link href="/#fonctionnalites" className="hidden min-h-11 items-center rounded-lg px-3 hover:bg-accent sm:flex">Fonctionnalités</Link>
            <Link href="/tarifs" className="flex min-h-11 items-center rounded-lg px-3 hover:bg-accent">Tarifs</Link>
            <Link href="/login" className="flex min-h-11 items-center rounded-lg bg-zinc-900 px-4 text-white hover:bg-zinc-700">Connexion</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-zinc-50">
        <div className="page-container flex flex-wrap justify-between gap-3 py-8 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Licyo - Le site et la gestion des clubs sportifs.</p>
          <p>Données hébergées dans l'Union européenne - Aucun cookie publicitaire.</p>
        </div>
      </footer>
    </div>
  );
}
