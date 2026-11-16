// Durée de conservation (2026-10-16, audit de sécurité) : la politique de confidentialité annonce une conservation
// jusqu'à 3 ans après la fin de la saison d'adhésion (30 juin). Cette revue liste les fiches dont le délai est passé,
// dans /admin/parametres : AUCUNE suppression automatique (règle absolue du projet sur les données des adhérents),
// le club archive puis supprime définitivement chaque fiche (inscription-deletion.js : fiche, fichiers R2 et copies).
// Les liens de l'espace famille expirés depuis plus de 90 jours sont, eux, effacés chaque jour (purgeExpiredFamilyLinks,
// lancé par /api/cron) : ce ne sont que des empreintes, sans donnée de la famille.
import { ensureFamilyLinksTable } from './family-links.js';

export const RETENTION_YEARS = 3;
export const FAMILY_LINK_PURGE_DAYS = 90;

// Fin de la saison « 2026-2027 » : 30 juin 2027. Saison illisible : null (fiche jamais proposée à la suppression).
export function seasonEnd(saison) {
  const match = /^(\d{4})-(\d{4})$/.exec(String(saison || ''));
  if (!match || Number(match[2]) !== Number(match[1]) + 1) return null;
  return `${match[2]}-06-30`;
}

export function retentionEnd(saison) {
  const end = seasonEnd(saison);
  return end ? `${Number(end.slice(0, 4)) + RETENTION_YEARS}${end.slice(4)}` : null;
}

// Fiches de l'organisation dont la durée de conservation est passée (date du jour en UTC).
export async function retentionDue(db, organizationId, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const { results } = await db
    .prepare('SELECT id, enfant_prenom, enfant_nom, saison, archived_at FROM inscriptions WHERE organization_id = ? ORDER BY saison, id')
    .bind(organizationId)
    .all();
  return results.filter((r) => {
    const end = retentionEnd(r.saison);
    return end && end < today;
  }).map((r) => ({ ...r, retentionEnd: retentionEnd(r.saison) }));
}

export async function purgeExpiredFamilyLinks(db, organizationId, now = Date.now()) {
  await ensureFamilyLinksTable(db);
  const limit = new Date(now - FAMILY_LINK_PURGE_DAYS * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
  const result = await db.prepare('DELETE FROM family_links WHERE organization_id = ? AND expires_at < ?').bind(organizationId, limit).run();
  return result.meta?.changes || 0;
}
