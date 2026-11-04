'use client';
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Bell, type LucideIcon } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Brand } from '@/components/platform/Brand';
export type ShellLink = {
  href: string;
  label: string;
  icon?: LucideIcon;
  glyph?: ReactNode;
};
export function AdminShell({
  title,
  subtitle,
  links,
  footer,
  banner,
  children,
}: {
  title: string;
  subtitle?: string;
  links: ShellLink[];
  footer?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav className="app-nav" aria-label="Navigation de votre espace">
      {links.map(({ href, label, icon: Icon, glyph }, i) => (
        <Link
          href={href}
          key={href}
          aria-current={
            (i === 0 ? path === href : path.startsWith(href))
              ? 'page'
              : undefined
          }
          onClick={() => setOpen(false)}
        >
          {glyph ?? (Icon ? <Icon aria-hidden /> : null)}
          {label}
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Brand />
        <div className="app-workspace">
          <strong>{title}</strong>
          <small>{subtitle ?? 'Votre espace de gestion'}</small>
        </div>
        {nav}
        <div className="app-sidebar-footer">
          {footer ?? 'Licyo · Le club au centre.'}
        </div>
      </aside>
      <div className="min-w-0">
        <header className="app-topbar">
          <strong>{title}</strong>
          <span>Chaque détail compte. Chaque personne aussi.</span>
          <button
            className="app-menu-button"
            onClick={() => setOpen(true)}
            aria-label="Ouvrir le menu"
            aria-expanded={open}
          >
            <Menu size={20} />
          </button>
          <span className="hidden lg:block">
            <Bell size={17} aria-hidden />
          </span>
        </header>
        {banner}
        <main className="page-container app-content">{children}</main>
      </div>
      <Dialog open={open} onOpenChange={setOpen} title={title}>
        <div className="pb-4">{nav}</div>
        {footer}
      </Dialog>
    </div>
  );
}
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="app-page-header flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
