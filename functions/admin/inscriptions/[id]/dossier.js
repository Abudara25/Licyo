// Sert le dossier signé (stocké dans le bucket R2 "DOSSIERS") depuis la fiche admin d'une
// inscription — voir functions/depot/[token].js pour le dépôt côté famille. Même garde
// d'authentification que le reste de /admin (_shared/admin-auth.js).
// onRequestPost (ajouté 2026-09-05) : dépôt manuel par un responsable du club, pour le cas où un
// parent envoie le dossier signé par e-mail plutôt que par le lien /depot/<token> — mêmes règles
// de validation que ce dépôt public (voir MAX_SIZE/ALLOWED_TYPES), stocké sous la même clé R2
// (dossiers/<upload_token>) pour que les deux chemins de dépôt restent interchangeables.
import { ensureInscriptionsTable } from '../../../_shared/inscriptions-db.js';
import { isAuthed, loginPage } from '../../../_shared/admin-auth.js';
import { afterInscriptionChange } from '../../../_shared/automations.js';
import { readUpload } from '../../../_shared/security.js';

const MAX_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

// N'autorise que des redirections internes vers /admin/inscriptions (avec filtres éventuels) ou vers
// une fiche /admin/inscriptions/<id>, pour ramener l'admin exactement là où il était — jamais une
// redirection ouverte.
const safeRedirect = (value) => (/^\/admin\/inscriptions(\/\d+)?(\?[^\s]*)?$/.test(value || '') ? value : '/admin/inscriptions');

export async function onRequestGet({ request, env, params }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  await ensureInscriptionsTable(env.DB);
  const row = await env.DB.prepare('SELECT dossier_key, dossier_content_type FROM inscriptions WHERE organization_id = ? AND id = ?')
    .bind(admin.organizationId, Number(params.id))
    .first();
  if (!row?.dossier_key) {
    return new Response('Aucun dossier pour cette inscription.', { status: 404 });
  }
  if (!env.DOSSIERS) {
    return new Response('Le stockage des dossiers (bucket R2) n’est pas configuré.', { status: 500 });
  }

  const object = await env.DOSSIERS.get(row.dossier_key);
  if (!object) {
    return new Response('Fichier introuvable (peut-être supprimé).', { status: 404 });
  }

  const ext = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[row.dossier_content_type] || 'bin';
  return new Response(object.body, {
    headers: {
      'Content-Type': row.dossier_content_type || 'application/octet-stream',
      'Content-Disposition': `${new URL(request.url).searchParams.has('telecharger') ? 'attachment' : 'inline'}; filename="dossier-${params.id}.${ext}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

export async function onRequestPost({ request, env, params, waitUntil }) {
  const admin = await isAuthed(request, env);
  if (!admin) {
    return new Response(loginPage(), { status: 401, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
  }

  await ensureInscriptionsTable(env.DB);
  const id = Number(params.id);
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(admin.organizationId, id).first();
  if (!row) {
    return new Response('Inscription introuvable.', { status: 404 });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    form = null;
  }
  const redirectTo = safeRedirect(form?.get('redirectTo'));
  const withError = (error) =>
    new Response('', { status: 302, headers: { Location: `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}dossierError=${encodeURIComponent(error)}` } });

  if (!form) {
    return withError('Envoi invalide, réessayez.');
  }

  if (!env.DOSSIERS) {
    return withError("Stockage des dossiers (bucket R2) non configuré.");
  }
  // Type déduit du contenu du fichier, pas de ce qu'annonce le navigateur.
  const upload = await readUpload(form.get('dossier'), { allowedTypes: ALLOWED_TYPES, maxSize: MAX_SIZE });
  if (upload.error) {
    return withError({ empty: 'Choisissez un fichier avant d’envoyer.', too_large: 'Le fichier dépasse 10 Mo.', bad_type: 'Format non accepté — PDF, JPG ou PNG uniquement.' }[upload.error]);
  }

  // Déposé par un responsable qui a le document sous les yeux (reçu par e-mail ou en main propre) :
  // validé d'office, contrairement au dépôt de la famille qui passe « à vérifier ».
  const key = `dossiers/${row.upload_token || `admin-${id}`}`;
  try {
    await env.DOSSIERS.put(key, upload.buffer, { httpMetadata: { contentType: upload.type } });
    await env.DB.prepare(
      "UPDATE inscriptions SET dossier_key = ?, dossier_content_type = ?, dossier_uploaded_at = datetime('now'), dossier_status = 'valide', dossier_verified_at = datetime('now') WHERE organization_id = ? AND id = ?"
    )
      .bind(key, upload.type, admin.organizationId, id)
      .run();
  } catch {
    return withError("Échec de l'envoi, réessayez.");
  }

  if (env.DOSSIERS_BACKUP) {
    waitUntil(env.DOSSIERS_BACKUP.put(key, upload.buffer, { httpMetadata: { contentType: upload.type } }).catch(() => {}));
  }

  waitUntil(afterInscriptionChange(env, { organizationId: admin.organizationId, id, before: row, step: 'dossier', source: 'admin', siteUrl: new URL(request.url).origin }));
  return new Response('', { status: 302, headers: { Location: `${redirectTo}${redirectTo.includes('?') ? '&' : '?'}dossierOk=1` } });
}
