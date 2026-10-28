'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import type { NavLink } from './nav';

export function ClubHeader({
  name,
  logoUrl,
  prefix,
  links,
  showRegister,
  isDemo,
}: {
  name: string;
  logoUrl: string | null;
  prefix: string;
  links: NavLink[];
  showRegister: boolean;
  isDemo: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 bg-club-primary text-club-primary-fg shadow">
      {isDemo ? (
        <p className="bg-black/80 px-4 py-1 text-center text-xs text-white">Site de démonstration - les informations sont des exemples.</p>
      ) : null}
      <div className="page-container flex min-h-16 items-center justify-between gap-3">
        <Link href={prefix || '/'} className="flex min-h-11 min-w-0 items-center gap-3 font-bold">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-white object-contain p-0.5" />
          ) : (
            <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-club-secondary text-lg text-club-secondary-fg">
              {name.charAt(0)}
            </span>
          )}
          <span className="truncate text-base md:text-lg">{name}</span>
        </Link>

        <nav aria-label="Navigation principale" className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-black/10">
              {l.label}
            </Link>
          ))}
          {showRegister ? (
            <Link href={`${prefix}/inscription`} className="ml-2 inline-flex min-h-11 items-center rounded-lg bg-club-secondary px-4 text-sm font-semibold text-club-secondary-fg">
              S'inscrire
            </Link>
          ) : null}
        </nav>

        <button
          type="button"
          className="flex size-11 items-center justify-center rounded-lg hover:bg-black/10 lg:hidden"
          aria-expanded={open}
          aria-controls="menu-mobile"
          aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>
      {open ? (
        <nav id="menu-mobile" aria-label="Navigation mobile" className="border-t border-white/20 lg:hidden">
          <ul className="page-container flex flex-col py-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-lg px-2 font-medium hover:bg-black/10">
                  {l.label}
                </Link>
              </li>
            ))}
            {showRegister ? (
              <li className="pb-2 pt-1">
                <Link href={`${prefix}/inscription`} onClick={() => setOpen(false)} className="flex min-h-12 items-center justify-center rounded-lg bg-club-secondary font-semibold text-club-secondary-fg">
                  S'inscrire
                </Link>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
