import { createAdminClient } from '@/lib/db/admin';
import { getDatabase } from '@/lib/db/d1';
import { getClubContext } from '@/lib/db/server';
import { grantsCan } from '@/lib/permissions';
import { exportPerson } from '@/lib/personal-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Droit d'accès et à la portabilité (RGPD, art. 15 et 20) : tout ce que le club détient sur une personne, en JSON.
 * Réservé à la présidence ; chaque export est tracé dans audit_events (sans donnée personnelle).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getClubContext();
  if (!ctx) return new Response('Session expirée : reconnectez-vous.', { status: 401 });
  if (!grantsCan(ctx.grants, 'club.admin')) return new Response('Réservé à la présidence du club.', { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Introuvable.', { status: 404 });
  const data = await exportPerson(getDatabase(), ctx.club.id, id);
  if (!data) return new Response('Introuvable.', { status: 404 });
  await createAdminClient().from('audit_events').insert({ club_id: ctx.club.id, actor_id: ctx.auth.userId, action: 'rgpd.export', object_id: id });
  const name = `donnees-${data.personne.prenom}-${data.personne.nom}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .toLowerCase();
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.json"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
