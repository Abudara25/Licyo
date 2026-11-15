import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';
import './site-directions.css';
import { workerVar } from '@/lib/secrets';

export const metadata: Metadata = {
  icons: { icon: '/favicon.svg' },
  title: {
    default: 'Licyo - Site et gestion pour clubs sportifs',
    template: '%s | Licyo',
  },
  description:
    "Le site internet et le back-office de votre club sportif : inscriptions en ligne, paiements, feuilles d'appel et attestations.",
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // Clé PUBLIQUE Turnstile, lue par le widget (src/components/ui/turnstile.tsx) sans recompiler le site.
    <html lang="fr" data-turnstile-site-key={workerVar('TURNSTILE_SITE_KEY')}>
      <body className="min-h-dvh">
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
