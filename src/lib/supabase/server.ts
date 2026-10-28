import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import type { Club, Database, StaffMember, StaffRole } from '@/types/database';
import { IMPERSONATION_COOKIE, verifyImpersonation } from '@/lib/utils/impersonation';

/** Client serveur lié à la session de l'utilisateur (cookies), soumis à la RLS. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Appelé depuis un Server Component : le middleware rafraîchit la session.
        }
      },
    },
  });
}

export type AuthContext = {
  userId: string;
  email: string;
  isSuperAdmin: boolean;
  memberships: StaffMember[];
};

/** Utilisateur connecté et ses rattachements (mémorisé pour la durée de la requête). */
export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('staff_members').select('*').eq('user_id', user.id);
  const memberships = data ?? [];
  return {
    userId: user.id,
    email: user.email ?? '',
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
  const supabase = await createClient();
  const cookieStore = await cookies();

  if (auth.isSuperAdmin) {
    const clubId = await verifyImpersonation(cookieStore.get(IMPERSONATION_COOKIE)?.value, auth.userId);
    if (clubId) {
      const { data: club } = await supabase.from('clubs').select('*').eq('id', clubId).maybeSingle();
      if (club) return { auth, club, role: 'super_admin', impersonating: true };
    }
  }

  const clubMemberships = auth.memberships.filter((m) => m.club_id);
  if (clubMemberships.length === 0) return null;
  const preferred = cookieStore.get('active_club')?.value;
  const membership = clubMemberships.find((m) => m.club_id === preferred) ?? clubMemberships[0];
  const { data: club } = await supabase.from('clubs').select('*').eq('id', membership.club_id!).maybeSingle();
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
