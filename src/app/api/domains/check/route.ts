import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Appelé par Caddy (on_demand_tls « ask ») avant d'émettre un certificat :
 * 200 seulement pour un domaine rattaché à un club publié. Empêche qu'un
 * inconnu fasse générer des certificats pour n'importe quel nom.
 */
export async function GET(req: Request) {
  const domain = (new URL(req.url).searchParams.get('domain') ?? '').toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return new Response(null, { status: 400 });
  const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? '').replace(/:\d+$/, '');
  if (root && (domain === root || domain.endsWith(`.${root}`))) return new Response(null, { status: 200 });
  const bare = domain.replace(/^www\./, '');
  const { data } = await createAdminClient()
    .from('clubs')
    .select('id')
    .in('custom_domain', [bare, `www.${bare}`])
    .in('status', ['active', 'demo'])
    .limit(1);
  return new Response(null, { status: data?.length ? 200 : 404 });
}
