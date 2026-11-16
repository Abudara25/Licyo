// Fiche adhérent (CRM, phase 3 ; refaite le 2026-10-14 ; depuis le 2026-11-10, renvoie vers la fiche enfant unique de
// l'inscription quand il y en a une, voir functions/admin/inscriptions/[id].js) : prochaine étape, parcours de l'adhésion (dossier, photo,
// paiement, licence FFF), responsables joignables, l'enfant, e-mails envoyés à la famille et historique. L'identifiant
// est celui de la PERSONNE (contacts.id), qui reste le même d'une période à l'autre ; l'organisation vient de la session.
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
  const url = new URL(request.url);
  // Fiche enfant unique (2026-11-10) : la fiche de l'inscription de la saison regroupe tout (paiement, dossier, licence,
  // famille, historique). Les messages de retour (?suiviOk=1…) suivent ; l'ancre (#suivi-club) est gardée par le navigateur.
  const current = profile.memberships.find((m) => m.is_current && m.inscription_id) || profile.memberships.find((m) => m.inscription_id);
  if (current) return new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${current.inscription_id}${url.search}` } });
  const emails = await listEmailsForInscriptions(env.DB, admin.organizationId, profile.memberships.map((m) => m.inscription_id)).catch(() => null);
  return html(
    profilePage(profile, {
      asMember: true,
      emails,
      messages: { licenceOk: url.searchParams.has('licenceOk'), licenceError: url.searchParams.has('licenceError'), savedOk: url.searchParams.has('savedOk'), suiviOk: url.searchParams.has('suiviOk'), relanceOk: url.searchParams.has('relanceOk'),
        noteOk: url.searchParams.has('noteOk'), noteError: url.searchParams.has('noteError'),
        bulkOk: url.searchParams.get('bulkOk'), bulkError: url.searchParams.get('bulkError') },
      ageCtx: await loadAgeContext(env, admin.organizationId).catch(() => null),
      badges: await adminBadges(env, admin),
    })
  );
}
