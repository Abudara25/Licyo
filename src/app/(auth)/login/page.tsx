import type { Metadata } from 'next';
import Link from 'next/link';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Connexion', robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; erreur?: string }> }) {
  const { next, erreur } = await searchParams;
  // Redirection interne uniquement : jamais vers un autre site.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/club-admin';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mx-auto mb-6 flex min-h-11 w-fit items-center text-2xl font-extrabold">Licyo</Link>
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold">Connexion au back-office</h1>
          <p className="mt-1 text-sm text-muted-foreground">Recevez un lien de connexion par e-mail, sans mot de passe.</p>
          {erreur ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">Le lien a expiré ou n'est plus valable. Demandez-en un nouveau.</p> : null}
          <LoginForm next={safeNext} />
        </div>
      </div>
    </main>
  );
}
