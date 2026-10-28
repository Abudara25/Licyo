import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-extrabold">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page introuvable</h1>
      <p className="mt-1 text-muted-foreground">Cette page n'existe pas ou n'est plus en ligne.</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-zinc-900 px-5 font-semibold text-white">Retour à l'accueil</Link>
    </main>
  );
}
