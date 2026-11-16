// Vérification du dossier signé par un responsable, depuis la fiche admin (bloc « Dossier & paiement ») :
// action=valider ou action=refuser (motifs cochés parmi DOSSIER_REFUS_MOTIFS + commentaire libre). Un
// refus remet l'étape "à faire" côté famille et, sauf case décochée, lui envoie l'e-mail qui explique
// ce qui manque (sendDossierRefusedEmail). Une validation déclenche l'e-mail de suivi habituel.
import { ensureInscriptionsTable, DOSSIER_REFUS_MOTIFS, dossierStatus } from '../../../_shared/inscriptions-db.js';
import { isAuthed, loginPage } from '../../../_shared/admin-auth.js';
import { afterInscriptionChange } from '../../../_shared/automations.js';
import { sendDossierRefusedEmail } from '../../../_shared/confirmation-email.js';

const COMMENT_MAX = 500;

export async function onRequestPost({ request, env, params, waitUntil }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  await ensureInscriptionsTable(env.DB);
  const id = Number(params.id);
  const org = admin.organizationId;
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(org, id).first();
  if (!row) {
    return new Response('Inscription introuvable.', { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  // Depuis l'aperçu du document (suite=1) : une erreur y ramène, et une vérification réussie ouvre directement le
  // dossier suivant à vérifier (le plus ancien reçu), ou la fiche quand il n'en reste plus.
  const chain = form?.get('suite') === '1';
  const redirect = (location) => new Response('', { status: 302, headers: { Location: location } });
  const back = (param) => redirect(chain && param.startsWith('verifError') ? `/admin/inscriptions/${id}/apercu?${param}` : `/admin/inscriptions/${id}?${param}#dossier`);
  const done = async (param) => {
    if (!chain) return back(param);
    const { results } = await env.DB.prepare(
      'SELECT * FROM inscriptions WHERE organization_id = ? AND archived_at IS NULL AND dossier_uploaded_at IS NOT NULL AND id <> ? ORDER BY dossier_uploaded_at, id'
    )
      .bind(org, id)
      .all();
    const next = results.find((r) => dossierStatus(r) === 'a_verifier');
    return next ? redirect(`/admin/inscriptions/${next.id}/apercu?${param}&precedent=${id}`) : redirect(`/admin/inscriptions/${id}?${param}&fin=1#dossier`);
  };
  if (!row.dossier_uploaded_at) {
    return back(`verifError=${encodeURIComponent('Aucun dossier reçu pour cette inscription.')}`);
  }
  const siteUrl = new URL(request.url).origin;

  if (form?.get('action') === 'valider') {
    await env.DB.prepare("UPDATE inscriptions SET dossier_status = 'valide', dossier_verified_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(org, id).run();
    waitUntil(afterInscriptionChange(env, { organizationId: org, id, before: row, step: 'dossier', source: 'admin', siteUrl }));
    return done('verifOk=valide');
  }

  if (form?.get('action') === 'refuser') {
    const motifs = [...new Set(form.getAll('motifs'))].filter((key) => key in DOSSIER_REFUS_MOTIFS);
    const commentaire = String(form.get('commentaire') || '').trim().slice(0, COMMENT_MAX);
    if (!motifs.length && !commentaire) {
      return back(`verifError=${encodeURIComponent('Cochez au moins un motif ou écrivez un commentaire : la famille doit savoir quoi corriger.')}`);
    }
    // complete_notified_at est remis à zéro : la famille recevra de nouveau « Dossier complet » une fois
    // le dossier corrigé validé.
    await env.DB.prepare(
      `UPDATE inscriptions SET dossier_status = 'refuse', dossier_verified_at = NULL, dossier_refused_at = datetime('now'),
        dossier_refus_motifs = ?, dossier_refus_commentaire = ?, complete_notified_at = NULL WHERE organization_id = ? AND id = ?`
    )
      .bind(motifs.join(','), commentaire || null, org, id)
      .run();

    if (form.get('notifier') !== 'on') return done('verifOk=refuse');
    const updated = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(org, id).first();
    const sent = await sendDossierRefusedEmail(env, updated, siteUrl);
    if (sent) {
      // Compte comme un contact : les relances automatiques attendent au moins 3 jours (_shared/automations.js).
      await env.DB.prepare("UPDATE inscriptions SET last_reminder_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(org, id).run();
    }
    return done(sent ? 'verifOk=refuse-mail' : 'verifOk=refuse-mail-echec');
  }

  return back(`verifError=${encodeURIComponent('Action inconnue.')}`);
}
