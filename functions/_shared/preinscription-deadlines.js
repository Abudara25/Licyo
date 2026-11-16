// Délai d'inscription après une invitation (demande de l'utilisateur, 2026-11-04 : « on doit laisser un temps max
// pour que la personne s'inscrive entièrement, c'est-à-dire remplir le dossier et régler la 1re cotisation […] si la
// personne ne fait rien dans les temps elle a un rappel et si rien du tout sa place saute »).
//
// Une famille invitée (invited_at, échéance invite_deadline_at = invitation + délai du groupe) doit, avant
// l'échéance : remplir le formulaire d'inscription, déposer le dossier signé (non refusé) et régler la première
// cotisation (paiement reçu). La photo et la vérification du dossier par le club ne comptent pas : un retard du club
// ne fait jamais perdre une place. Chaque matin (/api/cron) :
//   - finalisé (même enfant : prénom, nom, naissance, inscription active) → completed_at, plus rien à faire ;
//   - 2 jours avant l'échéance → UN rappel (invite_reminded_at, réservé par la même instruction que la lecture) ;
//   - échéance passée → expired_at : la place est libérée (la ligne n'est jamais supprimée, une inscription
//     commencée n'est pas touchée), la famille et le club sont prévenus.
// Invitation antérieure à cette règle (sans échéance) : un délai complet lui est accordé à partir de maintenant.
import { ensurePreinscriptionsTable, getPreinscriptionGroups, findActiveInscriptionForChild } from './preinscriptions.js';
import { ensureInscriptionsTable, hasPaymentStarted } from './inscriptions-db.js';
import { openPreinscriptionGroupIfFull } from './preinscription-opening.js';
import { sendPreinscriptionDeadlineReminder, sendPreinscriptionExpired, sendPreinscriptionExpiredClub } from './confirmation-email.js';

export const REMINDER_DAYS_BEFORE = 2;
const DAY = 86400000;
const utc = (value) => Date.parse(`${String(value).replace(' ', 'T')}Z`);

// Étapes encore à faire pour une famille invitée (libellés pour le rappel) ; [] = adhésion finalisée.
export function missingSteps(inscription) {
  if (!inscription) return ["le formulaire d'inscription", 'le dossier signé', 'la première cotisation'];
  return [
    !(inscription.dossier_uploaded_at && inscription.dossier_status !== 'refuse') && 'le dossier signé',
    !hasPaymentStarted(inscription) && 'la première cotisation',
  ].filter(Boolean);
}

export async function runPreinscriptionDeadlines(env, organizationId, siteUrl, { now = new Date() } = {}) {
  if (!env.DB) return null;
  await ensurePreinscriptionsTable(env.DB);
  await ensureInscriptionsTable(env.DB);
  const groups = new Map((await getPreinscriptionGroups(env, organizationId)).map((g) => [g.groupe, g]));
  const { results } = await env.DB
    .prepare('SELECT * FROM preinscriptions WHERE organization_id = ? AND invited_at IS NOT NULL AND expired_at IS NULL AND completed_at IS NULL ORDER BY id')
    .bind(organizationId)
    .all();
  const summary = { completed: 0, reminded: 0, expired: 0, extended: 0 };
  const expired = [];
  for (const row of results) {
    const config = groups.get(row.groupe) || { groupe: row.groupe, label: row.groupe, inviteDays: 7 };
    const inscription = await env.DB
      .prepare('SELECT * FROM inscriptions WHERE organization_id = ? AND id = ?')
      .bind(organizationId, (await findActiveInscriptionForChild(env.DB, organizationId, { enfantPrenom: row.enfant_prenom, enfantNom: row.enfant_nom, naissance: row.naissance }))?.id ?? -1)
      .first();
    const missing = missingSteps(inscription);
    if (!missing.length) {
      await env.DB.prepare("UPDATE preinscriptions SET completed_at = datetime('now') WHERE organization_id = ? AND id = ? AND completed_at IS NULL").bind(organizationId, row.id).run();
      summary.completed += 1;
      continue;
    }
    if (!row.invite_deadline_at) {
      await env.DB
        .prepare('UPDATE preinscriptions SET invite_deadline_at = ? WHERE organization_id = ? AND id = ? AND invite_deadline_at IS NULL')
        .bind(new Date(now.getTime() + (config.inviteDays || 7) * DAY).toISOString().slice(0, 19).replace('T', ' '), organizationId, row.id)
        .run();
      summary.extended += 1;
      continue;
    }
    const deadline = utc(row.invite_deadline_at);
    if (now.getTime() >= deadline) {
      const gone = await env.DB
        .prepare("UPDATE preinscriptions SET expired_at = datetime('now') WHERE organization_id = ? AND id = ? AND expired_at IS NULL AND completed_at IS NULL RETURNING *")
        .bind(organizationId, row.id)
        .first();
      if (gone) {
        summary.expired += 1;
        expired.push({ row: gone, config });
        await sendPreinscriptionExpired(env, gone, config, siteUrl, organizationId).catch(() => false);
      }
    } else if (!row.invite_reminded_at && now.getTime() >= deadline - REMINDER_DAYS_BEFORE * DAY) {
      const due = await env.DB
        .prepare("UPDATE preinscriptions SET invite_reminded_at = datetime('now') WHERE organization_id = ? AND id = ? AND invite_reminded_at IS NULL RETURNING *")
        .bind(organizationId, row.id)
        .first();
      if (due) {
        summary.reminded += 1;
        await sendPreinscriptionDeadlineReminder(env, due, config, siteUrl, organizationId, missing).catch(() => false);
      }
    }
  }
  if (expired.length) {
    await sendPreinscriptionExpiredClub(env, expired, siteUrl, organizationId).catch(() => false);
    // Places libérées : une liste d'attente pleine pourra de nouveau prévenir le club (fullNotifiedAt remis à zéro).
    for (const groupe of new Set(expired.map((e) => e.row.groupe))) await openPreinscriptionGroupIfFull(env, organizationId, siteUrl, groupe).catch(() => null);
  }
  return summary;
}
