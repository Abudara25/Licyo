// Copie de sauvegarde des fichiers déposés (dossiers signés, photos d'enfants et d'éducateurs) dans le bucket
// DOSSIERS_BACKUP (2026-11-13, audit Codex : les échecs de copie étaient ignorés sans trace).
//
// - backupCopy : copie après un dépôt réussi, jamais bloquante pour la famille ou le club (le fichier principal est
//   déjà enregistré). Une seconde tentative, puis un avertissement dans le journal des Functions.
// - syncBackups : reprise quotidienne (tâche « backups » de /api/cron) : chaque fichier référencé en base pour
//   l'organisation et absent de la sauvegarde y est recopié depuis le bucket principal.
// Journaux : préfixe de la clé et type d'erreur seulement (la clé contient un jeton, jamais affichée en entier).

function keyPrefix(key) {
  return String(key || '').split('/')[0] || 'fichier';
}

async function putWithRetry(bucket, key, body, contentType) {
  const options = contentType ? { httpMetadata: { contentType } } : undefined;
  try {
    await bucket.put(key, body, options);
  } catch {
    await bucket.put(key, body, options);
  }
}

export function backupCopy(env, key, upload, waitUntil) {
  if (!env.DOSSIERS_BACKUP) return;
  const copy = putWithRetry(env.DOSSIERS_BACKUP, key, upload.buffer, upload.type).catch((error) => {
    console.warn(`Sauvegarde R2 : copie « ${keyPrefix(key)} » en échec (${error?.name || 'erreur'}), reprise au prochain passage du cron`);
  });
  if (waitUntil) waitUntil(copy);
  return copy;
}

// Au plus BACKUP_SYNC_LIMIT fichiers vérifiés par passage (le reste au passage suivant) : borne le temps d'une requête.
export const BACKUP_SYNC_LIMIT = 300;

export async function syncBackups(env, organizationId, { limit = BACKUP_SYNC_LIMIT } = {}) {
  if (!env.DOSSIERS || !env.DOSSIERS_BACKUP) return null;
  const { results: inscriptions = [] } = await env.DB.prepare(
    'SELECT dossier_key, dossier_content_type, photo_key, photo_content_type FROM inscriptions WHERE organization_id = ? AND (dossier_key IS NOT NULL OR photo_key IS NOT NULL)'
  ).bind(organizationId).all();
  let educateurs = [];
  try {
    ({ results: educateurs = [] } = await env.DB.prepare(
      'SELECT photo_key, photo_content_type FROM educateurs WHERE organization_id = ? AND photo_key IS NOT NULL'
    ).bind(organizationId).all());
  } catch {
    // Table créée au premier usage des éducateurs : absente = aucune photo à copier.
  }

  const files = new Map();
  for (const row of inscriptions) {
    if (row.dossier_key) files.set(row.dossier_key, row.dossier_content_type);
    if (row.photo_key) files.set(row.photo_key, row.photo_content_type);
  }
  for (const row of educateurs) files.set(row.photo_key, row.photo_content_type);

  let checked = 0;
  let copied = 0;
  let missing = 0;
  let failed = 0;
  for (const [key, contentType] of files) {
    if (checked >= limit) break;
    checked += 1;
    try {
      if (await env.DOSSIERS_BACKUP.head(key)) continue;
      const object = await env.DOSSIERS.get(key);
      if (!object) {
        missing += 1;
        continue;
      }
      const body = typeof object.arrayBuffer === 'function' ? await object.arrayBuffer() : object.body;
      await putWithRetry(env.DOSSIERS_BACKUP, key, body, contentType || object.httpMetadata?.contentType);
      copied += 1;
    } catch (error) {
      failed += 1;
      console.warn(`Sauvegarde R2 : reprise « ${keyPrefix(key)} » en échec (${error?.name || 'erreur'})`);
    }
  }
  // Un échec de copie fait échouer la tâche : le cron le note et prévient le club (recordCronFailure).
  if (failed) throw new Error(`${failed} copie(s) de sauvegarde en échec`);
  return { checked, copied, missing, remaining: Math.max(0, files.size - checked) };
}
