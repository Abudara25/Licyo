'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ShellLink = { href: string; label: string; icon: LucideIcon };

/** Coquille commune aux deux back-offices : barre latérale (bureau) ou tiroir (mobile). */
export function AdminShell({ title, subtitle, links, footer, banner, children }: { title: string; subtitle?: string; links: ShellLink[]; footer?: ReactNode; banner?: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === links[0]?.href ? pathname === href : pathname.startsWith(href));

  const nav = (
    <nav aria-label="Navigation du back-office" className="flex flex-1 flex-col gap-1 p-3">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          onClick={() => setOpen(false)}
          aria-current={isActive(href) ? 'page' : undefined}
          className={cn('flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-white/10', isActive(href) && 'bg-white/15 text-white')}
        >
          <Icon className="size-5 shrink-0" aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-zinc-50 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="hidden flex-col bg-zinc-950 text-zinc-300 lg:sticky lg:top-0 lg:flex lg:h-dvh">
        <div className="border-b border-white/10 p-4">
          <p className="truncate font-bold text-white">{title}</p>
          {subtitle ? <p className="truncate text-xs text-zinc-400">{subtitle}</p> : null}
        </div>
        {nav}
        {footer ? <div className="border-t border-white/10 p-3">{footer}</div> : null}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-3 bg-zinc-950 px-4 text-white lg:hidden">
          <p className="truncate font-bold">{title}</p>
          <button type="button" onClick={() => setOpen(true)} className="flex size-11 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Ouvrir le menu" aria-expanded={open}>
            <Menu className="size-6" />
          </button>
        </header>
        {open ? (
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" className="absolute inset-0 bg-black/50" aria-label="Fermer le menu" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-zinc-950 text-zinc-300 safe-bottom">
              <div className="flex items-center justify-between border-b border-white/10 p-3">
                <p className="truncate pl-1 font-bold text-white">{title}</p>
                <button type="button" onClick={() => setOpen(false)} className="flex size-11 items-center justify-center rounded-lg hover:bg-white/10" aria-label="Fermer le menu">
                  <X className="size-6" />
                </button>
              </div>
              {nav}
              {footer ? <div className="border-t border-white/10 p-3">{footer}</div> : null}
            </div>
          </div>
        ) : null}
        {banner}
        <main className="page-container py-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
