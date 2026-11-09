import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/db/server';
export async function getMemberContext() {
  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect('/login?next=/espace-adherent');
  const { error } = await db.rpc('claim_family_access', {});
  if (error)
    throw new Error(
      'Impossible de vérifier vos accès. Réessayez dans quelques instants.',
    );
  const { data: access, error: accessError } = await db
    .from('family_access')
    .select('*')
    .eq('user_id', user.id);
  if (accessError)
    throw new Error('Vos dossiers sont temporairement indisponibles.');
  return { db, user, access: access ?? [] };
}
