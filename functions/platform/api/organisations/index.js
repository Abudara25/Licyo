// POST /platform/api/organisations : création depuis l'assistant d'onboarding (permission orgs.create, middleware).
// Réponse JSON : { id, inviteUrl } — le lien du président n'est renvoyé qu'ici, une seule fois.
import { createOrganization } from '../../../_shared/platform-data.js';
import { PlatformError } from '../../../_shared/platform-auth.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function onRequestPost(context) {
  const { request, env } = context;
  const form = await request.formData();
  const get = (k) => String(form.get(k) || '').trim();
  const siteDomain = env.PLATFORM_SITE_DOMAIN || 'licyo-demo.pages.dev';
  const slug = get('slug');
  const input = {
    name: get('name'),
    slug,
    sport: get('sport'),
    plan: get('plan'),
    timezone: get('timezone'),
    domain: get('customDomain') || `${slug}.${siteDomain}`,
    extraDomains: get('customDomain') ? [`${slug}.${siteDomain}`] : [],
    presidentName: get('adminName'),
    presidentEmail: get('adminEmail'),
  };
  try {
    const origin = new URL(request.url).protocol === 'http:' ? 'http' : 'https';
    const created = await createOrganization(env, context.data.operator, input, { origin });
    return json({ id: created.id, inviteUrl: created.invite.url });
  } catch (error) {
    if (error instanceof PlatformError) return json({ error: error.message }, 400);
    throw error;
  }
}
