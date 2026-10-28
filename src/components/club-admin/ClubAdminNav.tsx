'use client';

import type { ReactNode } from 'react';
import { ClipboardCheck, ExternalLink, FileText, Home, LogOut, Newspaper, Settings, Trophy, Wallet } from 'lucide-react';
import { AdminShell, type ShellLink } from './AdminShell';
import type { StaffRole } from '@/types/database';

export function ClubAdminNav({
  clubName,
  subtitle,
  role,
  siteUrl,
  attendanceEnabled,
  banner,
  signOutAction,
  children,
}: {
  clubName: string;
  subtitle: string;
  role: StaffRole;
  siteUrl: string;
  attendanceEnabled: boolean;
  banner: ReactNode;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const manager = role !== 'coach';
  const links: ShellLink[] = [
    { href: '/club-admin', label: 'Tableau de bord', icon: Home },
    ...(manager ? [{ href: '/club-admin/inscriptions', label: 'Inscriptions', icon: FileText }] : []),
    ...(manager ? [{ href: '/club-admin/tresorerie', label: 'Trésorerie', icon: Wallet }] : []),
    ...(attendanceEnabled ? [{ href: '/club-admin/appel', label: "Feuille d'appel", icon: ClipboardCheck }] : []),
    { href: '/club-admin/sportif', label: 'Sportif', icon: Trophy },
    ...(manager ? [{ href: '/club-admin/contenus', label: 'Site et contenus', icon: Newspaper }] : []),
    ...(manager ? [{ href: '/club-admin/parametres', label: 'Paramètres', icon: Settings }] : []),
  ];
  return (
    <AdminShell
      title={clubName}
      subtitle={subtitle}
      links={links}
      banner={banner}
      footer={
        <div className="grid gap-1 text-sm">
          <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-white/10">
            <ExternalLink className="size-5" aria-hidden /> Voir le site
          </a>
          <form action={signOutAction}>
            <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 hover:bg-white/10">
              <LogOut className="size-5" aria-hidden /> Se déconnecter
            </button>
          </form>
        </div>
      }
    >
      {children}
    </AdminShell>
  );
}
