// Suppression définitive d'une inscription (bouton « Supprimer définitivement » de la corbeille).
//
// Avant 2026-09-23, seule la ligne D1 était supprimée : le dossier signé et la photo de l'enfant restaient
// dans R2 (bucket principal ET copie DOSSIERS_BACKUP), et le journal des e-mails gardait les adresses.
//
// Politique appliquée ici (technique, pas une décision juridique : voir CLAUDE.md) :
// - SUPPRIMÉ : la fiche (identité de l'enfant et des responsables, coordonnées, statuts), le dossier
//   signé et la photo dans les deux buckets.
// - ANONYMISÉ : les lignes du journal des e-mails de cette fiche (destinataires, objet, erreur,
//   identifiant Brevo effacés ; type, date et résultat gardés pour les statistiques d'envoi), et
//   l'e-mail du payeur des commandes HelloAsso qui ne concernent plus aucune autre fiche.
// - CONSERVÉ : la trace de la commande HelloAsso (numéro, statut, date), indispensable à l'anti-doublon
//   des notifications. Le justificatif comptable du paiement reste chez HelloAsso.
//
// Les fichiers sont supprimés AVANT la fiche : si R2 échoue, rien n'est supprimé et le responsable peut
// réessayer (l'inverse laisserait des fichiers orphelins que plus rien ne référence).
import { ensureInscriptionsTable } from './inscriptions-db.js';
import { crmDeletionStatements } from './crm.js';
import { ensureFamilyLinksTable, familyLinksDeletionStatement } from './family-links.js';
import { assertProvenanceIntact } from './crm-schema.js';

// Toutes les clés R2 que cette fiche a pu utiliser : celles enregistrées en base, et les deux schémas de
// nommage des dépôts (famille : <jeton>, responsable sans jeton : admin-<id>).
export function inscriptionFileKeys(row) {
  const keys = new Set([row.dossier_key, row.photo_key]);
  for (const prefix of ['dossiers', 'photos']) {
    if (row.upload_token) keys.add(`${prefix}/${row.upload_token}`);
    keys.add(`${prefix}/admin-${row.id}`);
  }
  keys.delete(null);
  keys.delete(undefined);
  keys.delete('');
  return [...keys];
}

// { ok: true } ou { error } (message pour le responsable). Refuse une fiche qui n'est pas dans la corbeille.
export async function deleteInscriptionPermanently(env, organizationId, id) {
  await ensureInscriptionsTable(env.DB);
  // Fiche d'une autre organisation : introuvable ici, donc rien n'est supprimé.
  const row = await env.DB.prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, id).first();
  if (!row) return { ok: true }; // déjà supprimée
  if (!row.archived_at) return { error: 'Seule une fiche placée dans la corbeille peut être supprimée définitivement.' };

  // La suppression CRM s'appuie sur la provenance des relations : si cette table a disparu alors que des relations
  // existent, rien n'est supprimé (ni fichiers, ni fiche) : échec explicite avant toute opération.
  await assertProvenanceIntact(env.DB);

  const keys = inscriptionFileKeys(row);
  const hasFiles = Boolean(row.dossier_key || row.photo_key);
  if (hasFiles && !env.DOSSIERS) {
    return { error: 'Stockage des fichiers indisponible : suppression annulée pour ne pas laisser le dossier ou la photo en place.' };
  }
  // delete() accepte une liste et ignore les clés absentes : un second essai termine proprement une
  // suppression interrompue.
  let step = 'principal';
  try {
    if (env.DOSSIERS) await env.DOSSIERS.delete(keys);
    step = 'sauvegarde';
    if (env.DOSSIERS_BACKUP) await env.DOSSIERS_BACKUP.delete(keys);
  } catch {
    // Trace technique sans donnée personnelle, pour savoir qu'une suppression est à reprendre.
    console.error(`Suppression définitive interrompue (stockage ${step}) : organisation ${organizationId}, fiche ${id}`);
    return {
      error:
        step === 'principal'
          ? 'Les fichiers (dossier, photo) n’ont pas pu être supprimés : la fiche est conservée, réessayez.'
          : 'Suppression interrompue : une partie des fichiers est déjà supprimée, mais pas leur copie de sauvegarde. La fiche est conservée : réessayez pour terminer.',
    };
  }

  const statements = [
    env.DB.prepare(
      'UPDATE email_log SET recipients = NULL, subject = NULL, error = NULL, message_id = NULL WHERE organization_id = ? AND inscription_id = ?'
    ).bind(organizationId, id),
  ];
  if (row.helloasso_order_id) {
    statements.push(
      env.DB.prepare(
        'UPDATE helloasso_orders SET payer_email = NULL WHERE organization_id = ? AND order_id = ? AND NOT EXISTS (SELECT 1 FROM inscriptions WHERE organization_id = ? AND helloasso_order_id = ? AND id != ?)'
      ).bind(organizationId, row.helloasso_order_id, organizationId, row.helloasso_order_id, id)
    );
  }
  // CRM (phase 3) : les contacts, relations et adhésions créés depuis cette inscription disparaissent avec elle,
  // dans la même transaction (un responsable partagé avec la fratrie est conservé).
  statements.push(...crmDeletionStatements(env.DB, organizationId, id));
  await ensureFamilyLinksTable(env.DB);
  statements.push(familyLinksDeletionStatement(env.DB, organizationId, id)); // liens de l'espace famille
  statements.push(env.DB.prepare('DELETE FROM inscriptions WHERE organization_id = ? AND id = ?').bind(organizationId, id));
  await env.DB.batch(statements);
  return { ok: true };
}

