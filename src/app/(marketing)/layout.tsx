import Link from 'next/link';
import { Brand } from '@/components/platform/Brand';
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="marketing">
      <header className="marketing-header">
        <div className="page-container">
          <Brand />
          <nav aria-label="Navigation principale">
            <Link className="desktop-link" href="/#fonctionnalites">
              La plateforme
            </Link>
            <Link className="desktop-link" href="/modeles">
              Les modèles
            </Link>
            <Link href="/tarifs">Tarifs</Link>
            <Link href="/login">Connexion</Link>
            <Link className="pill-button small desktop-link" href="/commencer">
              Créer mon club ↗
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="marketing-footer">
        <div className="page-container">
          <div>
            <Brand />
            <p>
              Moins de gestion.
              <br />
              Plus de vie dans votre club.
            </p>
          </div>
          <div>
            <b>Votre prochain chapitre</b>
            <Link href="/commencer">Créer mon espace club</Link>
            <Link href="/modeles">Choisir un modèle</Link>
            <Link href="/espace-adherent">Espace adhérent</Link>
          </div>
          <div>
            <b>La plateforme</b>
            <Link href="/tarifs">Une offre à votre taille</Link>
            <Link href="/decouvrir/club">Découvrir le back-office</Link>
            <Link href="/login?next=/super-admin">Administration Licyo</Link>
          </div>
        </div>
        <div className="page-container footer-bottom">
          <span>© {new Date().getFullYear()} Licyo</span>
          <span>Pour tous les sports. Pour chaque association.</span>
        </div>
      </footer>
    </div>
  );
}
