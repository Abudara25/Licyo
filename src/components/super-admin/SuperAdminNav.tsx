'use client';
import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { ControlShell } from './ControlShell';
export function SuperAdminNav({
  email,
  signOutAction,
  children,
}: {
  email: string;
  signOutAction: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <ControlShell
      email={email}
      footer={
        <form action={signOutAction}>
          <button type="submit">
            <LogOut size={16} />
            Se déconnecter
          </button>
        </form>
      }
    >
      {children}
    </ControlShell>
  );
}
