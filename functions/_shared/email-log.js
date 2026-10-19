// Journal des e-mails envoyés par le site via Brevo (confirmations, relances, suivis, alertes club…),
// affiché dans /admin/events pour que le club sache ce qui est parti, quand, à qui et si Brevo l'a
// accepté. Alimenté par brevoSend() (_shared/confirmation-email.js), par où passent tous les envois.
// Ne stocke ni le contenu ni les pièces jointes : type, destinataires, objet, fiche liée, résultat.
// Best-effort : un échec d'écriture ici ne doit jamais empêcher un e-mail de partir.
import { ensureSchema } from './inscriptions-db.js';

// Clés stables (stockées en base) → libellés affichés. Ne jamais renommer une clé.
export const EMAIL_KINDS = {
  confirmation: 'Confirmation d’inscription',
  relance: 'Relance famille',
  suivi: 'Suivi (étape validée)',
  complet: 'Dossier complet',
  dossier_refuse: 'Dossier refusé',
  photo_refusee: 'Photo à refaire',
  reinscription: 'Lien de réinscription',
  reinscription_rappel: 'Rappel de réinscription',
  club_inscription: 'Club : nouvelle inscription',
  club_depot: 'Club : dépôt famille',
  club_paiement: 'Club : mode de paiement changé',
  club_helloasso: 'Club : paiement à rattacher',
  recap: 'Club : récapitulatif du lundi',
  code_admin: 'Club : code de confirmation',
  preinscription: 'Pré-inscription (famille)',
  club_preinscription: 'Club : nouvelle pré-inscription',
  preinscription_ouverture: 'Ouverture du groupe (famille)',
  club_preinscription_ouverture: 'Club : groupe ouvert',
  club_cron: 'Club : automatisation en échec',
  club_contact: 'Club : message du formulaire de contact',
  message_club: 'Message du club',
  lien_famille: 'Nouveau lien espace famille',
};

export const EMAIL_ORIGINS = { auto: 'Automatique', manuel: 'Manuel', famille: 'Action famille', doublon: 'Inscription en doublon' };

const RETENTION_DAYS = 400;

// La table (et son organization_id) est créée par les migrations numérotées (schema.js).
export const ensureEmailLogTable = (db) => ensureSchema(db);

// E-mails internes au club (alertes, récapitulatif, code) : distingués des e-mails envoyés à la famille.
export const isClubEmailKind = (kind) => kind.startsWith('club_') || kind === 'recap' || kind === 'code_admin';

// E-mails liés aux inscriptions d'une personne (fiche adhérent), les plus récents d'abord. Organisation de la
// session uniquement : un identifiant d'inscription d'une autre organisation ne renvoie rien.
export async function listEmailsForInscriptions(db, organizationId, inscriptionIds, { limit = 200 } = {}) {
  const ids = [...new Set(inscriptionIds.filter(Number.isInteger))].slice(0, 50);
  if (!organizationId || !ids.length) return [];
  const { results } = await db
    .prepare(
      `SELECT id, created_at, kind, origin, inscription_id, recipients, subject, ok, status, error FROM email_log
       WHERE organization_id = ? AND inscription_id IN (${ids.map(() => '?').join(', ')})
       ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .bind(organizationId, ...ids, limit)
    .all();
  return results;
}

// body : la requête Brevo ; log : { kind, origin, inscriptionId, organizationId } ; result : { ok, status, messageId, error }.
// organizationId manquant : repris de la fiche liée ; sans fiche ni organisation, la ligne n'est visible
// dans aucun espace admin (aucune fuite possible vers une autre organisation).
export async function logEmail(env, body, log, result) {
  if (!env.DB || !log?.kind) return;
  try {
    await ensureEmailLogTable(env.DB);
    const inscriptionId = Number.isInteger(log.inscriptionId) ? log.inscriptionId : null;
    let organizationId = log.organizationId || null;
    // Identifiant de fiche unique sur toute la base : il désigne à lui seul son organisation.
    if (!organizationId && inscriptionId) {
      organizationId = (await env.DB.prepare('SELECT organization_id FROM inscriptions /* toutes-organisations */ WHERE id = ?').bind(inscriptionId).first())
        ?.organization_id || null;
    }
    const recipients = (body.to || []).map((r) => r.email).filter(Boolean).join(', ');
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO email_log (organization_id, kind, origin, inscription_id, recipients, subject, ok, status, message_id, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        organizationId,
        log.kind,
        log.origin || null,
        inscriptionId,
        recipients.slice(0, 500) || null,
        String(body.subject || '').slice(0, 300) || null,
        result.ok ? 1 : 0,
        result.status ?? null,
        result.messageId || null,
        result.error ? String(result.error).slice(0, 300) : null
      ),
      env.DB.prepare(`DELETE FROM email_log WHERE organization_id = ? AND created_at < datetime('now', '-${RETENTION_DAYS} days')`).bind(organizationId),
    ]);
  } catch {
    // best-effort
  }
}
