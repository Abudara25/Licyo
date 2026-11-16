// Fiche contact (CRM, phase 3), lecture seule : n'importe quelle personne de l'organisation (responsable,
// adhérent…), avec ses coordonnées et les personnes qui lui sont liées. L'organisation vient de la session.
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { isAuthed, loginPage, adminBadges } from '../../_shared/admin-auth.js';
import { getContactProfile } from '../../_shared/crm.js';
import { loadAgeContext } from '../../_shared/preinscriptions.js';
import { profilePage, html, notFoundPage } from '../../_shared/crm-ui.js';

export async function onRequestGet({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) return html(loginPage());
  const id = Number.parseInt(params.id, 10);
  if (!Number.isInteger(id)) return notFoundPage();
  await ensureSchema(env.DB);
  const profile = await getContactProfile(env.DB, admin.organizationId, id);
  if (!profile) return notFoundPage();
  return html(profilePage(profile, { asMember: false, ageCtx: await loadAgeContext(env, admin.organizationId).catch(() => null), badges: await adminBadges(env, admin) }));
}
