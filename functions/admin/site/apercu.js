// Aperçu d'une page du BROUILLON du site (permission settings.manage) : même rendu que le site public, avec les
// données vivantes du club. Jamais indexé, jamais mis en cache.
import { isAuthed, loginPage, escapeHtml } from '../../_shared/admin-auth.js';
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { readSiteConfig } from '../../_shared/site-config.js';
import { loadOrganization } from '../../_shared/organization.js';
import { renderPreview } from '../../_shared/public-site.js';

const headers = { 'Content-Type': 'text/html;charset=UTF-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };

export async function onRequestGet({ request, env }) {
  const admin = await isAuthed(request, env);
  if (!admin) return new Response(loginPage(), { headers });
  await ensureSchema(env.DB);
  const state = await readSiteConfig(env, admin.organizationId);
  const pageId = new URL(request.url).searchParams.get('page') || '';
  const page = state?.config?.pages?.find((p) => p.id === pageId);
  if (!page) return new Response('Page introuvable dans le brouillon.', { status: 404, headers: { ...headers, 'Content-Type': 'text/plain;charset=UTF-8' } });
  const organization = await loadOrganization(env, admin.organizationId);
  try {
    const page_html = await renderPreview(env, organization, state.config, page.route);
    const banner = '<div style="position:sticky;top:0;z-index:9999;background:#1d2733;color:#fff;font:600 14px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center">Aperçu du brouillon : pas encore en ligne</div>';
    return new Response(page_html.replace(/<body([^>]*)>/, `<body$1>${banner}`), { headers });
  } catch (error) {
    return new Response(`<!doctype html><meta charset="utf-8"><title>Aperçu impossible</title><p style="font:16px system-ui;padding:24px">Aperçu impossible : ${escapeHtml(String(error.message).split('\n').slice(0, 5).join(' '))}</p>`, { status: 422, headers });
  }
}
