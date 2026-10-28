'use client';

import type { ReactNode } from 'react';
import { Building2, FileUp, Gauge, LogOut, Users, Wand2 } from 'lucide-react';
import { AdminShell } from '@/components/club-admin/AdminShell';

export function SuperAdminNav({ email, signOutAction, children }: { email: string; signOutAction: () => Promise<void>; children: ReactNode }) {
  return (
    <AdminShell
      title="Licyo - pilotage"
      subtitle={email}
      links={[
        { href: '/super-admin', label: 'Vue d\'ensemble', icon: Gauge },
        { href: '/super-admin/demo-generator', label: 'Générer une démo', icon: Wand2 },
        { href: '/super-admin/clubs', label: 'Clubs', icon: Building2 },
        { href: '/super-admin/crm', label: 'Prospects', icon: Users },
        { href: '/super-admin/import', label: 'Import CSV', icon: FileUp },
      ]}
      footer={
        <form action={signOutAction}>
          <button type="submit" className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm hover:bg-white/10">
            <LogOut className="size-5" aria-hidden /> Se déconnecter
          </button>
        </form>
      }
    >
      {children}
    </AdminShell>
  );
}
