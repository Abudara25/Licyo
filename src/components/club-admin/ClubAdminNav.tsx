'use client';

import type { ReactNode } from 'react';
import {
  ClipboardCheck,
  ExternalLink,
  FileText,
  Home,
  LogOut,
  Newspaper,
  Settings,
  Trophy,
  Wallet,
  SlidersHorizontal,
  ListChecks,
  Mail,
  Hourglass,
  Inbox,
  MessageSquare,
  Image,
} from 'lucide-react';
import { AdminShell, type ShellLink } from './AdminShell';
import { moduleEnabled } from '@/lib/platform';
import type { StaffRole } from '@/types/database';
import { grantsCan, grantsCanAny, type Grant } from '@/lib/permissions';

export function ClubAdminNav({
  clubName,
  subtitle,
  role,
  grants,
  siteUrl,
  attendanceEnabled,
  modules,
  banner,
  signOutAction,
  children,
}: {
  clubName: string;
  subtitle: string;
  role: StaffRole;
  /** Droits effectifs de la personne connectée. */
  grants: Grant[];
  siteUrl: string;
  attendanceEnabled: boolean;
  modules: Record<string, boolean>;
  banner: ReactNode;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  const may = (p: Parameters<typeof grantsCan>[1]) => grantsCan(grants, p);
  const links: ShellLink[] = [
    { href: '/club-admin', label: 'Tableau de bord', icon: Home },
    ...(may('members.read') && moduleEnabled(modules, 'inscriptions')
      ? [
          {
            href: '/club-admin/inscriptions',
            label: 'Inscriptions',
            icon: FileText,
          },
        ]
      : []),
    ...(may('members.read') && moduleEnabled(modules, 'inscriptions')
      ? [{ href: '/club-admin/a-traiter', label: 'À traiter', icon: Inbox }]
      : []),
    ...(may('members.read') && moduleEnabled(modules, 'inscriptions')
      ? [{ href: '/club-admin/preinscriptions', label: 'Pré-inscriptions', icon: Hourglass }]
      : []),
    ...(may('finance.read') && moduleEnabled(modules, 'payments')
      ? [{ href: '/club-admin/tresorerie', label: 'Trésorerie', icon: Wallet }]
      : []),
    ...(attendanceEnabled
      ? [
          {
            href: '/club-admin/appel',
            label: "Feuille d'appel",
            icon: ClipboardCheck,
          },
        ]
      : []),
    { href: '/club-admin/sportif', label: 'Sportif', icon: Trophy },
    ...(may('content.write')
      ? [
          {
            href: '/club-admin/contenus',
            label: 'Site et contenus',
            icon: Newspaper,
          },
        ]
      : []),
    ...(may('members.read') && moduleEnabled(modules, 'private_lessons')
      ? [
          {
            href: '/club-admin/demandes',
            label: 'Demandes de cours',
            icon: MessageSquare,
          },
        ]
      : []),
    ...(may('content.write') && moduleEnabled(modules, 'gallery')
      ? [{ href: '/club-admin/galerie', label: 'Galerie', icon: Image }]
      : []),
    ...(grantsCanAny(grants, ['members.read', 'communication.manage'])
      ? [{ href: '/club-admin/emails', label: 'Journal des e-mails', icon: Mail }]
      : []),
    ...(may('settings.manage') && moduleEnabled(modules, 'inscriptions')
      ? [{ href: '/club-admin/formulaire', label: 'Formulaire d’inscription', icon: ListChecks }]
      : []),
    ...(may('settings.manage')
      ? [
          {
            href: '/club-admin/modules',
            label: 'Modules et modèle',
            icon: SlidersHorizontal,
          },
        ]
      : []),
    ...(grantsCanAny(grants, ['settings.manage', 'communication.manage', 'finance.write', 'club.admin'])
      ? [
          {
            href: '/club-admin/parametres',
            label: 'Paramètres',
            icon: Settings,
          },
        ]
      : []),
  ];
  return (
    <AdminShell
      title={clubName}
      subtitle={subtitle}
      links={links}
      banner={banner}
      footer={
        <div className="grid gap-1 text-sm">
          <a
            href={siteUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-white/10"
          >
            <ExternalLink className="size-5" aria-hidden /> Voir le site
          </a>
          <form action={signOutAction}>
            <button
              type="submit"
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 hover:bg-white/10"
            >
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
