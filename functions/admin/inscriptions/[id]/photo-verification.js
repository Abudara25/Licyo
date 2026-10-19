// Photo de l'enfant à refaire, demandée par un responsable depuis la fiche (bloc « Photo de l'enfant ») : motifs cochés
// parmi PHOTO_REFUS_MOTIFS + précision libre. La photo ne compte plus comme reçue (photo_uploaded_at effacé : l'étape
// repasse « à faire » pour la famille, les relances et le statut complet) ; le fichier est conservé. Sauf case
// décochée, la famille reçoit les consignes (fond blanc, visage seul, de face) et le lien pour envoyer la nouvelle photo.
import { ensureInscriptionsTable, PHOTO_REFUS_MOTIFS } from '../../../_shared/inscriptions-db.js';
import { isAuthed, loginPage } from '../../../_shared/admin-auth.js';
import { sendPhotoRefusedEmail } from '../../../_shared/confirmation-email.js';
import { syncInscriptionSafe } from '../../../_shared/crm.js';

const COMMENT_MAX = 500;

export async function onRequestPost({ request, env, params, waitUntil }) {
  const admin = await isAuthed(request, env);
  if (!admin) return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

  await ensureInscriptionsTable(env.DB);
  const id = Number(params.id);
  const org = admin.organizationId;
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(org, id).first();
  if (!row) return new Response('Inscription introuvable.', { status: 404 });

  const back = (param) => new Response('', { status: 302, headers: { Location: `/admin/inscriptions/${id}?${param}#photo-enfant` } });
  const form = await request.formData().catch(() => null);
  if (form?.get('action') !== 'refuser') return back(`photoError=${encodeURIComponent('Action inconnue.')}`);
  if (!row.photo_uploaded_at) return back(`photoError=${encodeURIComponent('Aucune photo reçue pour cette inscription.')}`);

  const motifs = [...new Set(form.getAll('motifs'))].filter((key) => key in PHOTO_REFUS_MOTIFS);
  const commentaire = String(form.get('commentaire') || '').trim().slice(0, COMMENT_MAX);
  if (!motifs.length && !commentaire) {
    return back(`photoError=${encodeURIComponent('Cochez au moins un motif ou écrivez une précision : la famille doit savoir quoi changer.')}`);
  }
  // « Dossier complet » repartira une fois la nouvelle photo reçue (complete_notified_at remis à zéro).
  await env.DB.prepare(
    `UPDATE inscriptions SET photo_uploaded_at = NULL, photo_refused_at = datetime('now'), photo_refus_motifs = ?, photo_refus_commentaire = ?,
       complete_notified_at = NULL WHERE organization_id = ? AND id = ?`
  )
    .bind(motifs.join(','), commentaire || null, org, id)
    .run();
  waitUntil(syncInscriptionSafe(env, org, id));

  if (form.get('notifier') !== 'on') return back('photoRefus=sans');
  const updated = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(org, id).first();
  const sent = await sendPhotoRefusedEmail(env, updated, new URL(request.url).origin);
  if (sent) {
    // Compte comme un contact : les relances automatiques attendent au moins 3 jours.
    await env.DB.prepare("UPDATE inscriptions SET last_reminder_at = datetime('now') WHERE organization_id = ? AND id = ?").bind(org, id).run();
  }
  return back(sent ? 'photoRefus=mail' : 'photoRefus=mail-echec');
}
