import { getDatabase } from '@/lib/db/d1';
import { unsubscribeByToken } from '@/lib/newsletter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Désinscription en un clic (RFC 8058) : la messagerie envoie un POST « List-Unsubscribe=One-Click » sans ouvrir de
 * page. Un GET (lien ouvert à la main) renvoie vers la page de confirmation : un simple affichage ne désinscrit pas.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('t') ?? '';
  const done = await unsubscribeByToken(getDatabase(), token);
  return new Response(done ? 'Désinscription enregistrée.' : 'Lien inconnu.', {
    status: done ? 200 : 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  return Response.redirect(new URL(`/newsletter/desinscription/${encodeURIComponent(token)}`, url.origin), 303);
}
