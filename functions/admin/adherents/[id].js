// Fiche adhérent (CRM, phase 3 ; refaite le 2026-10-14) : prochaine étape, parcours de l'adhésion (dossier, photo,
// paiement, licence FFF), responsables joignables, l'enfant, e-mails envoyés à la famille et historique. L'identifiant
// est celui de la PERSONNE (contacts.id), qui reste le même d'une période à l'autre ; l'organisation vient de la session.
import { getCustomFields } from '../../_shared/custom-fields.js';
import { ensureSchema } from '../../_shared/inscriptions-db.js';
import { isAuthed, loginPage, adminBadges } from '../../_shared/admin-auth.js';
import { getContactProfile } from '../../_shared/crm.js';
import { listEmailsForInscriptions } from '../../_shared/email-log.js';
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
  // Une personne sans adhésion (un responsable) a sa fiche contact.
  if (!profile.memberships.length) return new Response('', { status: 302, headers: { Location: `/admin/contacts/${id}` } });
  const emails = await listEmailsForInscriptions(env.DB, admin.organizationId, profile.memberships.map((m) => m.inscription_id)).catch(() => null);
  const url = new URL(request.url);
  return html(
    profilePage(profile, {
      asMember: true,
      emails,
      messages: { licenceOk: url.searchParams.has('licenceOk'), licenceError: url.searchParams.has('licenceError'), savedOk: url.searchParams.has('savedOk'), suiviOk: url.searchParams.has('suiviOk'),
        noteOk: url.searchParams.has('noteOk'), noteError: url.searchParams.has('noteError'),
        bulkOk: url.searchParams.get('bulkOk'), bulkError: url.searchParams.get('bulkError') },
      ageCtx: await loadAgeContext(env, admin.organizationId).catch(() => null),
      badges: await adminBadges(env, admin),
      customDefs: await getCustomFields(env, admin.organizationId),
    })
  );
}
