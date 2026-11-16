// Fratries dans l'espace famille (2026-11-14) : depuis le lien d'un enfant, la famille voit ses autres enfants inscrits
// et passe de l'un à l'autre sans attendre un nouveau lien par e-mail.
//
// Règles :
// - « Même famille » = une adresse e-mail en commun entre les responsables (1 ou 2) des deux fiches : c'est la
//   personne qui reçoit déjà les liens de chacune. Même organisation, fiches non archivées seulement.
// - Une fiche dont le club a révoqué les liens (« Révoquer les liens ») n'est pas proposée, sauf si le club a envoyé un
//   nouveau lien depuis : la révocation n'est jamais contournée par le passage d'un enfant à l'autre.
// - Le passage (functions/depot/[token]/enfant/[id].js) crée un lien neuf de la fiche visée, comme un e-mail du club ;
//   aucune donnée de fiche n'est modifiée.
import { ensureFamilyLinksTable } from './family-links.js';

export const MAX_SIBLINGS = 8;

const normalized = (email) => String(email || '').trim().toLowerCase();

export function guardianEmails(row) {
  return [...new Set([normalized(row?.email), normalized(row?.parent2_email)].filter((e) => e.includes('@')))];
}

export async function findSiblings(db, organizationId, row) {
  const emails = guardianEmails(row);
  if (!emails.length) return [];
  await ensureFamilyLinksTable(db);
  const marks = emails.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT i.* FROM inscriptions i
       WHERE i.organization_id = ? AND i.id <> ? AND i.archived_at IS NULL
         AND (lower(trim(i.email)) IN (${marks}) OR lower(trim(COALESCE(i.parent2_email, ''))) IN (${marks}))
         AND (i.family_links_revoked_at IS NULL OR EXISTS (
           SELECT 1 FROM family_links l
           WHERE l.organization_id = i.organization_id AND l.inscription_id = i.id
             AND l.revoked_at IS NULL AND l.created_at > i.family_links_revoked_at))
       ORDER BY i.naissance, i.id
       LIMIT ?`
    )
    .bind(organizationId, row.id, ...emails, ...emails, MAX_SIBLINGS)
    .all();
  return results;
}
