'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Building2,
  Users,
  CreditCard,
  ShieldCheck,
  Wand2,
  FileUp,
  Menu,
  X,
  ArrowUpRight,
} from 'lucide-react';
const links = [
  ['/super-admin', 'Centre de contrôle', Activity],
  ['/super-admin/clubs', 'Parc clients', Building2],
  ['/super-admin/crm', 'Pipeline commercial', Users],
  ['/super-admin/offres', 'Offres et abonnements', CreditCard],
  ['/super-admin/demo-generator', 'Création de démos', Wand2],
  ['/super-admin/import', 'Import de clients', FileUp],
  ['/super-admin/audit', 'Journal de contrôle', ShieldCheck],
] as const;
export function ControlShell({
  children,
  email = 'Direction Licyo',
  footer,
  preview = false,
  previewView = 0,
}: {
  children: ReactNode;
  email?: string;
  footer?: ReactNode;
  preview?: boolean;
  previewView?: number;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <div className="control-shell">
      <header className="control-mobile">
        <Link href={preview ? '/decouvrir/pilotage' : '/super-admin'}>
          LICYO <small>CONTROL</small>
        </Link>
        <button
          aria-label={open ? 'Fermer la navigation' : 'Ouvrir la navigation'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </header>
      <aside className={'control-sidebar ' + (open ? 'is-open' : '')}>
        <Link
          className="control-logo"
          href={preview ? '/decouvrir/pilotage' : '/super-admin'}
        >
          L
          <span>
            LICYO<small>CONTROL CENTER</small>
          </span>
        </Link>
        <div className="control-scope">
          <span className="control-dot" />
          Administration plateforme<small>Accès propriétaire</small>
        </div>
        <nav aria-label="Pilotage central">
          <p>SUPERVISION</p>
          {links.map(([href, label, Icon], i) => (
            <Link
              key={href}
              href={preview ? '/decouvrir/pilotage?vue=' + i : href}
              className={
                (
                  preview
                    ? previewView === i
                    : path === href ||
                      (href != '/super-admin' && path.startsWith(href))
                )
                  ? 'active'
                  : ''
              }
              onClick={() => setOpen(false)}
            >
              <Icon size={18} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="control-operator">
          <span>COMPTE ADMINISTRATEUR</span>
          <strong>{email}</strong>
          {footer}
          <Link href="/decouvrir/club">
            Aperçu de l’espace club <ArrowUpRight size={15} />
          </Link>
        </div>
      </aside>
      <div className="control-body">
        <div className="control-topbar">
          <span>PLATEFORME / SUPERVISION</span>
          <span>
            <ShieldCheck size={15} /> Accès restreint
          </span>
        </div>
        {preview ? (
          <div className="control-demo">
            Démonstration · données fictives · aucune modification enregistrée
          </div>
        ) : null}
        <main className="control-main">{children}</main>
      </div>
    </div>
  );
}
