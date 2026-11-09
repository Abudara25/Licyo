import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Club, StaffMember, StaffRole } from '@/types/database';
import { IMPERSONATION_COOKIE, verifyImpersonation } from '@/lib/utils/impersonation';
import { endSession, getSessionUser, type AuthUser } from '@/lib/auth/session';
import { makeClient, type DbClient } from './client.ts';
import { getDatabase } from './d1.ts';

export type ServerDbClient = DbClient & {
  auth: {
    getUser(): Promise<{ data: { user: AuthUser | null }; error: null }>;
    signOut(): Promise<{ error: null }>;
  };
};

/** Client lié à l'utilisateur de la session (cookie), soumis aux règles d'accès. */
export async function createClient(): Promise<ServerDbClient> {
  const user = await getSessionUser();
  const client = makeClient(getDatabase(), user ? { role: 'authenticated', userId: user.id } : { role: 'anon' });
  return {
    ...client,
    auth: {
      getUser: async () => ({ data: { user }, error: null }),
      signOut: async () => {
        await endSession();
        return { error: null };
      },
    },
  };
}

export type AuthContext = {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  memberships: StaffMember[];
};

/** Utilisateur connecté et ses rattachements (mémorisé pour la durée de la requête). */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('staff_members').select('*').eq('user_id', user.id);
  const memberships = data ?? [];
  return {
    userId: user.id,
    email: user.email,
    isSuperAdmin: memberships.some((m) => m.role === 'super_admin'),
    memberships,
  };
});

export type ClubContext = {
  auth: AuthContext;
  club: Club;
  role: StaffRole;
  /** Vrai si un super_admin consulte le back-office d'un club en Mode Miroir. */
  impersonating: boolean;
};

export const MANAGER_ROLES: StaffRole[] = ['president', 'secretary', 'treasurer', 'super_admin'];

/**
 * Club courant du back-office.
 * - Super_admin avec cookie miroir valide (signé, lié à son compte) : le club ciblé.
 * - Sinon : le club de rattachement (le premier si plusieurs, ou celui du cookie `active_club`).
 */
export const getClubContext = cache(async (): Promise<ClubContext | null> => {
  const auth = await getAuthContext();
  if (!auth) return null;
  const db = await createClient();
  const cookieStore = await cookies();

  if (auth.isSuperAdmin) {
    const clubId = await verifyImpersonation(cookieStore.get(IMPERSONATION_COOKIE)?.value, auth.userId);
    if (clubId) {
      const { data: club } = await db.from('clubs').select('*').eq('id', clubId).maybeSingle();
      if (club) return { auth, club, role: 'super_admin', impersonating: true };
    }
  }

  const clubMemberships = auth.memberships.filter((m) => m.club_id);
  if (clubMemberships.length === 0) return null;
  const preferred = cookieStore.get('active_club')?.value;
  const membership = clubMemberships.find((m) => m.club_id === preferred) ?? clubMemberships[0];
  const { data: club } = await db.from('clubs').select('*').eq('id', membership.club_id!).maybeSingle();
  if (!club) return null;
  return { auth, club, role: membership.role, impersonating: false };
});

/** Exige un club courant (et éventuellement un rôle), sinon redirige. */
export async function requireClubContext(allowedRoles?: StaffRole[]): Promise<ClubContext> {
  const ctx = await getClubContext();
  if (!ctx) {
    const auth = await getAuthContext();
    redirect(auth?.isSuperAdmin ? '/super-admin/clubs' : '/login?next=/club-admin');
  }
  if (allowedRoles && !allowedRoles.includes(ctx.role)) redirect('/club-admin?erreur=droits');
  return ctx;
}

export async function requireSuperAdmin(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) redirect('/login?next=/super-admin');
  if (!auth.isSuperAdmin) redirect('/club-admin');
  return auth;
}

export function isManager(role: StaffRole): boolean {
  return MANAGER_ROLES.includes(role);
}
